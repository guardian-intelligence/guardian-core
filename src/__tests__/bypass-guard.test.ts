import { execSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'vitest';

const SRC_DIR = path.resolve(import.meta.dirname, '..');

/**
 * Allowlist for files permitted to use raw pino() or console.* calls.
 * Each entry has a documented reason.
 */
const PINO_ALLOWLIST = [
	'src/AppLogger.ts', // Canonical logger factory
	'src/MountSecurityService.ts', // Contains pino import for Baileys compat; will be removed in Phase 5
];

const CONSOLE_ALLOWLIST = [
	'src/DeployLogger.ts', // Effect logger, uses globalThis.console explicitly
	'src/index.ts', // Static Docker banner (ensureDockerRunning), bounded
	'src/whatsapp-auth.ts', // Static console.log UX messages (setup CLI), bounded
];

function grepSrc(pattern: string): string[] {
	try {
		const output = execSync(
			`grep -rn '${pattern}' '${SRC_DIR}' --include='*.ts' --exclude-dir='__tests__'`,
			{ encoding: 'utf-8' },
		);
		return output.split('\n').filter((line) => line.trim().length > 0);
	} catch {
		// grep returns exit code 1 when no matches — that's fine
		return [];
	}
}

describe('bypass guard', () => {
	it('no ad-hoc pino() instances outside allowlist', () => {
		const matches = grepSrc('\\bpino(');
		const violations = matches.filter((line) => {
			const relPath = line.replace(`${path.resolve(SRC_DIR, '..')}/`, '');
			return !PINO_ALLOWLIST.some((allowed) => relPath.startsWith(allowed));
		});
		if (violations.length > 0) {
			throw new Error(
				`Found ad-hoc pino() calls outside allowlist. Use \`import { logger } from './AppLogger.js'\` instead:\n${violations.join('\n')}`,
			);
		}
	});

	it('no console.error/console.warn outside allowlist', () => {
		const matches = grepSrc('console\\.\\(error\\|warn\\)');
		const violations = matches.filter((line) => {
			const relPath = line.replace(`${path.resolve(SRC_DIR, '..')}/`, '');
			return !CONSOLE_ALLOWLIST.some((allowed) => relPath.startsWith(allowed));
		});
		if (violations.length > 0) {
			throw new Error(
				`Found console.error/console.warn outside allowlist. Use \`logger.error()\`/\`logger.warn()\` instead:\n${violations.join('\n')}`,
			);
		}
	});
});
