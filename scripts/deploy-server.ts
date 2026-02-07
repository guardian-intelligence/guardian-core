#!/usr/bin/env bun
/**
 * rumi-server deploy CLI — runs via Bun.
 *
 * Usage:
 *   bun scripts/deploy-server.ts            # Deploy to OVH
 *   bun scripts/deploy-server.ts --dry-run  # Show what would happen
 */
import { Command, Options } from '@effect/cli';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Cause, Effect, Layer } from 'effect';

import { DeployLoggerLive } from '../src/DeployLogger.js';
import { makeShellServiceLive } from '../src/deploy.js';
import {
	ServerDeployService,
	ServerDeployServiceLive,
} from '../src/deploy-server.js';

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

const MainLive = ServerDeployServiceLive.pipe(Layer.provide(ShellServiceLive));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const dryRunFlag = Options.boolean('dry-run').pipe(
	Options.withDescription('Show what would happen without doing it'),
);

const command = Command.make(
	'deploy-server',
	{ dryRun: dryRunFlag },
	({ dryRun }) =>
		Effect.gen(function* () {
			const svc = yield* ServerDeployService;
			yield* svc.deploy(dryRun);
		}),
);

const cli = Command.run(command, { name: 'deploy-server', version: '1.0.0' });

cli(process.argv).pipe(
	Effect.provide(MainLive),
	Effect.provide(DeployLoggerLive('server')),
	Effect.provide(BunContext.layer),
	Effect.tapErrorCause((cause) =>
		Effect.logError('DEPLOY_FAILED').pipe(
			Effect.annotateLogs({ prettyError: Cause.pretty(cause) }),
		),
	),
	BunRuntime.runMain,
);
