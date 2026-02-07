/**
 * Secrets management service — Effect TypeScript.
 *
 * Encrypts/decrypts .env files with age, deploys to remote via SCP + SSH.
 * Entry point: scripts/secrets.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Context, Effect, Layer } from 'effect';

import { fail, info, ok, warn } from './DeployLogger.js';
import { ShellService } from './deploy.js';
import { SecretsError } from './errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REMOTE = 'rumi-server';
const REMOTE_ROOT = '/opt/guardian-core';
const PRIMARY_ENV_ARCHIVE = 'guardian-core.env.age';
const LEGACY_ENV_ARCHIVE = 'nanoclaw.env.age';
const SERVER_ENV_ARCHIVE = 'server.env.age';
const CORE_SERVICE = 'guardian-core';
const SERVER_SERVICE = 'rumi-server';

function projectRoot(): string {
	return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
}

function configDir(): string {
	return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'guardian');
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Validate server .env PEM format constraints.
 * Exported for direct testing.
 */
export function validateServerEnv(content: string): readonly string[] {
	const lines = content.split('\n');
	const keyLines = lines.filter((l) => l.startsWith('GITHUB_APP_PRIVATE_KEY='));

	if (keyLines.length === 0) return [];

	const errors: string[] = [];

	if (keyLines.length > 1) {
		errors.push('Multiple GITHUB_APP_PRIVATE_KEY= lines found');
	}

	const keyLine = keyLines[0];

	if (keyLine.startsWith('GITHUB_APP_PRIVATE_KEY="')) {
		errors.push('GITHUB_APP_PRIVATE_KEY must not be quoted');
	}

	if (!keyLine.includes('\\n')) {
		errors.push('GITHUB_APP_PRIVATE_KEY missing literal \\n escapes');
	}

	return errors;
}

// ---------------------------------------------------------------------------
// SecretsService
// ---------------------------------------------------------------------------

export interface SecretsServiceShape {
	readonly backup: (dryRun: boolean) => Effect.Effect<void, SecretsError>;
	readonly restore: (dryRun: boolean) => Effect.Effect<void, SecretsError>;
	readonly deploy: (dryRun: boolean) => Effect.Effect<void, SecretsError>;
	readonly verify: () => Effect.Effect<void, SecretsError>;
}

export class SecretsService extends Context.Tag('SecretsService')<
	SecretsService,
	SecretsServiceShape
