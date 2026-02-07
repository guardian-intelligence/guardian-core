/**
 * Pure secret redaction engine.
 *
 * `redactLine(line)` scrubs secrets (WhatsApp JIDs, phone numbers, API keys,
 * tokens, sensitive paths) from a serialized log line. Replacements are pure
 * ASCII without `"`, `\`, or control chars — cannot break JSON structure.
 *
 * Zero dependencies. Pure string → string.
 */

export interface RedactPattern {
	readonly name: string;
	readonly regex: RegExp;
	readonly replacement: string;
}

export interface RedactConfig {
	readonly enabled: boolean;
	readonly extraPatterns?: readonly RedactPattern[];
}

const BUILT_IN_PATTERNS: readonly RedactPattern[] = [
	// WhatsApp JIDs: 1234567890@s.whatsapp.net, 1234567890-1234567890@g.us
	{ name: 'whatsapp-jid', regex: /\d+@s\.whatsapp\.net/g, replacement: '[JID]' },
	{ name: 'whatsapp-group', regex: /\d+-\d+@g\.us/g, replacement: '[GROUP_JID]' },

	// Phone numbers: +1234567890 (international, 10-15 digits after +)
	{ name: 'phone', regex: /\+\d{10,15}/g, replacement: '[PHONE]' },

	// API keys by VALUE prefix (catches them anywhere in the line)
	{ name: 'anthropic-key', regex: /sk-ant-[A-Za-z0-9_-]{20,}/g, replacement: '[ANTHROPIC_KEY]' },
	{ name: 'openai-key', regex: /sk-[A-Za-z0-9]{20,}/g, replacement: '[OPENAI_KEY]' },
	{ name: 'github-token', regex: /gh[ps]_[A-Za-z0-9]{36,}/g, replacement: '[GITHUB_TOKEN]' },
	{ name: 'elevenlabs-key', regex: /xi-[A-Za-z0-9]{20,}/g, replacement: '[ELEVENLABS_KEY]' },

	// Bearer tokens and JWTs
	{ name: 'bearer', regex: /Bearer [A-Za-z0-9._-]{20,}/g, replacement: 'Bearer [TOKEN]' },
	{
		name: 'jwt',
		regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
		replacement: '[JWT]',
	},

	// Home directory paths: /Users/username/... (macOS)
	{ name: 'home-path', regex: /\/Users\/[\w./-]+/g, replacement: '[HOME_PATH]' },
];

const DEFAULT_CONFIG: RedactConfig = { enabled: true };

export function redactLine(line: string, config?: RedactConfig): string {
	const cfg = config ?? DEFAULT_CONFIG;
	if (!cfg.enabled) return line;

	let result = line;
	for (const p of BUILT_IN_PATTERNS) {
		result = result.replace(p.regex, p.replacement);
	}
	if (cfg.extraPatterns) {
		for (const p of cfg.extraPatterns) {
			result = result.replace(p.regex, p.replacement);
		}
	}
	return result;
}
