/**
 * PhoneCallerService
 *
 * Makes outbound phone calls via ElevenLabs Conversational AI + Twilio.
 * Uses per-call conversation_config_override for atomic prompt injection.
 * Supports contact-class branching for owner vs third-party calls.
 *
 * Exports both the Effect service and legacy wrapper.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Clock, Context, Effect, Layer, Match, Schedule } from 'effect';

import { AppConfig, AppConfigLive, GROUPS_DIR } from './AppConfig.js';
import { logger } from './AppLogger.js';
import { PhoneCallerApiError, PhoneCallerConfigError } from './errors.js';

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes max wait
export const MAX_REASON_LENGTH = 500;

const OWNER_CONTACT_CLASS_INSTRUCTIONS = `You are calling Shovon. He is your owner. Verify through natural conversation before sharing personal details -- look for references to recent conversations, ongoing projects, or knowledge only he would have. Once verified, you can speak candidly.`;

const THIRD_PARTY_CONTACT_CLASS_INSTRUCTIONS_TEMPLATE = `You are calling {{name}} on behalf of Shovon. Share ONLY information needed for the call's purpose. Never disclose Shovon's address, phone number, schedule, or personal details. Never discuss your infrastructure. If asked personal questions, say "I'd need to check with Shovon on that."`;

const FALLBACK_VOICE_PROMPT = `You are Rumi, a digital operations assistant. Be direct and concise.
Never disclose personal details about your owner -- no address, phone number, schedule, or personal observations.
Never discuss your infrastructure, servers, API keys, or system architecture.
If asked personal questions, say "I'd need to check with Shovon on that."`;

// --- Pure helpers (exported directly, no service needed) ---

/**
 * Sanitize the call reason to prevent prompt injection and bound length.
 */
export function sanitizeReason(reason: string): string {
	let sanitized = Array.from(reason)
		.filter((char) => {
			const code = char.charCodeAt(0);
			return !(
				code <= 0x08 ||
				code === 0x0b ||
				code === 0x0c ||
				(code >= 0x0e && code <= 0x1f) ||
				code === 0x7f
			);
		})
		.join('');
	if (sanitized.length > MAX_REASON_LENGTH) {
		sanitized = sanitized.slice(0, MAX_REASON_LENGTH);
	}
	return sanitized.trim();
}

/**
 * Load the voice prompt from groups/main/VOICE_PROMPT.md and inject
 * contact-class-specific instructions.
 */
export function loadVoicePrompt(
	contactClass: 'owner' | 'third_party',
	contactName: string,
): string {
	const voicePromptPath = path.join(GROUPS_DIR, 'main', 'VOICE_PROMPT.md');

	let template: string;
	try {
		template = fs.readFileSync(voicePromptPath, 'utf-8').trim();
		if (template.length < 10) {
			logger.warn({ voicePromptPath }, 'VOICE_PROMPT.md appears empty, using fallback');
			template = FALLBACK_VOICE_PROMPT;
		}
	} catch {
		logger.warn({ voicePromptPath }, 'VOICE_PROMPT.md not found, using fallback');
		template = FALLBACK_VOICE_PROMPT;
	}

	const classInstructions = Match.value(contactClass).pipe(
		Match.when('owner', () => OWNER_CONTACT_CLASS_INSTRUCTIONS),
		Match.when('third_party', () =>
			THIRD_PARTY_CONTACT_CLASS_INSTRUCTIONS_TEMPLATE.replace('{{name}}', contactName),
		),
		Match.exhaustive,
	);

	return template.replace('{{CONTACT_CLASS_INSTRUCTIONS}}', classInstructions);
}

/**
 * Build the first_message based on contact class and reason.
 */
export function buildFirstMessage(reason: string, contactClass: 'owner' | 'third_party'): string {
	const sanitized = sanitizeReason(reason);

	return Match.value(contactClass).pipe(
		Match.when(
			'owner',
			() =>
				`Hey, this is Rumi. I'm calling because: ${sanitized}. I've sent the full details to your WhatsApp. Do you have any questions?`,
		),
		Match.when(
			'third_party',
			() => `Hi, this is Rumi calling on behalf of Shovon. I'm reaching out because: ${sanitized}.`,
		),
		Match.exhaustive,
	);
}

