import { describe, expect, it } from 'vitest';
import { Effect, Layer, Logger } from 'effect';

import { DeployError } from '../errors.js';
import {
  DeployService,
  DeployServiceLive,
  PlatformService,
  ShellService,
} from '../deploy.js';

const SilentLogger = Logger.replace(Logger.defaultLogger, Logger.none);

// ---------------------------------------------------------------------------
// Test layers
// ---------------------------------------------------------------------------

/** Records every shell command instead of executing it. */
function makeShellServiceTest(responses: Record<string, string> = {}): {
  layer: Layer.Layer<ShellService>;
  commands: Array<{ cmd: string; args: readonly string[] }>;
} {
  const commands: Array<{ cmd: string; args: readonly string[] }> = [];
  const layer = Layer.succeed(ShellService, {
    run: (cmd, args) =>
      Effect.gen(function* () {
        commands.push({ cmd, args });
        const key = `${cmd} ${args.join(' ')}`.trim();
        for (const [pattern, response] of Object.entries(responses)) {
          if (key.startsWith(pattern) || key === pattern) return response;
        }
        return '';
      }),
  });
  return { layer, commands };
}

/** Force a specific platform for testing. */
function makePlatformServiceTest(
  platform: 'darwin' | 'linux' = 'darwin',
): { layer: Layer.Layer<PlatformService>; calls: string[] } {
  const calls: string[] = [];
  const layer = Layer.succeed(PlatformService, {
    platform,
    installServiceTemplate: Effect.gen(function* () {
      calls.push('installServiceTemplate');
    }),
    restartService: Effect.gen(function* () {
      calls.push('restartService');
    }),
    verifyService: Effect.gen(function* () {
      calls.push('verifyService');
    }),
  });
  return { layer, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeployService', () => {
  it('should detect "all" mode and run full pipeline', async () => {
    const shell = makeShellServiceTest();
    const platform = makePlatformServiceTest();
    const TestLive = DeployServiceLive.pipe(
      Layer.provide(platform.layer),
      Layer.provide(shell.layer),
      Layer.provide(SilentLogger),
    );

    const program = Effect.gen(function* () {
      const svc = yield* DeployService;
      yield* svc.deploy('all', false);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLive)));

    const cmds = shell.commands.map(
      (c) => `${c.cmd} ${c.args.join(' ')}`.trim(),
    );
    expect(cmds).toContainEqual(
      'bun install',
    );
    expect(cmds).toContainEqual('bun run typecheck');
    expect(cmds).toContainEqual('bun run test');
    expect(cmds).toContainEqual('bun run build');
    expect(cmds).toContainEqual('./container/build.sh');

    expect(platform.calls).toEqual([
      'installServiceTemplate',
      'restartService',
      'verifyService',
    ]);
  });

  it('should only run app steps in "app" mode', async () => {
    const shell = makeShellServiceTest();
    const platform = makePlatformServiceTest();
    const TestLive = DeployServiceLive.pipe(
      Layer.provide(platform.layer),
      Layer.provide(shell.layer),
      Layer.provide(SilentLogger),
    );

    const program = Effect.gen(function* () {
      const svc = yield* DeployService;
      yield* svc.deploy('app', false);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLive)));

    const cmds = shell.commands.map(
      (c) => `${c.cmd} ${c.args.join(' ')}`.trim(),
    );
    expect(cmds).toContainEqual(
      'bun install',
    );
    expect(cmds).toContainEqual('bun run build');
    expect(cmds).not.toContainEqual('./container/build.sh');
  });

  it('should only run container step in "container" mode', async () => {
    const shell = makeShellServiceTest();
    const platform = makePlatformServiceTest();
    const TestLive = DeployServiceLive.pipe(
      Layer.provide(platform.layer),
      Layer.provide(shell.layer),
      Layer.provide(SilentLogger),
    );

    const program = Effect.gen(function* () {
      const svc = yield* DeployService;
      yield* svc.deploy('container', false);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLive)));

    const cmds = shell.commands.map(
      (c) => `${c.cmd} ${c.args.join(' ')}`.trim(),
    );
    expect(cmds).not.toContainEqual(
      'bun install',
    );
    expect(cmds).not.toContainEqual('bun run typecheck');
    expect(cmds).not.toContainEqual('bun run test');
    expect(cmds).not.toContainEqual('bun run build');
    expect(cmds).toContainEqual('./container/build.sh');
  });

  it('should stop after showing plan in dry-run mode', async () => {
    const shell = makeShellServiceTest();
    const platform = makePlatformServiceTest();
    const TestLive = DeployServiceLive.pipe(
      Layer.provide(platform.layer),
      Layer.provide(shell.layer),
      Layer.provide(SilentLogger),
    );

    const program = Effect.gen(function* () {
      const svc = yield* DeployService;
      yield* svc.deploy('all', true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLive)));

    const cmds = shell.commands.map(
      (c) => `${c.cmd} ${c.args.join(' ')}`.trim(),
    );
    expect(cmds).not.toContainEqual(
      'bun install',
    );
    expect(cmds).not.toContainEqual('bun run build');
    expect(cmds).not.toContainEqual('./container/build.sh');
    expect(platform.calls).toEqual([]);
  });

  it('should propagate shell errors as DeployError', async () => {
    const failLayer = Layer.succeed(ShellService, {
      run: (cmd, args) => {
        if (args.includes('typecheck')) {
          return Effect.fail(
            new DeployError({
              stage: 'typecheck',
              message: 'Type error in foo.ts',
            }),
          );
        }
        return Effect.succeed('');
      },
    });
    const platform = makePlatformServiceTest();
    const TestLive = DeployServiceLive.pipe(
      Layer.provide(platform.layer),
      Layer.provide(failLayer),
      Layer.provide(SilentLogger),
    );

    const program = Effect.gen(function* () {
      const svc = yield* DeployService;
      yield* svc.deploy('app', false);
    });

    const exit = await Effect.runPromiseExit(
      program.pipe(Effect.provide(TestLive)),
    );
    expect(exit._tag).toBe('Failure');
  });

  it('should detect smart mode with git changes', async () => {
    const shell = makeShellServiceTest({
      'git diff --name-only HEAD': 'src/index.ts\ncontainer/Dockerfile',
      'git diff --name-only --cached': '',
    });
    const platform = makePlatformServiceTest();
    const TestLive = DeployServiceLive.pipe(
      Layer.provide(platform.layer),
      Layer.provide(shell.layer),
      Layer.provide(SilentLogger),
    );

    const program = Effect.gen(function* () {
      const svc = yield* DeployService;
      yield* svc.deploy('smart', true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestLive)));

    const cmds = shell.commands.map(
      (c) => `${c.cmd} ${c.args.join(' ')}`.trim(),
    );
    expect(cmds).toContainEqual('git diff --name-only HEAD');
  });
});