>() {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const makeSecretsService = Effect.gen(function* () {
	const shell = yield* ShellService;
	const root = projectRoot();
	const cfg = configDir();
	const secretsDir = path.join(root, 'secrets');
	const ageKey = path.join(cfg, 'secrets.key');
	const agePub = path.join(cfg, 'secrets.pub');
	const recoveryPub = path.join(cfg, 'recovery.pub');

	// --- Internal helpers ---

	const assertFileExists = (filePath: string, label: string, stage: string) =>
		Effect.gen(function* () {
			if (!fs.existsSync(filePath)) {
				return yield* new SecretsError({ stage, message: `${label} not found: ${filePath}` });
			}
		});

	const initKey = (stage: string) =>
		Effect.gen(function* () {
			if (!fs.existsSync(ageKey)) {
				return yield* new SecretsError({
					stage,
					message: `No age identity found at ${ageKey}\n  Run: mkdir -p ${cfg} && age-keygen -o ${ageKey}\n  Then: age-keygen -y ${ageKey} > ${agePub}`,
				});
			}
			if (!fs.existsSync(agePub)) {
				yield* shell.run('age-keygen', ['-y', ageKey]).pipe(
					Effect.flatMap((pubKey) =>
						Effect.try({
							try: () => fs.writeFileSync(agePub, pubKey.trim() + '\n'),
							catch: (err) =>
								new SecretsError({
									stage,
									message: `Failed to write ${agePub}: ${String(err)}`,
									cause: err,
								}),
						}),
					),
					Effect.mapError((e) => new SecretsError({ stage, message: e.message, cause: e })),
				);
				yield* info(`Derived public key to ${agePub}`);
			}
		});

	const buildRecipientArgs = (stage: string) =>
		Effect.gen(function* () {
			const args: string[] = ['-R', agePub];
			if (fs.existsSync(recoveryPub)) {
				args.push('-R', recoveryPub);
				const recoveryContent = yield* Effect.try({
					try: () => fs.readFileSync(recoveryPub, 'utf-8'),
					catch: (err) =>
						new SecretsError({
							stage,
							message: `Failed to read ${recoveryPub}: ${String(err)}`,
							cause: err,
						}),
				});
				yield* info(`Recovery recipient: ${recoveryContent.split('\n')[0]}`);
			}
			const pubContent = yield* Effect.try({
				try: () => fs.readFileSync(agePub, 'utf-8').trim(),
				catch: (err) =>
					new SecretsError({
						stage,
						message: `Failed to read ${agePub}: ${String(err)}`,
						cause: err,
					}),
			});
			yield* info(`Primary recipient: ${pubContent}`);
			return args;
		});

	const checkNotTracked = (file: string, stage: string) =>
		Effect.gen(function* () {
			const result = yield* shell
				.run('git', ['ls-files', '--error-unmatch', file])
				.pipe(Effect.either);
			if (result._tag === 'Right') {
				return yield* new SecretsError({
					stage,
					message: `${file} is tracked by git. Run: git rm --cached ${file}`,
				});
			}
		});

	const logChecksums = (files: readonly string[]) =>
		Effect.forEach(files, (file) =>
			shell.run('shasum', ['-a', '256', file]).pipe(
				Effect.flatMap((output) => {
					const hash = output.split(/\s+/)[0];
					const label = path.relative(root, file);
					return info(`  ${label}: ${hash}`);
				}),
				Effect.mapError(
					(e) => new SecretsError({ stage: 'checksum', message: e.message, cause: e }),
				),
			),
		);

	const resolveHostEnvArchive = (stage: string) =>
		Effect.gen(function* () {
			const primaryPath = path.join(secretsDir, PRIMARY_ENV_ARCHIVE);
			if (fs.existsSync(primaryPath)) {
				return { filePath: primaryPath, label: PRIMARY_ENV_ARCHIVE };
			}

			const legacyPath = path.join(secretsDir, LEGACY_ENV_ARCHIVE);
			if (fs.existsSync(legacyPath)) {
				yield* warn(
					`Using legacy archive name ${LEGACY_ENV_ARCHIVE}; run backup to regenerate ${PRIMARY_ENV_ARCHIVE}.`,
				);
				return { filePath: legacyPath, label: LEGACY_ENV_ARCHIVE };
			}

			return yield* new SecretsError({
				stage,
				message: `Neither ${PRIMARY_ENV_ARCHIVE} nor ${LEGACY_ENV_ARCHIVE} was found in ${secretsDir}`,
			});
		});

	// --- Service methods ---

	const backup: SecretsServiceShape['backup'] = (dryRun) =>
		Effect.gen(function* () {
			const envFile = path.join(root, '.env');
			const serverEnvFile = path.join(root, 'server', '.env');

			// Preconditions
			yield* assertFileExists(envFile, '.env', 'backup');
			yield* assertFileExists(serverEnvFile, 'server/.env', 'backup');
			yield* checkNotTracked('.env', 'backup');
			yield* checkNotTracked('server/.env', 'backup');

			// PEM validation
			const serverEnvContent = yield* Effect.try({
				try: () => fs.readFileSync(serverEnvFile, 'utf-8'),
				catch: (err) =>
					new SecretsError({
						stage: 'backup',
						message: `Failed to read server/.env: ${String(err)}`,
						cause: err,
					}),
			});
			const pemErrors = validateServerEnv(serverEnvContent);
			if (pemErrors.length > 0) {
				return yield* new SecretsError({
					stage: 'backup',
					message: `PEM validation failed:\n${pemErrors.map((e) => `  - ${e}`).join('\n')}`,
				});
			}

			yield* initKey('backup');
			fs.mkdirSync(secretsDir, { recursive: true });
			const recipientArgs = yield* buildRecipientArgs('backup');

			// Show plan
			yield* Effect.log('');
			yield* Effect.log('Backup plan:');
			yield* Effect.log(`  • Encrypt .env → secrets/${PRIMARY_ENV_ARCHIVE}`);
			yield* Effect.log(`  • Encrypt server/.env → secrets/${SERVER_ENV_ARCHIVE}`);
			yield* Effect.log('');

			if (dryRun) {
				yield* warn('Dry run — nothing will be changed');
				return;
			}

			// Encrypt
			yield* shell
				.run('age', [...recipientArgs, '-o', path.join(secretsDir, PRIMARY_ENV_ARCHIVE), envFile])
				.pipe(
					Effect.mapError(
						(e) => new SecretsError({ stage: 'backup', message: e.message, cause: e }),
					),
				);
			yield* shell
				.run('age', [
					...recipientArgs,
					'-o',
					path.join(secretsDir, SERVER_ENV_ARCHIVE),
					serverEnvFile,
				])
				.pipe(
					Effect.mapError(
						(e) => new SecretsError({ stage: 'backup', message: e.message, cause: e }),
					),
				);

			yield* ok(`Encrypted to ${secretsDir}/`);
			yield* info('Checksums (for roundtrip verification):');
			yield* logChecksums([envFile, serverEnvFile]);
		}).pipe(Effect.withLogSpan('secrets.backup'));

	const restore: SecretsServiceShape['restore'] = (dryRun) =>
		Effect.gen(function* () {
			const envArchive = yield* resolveHostEnvArchive('restore');
			const ageServerEnv = path.join(secretsDir, SERVER_ENV_ARCHIVE);

			// Preconditions
			yield* assertFileExists(ageServerEnv, SERVER_ENV_ARCHIVE, 'restore');
			yield* initKey('restore');

			// Show plan
			yield* Effect.log('');
			yield* Effect.log('Restore plan:');
			yield* Effect.log(`  • Decrypt secrets/${envArchive.label} → .env`);
			yield* Effect.log(`  • Decrypt secrets/${SERVER_ENV_ARCHIVE} → server/.env`);
			yield* Effect.log('  • Set permissions to 600');
			yield* Effect.log('');

			if (dryRun) {
				yield* warn('Dry run — nothing will be changed');
				return;
			}

			// Decrypt to temp files
			const tmpDir = fs.mkdtempSync(path.join(root, '.secrets-tmp-'));
			const tmpEnv = path.join(tmpDir, 'env');
			const tmpServerEnv = path.join(tmpDir, 'server-env');

			yield* Effect.gen(function* () {
				yield* shell
					.run('age', ['-d', '-i', ageKey, '-o', tmpEnv, envArchive.filePath])
					.pipe(
						Effect.mapError(
							(e) => new SecretsError({ stage: 'restore', message: e.message, cause: e }),
						),
					);
				yield* shell
					.run('age', ['-d', '-i', ageKey, '-o', tmpServerEnv, ageServerEnv])
					.pipe(
						Effect.mapError(
							(e) => new SecretsError({ stage: 'restore', message: e.message, cause: e }),
						),
					);

				// Verify non-empty
				const envStat = fs.statSync(tmpEnv);
				if (envStat.size === 0) {
					return yield* new SecretsError({ stage: 'restore', message: 'Decrypted .env is empty' });
				}
				const serverEnvStat = fs.statSync(tmpServerEnv);
				if (serverEnvStat.size === 0) {
					return yield* new SecretsError({
						stage: 'restore',
						message: 'Decrypted server/.env is empty',
					});
				}

				// Install with restricted permissions
				yield* shell
					.run('install', ['-m', '600', tmpEnv, path.join(root, '.env')])
					.pipe(
						Effect.mapError(
							(e) => new SecretsError({ stage: 'restore', message: e.message, cause: e }),
						),
					);
				yield* shell
					.run('install', ['-m', '600', tmpServerEnv, path.join(root, 'server', '.env')])
					.pipe(
						Effect.mapError(
							(e) => new SecretsError({ stage: 'restore', message: e.message, cause: e }),
						),
					);
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						try {
							fs.unlinkSync(tmpEnv);
						} catch {}
						try {
							fs.unlinkSync(tmpServerEnv);
						} catch {}
						try {
							fs.rmdirSync(tmpDir);
						} catch {}
					}),
				),
			);

			yield* ok('Restored .env files (mode 600)');
			yield* info('Checksums:');
			yield* logChecksums([path.join(root, '.env'), path.join(root, 'server', '.env')]);
		}).pipe(Effect.withLogSpan('secrets.restore'));

	const remoteInstallScript = `
set -euo pipefail
umask 077

ROOT="${REMOTE_ROOT}"

# Stage in target directories — same filesystem = true atomic rename
STAGE_ENV="$(mktemp "$ROOT/.env.XXXXXX")"
STAGE_SERVER_ENV="$(mktemp "$ROOT/server/.env.XXXXXX")"

trap 'rm -f "$STAGE_ENV" "$STAGE_SERVER_ENV"' EXIT

# Move uploaded files to stage locations
mv -f /tmp/guardian-env-tmp "$STAGE_ENV"
mv -f /tmp/guardian-server-env-tmp "$STAGE_SERVER_ENV"

# Validate non-empty
[ -s "$STAGE_ENV" ] || { echo "ERROR: staged .env is empty" >&2; exit 1; }
[ -s "$STAGE_SERVER_ENV" ] || { echo "ERROR: staged server/.env is empty" >&2; exit 1; }

chmod 600 "$STAGE_ENV" "$STAGE_SERVER_ENV"

# Backup for rollback
BAK_ENV="" BAK_SERVER_ENV=""
[ -f "$ROOT/.env" ] && { BAK_ENV="$(mktemp "$ROOT/.env.bak.XXXXXX")"; cp -p "$ROOT/.env" "$BAK_ENV"; }
[ -f "$ROOT/server/.env" ] && { BAK_SERVER_ENV="$(mktemp "$ROOT/server/.env.bak.XXXXXX")"; cp -p "$ROOT/server/.env" "$BAK_SERVER_ENV"; }

# Atomic rename
if ! { mv -f "$STAGE_ENV" "$ROOT/.env" && mv -f "$STAGE_SERVER_ENV" "$ROOT/server/.env"; }; then
  echo "ERROR: Install failed, rolling back..." >&2
  [ -n "$BAK_ENV" ] && mv -f "$BAK_ENV" "$ROOT/.env"
  [ -n "$BAK_SERVER_ENV" ] && mv -f "$BAK_SERVER_ENV" "$ROOT/server/.env"
  echo "Rollback complete" >&2
  exit 1
fi

rm -f "$BAK_ENV" "$BAK_SERVER_ENV"
trap - EXIT
echo "Secrets installed (mode 600)"
`.trim();

	const deploy: SecretsServiceShape['deploy'] = (dryRun) =>
		Effect.gen(function* () {
			const envArchive = yield* resolveHostEnvArchive('deploy');
			const ageServerEnv = path.join(secretsDir, SERVER_ENV_ARCHIVE);

			// Preconditions
			yield* assertFileExists(ageServerEnv, SERVER_ENV_ARCHIVE, 'deploy');
			yield* initKey('deploy');

			// Preflight: remote write access
			yield* info('Preflight: checking remote write access...');
			yield* shell
				.run('ssh', [
					REMOTE,
					`test -w ${REMOTE_ROOT}/.env -o -w ${REMOTE_ROOT} && test -w ${REMOTE_ROOT}/server/.env -o -w ${REMOTE_ROOT}/server && echo "Write access OK"`,
				])
				.pipe(
					Effect.mapError(
						(e) =>
							new SecretsError({
								stage: 'deploy',
								message: `SSH preflight failed: ${e.message}`,
								cause: e,
							}),
					),
				);

			// Show plan
			yield* Effect.log('');
			yield* Effect.log('Deploy plan:');
			yield* Effect.log(`  • Decrypt .age files locally`);
			yield* Effect.log(`  • SCP to ${REMOTE}:/tmp/`);
			yield* Effect.log(`  • SSH atomic install to ${REMOTE_ROOT}/`);
			yield* Effect.log(`  • Restart ${CORE_SERVICE} + ${SERVER_SERVICE}`);
			yield* Effect.log(`  • Verify remote state`);
			yield* Effect.log('');

			if (dryRun) {
				yield* warn('Dry run — nothing will be changed');
				return;
			}

			yield* info(`Deploying secrets to ${REMOTE}...`);

			// Decrypt locally to temp files
			const tmpDir = fs.mkdtempSync(path.join(root, '.secrets-tmp-'));
			const tmpEnv = path.join(tmpDir, 'env');
			const tmpServerEnv = path.join(tmpDir, 'server-env');

			yield* Effect.gen(function* () {
				yield* shell
					.run('age', ['-d', '-i', ageKey, '-o', tmpEnv, envArchive.filePath])
					.pipe(
						Effect.mapError(
							(e) => new SecretsError({ stage: 'deploy', message: e.message, cause: e }),
						),
					);
				yield* shell
					.run('age', ['-d', '-i', ageKey, '-o', tmpServerEnv, ageServerEnv])
					.pipe(
						Effect.mapError(
							(e) => new SecretsError({ stage: 'deploy', message: e.message, cause: e }),
						),
					);

				// Verify non-empty
				const envStat = fs.statSync(tmpEnv);
				if (envStat.size === 0) {
					return yield* new SecretsError({ stage: 'deploy', message: 'Decrypted .env is empty' });
				}
				const serverEnvStat = fs.statSync(tmpServerEnv);
				if (serverEnvStat.size === 0) {
					return yield* new SecretsError({
						stage: 'deploy',
						message: 'Decrypted server/.env is empty',
					});
				}

				// SCP to remote /tmp/
				yield* shell.run('scp', [tmpEnv, `${REMOTE}:/tmp/guardian-env-tmp`]).pipe(
					Effect.mapError(
						(e) =>
							new SecretsError({
								stage: 'deploy',
								message: `SCP failed: ${e.message}`,
								cause: e,
							}),
					),
				);
				yield* shell.run('scp', [tmpServerEnv, `${REMOTE}:/tmp/guardian-server-env-tmp`]).pipe(
					Effect.mapError(
						(e) =>
							new SecretsError({
								stage: 'deploy',
								message: `SCP failed: ${e.message}`,
								cause: e,
							}),
					),
				);

				// SSH atomic install
				yield* shell.run('ssh', [REMOTE, remoteInstallScript]).pipe(
					Effect.mapError(
						(e) =>
							new SecretsError({
								stage: 'deploy',
								message: `Remote install failed: ${e.message}`,
								cause: e,
							}),
					),
				);

				// Restart services
				yield* shell
					.run('ssh', [REMOTE, `sudo systemctl restart ${CORE_SERVICE} ${SERVER_SERVICE}`])
					.pipe(
						Effect.mapError(
							(e) =>
								new SecretsError({
									stage: 'deploy',
									message: `Service restart failed: ${e.message}`,
									cause: e,
								}),
						),
					);
				yield* ok('Services restarted');
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						try {
							fs.unlinkSync(tmpEnv);
						} catch {}
						try {
							fs.unlinkSync(tmpServerEnv);
						} catch {}
						try {
							fs.rmdirSync(tmpDir);
						} catch {}
					}),
				),
			);

			// Verify
			yield* verify();
		}).pipe(Effect.withLogSpan('secrets.deploy'));

	const verify: SecretsServiceShape['verify'] = () =>
		Effect.gen(function* () {
			const failures: string[] = [];

			// 1. Check file permissions
			yield* info('=== Remote file permissions ===');
			const permsResult = yield* shell
				.run('ssh', [
					REMOTE,
					`stat -c '%a %U:%G %n' ${REMOTE_ROOT}/.env ${REMOTE_ROOT}/server/.env`,
				])
				.pipe(Effect.either);

			if (permsResult._tag === 'Left') {
				failures.push('Could not stat .env files on remote');
			} else {
				const permsOutput = permsResult.right;
				yield* Effect.log(permsOutput);
				const permsLines = permsOutput.split('\n').filter((l) => l.trim().length > 0);
				for (const line of permsLines) {
					const parts = line.trim().split(/\s+/);
					const mode = parts[0];
					const ownerGroup = parts[1];
					const fileName = parts[2];
					if (mode !== '600') {
						failures.push(`Expected mode 600, got ${mode} for ${fileName}`);
					}
					if (ownerGroup !== 'rumi:users') {
						failures.push(`Expected owner rumi:users, got ${ownerGroup} for ${fileName}`);
					}
				}
			}

			// 2. Check service status
			yield* Effect.log('');
			yield* info('=== Service status ===');
			const statusResult = yield* shell
				.run('ssh', [REMOTE, `systemctl is-active ${CORE_SERVICE} ${SERVER_SERVICE}`])
				.pipe(Effect.either);

			if (statusResult._tag === 'Left') {
				failures.push('One or more services not active');
			} else {
				yield* Effect.log(statusResult.right);
			}

			// 3. Health check
			yield* Effect.log('');
			yield* info('=== Health check ===');
			const healthResult = yield* shell
				.run('ssh', [REMOTE, 'curl -sf localhost:3000/health'])
				.pipe(Effect.either);

			if (healthResult._tag === 'Left') {
				failures.push('Health check failed');
			} else {
				yield* ok(`${healthResult.right} OK`);
			}

			// Report
			if (failures.length > 0) {
				for (const f of failures) {
					yield* fail(`FAILED: ${f}`);
				}
				return yield* new SecretsError({
					stage: 'verify',
					message: `Verification failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`,
				});
			}

			yield* Effect.log('');
			yield* ok('All checks passed.');
		}).pipe(Effect.withLogSpan('secrets.verify'));

	return { backup, restore, deploy, verify } satisfies SecretsServiceShape;
});

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const SecretsServiceLive = Layer.effect(SecretsService, makeSecretsService);
