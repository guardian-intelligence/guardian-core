/**
 * Dual deploy logger — ANSI console + JSONL file.
 *
 * Provides styled info/ok/warn/fail helpers that feed into Effect's Logger
 * pipeline. The DeployLoggerLive layer writes both to the console (same UX as
 * before) and to a JSONL file for Rumi to read when debugging deploy failures.
 */
import fs from 'node:fs';
import path from 'node:path';

import { Cause, Effect, HashMap, type Layer, List, Logger, LogLevel } from 'effect';

import { redactLine } from './redact.js';

// ---------------------------------------------------------------------------
// ANSI constants
// ---------------------------------------------------------------------------

const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const NC = '\x1b[0m';

// ---------------------------------------------------------------------------
// Log helpers — Effect.log with 'icon' annotation
// ---------------------------------------------------------------------------

export const info = (msg: string) => Effect.log(msg).pipe(Effect.annotateLogs('icon', 'info'));

export const ok = (msg: string) => Effect.log(msg).pipe(Effect.annotateLogs('icon', 'ok'));

export const warn = (msg: string) =>
	Effect.logWarning(msg).pipe(Effect.annotateLogs('icon', 'warn'));

export const fail = (msg: string) => Effect.logError(msg).pipe(Effect.annotateLogs('icon', 'fail'));

// ---------------------------------------------------------------------------
// ANSI console logger
// ---------------------------------------------------------------------------

const iconPrefixes: Record<string, string> = {
	info: `${BLUE}→${NC}`,
	ok: `${GREEN}✓${NC}`,
	warn: `${YELLOW}!${NC}`,
	fail: `${RED}✗${NC}`,
};

const AnsiConsoleLogger = Logger.make(({ message, annotations }) => {
	const msg = String(message);

	let iconValue: string | undefined;
	const opt = HashMap.get(annotations, 'icon');
	if (opt._tag === 'Some') iconValue = opt.value as string;

	if (iconValue && iconPrefixes[iconValue]) {
		// biome-ignore lint/suspicious/noConsole: Deploy logger IS the console output layer
		globalThis.console.log(`${iconPrefixes[iconValue]} ${redactLine(msg)}`);
	} else {
		// biome-ignore lint/suspicious/noConsole: Deploy logger IS the console output layer
		globalThis.console.log(redactLine(msg));
	}
});

// ---------------------------------------------------------------------------
// JSONL file logger
// ---------------------------------------------------------------------------

function spansToRecord(
	spans: List.List<{ readonly label: string; readonly startTime: number }>,
): Record<string, number> {
	const result: Record<string, number> = {};
	const now = Date.now();
	List.forEach(spans, (span) => {
		result[span.label] = now - span.startTime;
	});
	return result;
}

function annotationsToRecord(
	annotations: HashMap.HashMap<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	HashMap.forEach(annotations, (value, key) => {
		result[key] = value;
	});
	return result;
}

function levelLabel(level: LogLevel.LogLevel): string {
	if (level === LogLevel.Info) return 'INFO';
	if (level === LogLevel.Warning) return 'WARN';
	if (level === LogLevel.Error) return 'ERROR';
	if (level === LogLevel.Debug) return 'DEBUG';
	if (level === LogLevel.Fatal) return 'FATAL';
	return level._tag;
}

function makeFileLogger(fd: number) {
	return Logger.make(({ logLevel, message, cause, annotations, spans, date }) => {
		const entry: Record<string, unknown> = {
			timestamp: date.toISOString(),
			level: levelLabel(logLevel),
			message: String(message),
		};

		const ann = annotationsToRecord(annotations);
		if (Object.keys(ann).length > 0) entry.annotations = ann;

		const sp = spansToRecord(spans);
		if (Object.keys(sp).length > 0) entry.spans = sp;

		if (cause._tag !== 'Empty') {
			entry.cause = Cause.pretty(cause);
		}

		try {
			fs.writeSync(fd, redactLine(`${JSON.stringify(entry)}\n`));
		} catch {
			// Silently ignore disk errors to avoid crashing the deploy
		}
	});
}

// ---------------------------------------------------------------------------
// Log rotation
// ---------------------------------------------------------------------------

function pruneOldLogs(dir: string, keep: number): void {
	try {
		const files = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith('.jsonl') && !f.includes('-latest'))
			.sort();
		const toRemove = files.slice(0, Math.max(0, files.length - keep));
		for (const f of toRemove) {
			fs.unlinkSync(path.join(dir, f));
		}
	} catch {
		// Best-effort cleanup
	}
}

// ---------------------------------------------------------------------------
// DeployLoggerLive layer
// ---------------------------------------------------------------------------

export function DeployLoggerLive(target: string): Layer.Layer<never> {
	const makeDualLogger = Effect.acquireRelease(
		Effect.sync(() => {
			const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
			const logDir = path.join(root, 'logs', 'deploy');
			fs.mkdirSync(logDir, { recursive: true });

			pruneOldLogs(logDir, 20);

			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const filename = `${target}-${timestamp}.jsonl`;
			const filepath = path.join(logDir, filename);
			const fd = fs.openSync(filepath, 'w');

			const latestLink = path.join(logDir, `${target}-latest.jsonl`);
			try {
				fs.unlinkSync(latestLink);
			} catch {
				// Doesn't exist yet
			}
			fs.symlinkSync(filename, latestLink);

			const fileLogger = makeFileLogger(fd);
			const dualLogger = Logger.zip(AnsiConsoleLogger, fileLogger);

			return { dualLogger, fd };
		}),
		({ fd }) =>
			Effect.sync(() => {
				try {
					fs.closeSync(fd);
				} catch {
					// Already closed
				}
			}),
	).pipe(Effect.map(({ dualLogger }) => dualLogger));

	return Logger.replaceScoped(Logger.defaultLogger, makeDualLogger);
}
