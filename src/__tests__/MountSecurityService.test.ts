import fs from 'node:fs';
import path from 'node:path';

import { layer as BunFileSystemLayer } from '@effect/platform-bun/BunFileSystem';
import { Duration, Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppConfig } from '../AppConfig.js';
import { MountSecurityService, MountSecurityServiceLive } from '../MountSecurityService.js';

const TEST_ROOT = path.join('/tmp', 'guardian-core-mount-security-service-tests');
const TEST_ALLOWLIST_PATH = path.join(TEST_ROOT, 'mount-allowlist.json');

const VALID_ALLOWLIST = JSON.stringify({
	allowedRoots: [
		{ path: '/tmp/allowed', allowReadWrite: true, description: 'Test root' },
		{ path: '/tmp/readonly-root', allowReadWrite: false, description: 'Read-only root' },
	],
	blockedPatterns: ['password', 'secret'],
	nonMainReadOnly: true,
});

const mountFixtureDirs = [
	'/tmp/allowed/myproject',
	'/tmp/allowed/.ssh',
	'/tmp/allowed/project',
	'/tmp/readonly-root/data',
	'/tmp/allowed/good',
	'/tmp/allowed/also-good',
];

function makeAppConfigLayer(): Layer.Layer<AppConfig> {
	return Layer.succeed(AppConfig, {
		assistantName: 'Andy',
		pollInterval: 2000,
		schedulerPollInterval: 60000,
		projectRoot: process.cwd(),
		homeDir: process.env.HOME || '/tmp',
		mountAllowlistPath: TEST_ALLOWLIST_PATH,
		storeDir: path.resolve(process.cwd(), 'store'),
		groupsDir: path.resolve(process.cwd(), 'groups'),
		dataDir: path.resolve(process.cwd(), 'data'),
		mainGroupFolder: 'main',
		containerImage: 'guardian-core-agent:latest',
		containerTimeout: 300000,
		containerMaxOutputSize: 10485760,
		ipcPollInterval: 1000,
		timezone: process.env.TZ || 'UTC',
		pollIntervalDuration: Duration.millis(2000),
		schedulerPollDuration: Duration.minutes(1),
		containerTimeoutDuration: Duration.millis(300000),
		ipcPollDuration: Duration.seconds(1),
	});
}

function makeMountSecurityTestLayer(): Layer.Layer<MountSecurityService> {
	return MountSecurityServiceLive.pipe(
		Layer.provide(makeAppConfigLayer()),
		Layer.provide(BunFileSystemLayer),
	);
}

