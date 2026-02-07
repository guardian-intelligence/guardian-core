import { describe, expect, it } from 'vitest';

import { redactLine } from '../redact.js';

describe('redactLine', () => {
	// ── A. Pattern coverage ──────────────────────────────────────────────

	it('redacts WhatsApp JID', () => {
		expect(redactLine('msg from 1234567890@s.whatsapp.net')).toBe('msg from [JID]');
	});

	it('redacts WhatsApp group JID', () => {
		expect(redactLine('group 120363012345-1234567890@g.us')).toBe('group [GROUP_JID]');
	});

	it('redacts phone number', () => {
		expect(redactLine('calling +12025551234')).toBe('calling [PHONE]');
	});

	it('redacts Anthropic API key', () => {
		expect(redactLine('key=sk-ant-api03-abcdefghijklmnopqrst')).toBe('key=[ANTHROPIC_KEY]');
	});

	it('redacts OpenAI API key', () => {
		expect(redactLine('key=sk-abcdefghijklmnopqrstuvwxyz')).toBe('key=[OPENAI_KEY]');
	});

	it('redacts GitHub PAT', () => {
		expect(redactLine('token ghp_1234567890abcdefghijklmnopqrstuvwxyz1234')).toBe(
			'token [GITHUB_TOKEN]',
		);
	});

	it('redacts ElevenLabs key', () => {
		expect(redactLine('key xi-abcdefghijklmnopqrst')).toBe('key [ELEVENLABS_KEY]');
	});

	it('redacts Bearer token', () => {
		expect(redactLine('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(
			'Authorization: Bearer [TOKEN]',
		);
	});

	it('redacts JWT', () => {
		expect(
			redactLine(
				'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XljN',
			),
		).toBe('token [JWT]');
	});

	it('redacts home directory path', () => {
		expect(redactLine('/Users/shovonhasan/Documents/foo')).toBe('[HOME_PATH]');
	});

	// ── B. JSON parseability ─────────────────────────────────────────────

	it('preserves JSON validity after redacting JID in message field', () => {
		const line = JSON.stringify({
			level: 30,
			msg: 'from 1234567890@s.whatsapp.net',
		});
		const redacted = redactLine(line);
		expect(() => JSON.parse(redacted)).not.toThrow();
		expect(JSON.parse(redacted).msg).toBe('from [JID]');
	});

	it('preserves JSON validity after redacting phone number', () => {
		const line = JSON.stringify({ level: 30, msg: 'call +12025551234' });
		const redacted = redactLine(line);
		expect(() => JSON.parse(redacted)).not.toThrow();
		expect(JSON.parse(redacted).msg).toBe('call [PHONE]');
	});

	it('preserves JSON validity after redacting API key in value field', () => {
		const line = JSON.stringify({
			level: 30,
			msg: 'API error',
			key: 'sk-ant-api03-abcdefghijklmnopqrst',
		});
		const redacted = redactLine(line);
		const parsed = JSON.parse(redacted);
		expect(parsed.key).toBe('[ANTHROPIC_KEY]');
		expect(parsed.msg).toBe('API error');
	});

	it('preserves JSON validity after redacting home path', () => {
		const line = JSON.stringify({
			level: 30,
			path: '/Users/shovonhasan/Documents/work',
		});
		const redacted = redactLine(line);
		expect(() => JSON.parse(redacted)).not.toThrow();
		expect(JSON.parse(redacted).path).toBe('[HOME_PATH]');
	});

	it('preserves JSON validity after redacting Bearer token', () => {
		const line = JSON.stringify({
			level: 30,
			header: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
		});
		const redacted = redactLine(line);
		expect(() => JSON.parse(redacted)).not.toThrow();
		expect(JSON.parse(redacted).header).toBe('Bearer [TOKEN]');
	});

	// ── C. Multiple secrets in one line ──────────────────────────────────

	it('redacts multiple secrets in one line', () => {
		const input = 'msg from 1234567890@s.whatsapp.net with key sk-ant-api03-abcdefghijklmnopqrst';
		const result = redactLine(input);
		expect(result).toBe('msg from [JID] with key [ANTHROPIC_KEY]');
	});

	// ── D. No false positives ───────────────────────────────────────────

	it('does not redact epoch timestamps', () => {
		expect(redactLine('timestamp 1706234567890')).toBe('timestamp 1706234567890');
	});

	it('does not redact short numbers', () => {
		expect(redactLine('count: 12345')).toBe('count: 12345');
	});

	it('does not redact non-user paths', () => {
		expect(redactLine('/usr/local/bin/node')).toBe('/usr/local/bin/node');
	});

	// ── E. Idempotency ──────────────────────────────────────────────────

	it('is idempotent for built-in patterns', () => {
		const input =
			'secret 1234567890@s.whatsapp.net and +12025551234 and sk-ant-api03-abcdefghijklmnopqrst';
		expect(redactLine(redactLine(input))).toBe(redactLine(input));
	});

	// ── F. Config override ──────────────────────────────────────────────

	it('skips redaction when disabled', () => {
		const line = 'secret 1234567890@s.whatsapp.net';
		expect(redactLine(line, { enabled: false })).toBe(line);
	});

	it('applies extra patterns', () => {
		const line = 'custom-secret-abc123';
		const result = redactLine(line, {
			enabled: true,
			extraPatterns: [
				{
					name: 'custom',
					regex: /custom-secret-\w+/g,
					replacement: '[CUSTOM]',
				},
			],
		});
		expect(result).toBe('[CUSTOM]');
	});

	// ── G. Anthropic key ordering (sk-ant must match before generic sk-) ─

	it('matches Anthropic key before generic OpenAI pattern', () => {
		const input = 'sk-ant-api03-abcdefghijklmnopqrst';
		const result = redactLine(input);
		expect(result).toBe('[ANTHROPIC_KEY]');
	});
});
