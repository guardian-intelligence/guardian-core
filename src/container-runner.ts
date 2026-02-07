/**
 * ContainerRunnerService
 *
 * Spawns agent execution in Docker container and handles IPC.
 * Exports both the Effect service and legacy wrappers.
 */
import { exec, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Clock, Context, Effect, Layer, Match } from 'effect';

import {
	AppConfigLive,
	CONTAINER_IMAGE,
	CONTAINER_MAX_OUTPUT_SIZE,
	CONTAINER_TIMEOUT,
	DATA_DIR,
	GROUPS_DIR,
} from './AppConfig.js';
import { logger } from './AppLogger.js';
import {
	ContainerExitError,
	ContainerOutputParseError,
	ContainerSpawnError,
	ContainerTimeoutError,
} from './errors.js';
import { validateAdditionalMounts } from './MountSecurityService.js';
import type { RegisteredGroup } from './schemas.js';

// Sentinel markers for robust output parsing (must match agent-runner)
const OUTPUT_START_MARKER = '---GUARDIAN_CORE_OUTPUT_START---';
const OUTPUT_END_MARKER = '---GUARDIAN_CORE_OUTPUT_END---';

export interface ContainerInput {
	prompt: string;
	sessionId?: string;
	groupFolder: string;
	chatJid: string;
	isMain: boolean;
	isScheduledTask?: boolean;
}

export interface ContainerOutput {
	status: 'success' | 'error';
	result: string | null;
	newSessionId?: string;
	error?: string;
}

interface VolumeMount {
	hostPath: string;
	containerPath: string;
	readonly?: boolean;
}

// --- Pure helpers (no Effect, no side effects beyond fs) ---

function buildVolumeMounts(group: RegisteredGroup, isMain: boolean): VolumeMount[] {
	const mounts: VolumeMount[] = [];
	const projectRoot = process.cwd();

	if (isMain) {
		mounts.push({
			hostPath: projectRoot,
			containerPath: '/workspace/project',
			readonly: false,
		});
		mounts.push({
			hostPath: path.join(GROUPS_DIR, group.folder),
			containerPath: '/workspace/group',
			readonly: false,
		});
	} else {
		mounts.push({
			hostPath: path.join(GROUPS_DIR, group.folder),
			containerPath: '/workspace/group',
			readonly: false,
		});
		const globalDir = path.join(GROUPS_DIR, 'global');
		if (fs.existsSync(globalDir)) {
			mounts.push({
				hostPath: globalDir,
				containerPath: '/workspace/global',
				readonly: true,
			});
		}
	}

	const groupSessionsDir = path.join(DATA_DIR, 'sessions', group.folder, '.claude');
	fs.mkdirSync(groupSessionsDir, { recursive: true });
	mounts.push({
		hostPath: groupSessionsDir,
		containerPath: '/home/node/.claude',
		readonly: false,
	});

	const groupIpcDir = path.join(DATA_DIR, 'ipc', group.folder);
	fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
	fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
	mounts.push({
		hostPath: groupIpcDir,
		containerPath: '/workspace/ipc',
		readonly: false,
	});

	const envDir = path.join(DATA_DIR, 'env');
	fs.mkdirSync(envDir, { recursive: true });
	const envFile = path.join(projectRoot, '.env');
	if (fs.existsSync(envFile)) {
		const envContent = fs.readFileSync(envFile, 'utf-8');
		const allowedVars = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN'];
		const filteredLines = envContent.split('\n').filter((line) => {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) return false;
			return allowedVars.some((v) => trimmed.startsWith(`${v}=`));
		});

		if (filteredLines.length > 0) {
			fs.writeFileSync(path.join(envDir, 'env'), filteredLines.join('\n') + '\n');
			mounts.push({
				hostPath: envDir,
				containerPath: '/workspace/env-dir',
				readonly: true,
			});
		}
	}

	if (group.containerConfig?.additionalMounts) {
		const validatedMounts = validateAdditionalMounts(
			group.containerConfig.additionalMounts,
			group.name,
			isMain,
		);
		mounts.push(...validatedMounts);
	}

	return mounts;
}

