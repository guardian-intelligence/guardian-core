/**
 * MountSecurityService
 *
 * Validates additional mounts against an allowlist stored OUTSIDE the project root.
 * Uses @effect/platform FileSystem port for all file I/O.
 * Exports both the Effect service and legacy wrappers.
 */
import path from 'node:path';
import { FileSystem } from '@effect/platform/FileSystem';
import { layer as BunFileSystemLayer } from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Either, Layer, Option, Ref, Schema } from 'effect';

import { AppConfig, AppConfigLive } from './AppConfig.js';
import { logger } from './AppLogger.js';
import { MountAllowlistNotFoundError, MountAllowlistParseError } from './errors.js';
import {
	type AdditionalMount,
	type AllowedRoot,
	type MountAllowlist,
	MountAllowlist as MountAllowlistSchema,
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

function expandPath(p: string, homeDir: string): string {
	if (p.startsWith('~/')) return path.join(homeDir, p.slice(2));
	if (p === '~') return homeDir;
	return path.resolve(p);
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
		mounts: readonly AdditionalMount[],
		groupName: string,
		isMain: boolean,
	) => Effect.Effect<Array<{ hostPath: string; containerPath: string; readonly: boolean }>>;
}

export class MountSecurityService extends Context.Tag('MountSecurityService')<
	MountSecurityService,
	MountSecurityServiceShape
>() {}

// --- Service implementation ---