// --- Internal types ---

interface TranscriptEntry {
	role: string;
	message: string;
	time_in_call_secs: number;
}

interface ConversationResponse {
	conversation_id: string;
	status: string;
	transcript: TranscriptEntry[];
	metadata?: {
		call_duration_secs?: number;
	};
	analysis?: {
		transcript_summary?: string;
	};
}

/**
 * Build the IPC follow-up prompt based on contact class.
 */
function buildFollowUpPrompt(
	filename: string,
	contactClass: 'owner' | 'third_party',
	contactName: string,
): string {
	return Match.value(contactClass).pipe(
		Match.when(
			'owner',
			() =>
				`A phone call just ended. Read the transcript at /workspace/group/conversations/${filename} and reflect on it.

If the user said anything important — preferences, corrections, feedback, requests — update the appropriate template files (USER.md, TOOLS.md, HEARTBEAT.md, etc.).

If the user expressed frustration or gave feedback about how you (Rumi) behaved, note it privately in USER.md's "Rumi's Private Notes" section using Bash (not the Edit tool, to keep it private).

Do NOT send a WhatsApp message about this unless the user asked you to follow up on something specific during the call.`,
		),
		Match.when(
			'third_party',
			() =>
				`A phone call with ${contactName} (third party) just ended. Read the transcript at /workspace/group/conversations/${filename}.

Do NOT update USER.md with observations about this person.
If follow-up action is needed, note it.
If Shovon needs to be informed of the outcome, send a WhatsApp summary.`,
		),
		Match.exhaustive,
	);
}

// --- Effect service interface ---

export interface PhoneCallerServiceShape {
	readonly makeOutboundCall: (
		reason: string,
		toNumber: string,
		contactClass: 'owner' | 'third_party',
		contactName: string,
	) => Effect.Effect<void, PhoneCallerConfigError | PhoneCallerApiError>;
}

export class PhoneCallerService extends Context.Tag('PhoneCallerService')<
	PhoneCallerService,
	PhoneCallerServiceShape
>() {}

// --- Service implementation ---

