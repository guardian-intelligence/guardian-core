/**
 * Guardian Core deploy services — Effect TypeScript, cross-platform (launchd + systemd).
 *
 * Services: ShellService, PlatformService, DeployService
 * Entry point: scripts/deploy.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Context, Effect, Layer } from 'effect';

import { fail, info, ok, warn } from './DeployLogger.js';
import { DeployError } from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Mode = 'smart' | 'app' | 'container' | 'all';

interface DetectResult {
	readonly needApp: boolean;
	readonly needContainer: boolean;
}

// ---------------------------------------------------------------------------
// Project root
// ---------------------------------------------------------------------------

/** Resolve project root from this file's location (src/deploy.ts → ..) */
function projectRoot(): string {
	return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
}

// ---------------------------------------------------------------------------
// 1. ShellService — I/O boundary
// ---------------------------------------------------------------------------

export interface ShellServiceShape {
	readonly run: (cmd: string, args: readonly string[]) => Effect.Effect<string, DeployError>;
}

export class ShellService extends Context.Tag('ShellService')<ShellService, ShellServiceShape>() {}

/**
 * Live ShellService that delegates to an executor function.
 * The executor is injected so the module doesn't reference Bun globals directly
 * (which would break tsc and vitest).
 */
export function makeShellServiceLive(
	executor: (
		cmd: string,
		args: readonly string[],
		cwd: string,
	) => { exitCode: number; stdout: string; stderr: string },
): Layer.Layer<ShellService> {
	return Layer.succeed(ShellService, {
		run: (cmd, args) =>
			Effect.gen(function* () {
				yield* Effect.logDebug(`$ ${cmd} ${args.join(' ')}`);
				const result = executor(cmd, args, projectRoot());
				if (result.exitCode !== 0) {
					yield* Effect.logError('Command failed').pipe(
						Effect.annotateLogs({
							exitCode: result.exitCode,
							stderr: result.stderr,
							cmd,
							args: args.join(' '),
						}),
					);
					return yield* new DeployError({
						stage: 'shell',
						message: `Command failed (exit ${result.exitCode}): ${cmd} ${args.join(' ')}\n${result.stderr || result.stdout}`,
					});
				}
				return result.stdout;
			}).pipe(Effect.withLogSpan('shell.run'), Effect.annotateLogs({ cmd, args: args.join(' ') })),
	});
}

// ---------------------------------------------------------------------------
// 2. PlatformService — OS abstraction
// ---------------------------------------------------------------------------

export interface PlatformServiceShape {
	readonly platform: 'darwin' | 'linux';
	readonly installServiceTemplate: Effect.Effect<void, DeployError>;
	readonly restartService: Effect.Effect<void, DeployError>;
	readonly verifyService: Effect.Effect<void, DeployError>;
}

export class PlatformService extends Context.Tag('PlatformService')<
	PlatformService,
	PlatformServiceShape
>() {}

function resolveTemplate(templatePath: string): string {
	const root = projectRoot();
	const home = os.homedir();
	const nodePath = process.execPath;
	let content = fs.readFileSync(templatePath, 'utf-8');
	content = content.replaceAll('{{NODE_PATH}}', nodePath);
	content = content.replaceAll('{{PROJECT_ROOT}}', root);
	content = content.replaceAll('{{HOME}}', home);
	return content;
}

function makeDarwinPlatform(shell: ShellServiceShape): PlatformServiceShape {
	const root = projectRoot();
	const home = os.homedir();
	const plistSrc = path.join(root, 'launchd', 'com.guardian-core.plist');
	const plistDst = path.join(home, 'Library', 'LaunchAgents', 'com.guardian-core.plist');

	return {
		platform: 'darwin',

		installServiceTemplate: Effect.gen(function* () {
			if (!fs.existsSync(plistSrc)) {
				return yield* new DeployError({
					stage: 'installServiceTemplate',
					message: `Template not found: ${plistSrc}`,
				});
			}
			yield* info('Installing launchd plist...');
			const content = resolveTemplate(plistSrc);
			fs.writeFileSync(plistDst, content);
			yield* ok(`Plist installed to ${plistDst}`);
		}).pipe(Effect.withLogSpan('platform.installServiceTemplate')),

		restartService: Effect.gen(function* () {
			yield* info('Restarting service...');
			fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
			yield* shell
				.run('launchctl', ['unload', plistDst])
				.pipe(Effect.catchAll(() => Effect.succeed('')));
			yield* Effect.sleep('1 second');
			yield* shell.run('launchctl', ['load', plistDst]);
			yield* ok('Service restarted');
		}).pipe(Effect.withLogSpan('platform.restartService')),

		verifyService: Effect.gen(function* () {
			yield* Effect.sleep('2 seconds');
			yield* info('Verifying service...');
			const output = yield* shell.run('launchctl', ['list']);
			const line = output.split('\n').find((l) => l.includes('com.guardian-core'));
			if (!line) {
				yield* fail('Service not found in launchctl — check the plist');
				return yield* new DeployError({
					stage: 'verify',
					message: 'Service not found in launchctl',
				});
			}
			const pid = line.trim().split(/\s+/)[0];
			if (pid && pid !== '-') {
				yield* ok(`Service running (PID: ${pid})`);
			} else {
				yield* warn('Service loaded but not running yet — check logs/guardian-core.error.log');
			}
		}).pipe(Effect.withLogSpan('platform.verifyService')),
	};
}

