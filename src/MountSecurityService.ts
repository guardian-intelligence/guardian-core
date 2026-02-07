/**
 * MountSecurityService — Effect port of mount-security.ts
 *
 * Validates additional mounts against an allowlist stored OUTSIDE the project root.
 * Exports both the Effect service and legacy wrappers (drop-in replacement for mount-security.ts).
 */
import fs from 'fs';
import path from 'path';
import { Context, Effect, Layer, Ref, Schema } from 'effect';

import { MOUNT_ALLOWLIST_PATH } from './config.js';
import {
  MountAllowlistNotFoundError,
  MountAllowlistParseError,
} from './errors.js';
import { logger } from './logger.js';
import {
  type AdditionalMount,
  type AllowedRoot,
  MountAllowlist as MountAllowlistSchema,
  type MountAllowlist,
} from './schemas.js';

// --- Constants ---

const DEFAULT_BLOCKED_PATTERNS = [
  '.ssh',
  '.gnupg',
  '.gpg',
  '.aws',
  '.azure',
  '.gcloud',
  '.kube',
  '.docker',
  'credentials',
  '.env',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_ed25519',
  'private_key',
  '.secret',
];

// --- Pure helpers (no Effect, no side effects) ---

function expandPath(p: string): string {
  const homeDir = process.env.HOME || '/Users/user';
  if (p.startsWith('~/')) return path.join(homeDir, p.slice(2));
  if (p === '~') return homeDir;
  return path.resolve(p);
}

function getRealPath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function matchesBlockedPattern(
  realPath: string,
  blockedPatterns: readonly string[],
): string | null {
  const pathParts = realPath.split(path.sep);
  for (const pattern of blockedPatterns) {
    for (const part of pathParts) {
      if (part === pattern || part.includes(pattern)) return pattern;
    }
    if (realPath.includes(pattern)) return pattern;
  }
  return null;
}

function findAllowedRoot(
  realPath: string,
  allowedRoots: readonly AllowedRoot[],
): AllowedRoot | null {
  for (const root of allowedRoots) {
    const expandedRoot = expandPath(root.path);
    const realRoot = getRealPath(expandedRoot);
    if (realRoot === null) continue;
    const relative = path.relative(realRoot, realPath);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) return root;
  }
  return null;
}

function isValidContainerPath(containerPath: string): boolean {
  if (containerPath.includes('..')) return false;
  if (containerPath.startsWith('/')) return false;
  if (!containerPath || containerPath.trim() === '') return false;
  return true;
}

// --- Effect service interface ---

export interface MountValidationResult {
  allowed: boolean;
  reason: string;
  realHostPath?: string;
  effectiveReadonly?: boolean;
}

export interface MountSecurityServiceShape {
  readonly loadAllowlist: Effect.Effect<
    MountAllowlist,
    MountAllowlistNotFoundError | MountAllowlistParseError
  >;
  readonly validateMount: (
    mount: AdditionalMount,
    isMain: boolean,
  ) => Effect.Effect<MountValidationResult>;
  readonly validateAdditionalMounts: (
    mounts: AdditionalMount[],
    groupName: string,
    isMain: boolean,
  ) => Effect.Effect<
    Array<{ hostPath: string; containerPath: string; readonly: boolean }>
  >;
}

export class MountSecurityService extends Context.Tag('MountSecurityService')<
  MountSecurityService,
  MountSecurityServiceShape
>() {}

// --- Service implementation ---

