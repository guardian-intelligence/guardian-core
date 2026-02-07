import { vi } from 'vitest';

const debugLogs = process.env.VITEST_DEBUG_LOGS === '1';

if (!debugLogs) {
	process.env.LOG_LEVEL = 'silent';

	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'info').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'debug').mockImplementation(() => {});
}
