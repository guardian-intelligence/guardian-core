import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../AppLogger.js';

function collectLines(): { lines: string[]; stream: Writable } {
	const lines: string[] = [];
	const stream = new Writable({
		write(chunk, _enc, cb) {
			lines.push(chunk.toString());
			cb();
		},
	});
	return { lines, stream };
}

function createTestLogger(sink: { stream: Writable }) {
	return createLogger({ transport: undefined, level: 'trace' }, sink.stream);
}

describe('logger integration — redaction through pino pipeline', () => {
	it('redacts JID from log output', () => {
		const sink = collectLines();
		const log = createTestLogger(sink);
		log.info('from 1234567890@s.whatsapp.net');
		const output = sink.lines.join('');
		expect(output).toContain('[JID]');
		expect(output).not.toContain('1234567890@s.whatsapp.net');
	});

	it('child logger redacts phone number', () => {
		const sink = collectLines();
		const log = createTestLogger(sink);
		const child = log.child({ component: 'test' });
		child.warn('call +12025551234');
		const output = sink.lines.join('');
		expect(output).toContain('[PHONE]');
		expect(output).not.toContain('+12025551234');
	});

	it('redacts API key from error serialization', () => {
		const sink = collectLines();
		const log = createTestLogger(sink);
		log.error({ err: new Error('sk-ant-api03-abcdefghijklmnopqrst') }, 'fail');
		const output = sink.lines.join('');
		expect(output).toContain('[ANTHROPIC_KEY]');
		expect(output).not.toContain('sk-ant-api03');
	});

	it('output lines are valid JSON', () => {
		const sink = collectLines();
		const log = createTestLogger(sink);
		log.info('from 1234567890@s.whatsapp.net with key sk-ant-api03-abcdefghijklmnopqrst');
		for (const line of sink.lines) {
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				expect(() => JSON.parse(trimmed)).not.toThrow();
			}
		}
	});

	it('createLogger installs streamWrite hook', () => {
		const log = createLogger({ transport: undefined });
		const hooksSym = Object.getOwnPropertySymbols(log).find(
			(s) => s.toString() === 'Symbol(pino.hooks)',
		);
		expect(hooksSym).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: test assertion
		const hooks = (log as any)[hooksSym!];
		expect(hooks.streamWrite).toBeTypeOf('function');
	});
});