function buildContainerArgs(mounts: VolumeMount[], containerName: string): string[] {
	const args: string[] = ['run', '-i', '--rm', '--name', containerName];

	for (const mount of mounts) {
		if (mount.readonly) {
			args.push('-v', `${mount.hostPath}:${mount.containerPath}:ro`);
		} else {
			args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
		}
	}

	args.push(CONTAINER_IMAGE);
	return args;
}

// --- Effect service interface ---

export interface ContainerRunnerServiceShape {
	readonly runContainerAgent: (
		group: RegisteredGroup,
		input: ContainerInput,
	) => Effect.Effect<
		ContainerOutput,
		ContainerSpawnError | ContainerTimeoutError | ContainerExitError | ContainerOutputParseError
	>;
	readonly writeTasksSnapshot: (
		groupFolder: string,
		isMain: boolean,
		tasks: Array<{
			id: string;
			groupFolder: string;
			prompt: string;
			schedule_type: string;
			schedule_value: string;
			status: string;
			next_run: string | null;
		}>,
	) => Effect.Effect<void>;
	readonly writeGroupsSnapshot: (
		groupFolder: string,
		isMain: boolean,
		groups: AvailableGroup[],
		registeredJids: Set<string>,
	) => Effect.Effect<void>;
}

export class ContainerRunnerService extends Context.Tag('ContainerRunnerService')<
	ContainerRunnerService,
	ContainerRunnerServiceShape
>() {}

export interface AvailableGroup {
	jid: string;
	name: string;
	lastActivity: string;
	isRegistered: boolean;
}

// --- Service implementation ---

