import fs from 'fs';
import path from 'path';
import { Effect, Layer, Ref } from 'effect';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  MountSecurityService,
  MountSecurityServiceLive,
  type MountValidationResult,
} from '../MountSecurityService.js';

// Mock fs for deterministic tests
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      realpathSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    realpathSync: vi.fn(),
  };
});

const mockFs = vi.mocked(fs);

const VALID_ALLOWLIST = JSON.stringify({
  allowedRoots: [
    { path: '/tmp/allowed', allowReadWrite: true, description: 'Test root' },
    { path: '/tmp/readonly-root', allowReadWrite: false, description: 'Read-only root' },
  ],
  blockedPatterns: ['password', 'secret'],
  nonMainReadOnly: true,
});

function setupAllowlistMocks(allowlistJson: string) {
  mockFs.existsSync.mockReturnValue(true);
  mockFs.readFileSync.mockReturnValue(allowlistJson);
  mockFs.realpathSync.mockImplementation((p: fs.PathLike) => p.toString());
}

describe('MountSecurityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadAllowlist', () => {
    it('should load and parse a valid allowlist', () => {
      setupAllowlistMocks(VALID_ALLOWLIST);

      const program = Effect.gen(function* () {
        const service = yield* MountSecurityService;
        return yield* service.loadAllowlist;
      });

      const result = Effect.runSync(
        program.pipe(Effect.provide(MountSecurityServiceLive)),
      );

      expect(result.allowedRoots).toHaveLength(2);
      expect(result.nonMainReadOnly).toBe(true);
      // Default blocked patterns are merged in
      expect(result.blockedPatterns).toContain('.ssh');
      expect(result.blockedPatterns).toContain('password');
    });

    it('should fail when allowlist file is missing', () => {
      mockFs.existsSync.mockReturnValue(false);

      const program = Effect.gen(function* () {
        const service = yield* MountSecurityService;
        return yield* service.loadAllowlist;
      });

      const result = Effect.runSyncExit(
        program.pipe(Effect.provide(MountSecurityServiceLive)),
      );

      expect(result._tag).toBe('Failure');
    });

    it('should fail when allowlist contains invalid JSON', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('not json');

      const program = Effect.gen(function* () {
        const service = yield* MountSecurityService;
        return yield* service.loadAllowlist;
      });

      const result = Effect.runSyncExit(
        program.pipe(Effect.provide(MountSecurityServiceLive)),
      );

      expect(result._tag).toBe('Failure');
    });
  });

  describe('validateMount', () => {
    it('should allow a mount under an allowed root', () => {
      setupAllowlistMocks(VALID_ALLOWLIST);

      const program = Effect.gen(function* () {
        const service = yield* MountSecurityService;
        return yield* service.validateMount(
          { hostPath: '/tmp/allowed/myproject', containerPath: 'myproject' },
          true,
        );
      });

      const result = Effect.runSync(
        program.pipe(Effect.provide(MountSecurityServiceLive)),
      );

      expect(result.allowed).toBe(true);
      expect(result.realHostPath).toBe('/tmp/allowed/myproject');
    });

    it('should block a mount matching a blocked pattern', () => {
      setupAllowlistMocks(VALID_ALLOWLIST);
      mockFs.realpathSync.mockImplementation((p: fs.PathLike) => p.toString());

      const program = Effect.gen(function* () {
        const service = yield* MountSecurityService;
        return yield* service.validateMount(
          { hostPath: '/tmp/allowed/.ssh', containerPath: 'ssh' },
          true,
        );
      });

      const result = Effect.runSync(
        program.pipe(Effect.provide(MountSecurityServiceLive)),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('.ssh');
    });

    it('should block a path not under any allowed root', () => {
      setupAllowlistMocks(VALID_ALLOWLIST);

      const program = Effect.gen(function* () {
        const service = yield* MountSecurityService;
        return yield* service.validateMount(
          { hostPath: '/etc/passwd', containerPath: 'passwd' },
          true,
        );
      });

      const result = Effect.runSync(
        program.pipe(Effect.provide(MountSecurityServiceLive)),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not under any allowed root');
    });

    it('should force read-only for non-main groups when nonMainReadOnly is true', () => {
      setupAllowlistMocks(VALID_ALLOWLIST);

      const program = Effect.gen(function* () {
        const service = yield* MountSecurityService;
        return yield* service.validateMount(
          {
            hostPath: '/tmp/allowed/project',
            containerPath: 'project',
            readonly: false,
          },
          false, // not main
        );
      });

      const result = Effect.runSync(
        program.pipe(Effect.provide(MountSecurityServiceLive)),
      );

      expect(result.allowed).toBe(true);
      expect(result.effectiveReadonly).toBe(true);
    });

    it('should force read-only when root disallows read-write', () => {
      setupAllowlistMocks(VALID_ALLOWLIST);

      const program = Effect.gen(function* () {
        const service = yield* MountSecurityService;
        return yield* service.validateMount(
          {
            hostPath: '/tmp/readonly-root/data',
            containerPath: 'data',
            readonly: false,
          },
          true, // main
        );
      });

      const result = Effect.runSync(
        program.pipe(Effect.provide(MountSecurityServiceLive)),
      );

      expect(result.allowed).toBe(true);
      expect(result.effectiveReadonly).toBe(true);
    });

    it('should reject invalid container paths', () => {
      setupAllowlistMocks(VALID_ALLOWLIST);

      const program = Effect.gen(function* () {
        const service = yield* MountSecurityService;
        return yield* service.validateMount(
          { hostPath: '/tmp/allowed/project', containerPath: '../escape' },
          true,
        );
      });

      const result = Effect.runSync(
        program.pipe(Effect.provide(MountSecurityServiceLive)),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('..');
    });
  });

  describe('validateAdditionalMounts', () => {
    it('should filter out invalid mounts and keep valid ones', () => {
      setupAllowlistMocks(VALID_ALLOWLIST);

      const program = Effect.gen(function* () {
        const service = yield* MountSecurityService;
        return yield* service.validateAdditionalMounts(
          [
            { hostPath: '/tmp/allowed/good', containerPath: 'good' },
            { hostPath: '/etc/shadow', containerPath: 'bad' },
            { hostPath: '/tmp/allowed/also-good', containerPath: 'also-good' },
          ],
          'test-group',
          true,
        );
      });

      const result = Effect.runSync(
        program.pipe(Effect.provide(MountSecurityServiceLive)),
      );

      expect(result).toHaveLength(2);
      expect(result[0].containerPath).toBe('/workspace/extra/good');
      expect(result[1].containerPath).toBe('/workspace/extra/also-good');
    });
  });
});
