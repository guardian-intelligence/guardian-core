#!/usr/bin/env bun
/**
 * Secrets management CLI — runs via Bun.
 *
 * Usage:
 *   bun scripts/secrets.ts backup              # Encrypt .env files
 *   bun scripts/secrets.ts backup --dry-run    # Show what would happen
 *   bun scripts/secrets.ts restore             # Decrypt to local .env files
 *   bun scripts/secrets.ts restore --dry-run   # Show what would happen
 *   bun scripts/secrets.ts deploy              # Decrypt + push to VPS + restart
 *   bun scripts/secrets.ts deploy --dry-run    # Show what would happen
 *   bun scripts/secrets.ts verify              # Check remote file perms + health
 */
import { Command, Options } from '@effect/cli';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Cause, Effect, Layer } from 'effect';

import { DeployLoggerLive } from '../src/DeployLogger.js';
import { makeShellServiceLive } from '../src/deploy.js';
import { SecretsService, SecretsServiceLive } from '../src/secrets.js';

// ---------------------------------------------------------------------------
// ShellService live — uses Bun.spawnSync
// ---------------------------------------------------------------------------

const ShellServiceLive = makeShellServiceLive((cmd, args, cwd) => {
	const result = Bun.spawnSync([cmd, ...args], {
		cwd,
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env },
	});
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
	};
});

// ---------------------------------------------------------------------------
// Layer composition
// ---------------------------------------------------------------------------

const MainLive = SecretsServiceLive.pipe(Layer.provide(ShellServiceLive));

// ---------------------------------------------------------------------------
// CLI — subcommands
// ---------------------------------------------------------------------------

const dryRunFlag = Options.boolean('dry-run').pipe(
	Options.withDescription('Show what would happen without doing it'),
);

const backupCmd = Command.make(
	'backup',
	{ dryRun: dryRunFlag },
	({ dryRun }) =>
		Effect.gen(function* () {
			const svc = yield* SecretsService;
			yield* svc.backup(dryRun);
		}),
);

const restoreCmd = Command.make(
	'restore',
	{ dryRun: dryRunFlag },
	({ dryRun }) =>
		Effect.gen(function* () {
			const svc = yield* SecretsService;
			yield* svc.restore(dryRun);
		}),
);

const deployCmd = Command.make(
	'deploy',
	{ dryRun: dryRunFlag },
	({ dryRun }) =>
		Effect.gen(function* () {
			const svc = yield* SecretsService;
			yield* svc.deploy(dryRun);
		}),
);

const verifyCmd = Command.make(
	'verify',
	{},
	() =>
		Effect.gen(function* () {
			const svc = yield* SecretsService;
			yield* svc.verify();
		}),
);

const command = Command.make('secrets', {}).pipe(
	Command.withSubcommands([backupCmd, restoreCmd, deployCmd, verifyCmd]),
);

const cli = Command.run(command, { name: 'secrets', version: '1.0.0' });

cli(process.argv).pipe(
	Effect.provide(MainLive),
	Effect.provide(DeployLoggerLive('secrets')),
	Effect.provide(BunContext.layer),
	Effect.tapErrorCause((cause) =>
		Effect.logError('SECRETS_FAILED').pipe(
			Effect.annotateLogs({ prettyError: Cause.pretty(cause) }),
		),
	),
	BunRuntime.runMain,
);