function ensureFixtures(): void {
	for (const dir of mountFixtureDirs) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function writeAllowlist(content: string): void {
	fs.mkdirSync(path.dirname(TEST_ALLOWLIST_PATH), { recursive: true });
	fs.writeFileSync(TEST_ALLOWLIST_PATH, content, 'utf-8');
}

function removeAllowlist(): void {
	fs.rmSync(TEST_ALLOWLIST_PATH, { force: true });
}

describe('MountSecurityService', () => {
	beforeEach(() => {
		removeAllowlist();
		ensureFixtures();
	});

	describe('loadAllowlist', () => {
		it('should load and parse a valid allowlist', async () => {
			writeAllowlist(VALID_ALLOWLIST);

			const program = Effect.gen(function* () {
				const service = yield* MountSecurityService;
				return yield* service.loadAllowlist;
			});

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(makeMountSecurityTestLayer())),
			);

			expect(result.allowedRoots).toHaveLength(2);
			expect(result.nonMainReadOnly).toBe(true);
			expect(result.blockedPatterns).toContain('.ssh');
			expect(result.blockedPatterns).toContain('password');
		});

		it('should fail when allowlist file is missing', async () => {
			const program = Effect.gen(function* () {
				const service = yield* MountSecurityService;
				return yield* service.loadAllowlist;
			});

			const result = await Effect.runPromiseExit(
				program.pipe(Effect.provide(makeMountSecurityTestLayer())),
			);

			expect(result._tag).toBe('Failure');
		});

		it('should fail when allowlist contains invalid JSON', async () => {
			writeAllowlist('not json');

			const program = Effect.gen(function* () {
				const service = yield* MountSecurityService;
				return yield* service.loadAllowlist;
			});

			const result = await Effect.runPromiseExit(
				program.pipe(Effect.provide(makeMountSecurityTestLayer())),
			);

			expect(result._tag).toBe('Failure');
		});
	});

	describe('validateMount', () => {
		it('should allow a mount under an allowed root', async () => {
			writeAllowlist(VALID_ALLOWLIST);

			const program = Effect.gen(function* () {
				const service = yield* MountSecurityService;
				return yield* service.validateMount(
					{ hostPath: '/tmp/allowed/myproject', containerPath: 'myproject' },
					true,
				);
			});

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(makeMountSecurityTestLayer())),
			);

			expect(result.allowed).toBe(true);
			expect(result.realHostPath).toMatch(/\/tmp\/allowed\/myproject$/);
		});

		it('should block a mount matching a blocked pattern', async () => {
			writeAllowlist(VALID_ALLOWLIST);

			const program = Effect.gen(function* () {
				const service = yield* MountSecurityService;
				return yield* service.validateMount(
					{ hostPath: '/tmp/allowed/.ssh', containerPath: 'ssh' },
					true,
				);
			});

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(makeMountSecurityTestLayer())),
			);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('.ssh');
		});

		it('should block a path not under any allowed root', async () => {
			writeAllowlist(VALID_ALLOWLIST);

			const program = Effect.gen(function* () {
				const service = yield* MountSecurityService;
				return yield* service.validateMount(
					{ hostPath: '/etc/passwd', containerPath: 'passwd' },
					true,
				);
			});

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(makeMountSecurityTestLayer())),
			);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('not under any allowed root');
		});

		it('should force read-only for non-main groups when nonMainReadOnly is true', async () => {
			writeAllowlist(VALID_ALLOWLIST);

			const program = Effect.gen(function* () {
				const service = yield* MountSecurityService;
				return yield* service.validateMount(
					{
						hostPath: '/tmp/allowed/project',
						containerPath: 'project',
						readonly: false,
					},
					false,
				);
			});

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(makeMountSecurityTestLayer())),
			);

			expect(result.allowed).toBe(true);
			expect(result.effectiveReadonly).toBe(true);
		});

		it('should force read-only when root disallows read-write', async () => {
			writeAllowlist(VALID_ALLOWLIST);

			const program = Effect.gen(function* () {
				const service = yield* MountSecurityService;
				return yield* service.validateMount(
					{
						hostPath: '/tmp/readonly-root/data',
						containerPath: 'data',
						readonly: false,
					},
					true,
				);
			});

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(makeMountSecurityTestLayer())),
			);

			expect(result.allowed).toBe(true);
			expect(result.effectiveReadonly).toBe(true);
		});

		it('should reject invalid container paths', async () => {
			writeAllowlist(VALID_ALLOWLIST);

			const program = Effect.gen(function* () {
				const service = yield* MountSecurityService;
				return yield* service.validateMount(
					{ hostPath: '/tmp/allowed/project', containerPath: '../escape' },
					true,
				);
			});

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(makeMountSecurityTestLayer())),
			);

			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('..');
		});
	});

	describe('validateAdditionalMounts', () => {
		it('should filter out invalid mounts and keep valid ones', async () => {
			writeAllowlist(VALID_ALLOWLIST);

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

			const result = await Effect.runPromise(
				program.pipe(Effect.provide(makeMountSecurityTestLayer())),
			);

			expect(result).toHaveLength(2);
			expect(result[0].containerPath).toBe('/workspace/extra/good');
			expect(result[1].containerPath).toBe('/workspace/extra/also-good');
		});
	});
});
