import type fs from 'node:fs';

import { Effect, Layer, Logger } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellService } from '../deploy.js';
import { DeployError } from '../errors.js';
import { SecretsService, SecretsServiceLive, validateServerEnv } from '../secrets.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('fs', async () => {
	const actual = await vi.importActual<typeof fs>('fs');
	return {
		...actual,
		default: {
			...actual,
			existsSync: vi.fn(() => true),
			readFileSync: vi.fn(() => ''),
			statSync: vi.fn(() => ({ size: 100 })),
			mkdirSync: vi.fn(),
			mkdtempSync: vi.fn(() => '/tmp/secrets-test'),
			unlinkSync: vi.fn(),
			rmdirSync: vi.fn(),
			writeFileSync: vi.fn(),
		},
		existsSync: vi.fn(() => true),
		readFileSync: vi.fn(() => ''),
		statSync: vi.fn(() => ({ size: 100 })),
		mkdirSync: vi.fn(),
		mkdtempSync: vi.fn(() => '/tmp/secrets-test'),
		unlinkSync: vi.fn(),
		rmdirSync: vi.fn(),
		writeFileSync: vi.fn(),
	};
});

const fsMock = await import('node:fs');

const SilentLogger = Logger.replace(Logger.defaultLogger, Logger.none);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Records every shell command; returns configured responses. */
function makeShellServiceTest(responses: Record<string, string> = {}): {
	layer: Layer.Layer<ShellService>;
	commands: Array<{ cmd: string; args: readonly string[] }>;
} {
	const commands: Array<{ cmd: string; args: readonly string[] }> = [];
	const layer = Layer.succeed(ShellService, {
		run: (cmd, args) =>
			Effect.sync(() => {
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

function makeTestLayer(shell: { layer: Layer.Layer<ShellService> }): Layer.Layer<SecretsService> {
	return SecretsServiceLive.pipe(Layer.provide(shell.layer), Layer.provide(SilentLogger));
}

/** Setup fs mocks so all preconditions pass by default. */
function setupDefaultFsMocks(): void {
	(fsMock.default.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
	(fsMock.default.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
		'GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nMIIE...',
	);
	(fsMock.default.statSync as ReturnType<typeof vi.fn>).mockReturnValue({ size: 100 });
	(fsMock.default.mkdtempSync as ReturnType<typeof vi.fn>).mockReturnValue('/tmp/secrets-test');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateServerEnv', () => {
	it('should pass with valid escaped-newline format', () => {
		const content =
			'GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nMIIE...\\n-----END RSA PRIVATE KEY-----';
		expect(validateServerEnv(content)).toEqual([]);
	});

	it('should fail with quoted value', () => {
		const content = 'GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\nMIIE..."';
		const errors = validateServerEnv(content);
		expect(errors).toContainEqual(expect.stringContaining('must not be quoted'));
	});

	it('should fail with missing literal \\n', () => {
		const content = 'GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----';
		const errors = validateServerEnv(content);
		expect(errors).toContainEqual(expect.stringContaining('missing literal \\n'));
	});

	it('should fail with duplicate key lines', () => {
		const content = [
			'GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nfoo',
			'GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nbar',
		].join('\n');
		const errors = validateServerEnv(content);
		expect(errors).toContainEqual(expect.stringContaining('Multiple'));
	});

	it('should pass when key is not present', () => {
		const content = 'OTHER_VAR=hello\nANOTHER=world';
		expect(validateServerEnv(content)).toEqual([]);
	});
});

describe('SecretsService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setupDefaultFsMocks();
	});

	// --- Precondition checks ---

	describe('backup preconditions', () => {
		it('should fail when .env missing', () => {
			(fsMock.default.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
				(p: string) => !p.endsWith('.env') || p.includes('server'),
			);

			const failShell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					const key = `${cmd} ${args.join(' ')}`.trim();
					if (key.startsWith('git ls-files')) {
						return Effect.fail(new DeployError({ stage: 'shell', message: 'not tracked' }));
					}
					return Effect.succeed('');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.backup(false);
			});

			const exit = Effect.runSyncExit(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(failShell), Layer.provide(SilentLogger)),
					),
				),
			);
			expect(exit._tag).toBe('Failure');
		});

		it('should fail when server/.env missing', () => {
			(fsMock.default.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
				(p: string) => !p.includes('server/.env') || p.includes('.age'),
			);

			const shell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					const key = `${cmd} ${args.join(' ')}`.trim();
					if (key.startsWith('git ls-files')) {
						return Effect.fail(new DeployError({ stage: 'shell', message: 'not tracked' }));
					}
					return Effect.succeed('');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.backup(false);
			});

			const exit = Effect.runSyncExit(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);
			expect(exit._tag).toBe('Failure');
		});

		it('should fail when .env is git-tracked', () => {
			const shell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					const key = `${cmd} ${args.join(' ')}`.trim();
					// git ls-files --error-unmatch succeeds = file IS tracked = BAD
					if (key.startsWith('git ls-files --error-unmatch .env')) {
						return Effect.succeed('.env');
					}
					return Effect.succeed('');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.backup(false);
			});

			const exit = Effect.runSyncExit(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);
			expect(exit._tag).toBe('Failure');
		});

		it('should fail when age key missing', () => {
			(fsMock.default.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
				(p: string) => !p.includes('secrets.key'),
			);

			const shell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					const key = `${cmd} ${args.join(' ')}`.trim();
					if (key.startsWith('git ls-files')) {
						return Effect.fail(new DeployError({ stage: 'shell', message: 'not tracked' }));
					}
					return Effect.succeed('');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.backup(false);
			});

			const exit = Effect.runSyncExit(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);
			expect(exit._tag).toBe('Failure');
		});

		it('should fail when PEM validation fails', () => {
			(fsMock.default.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
				'GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----"',
			);

			const shell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					const key = `${cmd} ${args.join(' ')}`.trim();
					if (key.startsWith('git ls-files')) {
						return Effect.fail(new DeployError({ stage: 'shell', message: 'not tracked' }));
					}
					return Effect.succeed('');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.backup(false);
			});

			const exit = Effect.runSyncExit(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);
			expect(exit._tag).toBe('Failure');
		});
	});

	describe('restore preconditions', () => {
		it('should fail when .age files missing', () => {
			(fsMock.default.existsSync as ReturnType<typeof vi.fn>).mockImplementation(
				(p: string) => !p.includes('.age'),
			);

			const shell = makeShellServiceTest();
			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.restore(false);
			});

			const exit = Effect.runSyncExit(program.pipe(Effect.provide(makeTestLayer(shell))));
			expect(exit._tag).toBe('Failure');
		});
	});

	// --- Dry-run tests ---

	describe('dry-run', () => {
		it('backup dry-run: runs preconditions but no mutation commands', () => {
			const commands: Array<{ cmd: string; args: readonly string[] }> = [];
			const trackingShell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					commands.push({ cmd, args });
					const key = `${cmd} ${args.join(' ')}`.trim();
					if (key.startsWith('git ls-files')) {
						return Effect.fail(new DeployError({ stage: 'shell', message: 'not tracked' }));
					}
					return Effect.succeed('age1pubkeyhere');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.backup(true);
			});

			Effect.runSync(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(trackingShell), Layer.provide(SilentLogger)),
					),
				),
			);

			const cmds = commands.map((c) => c.cmd);
			expect(cmds).not.toContain('age');
			expect(cmds).not.toContain('shasum');
		});

		it('restore dry-run: runs preconditions but no mutation commands', () => {
			const commands: Array<{ cmd: string; args: readonly string[] }> = [];
			const trackingShell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					commands.push({ cmd, args });
					return Effect.succeed('');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.restore(true);
			});

			Effect.runSync(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(trackingShell), Layer.provide(SilentLogger)),
					),
				),
			);

			const cmds = commands.map((c) => c.cmd);
			expect(cmds).not.toContain('age');
			expect(cmds).not.toContain('install');
		});

		it('deploy dry-run: runs preflight but no SCP/SSH install', () => {
			const commands: Array<{ cmd: string; args: readonly string[] }> = [];
			const trackingShell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					commands.push({ cmd, args });
					return Effect.succeed('Write access OK');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.deploy(true);
			});

			Effect.runSync(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(trackingShell), Layer.provide(SilentLogger)),
					),
				),
			);

			const cmds = commands.map((c) => c.cmd);
			// Preflight SSH runs
			expect(cmds).toContain('ssh');
			// But no SCP or age decrypt
			const fullCmds = commands.map((c) => `${c.cmd} ${c.args.join(' ')}`.trim());
			expect(fullCmds).not.toContainEqual(expect.stringContaining('scp'));
			expect(fullCmds).not.toContainEqual(expect.stringContaining('age -d'));
		});
	});

	// --- Happy paths ---

	describe('backup happy path', () => {
		it('should encrypt both files and log checksums', () => {
			const commands: Array<{ cmd: string; args: readonly string[] }> = [];
			const shell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					commands.push({ cmd, args });
					const key = `${cmd} ${args.join(' ')}`.trim();
					if (key.startsWith('git ls-files')) {
						return Effect.fail(new DeployError({ stage: 'shell', message: 'not tracked' }));
					}
					if (key.startsWith('shasum')) {
						return Effect.succeed('abc123  .env');
					}
					return Effect.succeed('age1pubkeyhere');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.backup(false);
			});

			Effect.runSync(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);

			const fullCmds = commands.map((c) => `${c.cmd} ${c.args.join(' ')}`.trim());
			expect(fullCmds).toContainEqual(expect.stringContaining('age -R'));
			expect(fullCmds).toContainEqual(expect.stringContaining('guardian-core.env.age'));
			expect(fullCmds).toContainEqual(expect.stringContaining('server.env.age'));
			expect(fullCmds).toContainEqual(expect.stringContaining('shasum'));
		});
	});

	describe('restore happy path', () => {
		it('should decrypt and install with mode 600', () => {
			const commands: Array<{ cmd: string; args: readonly string[] }> = [];
			const shell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					commands.push({ cmd, args });
					if (cmd === 'shasum') return Effect.succeed('def456  file');
					return Effect.succeed('');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.restore(false);
			});

			Effect.runSync(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);

			const fullCmds = commands.map((c) => `${c.cmd} ${c.args.join(' ')}`.trim());
			expect(fullCmds).toContainEqual(expect.stringContaining('age -d'));
			expect(fullCmds).toContainEqual(expect.stringContaining('install -m 600'));
		});
	});

	describe('deploy happy path', () => {
		it('should run full sequence: preflight, decrypt, SCP, install, restart, verify', () => {
			const commands: Array<{ cmd: string; args: readonly string[] }> = [];
			const shell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					commands.push({ cmd, args });
					const key = `${cmd} ${args.join(' ')}`.trim();
					if (key.includes('stat -c')) {
						return Effect.succeed(
							'600 rumi:users /opt/guardian-core/.env\n600 rumi:users /opt/guardian-core/server/.env',
						);
					}
					if (key.includes('systemctl is-active')) {
						return Effect.succeed('active\nactive');
					}
					if (key.includes('curl')) {
						return Effect.succeed('OK');
					}
					return Effect.succeed('Write access OK');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.deploy(false);
			});

			Effect.runSync(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);

			const fullCmds = commands.map((c) => `${c.cmd} ${c.args.join(' ')}`.trim());
			// SSH preflight
			expect(fullCmds[0]).toContain('ssh');
			// age decrypt
			expect(fullCmds).toContainEqual(expect.stringContaining('age -d'));
			// SCP
			expect(fullCmds).toContainEqual(expect.stringContaining('scp'));
			// SSH install + restart
			expect(fullCmds).toContainEqual(expect.stringContaining('systemctl restart'));
			// Verify calls
			expect(fullCmds).toContainEqual(expect.stringContaining('stat -c'));
			expect(fullCmds).toContainEqual(expect.stringContaining('curl'));
		});
	});

	describe('verify', () => {
		it('should pass when all checks succeed', () => {
			const shell = Layer.succeed(ShellService, {
				run: (_cmd, args) => {
					const key = args.join(' ');
					if (key.includes('stat -c')) {
						return Effect.succeed(
							'600 rumi:users /opt/guardian-core/.env\n600 rumi:users /opt/guardian-core/server/.env',
						);
					}
					if (key.includes('systemctl is-active')) {
						return Effect.succeed('active\nactive');
					}
					if (key.includes('curl')) {
						return Effect.succeed('OK');
					}
					return Effect.succeed('');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.verify();
			});

			Effect.runSync(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);
		});

		it('should fail with descriptive message when permissions are wrong', () => {
			const shell = Layer.succeed(ShellService, {
				run: (_cmd, args) => {
					const key = args.join(' ');
					if (key.includes('stat -c')) {
						return Effect.succeed(
							'644 root:root /opt/guardian-core/.env\n644 root:root /opt/guardian-core/server/.env',
						);
					}
					if (key.includes('systemctl is-active')) {
						return Effect.succeed('active\nactive');
					}
					if (key.includes('curl')) {
						return Effect.succeed('OK');
					}
					return Effect.succeed('');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.verify();
			});

			const exit = Effect.runSyncExit(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);
			expect(exit._tag).toBe('Failure');
		});
	});

	// --- Error propagation ---

	describe('error propagation', () => {
		it('should propagate shell failure during age encrypt as SecretsError', () => {
			const shell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					const key = `${cmd} ${args.join(' ')}`.trim();
					if (key.startsWith('git ls-files')) {
						return Effect.fail(new DeployError({ stage: 'shell', message: 'not tracked' }));
					}
					if (cmd === 'age' && args.includes('-o')) {
						return Effect.fail(
							new DeployError({ stage: 'shell', message: 'age: encryption failed' }),
						);
					}
					return Effect.succeed('age1pubkeyhere');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.backup(false);
			});

			const exit = Effect.runSyncExit(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);
			expect(exit._tag).toBe('Failure');
		});

		it('should propagate SSH preflight failure as SecretsError', () => {
			const shell = Layer.succeed(ShellService, {
				run: (cmd, args) => {
					const key = `${cmd} ${args.join(' ')}`.trim();
					if (cmd === 'ssh' && key.includes('test -w')) {
						return Effect.fail(
							new DeployError({ stage: 'shell', message: 'SSH connection refused' }),
						);
					}
					return Effect.succeed('');
				},
			});

			const program = Effect.gen(function* () {
				const svc = yield* SecretsService;
				yield* svc.deploy(false);
			});

			const exit = Effect.runSyncExit(
				program.pipe(
					Effect.provide(
						SecretsServiceLive.pipe(Layer.provide(shell), Layer.provide(SilentLogger)),
					),
				),
			);
			expect(exit._tag).toBe('Failure');
		});
	});
});