const makeMountSecurityService = Effect.gen(function* () {
  const cachedAllowlist = yield* Ref.make<MountAllowlist | null>(null);

  const loadAllowlist: MountSecurityServiceShape['loadAllowlist'] = Effect.gen(
    function* () {
      const cached = yield* Ref.get(cachedAllowlist);
      if (cached !== null) return cached;

      if (!fs.existsSync(MOUNT_ALLOWLIST_PATH)) {
        return yield* new MountAllowlistNotFoundError({
          path: MOUNT_ALLOWLIST_PATH,
        });
      }

      const raw = yield* Effect.try({
        try: () => fs.readFileSync(MOUNT_ALLOWLIST_PATH, 'utf-8'),
        catch: (err) =>
          new MountAllowlistParseError({
            path: MOUNT_ALLOWLIST_PATH,
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          }),
      });

      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw) as unknown,
        catch: (err) =>
          new MountAllowlistParseError({
            path: MOUNT_ALLOWLIST_PATH,
            message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
            cause: err,
          }),
      });

      const decoded = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(MountAllowlistSchema)(parsed),
        catch: (err) =>
          new MountAllowlistParseError({
            path: MOUNT_ALLOWLIST_PATH,
            message: `Schema validation failed: ${err instanceof Error ? err.message : String(err)}`,
            cause: err,
          }),
      });

      // Merge default blocked patterns
      const mergedBlockedPatterns = [
        ...new Set([...DEFAULT_BLOCKED_PATTERNS, ...decoded.blockedPatterns]),
      ];
      const allowlist: MountAllowlist = {
        ...decoded,
        blockedPatterns: mergedBlockedPatterns,
      };

      yield* Ref.set(cachedAllowlist, allowlist);

      logger.info(
        {
          path: MOUNT_ALLOWLIST_PATH,
          allowedRoots: allowlist.allowedRoots.length,
          blockedPatterns: allowlist.blockedPatterns.length,
        },
        'Mount allowlist loaded successfully',
      );

      return allowlist;
    },
  );

  const validateMountFn: MountSecurityServiceShape['validateMount'] = (
    mount,
    isMain,
  ) =>
    Effect.gen(function* () {
      // Try loading the allowlist — if it fails, return a rejection result
      const allowlistResult = yield* Effect.either(loadAllowlist);

      if (allowlistResult._tag === 'Left') {
        return {
          allowed: false,
          reason: `No mount allowlist configured at ${MOUNT_ALLOWLIST_PATH}`,
        } satisfies MountValidationResult;
      }

      const allowlist = allowlistResult.right;

      if (!isValidContainerPath(mount.containerPath)) {
        return {
          allowed: false,
          reason: `Invalid container path: "${mount.containerPath}" - must be relative, non-empty, and not contain ".."`,
        } satisfies MountValidationResult;
      }

      const expandedPath = expandPath(mount.hostPath);
      const realPath = getRealPath(expandedPath);

      if (realPath === null) {
        return {
          allowed: false,
          reason: `Host path does not exist: "${mount.hostPath}" (expanded: "${expandedPath}")`,
        } satisfies MountValidationResult;
      }

      const blockedMatch = matchesBlockedPattern(
        realPath,
        allowlist.blockedPatterns,
      );
      if (blockedMatch !== null) {
        return {
          allowed: false,
          reason: `Path matches blocked pattern "${blockedMatch}": "${realPath}"`,
        } satisfies MountValidationResult;
      }

      const allowedRoot = findAllowedRoot(realPath, allowlist.allowedRoots);
      if (allowedRoot === null) {
        return {
          allowed: false,
          reason: `Path "${realPath}" is not under any allowed root. Allowed roots: ${[...allowlist.allowedRoots].map((r) => expandPath(r.path)).join(', ')}`,
        } satisfies MountValidationResult;
      }

      const requestedReadWrite = mount.readonly === false;
      let effectiveReadonly = true;

      if (requestedReadWrite) {
        if (!isMain && allowlist.nonMainReadOnly) {
          effectiveReadonly = true;
          logger.info(
            { mount: mount.hostPath },
            'Mount forced to read-only for non-main group',
          );
        } else if (!allowedRoot.allowReadWrite) {
          effectiveReadonly = true;
          logger.info(
            { mount: mount.hostPath, root: allowedRoot.path },
            'Mount forced to read-only - root does not allow read-write',
          );
        } else {
          effectiveReadonly = false;
        }
      }

      return {
        allowed: true,
        reason: `Allowed under root "${allowedRoot.path}"${allowedRoot.description ? ` (${allowedRoot.description})` : ''}`,
        realHostPath: realPath,
        effectiveReadonly,
      } satisfies MountValidationResult;
    });

  const validateAdditionalMountsFn: MountSecurityServiceShape['validateAdditionalMounts'] =
    (mounts, groupName, isMain) =>
      Effect.gen(function* () {
        const validated: Array<{
          hostPath: string;
          containerPath: string;
          readonly: boolean;
        }> = [];

        for (const mount of mounts) {
          const result = yield* validateMountFn(mount, isMain);

          if (result.allowed) {
            validated.push({
              hostPath: result.realHostPath!,
              containerPath: `/workspace/extra/${mount.containerPath}`,
              readonly: result.effectiveReadonly!,
            });

            logger.debug(
              {
                group: groupName,
                hostPath: result.realHostPath,
                containerPath: mount.containerPath,
                readonly: result.effectiveReadonly,
                reason: result.reason,
              },
              'Mount validated successfully',
            );
          } else {
            logger.warn(
              {
                group: groupName,
                requestedPath: mount.hostPath,
                containerPath: mount.containerPath,
                reason: result.reason,
              },
              'Additional mount REJECTED',
            );
          }
        }

        return validated;
      });

  return {
    loadAllowlist,
    validateMount: validateMountFn,
    validateAdditionalMounts: validateAdditionalMountsFn,
  } satisfies MountSecurityServiceShape;
});

export const MountSecurityServiceLive = Layer.effect(
  MountSecurityService,
  makeMountSecurityService,
);

// --- Legacy wrappers (drop-in replacement for mount-security.ts exports) ---

/** Stateless service instance created once at module load */
const legacyService = Effect.runSync(makeMountSecurityService);

export function loadMountAllowlist(): MountAllowlist | null {
  return Effect.runSync(
    legacyService.loadAllowlist.pipe(
      Effect.catchAll(() => Effect.succeed(null as MountAllowlist | null)),
    ),
  );
}

export function validateMount(
  mount: AdditionalMount,
  isMain: boolean,
): MountValidationResult {
  return Effect.runSync(legacyService.validateMount(mount, isMain));
}

export function validateAdditionalMounts(
  mounts: AdditionalMount[],
  groupName: string,
  isMain: boolean,
): Array<{ hostPath: string; containerPath: string; readonly: boolean }> {
  return Effect.runSync(
    legacyService.validateAdditionalMounts(mounts, groupName, isMain),
  );
}

export function generateAllowlistTemplate(): string {
  const template: MountAllowlist = {
    allowedRoots: [
      {
        path: '~/projects',
        allowReadWrite: true,
        description: 'Development projects',
      },
      {
        path: '~/repos',
        allowReadWrite: true,
        description: 'Git repositories',
      },
      {
        path: '~/Documents/work',
        allowReadWrite: false,
        description: 'Work documents (read-only)',
      },
    ],
    blockedPatterns: ['password', 'secret', 'token'],
    nonMainReadOnly: true,
  };

  return JSON.stringify(template, null, 2);
}
