import { defineConfig } from 'vitest/config';

const isCI = !!process.env.CI;
const debugLogs = process.env.VITEST_DEBUG_LOGS === '1';

export default defineConfig({
	test: {
		include: ['src/__tests__/**/*.test.ts'],
		setupFiles: ['src/__tests__/setup.ts'],
		testTimeout: 20_000,
		hookTimeout: 20_000,
		pool: 'forks',
		maxConcurrency: isCI ? 4 : 8,
		reporters: isCI ? ['default'] : ['dot'],
		silent: !debugLogs,
	},
});
