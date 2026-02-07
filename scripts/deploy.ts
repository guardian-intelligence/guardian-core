#!/usr/bin/env bun
/**
 * Guardian Core deploy CLI — runs via Bun.
 *
 * Usage:
 *   bun scripts/deploy.ts              # Smart deploy (detects what changed)
 *   bun scripts/deploy.ts --app        # Rebuild host app only
 *   bun scripts/deploy.ts --container  # Rebuild container image only
 *   bun scripts/deploy.ts --all        # Rebuild everything
 *   bun scripts/deploy.ts --dry-run    # Show what would happen
 */
import { Command, Options } from '@effect/cli';
import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Cause, Effect, Layer } from 'effect';

import { DeployLoggerLive } from '../src/DeployLogger.js';
import {
  DeployService,
  DeployServiceLive,
  PlatformServiceLive,
  ShellService,
  makeShellServiceLive,
  type Mode,
} from '../src/deploy.js';

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

const MainLive = DeployServiceLive.pipe(
  Layer.provide(PlatformServiceLive),
  Layer.provide(ShellServiceLive),
);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const appFlag = Options.boolean('app').pipe(
  Options.withDescription('Rebuild host app only'),
);
const containerFlag = Options.boolean('container').pipe(
  Options.withDescription('Rebuild container image only'),
);
const allFlag = Options.boolean('all').pipe(
  Options.withDescription('Rebuild everything'),
);
const dryRunFlag = Options.boolean('dry-run').pipe(
  Options.withDescription('Show what would happen without doing it'),
);

const command = Command.make(
  'deploy',
  { app: appFlag, container: containerFlag, all: allFlag, dryRun: dryRunFlag },
  ({ app, container, all, dryRun }) =>
    Effect.gen(function* () {
      const svc = yield* DeployService;
      const mode: Mode = all
        ? 'all'
        : app
          ? 'app'
          : container
            ? 'container'
            : 'smart';
      yield* svc.deploy(mode, dryRun);
    }),
);

const cli = Command.run(command, { name: 'deploy', version: '1.0.0' });

cli(process.argv).pipe(
  Effect.provide(MainLive),
  Effect.provide(DeployLoggerLive('brain')),
  Effect.provide(BunContext.layer),
  Effect.tapErrorCause((cause) =>
    Effect.logError('DEPLOY_FAILED').pipe(
      Effect.annotateLogs({ prettyError: Cause.pretty(cause) }),
    ),
  ),
  BunRuntime.runMain,
);