function makeLinuxPlatform(shell: ShellServiceShape): PlatformServiceShape {
	const root = projectRoot();
	const home = os.homedir();
	const unitSrc = path.join(root, 'systemd', 'guardian-core.service');
	const unitDst = path.join(home, '.config', 'systemd', 'user', 'guardian-core.service');

	return {
		platform: 'linux',

		installServiceTemplate: Effect.gen(function* () {
			if (!fs.existsSync(unitSrc)) {
				return yield* new DeployError({
					stage: 'installServiceTemplate',
					message: `Template not found: ${unitSrc}`,
				});
			}
			yield* info('Installing systemd unit...');
			fs.mkdirSync(path.dirname(unitDst), { recursive: true });
			const content = resolveTemplate(unitSrc);
			fs.writeFileSync(unitDst, content);
			yield* ok(`Unit installed to ${unitDst}`);
		}).pipe(Effect.withLogSpan('platform.installServiceTemplate')),

		restartService: Effect.gen(function* () {
			yield* info('Restarting service...');
			fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
			yield* shell.run('systemctl', ['--user', 'daemon-reload']);
			yield* shell.run('systemctl', ['--user', 'restart', 'guardian-core']);
			yield* ok('Service restarted');
		}).pipe(Effect.withLogSpan('platform.restartService')),

		verifyService: Effect.gen(function* () {
			yield* Effect.sleep('2 seconds');
			yield* info('Verifying service...');
			const status = yield* shell.run('systemctl', ['--user', 'is-active', 'guardian-core']);
			if (status.trim() === 'active') {
				yield* ok('Service running');
			} else {
				yield* warn(`Service status: ${status.trim()} — check logs/guardian-core.error.log`);
			}
		}).pipe(Effect.withLogSpan('platform.verifyService')),
	};
}

export const PlatformServiceLive = Layer.effect(
	PlatformService,
	Effect.gen(function* () {
		const shell = yield* ShellService;
		const plat = process.platform;
		if (plat === 'darwin') return makeDarwinPlatform(shell);
		if (plat === 'linux') return makeLinuxPlatform(shell);
		return yield* Effect.fail(
			new DeployError({
				stage: 'platform',
				message: `Unsupported platform: ${plat}`,
			}),
		);
	}),
);

// ---------------------------------------------------------------------------
// 3. DeployService — Pipeline orchestrator
// ---------------------------------------------------------------------------

export interface DeployServiceShape {
	readonly deploy: (mode: Mode, dryRun: boolean) => Effect.Effect<void, DeployError>;
}

export class DeployService extends Context.Tag('DeployService')<
	DeployService,
	DeployServiceShape
>() {}

function detectChanges(
	shell: ShellServiceShape,
	mode: Mode,
): Effect.Effect<DetectResult, DeployError> {
	return Effect.gen(function* () {
		if (mode === 'app') return { needApp: true, needContainer: false };
		if (mode === 'container') return { needApp: false, needContainer: true };
		if (mode === 'all') return { needApp: true, needContainer: true };

		// Smart detection
		yield* info('Detecting changes...');

		const diffHead = yield* shell
			.run('git', ['diff', '--name-only', 'HEAD'])
			.pipe(Effect.catchAll(() => Effect.succeed('')));
		const diffCached = yield* shell
			.run('git', ['diff', '--name-only', '--cached'])
			.pipe(Effect.catchAll(() => Effect.succeed('')));

		const allChanges = [
			...new Set([...diffHead.split('\n'), ...diffCached.split('\n')].filter(Boolean)),
		];

		let needApp = false;
		let needContainer = false;

		if (allChanges.length === 0) {
			// No uncommitted changes — check timestamps
			const distIndex = path.join(projectRoot(), 'dist', 'index.js');
			if (fs.existsSync(distIndex)) {
				const distStat = fs.statSync(distIndex);
				const srcFiles = findTsFiles(path.join(projectRoot(), 'src'));
				needApp = srcFiles.some((f) => fs.statSync(f).mtimeMs > distStat.mtimeMs);
			} else {
				needApp = true;
			}

			const imageId = yield* shell
				.run('docker', ['images', '-q', 'guardian-core-agent:latest'])
				.pipe(Effect.catchAll(() => Effect.succeed('')));
			if (!imageId.trim()) needContainer = true;
		} else {
			const appPattern = /^(src\/|package\.json|tsconfig\.json)/;
			const containerPattern = /^container\//;
			needApp = allChanges.some((f) => appPattern.test(f));
			needContainer =
				allChanges.some((f) => containerPattern.test(f)) ||
				allChanges.some((f) => f === 'package.json');
		}

		return { needApp, needContainer };
	}).pipe(Effect.withLogSpan('deploy.detectChanges'));
}