const makeContainerRunnerService = Effect.gen(function* () {
	const clock = yield* Clock.Clock;
	const getNowIso = (): string => new Date(clock.unsafeCurrentTimeMillis()).toISOString();
	const getNowMs = (): number => clock.unsafeCurrentTimeMillis();

	const runContainerAgentFn: ContainerRunnerServiceShape['runContainerAgent'] = (group, input) =>
		Effect.gen(function* () {
			const startTime = getNowMs();

			const groupDir = path.join(GROUPS_DIR, group.folder);
			fs.mkdirSync(groupDir, { recursive: true });

			const mounts = buildVolumeMounts(group, input.isMain);
			const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
			const containerName = `guardian-core-${safeName}-${getNowMs()}`;
			const containerArgs = buildContainerArgs(mounts, containerName);

			logger.debug(
				{
					group: group.name,
					containerName,
					mounts: mounts.map(
						(m) => `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
					),
					containerArgs: containerArgs.join(' '),
				},
				'Container mount configuration',
			);

			logger.info(
				{
					group: group.name,
					containerName,
					mountCount: mounts.length,
					isMain: input.isMain,
				},
				'Spawning container agent',
			);

			const logsDir = path.join(GROUPS_DIR, group.folder, 'logs');
			fs.mkdirSync(logsDir, { recursive: true });

			const timeoutMs = group.containerConfig?.timeout || CONTAINER_TIMEOUT;

			// Core container execution as Effect.async
			const containerEffect = Effect.async<
				ContainerOutput,
				ContainerSpawnError | ContainerTimeoutError | ContainerExitError | ContainerOutputParseError
			>((resume) => {
				const container = spawn('docker', containerArgs, {
					stdio: ['pipe', 'pipe', 'pipe'],
				});

				let stdout = '';
				let stderr = '';
				let stdoutTruncated = false;
				let stderrTruncated = false;

				container.stdin.write(JSON.stringify(input));
				container.stdin.end();

				container.stdout.on('data', (data) => {
					if (stdoutTruncated) return;
					const chunk = data.toString();
					const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
					if (chunk.length > remaining) {
						stdout += chunk.slice(0, remaining);
						stdoutTruncated = true;
						logger.warn(
							{ group: group.name, size: stdout.length },
							'Container stdout truncated due to size limit',
						);
					} else {
						stdout += chunk;
					}
				});

				container.stderr.on('data', (data) => {
					const chunk = data.toString();
					const lines = chunk.trim().split('\n');
					for (const line of lines) {
						if (line) logger.debug({ container: group.folder }, line);
					}
					if (stderrTruncated) return;
					const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
					if (chunk.length > remaining) {
						stderr += chunk.slice(0, remaining);
						stderrTruncated = true;
						logger.warn(
							{ group: group.name, size: stderr.length },
							'Container stderr truncated due to size limit',
						);
					} else {
						stderr += chunk;
					}
				});

				container.on('close', (code) => {
					const duration = getNowMs() - startTime;

					const timestamp = getNowIso().replace(/[:.]/g, '-');
					const logFile = path.join(logsDir, `container-${timestamp}.log`);
					const isVerbose = process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

					const logLines = [
						`=== Container Run Log ===`,
						`Timestamp: ${getNowIso()}`,
						`Group: ${group.name}`,
						`IsMain: ${input.isMain}`,
						`Duration: ${duration}ms`,
						`Exit Code: ${code}`,
						`Stdout Truncated: ${stdoutTruncated}`,
						`Stderr Truncated: ${stderrTruncated}`,
						``,
					];

					if (isVerbose) {
						logLines.push(
							`=== Input ===`,
							JSON.stringify(input, null, 2),
							``,
							`=== Container Args ===`,
							containerArgs.join(' '),
							``,
							`=== Mounts ===`,
							mounts
								.map((m) => `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
								.join('\n'),
							``,
							`=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
							stderr,
							``,
							`=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
							stdout,
						);
					} else {
						logLines.push(
							`=== Input Summary ===`,
							`Prompt length: ${input.prompt.length} chars`,
							`Session ID: ${input.sessionId || 'new'}`,
							``,
							`=== Mounts ===`,
							mounts.map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`).join('\n'),
							``,
						);

						if (code !== 0) {
							logLines.push(`=== Stderr (last 500 chars) ===`, stderr.slice(-500), ``);
						}
					}

					fs.writeFileSync(logFile, logLines.join('\n'));
					logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

					if (code !== 0) {
						logger.error(
							{
								group: group.name,
								code,
								duration,
								stderr: stderr.slice(-500),
								logFile,
							},
							'Container exited with error',
						);

						resume(
							Effect.fail(
								new ContainerExitError({
									group: group.name,
									exitCode: code ?? -1,
									stderr: stderr.slice(-200),
								}),
							),
						);
						return;
					}

					try {
						const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
						const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

						let jsonLine: string;
						if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
							jsonLine = stdout.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
						} else {
							const lines = stdout.trim().split('\n');
							jsonLine = lines[lines.length - 1];
						}

						const output: ContainerOutput = JSON.parse(jsonLine);

						logger.info(
							{
								group: group.name,
								duration,
								status: output.status,
								hasResult: !!output.result,
							},
							'Container completed',
						);

						resume(Effect.succeed(output));
					} catch (err) {
						logger.error(
							{
								group: group.name,
								stdout: stdout.slice(-500),
								error: err,
							},
							'Failed to parse container output',
						);

						resume(
							Effect.fail(
								new ContainerOutputParseError({
									group: group.name,
									message: `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`,
									stdout: stdout.slice(-500),
								}),
							),
						);
					}
				});

				container.on('error', (err) => {
					logger.error({ group: group.name, containerName, error: err }, 'Container spawn error');
					resume(
						Effect.fail(
							new ContainerSpawnError({
								group: group.name,
								message: `Container spawn error: ${err.message}`,
								cause: err,
							}),
						),
					);
				});

				// Return cleanup function for Effect.onInterrupt
				return Effect.sync(() => {
					// Graceful stop: sends SIGTERM, waits, then SIGKILL
					exec(`docker stop ${containerName}`, { timeout: 15000 }, (err) => {
						if (err) {
							logger.warn(
								{ group: group.name, containerName, err },
								'Graceful stop failed, force killing',
							);
							container.kill('SIGKILL');
						}
					});
				});
			});

			// Apply timeout
			const output = yield* containerEffect.pipe(
				Effect.timeoutFail({
					duration: timeoutMs,
					onTimeout: () => {
						const ts = getNowIso().replace(/[:.]/g, '-');
						const timeoutLog = path.join(logsDir, `container-${ts}.log`);
						fs.writeFileSync(
							timeoutLog,
							[
								`=== Container Run Log (TIMEOUT) ===`,
								`Timestamp: ${getNowIso()}`,
								`Group: ${group.name}`,
								`Container: ${containerName}`,
								`Duration: ${getNowMs() - startTime}ms`,
							].join('\n'),
						);

						logger.error({ group: group.name, containerName }, 'Container timed out');

						return new ContainerTimeoutError({
							group: group.name,
							timeoutMs,
						});
					},
				}),
				Effect.onInterrupt(() =>
					Effect.sync(() => {
						exec(`docker stop ${containerName}`, { timeout: 15000 }, (err) => {
							if (err) {
								logger.warn(
									{ group: group.name, containerName, err },
									'Graceful stop on interrupt failed',
								);
							}
						});
					}),
				),
			);

			return output;
		}).pipe(
			Effect.annotateLogs({
				group: group.name,
				isMain: String(input.isMain),
			}),
			Effect.withLogSpan('container.run'),
		);

	const writeTasksSnapshotFn: ContainerRunnerServiceShape['writeTasksSnapshot'] = (
		groupFolder,
		isMain,
		tasks,
	) =>
		Effect.sync(() => {
			const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
			fs.mkdirSync(groupIpcDir, { recursive: true });

			const filteredTasks = isMain ? tasks : tasks.filter((t) => t.groupFolder === groupFolder);

			const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
			fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
		});

	const writeGroupsSnapshotFn: ContainerRunnerServiceShape['writeGroupsSnapshot'] = (
		groupFolder,
		isMain,
		groups,
		_registeredJids,
	) =>
		Effect.sync(() => {
			const groupIpcDir = path.join(DATA_DIR, 'ipc', groupFolder);
			fs.mkdirSync(groupIpcDir, { recursive: true });

			const visibleGroups = isMain ? groups : [];

			const groupsFile = path.join(groupIpcDir, 'available_groups.json');
			fs.writeFileSync(
				groupsFile,
				JSON.stringify(
					{
						groups: visibleGroups,
						lastSync: getNowIso(),
					},
					null,
					2,
				),
			);
		});

	return {
		runContainerAgent: runContainerAgentFn,
		writeTasksSnapshot: writeTasksSnapshotFn,
		writeGroupsSnapshot: writeGroupsSnapshotFn,
	} satisfies ContainerRunnerServiceShape;
});

export const ContainerRunnerServiceLive = Layer.effect(
	ContainerRunnerService,
	makeContainerRunnerService,
);

// --- Legacy wrappers ---

const legacyService = Effect.runSync(
	makeContainerRunnerService.pipe(
		Effect.provide(AppConfigLive),
		Effect.provide(Layer.succeed(Clock.Clock, Clock.make())),
	),
);

export async function runContainerAgent(
	group: RegisteredGroup,
	input: ContainerInput,
): Promise<ContainerOutput> {
	try {
		return await Effect.runPromise(
			legacyService.runContainerAgent(group, input).pipe(
				Effect.catchAll(
					(
						err:
							| ContainerSpawnError
							| ContainerTimeoutError
							| ContainerExitError
							| ContainerOutputParseError,
					) => {
						// Map tagged errors to ContainerOutput { status: 'error' } (preserving never-throw behavior)
						const errorMessage = Match.value(err).pipe(
							Match.tag(
								'ContainerTimeoutError',
								(e) => `Container timed out after ${e.timeoutMs}ms`,
							),
							Match.tag(
								'ContainerExitError',
								(e) => `Container exited with code ${e.exitCode}: ${e.stderr ?? ''}`,
							),
							Match.tag('ContainerSpawnError', (e) => `${e._tag}: ${e.message}`),
							Match.tag('ContainerOutputParseError', (e) => `${e._tag}: ${e.message}`),
							Match.exhaustive,
						);
						return Effect.succeed({
							status: 'error' as const,
							result: null,
							error: errorMessage,
						});
					},
				),
			),
		);
	} catch (err) {
		return {
			status: 'error',
			result: null,
			error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

export function writeTasksSnapshot(
	groupFolder: string,
	isMain: boolean,
	tasks: Array<{
		id: string;
		groupFolder: string;
		prompt: string;
		schedule_type: string;
		schedule_value: string;
		status: string;
		next_run: string | null;
	}>,
): void {
	Effect.runSync(legacyService.writeTasksSnapshot(groupFolder, isMain, tasks));
}

export function writeGroupsSnapshot(
	groupFolder: string,
	isMain: boolean,
	groups: AvailableGroup[],
	registeredJids: Set<string>,
): void {
	Effect.runSync(legacyService.writeGroupsSnapshot(groupFolder, isMain, groups, registeredJids));
}