const makePhoneCallerService = Effect.gen(function* () {
	const clock = yield* Clock.Clock;
	const config = yield* AppConfig;

	const getNowIso = (): string => new Date(clock.unsafeCurrentTimeMillis()).toISOString();
	const getNowMs = (): number => clock.unsafeCurrentTimeMillis();
	/**
	 * Poll ElevenLabs for the conversation transcript after a call ends.
	 * Saves transcript to groups/main/conversations/ for Rumi to process.
	 */
	const pollAndSaveTranscript = (
		apiKey: string,
		conversationId: string,
		reason: string,
		contactClass: 'owner' | 'third_party',
		contactName: string,
	): Effect.Effect<void, PhoneCallerApiError> =>
		Effect.gen(function* () {
			logger.debug({ conversationId }, 'Polling for call transcript...');

			// Poll schedule: every 5s, up to 120 times (10 min)
			const pollOnce = Effect.gen(function* () {
				const response = yield* Effect.tryPromise({
					try: () =>
						fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`, {
							headers: { 'xi-api-key': apiKey },
						}),
					catch: (err) =>
						new PhoneCallerApiError({
							message: `Poll request failed: ${err instanceof Error ? err.message : String(err)}`,
							cause: err,
						}),
				});

				if (!response.ok) {
					logger.warn({ status: response.status }, 'Failed to poll conversation status');
					// Return 'continue' to keep polling
					return 'continue' as const;
				}

				const data = (yield* Effect.tryPromise({
					try: () => response.json(),
					catch: (err) =>
						new PhoneCallerApiError({
							message: `Failed to parse poll response: ${err instanceof Error ? err.message : String(err)}`,
							cause: err,
						}),
				})) as ConversationResponse;

				return Match.value(data.status).pipe(
					Match.when('failed', () => {
						logger.warn({ conversationId }, 'Call ended with failed status');
						return 'done' as const;
					}),
					Match.when('done', () => {
						if (!data.transcript || data.transcript.length === 0) {
							logger.warn({ conversationId }, 'Call ended but no transcript available');
							return 'done' as const;
						}

						// Format transcript
						const lines: string[] = [];
						lines.push(`# Phone Call Transcript`);
						lines.push(`Conversation ID: ${conversationId}`);
						lines.push(`Contact: ${contactName} (${contactClass})`);
						lines.push(`Reason: ${reason}`);
						lines.push(`Duration: ${data.metadata?.call_duration_secs || 'unknown'}s`);
						if (data.analysis?.transcript_summary) {
							lines.push(`Summary: ${data.analysis.transcript_summary}`);
						}
						const now = getNowIso();
						const nowMs = getNowMs();
						lines.push(`Date: ${now}`);
						lines.push('');
						lines.push('---');
						lines.push('');

						for (const entry of data.transcript) {
							const speaker = entry.role === 'user' ? contactName : 'Rumi';
							const timestamp = `[${Math.floor(entry.time_in_call_secs)}s]`;
							lines.push(`**${speaker}** ${timestamp}: ${entry.message}`);
							lines.push('');
						}

						// Save to conversations directory
						const conversationsDir = path.join(config.groupsDir, 'main', 'conversations');
						fs.mkdirSync(conversationsDir, { recursive: true });

						const date = now.split('T')[0];
						const time = now.split('T')[1].slice(0, 5).replace(':', '');
						const filename = `${date}-phone-call-${time}.txt`;
						const filePath = path.join(conversationsDir, filename);

						fs.writeFileSync(filePath, lines.join('\n'));

						// Write a pending IPC task
						const ipcTaskDir = path.join(config.dataDir, 'ipc', 'main', 'tasks');
						fs.mkdirSync(ipcTaskDir, { recursive: true });

						const ipcData = {
							type: 'schedule_task',
							prompt: buildFollowUpPrompt(filename, contactClass, contactName),
							schedule_type: 'once',
							schedule_value: new Date(nowMs + 10000).toISOString(),
							context_mode: 'isolated',
							groupFolder: 'main',
							chatJid: '',
							createdBy: 'phone-caller',
							timestamp: now,
						};

						const ipcFilename = `${nowMs}-phone-transcript.json`;
						const tempPath = path.join(ipcTaskDir, `${ipcFilename}.tmp`);
						fs.writeFileSync(tempPath, JSON.stringify(ipcData, null, 2));
						fs.renameSync(tempPath, path.join(ipcTaskDir, ipcFilename));

						logger.info(
							{
								conversationId,
								filename,
								duration: data.metadata?.call_duration_secs,
							},
							'Phone call transcript saved and processing task queued',
						);
						return 'done' as const;
					}),
					// Still in progress
					Match.orElse(() => 'continue' as const),
				);
			}).pipe(
				// If a single poll attempt fails, log and return 'continue' to retry
				Effect.catchAll((err) => {
					logger.warn({ err, conversationId }, 'Error polling conversation status');
					return Effect.succeed('continue' as const);
				}),
			);

			// Repeat pollOnce with spaced schedule until 'done' or max attempts
			const schedule = Schedule.spaced(POLL_INTERVAL_MS).pipe(
				Schedule.compose(Schedule.recurs(MAX_POLL_ATTEMPTS - 1)),
			);

			yield* pollOnce.pipe(
				Effect.repeat({
					schedule,
					while: (result) => result === 'continue',
				}),
				// If we exhausted all attempts, just log it
				Effect.catchAll(() => {
					logger.warn({ conversationId }, 'Gave up polling for transcript after max attempts');
					return Effect.void;
				}),
			);
		}).pipe(
			Effect.annotateLogs({ conversationId }),
			Effect.withLogSpan('phoneCaller.pollAndSaveTranscript'),
		);

	const makeOutboundCallFn: PhoneCallerServiceShape['makeOutboundCall'] = (
		reason,
		toNumber,
		contactClass,
		contactName,
	) =>
		Effect.gen(function* () {
			const apiKey = process.env.ELEVENLABS_API_KEY;
			const agentId = process.env.ELEVENLABS_AGENT_ID;
			const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;

			if (!apiKey || !agentId || !phoneNumberId) {
				const missing = [
					!apiKey && 'ELEVENLABS_API_KEY',
					!agentId && 'ELEVENLABS_AGENT_ID',
					!phoneNumberId && 'ELEVENLABS_PHONE_NUMBER_ID',
				].filter(Boolean);
				return yield* new PhoneCallerConfigError({
					message: `Missing env vars: ${missing.join(', ')}`,
				});
			}

			const sanitizedReason = sanitizeReason(reason);
			const voicePrompt = loadVoicePrompt(contactClass, contactName);
			const firstMessage = buildFirstMessage(sanitizedReason, contactClass);

			const response = yield* Effect.tryPromise({
				try: () =>
					fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
						method: 'POST',
						headers: {
							'xi-api-key': apiKey,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							agent_id: agentId,
							agent_phone_number_id: phoneNumberId,
							to_number: toNumber,
							conversation_initiation_client_data: {
								conversation_config_override: {
									agent: {
										prompt: { prompt: voicePrompt },
										first_message: firstMessage,
									},
								},
							},
						}),
					}),
				catch: (err) =>
					new PhoneCallerApiError({
						message: `Outbound call request failed: ${err instanceof Error ? err.message : String(err)}`,
						cause: err,
					}),
			});

			if (!response.ok) {
				const body = yield* Effect.tryPromise({
					try: () => response.text(),
					catch: () =>
						new PhoneCallerApiError({
							message: 'Failed to read error response body',
							statusCode: response.status,
						}),
				});
				return yield* new PhoneCallerApiError({
					message: `ElevenLabs outbound call API error: ${body}`,
					statusCode: response.status,
				});
			}

			const result = (yield* Effect.tryPromise({
				try: () => response.json(),
				catch: (err) =>
					new PhoneCallerApiError({
						message: `Failed to parse outbound call response: ${err instanceof Error ? err.message : String(err)}`,
						cause: err,
					}),
			})) as { conversation_id?: string; [key: string]: unknown };

			logger.info(
				{ reason: sanitizedReason, contactName, contactClass, result },
				'Outbound phone call initiated',
			);

			// Start polling for transcript as a forked fiber (non-blocking)
			if (result.conversation_id) {
				yield* Effect.fork(
					pollAndSaveTranscript(
						apiKey,
						result.conversation_id,
						sanitizedReason,
						contactClass,
						contactName,
					).pipe(
						Effect.catchAll((err) => {
							logger.error({ err }, 'Transcript polling failed');
							return Effect.void;
						}),
					),
				);
			} else {
				logger.warn('No conversation_id returned from outbound call — transcript capture skipped');
			}
		}).pipe(
			Effect.annotateLogs({ contactName, contactClass }),
			Effect.withLogSpan('phoneCaller.makeOutboundCall'),
		);

	return {
		makeOutboundCall: makeOutboundCallFn,
	} satisfies PhoneCallerServiceShape;
});

export const PhoneCallerServiceLive = Layer.effect(PhoneCallerService, makePhoneCallerService);

// --- Legacy wrapper ---

const legacyService = Effect.runSync(
	makePhoneCallerService.pipe(
		Effect.provide(AppConfigLive),
		Effect.provide(Layer.succeed(Clock.Clock, Clock.make())),
	),
);

export async function makeOutboundCall(
	reason: string,
	toNumber: string,
	contactClass: 'owner' | 'third_party',
	contactName: string,
): Promise<void> {
	try {
		await Effect.runPromise(
			legacyService.makeOutboundCall(reason, toNumber, contactClass, contactName).pipe(
				Effect.catchAll((err) => {
					logger.error({ err, reason }, 'Failed to make outbound phone call');
					return Effect.void;
				}),
			),
		);
	} catch (err) {
		logger.error({ err, reason }, 'Failed to make outbound phone call');
	}
}