function findTsFiles(dir: string): string[] {
	const results: string[] = [];
	if (!fs.existsSync(dir)) return results;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory() && entry.name !== 'node_modules') {
			results.push(...findTsFiles(fullPath));
		} else if (entry.name.endsWith('.ts')) {
			results.push(fullPath);
		}
	}
	return results;
}

export const DeployServiceLive = Layer.effect(
	DeployService,
	Effect.gen(function* () {
		const shell = yield* ShellService;
		const platform = yield* PlatformService;

		return {
			deploy: (mode, dryRun) =>
				Effect.gen(function* () {
					// 1. Detect changes
					const { needApp, needContainer } = yield* detectChanges(shell, mode);

					if (!needApp && !needContainer) {
						yield* ok('Nothing to deploy — everything is up to date');
						return;
					}

					// 2. Show plan
					yield* Effect.log('');
					yield* Effect.log('Deploy plan:');
					if (needApp)
						yield* Effect.log('  • Rebuild host app (bun install → typecheck → test → build)');
					if (needContainer) yield* Effect.log('  • Rebuild container image (docker build)');
					yield* Effect.log('  • Restart service');
					yield* Effect.log('');

					// 3. Dry run bail
					if (dryRun) {
						yield* warn('Dry run — nothing will be changed');
						return;
					}

					// 4. Install dependencies
					if (needApp) {
						yield* Effect.gen(function* () {
							yield* info('Installing dependencies...');
							yield* shell.run('bun', ['install']);
							yield* ok('Dependencies installed');
						}).pipe(Effect.withLogSpan('deploy.installDeps'));
					}

					// 5. Typecheck
					if (needApp) {
						yield* Effect.gen(function* () {
							yield* info('Running typecheck...');
							yield* shell.run('bun', ['run', 'typecheck']).pipe(
								Effect.catchAll((e) =>
									Effect.gen(function* () {
										yield* fail('Typecheck failed — fix errors before deploying');
										return yield* new DeployError({
											stage: 'typecheck',
											message: e.message,
										});
									}),
								),
							);
							yield* ok('Typecheck passed');
						}).pipe(Effect.withLogSpan('deploy.typecheck'));
					}

					// 6. Tests
					if (needApp) {
						yield* Effect.gen(function* () {
							yield* info('Running tests...');
							yield* shell.run('bun', ['run', 'test']).pipe(
								Effect.catchAll((e) =>
									Effect.gen(function* () {
										yield* fail('Tests failed — fix tests before deploying');
										return yield* new DeployError({
											stage: 'test',
											message: e.message,
										});
									}),
								),
							);
							yield* ok('Tests passed');
						}).pipe(Effect.withLogSpan('deploy.test'));
					}

					// 7. Build
					if (needApp) {
						yield* Effect.gen(function* () {
							yield* info('Building TypeScript...');
							yield* shell.run('bun', ['run', 'build']);
							yield* ok('Build complete');
						}).pipe(Effect.withLogSpan('deploy.build'));
					}

					// 8. Container image
					if (needContainer) {
						yield* Effect.gen(function* () {
							yield* info('Building container image (this may take a minute)...');
							yield* shell.run('./container/build.sh', []);
							yield* ok('Container image built');
						}).pipe(Effect.withLogSpan('deploy.buildContainer'));
					}

					// 9–11. Service management
					yield* platform.installServiceTemplate;
					yield* platform.restartService;
					yield* platform.verifyService;

					yield* Effect.log('');
					yield* ok('Deploy complete');
					yield* Effect.log(`  Logs: tail -f ${projectRoot()}/logs/guardian-core.log`);
				}).pipe(Effect.withLogSpan('deploy'), Effect.annotateLogs({ mode, dryRun })),
		};
	}),
);
