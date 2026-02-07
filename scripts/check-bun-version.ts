#!/usr/bin/env bun

const expected = process.env.BUN_VERSION_PIN ?? '1.3.8';
const actual = Bun.version;

if (actual !== expected) {
	console.error(`bun version mismatch: expected ${expected}, got ${actual}`);
	process.exit(1);
}

process.stdout.write(`bun ${actual}\n`);