const makeMountSecurityService = Effect.gen(function* () {
	const fileSystem = yield* FileSystem;
	const config = yield* AppConfig;
	const cachedAllowlist = yield* Ref.make<MountAllowlist | null>(null);

	const getRealPath = (p: string): Effect.Effect<Option.Option<string>> =>
		fileSystem.realPath(p).pipe(
			Effect.map(Option.some),
			Effect.catchAll(() => Effect.succeed(Option.none<string>())),
		);

	const findAllowedRoot = (
		realPath: string,
		allowedRoots: readonly AllowedRoot[],
	): Effect.Effect<AllowedRoot | null> =>
		Effect.gen(function* () {
			for (const root of allowedRoots) {
				const expandedRoot = expandPath(root.path, config.homeDir);
				const realRootOpt = yield* getRealPath(expandedRoot);
				if (Option.isNone(realRootOpt)) continue;
				const realRoot = realRootOpt.value;
				const relative = path.relative(realRoot, realPath);
				if (!relative.startsWith('..') && !path.isAbsolute(relative)) return root;
			}
			return null;
		});

	const loadAllowlist: MountSecurityServiceShape['loadAllowlist'] = Effect.gen(function* () {
		const cached = yield* Ref.get(cachedAllowlist);
		if (cached !== null) return cached;

		const allowlistPath = config.mountAllowlistPath;

		const exists = yield* fileSystem
			.exists(allowlistPath)
			.pipe(Effect.catchAll(() => Effect.succeed(false)));
		if (!exists) {
			return yield* new MountAllowlistNotFoundError({
				path: allowlistPath,
			});
		}

		const raw = yield* fileSystem.readFileString(allowlistPath).pipe(
			Effect.mapError(
				(e) =>
					new MountAllowlistParseError({
						path: allowlistPath,
						message: e.message,
						cause: e,
					}),
			),
		);

		const parsed = yield* Effect.try({
			try: () => JSON.parse(raw) as unknown,
			catch: (err) =>
				new MountAllowlistParseError({
					path: allowlistPath,
					message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
					cause: err,
				}),
		});

		const decoded = yield* Effect.try({
			try: () => Schema.decodeUnknownSync(MountAllowlistSchema)(parsed),
			catch: (err) =>
				new MountAllowlistParseError({
					path: allowlistPath,
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
				path: allowlistPath,
				allowedRoots: allowlist.allowedRoots.length,
				blockedPatterns: allowlist.blockedPatterns.length,
			},
			'Mount allowlist loaded successfully',
		);

		return allowlist;
	});

	const validateMountFn: MountSecurityServiceShape['validateMount'] = (mount, isMain) =>
		Effect.gen(function* () {
			const allowlistPath = config.mountAllowlistPath;

			// Try loading the allowlist — if it fails, return a rejection result
			const allowlistResult = yield* Effect.either(loadAllowlist);

			const allowlist = Either.match(allowlistResult, {
				onLeft: () => null,
				onRight: (v) => v,
			});

			if (allowlist === null) {
				return {
					allowed: false,
					reason: `No mount allowlist configured at ${allowlistPath}`,
				} satisfies MountValidationResult;
			}

			if (!isValidContainerPath(mount.containerPath)) {
				return {
					allowed: false,
					reason: `Invalid container path: "${mount.containerPath}" - must be relative, non-empty, and not contain ".."`,
				} satisfies MountValidationResult;
			}

			const expandedPath = expandPath(mount.hostPath, config.homeDir);
			const realPathOpt = yield* getRealPath(expandedPath);

			if (Option.isNone(realPathOpt)) {
				return {
					allowed: false,
					reason: `Host path does not exist: "${mount.hostPath}" (expanded: "${expandedPath}")`,
				} satisfies MountValidationResult;
			}

			const realHostPath = realPathOpt.value;

			const blockedMatch = matchesBlockedPattern(realHostPath, allowlist.blockedPatterns);
			if (blockedMatch !== null) {
				return {
					allowed: false,
					reason: `Path matches blocked pattern "${blockedMatch}": "${realHostPath}"`,
				} satisfies MountValidationResult;
			}

			const allowedRoot = yield* findAllowedRoot(realHostPath, allowlist.allowedRoots);
			if (allowedRoot === null) {
				return {
					allowed: false,
					reason: `Path "${realHostPath}" is not under any allowed root. Allowed roots: ${[...allowlist.allowedRoots].map((r) => expandPath(r.path, config.homeDir)).join(', ')}`,
				} satisfies MountValidationResult;
			}

			const requestedReadWrite = mount.readonly === false;
			const effectiveReadonly = requestedReadWrite
				? !isMain && allowlist.nonMainReadOnly
					? (() => {
							logger.info(
								{ mount: mount.hostPath },
								'Mount forced to read-only for non-main group',
							);
							return true;
						})()
					: !allowedRoot.allowReadWrite
						? (() => {
								logger.info(
									{ mount: mount.hostPath, root: allowedRoot.path },
									'Mount forced to read-only - root does not allow read-write',
								);
								return true;
							})()
						: false
				: true;

			return {
				allowed: true,
				reason: `Allowed under root "${allowedRoot.path}"${allowedRoot.description ? ` (${allowedRoot.description})` : ''}`,
				realHostPath,
				effectiveReadonly,
			} satisfies MountValidationResult;
		});

	const validateAdditionalMountsFn: MountSecurityServiceShape['validateAdditionalMounts'] = (
		mounts,
		groupName,
		isMain,
	) =>
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

// --- Legacy wrappers ---

/** Stateless service instance created once at module load */
const legacyService = Effect.runSync(
	makeMountSecurityService.pipe(Effect.provide(BunFileSystemLayer), Effect.provide(AppConfigLive)),
);

export function loadMountAllowlist(): MountAllowlist | null {
	return Effect.runSync(
		legacyService.loadAllowlist.pipe(
			Effect.catchAll(() => Effect.succeed(null as MountAllowlist | null)),
		),
	);
}

export function validateMount(mount: AdditionalMount, isMain: boolean): MountValidationResult {
	return Effect.runSync(legacyService.validateMount(mount, isMain));
}

export function validateAdditionalMounts(
	mounts: readonly AdditionalMount[],
	groupName: string,
	isMain: boolean,
): Array<{ hostPath: string; containerPath: string; readonly: boolean }> {
	return Effect.runSync(legacyService.validateAdditionalMounts(mounts, groupName, isMain));
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
