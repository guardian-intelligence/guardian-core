/**
 * TestFileSystem
 *
 * In-memory FileSystem layer factory for tests.
 * Only implements methods used by services; others stub with Effect.die.
 */

import { SystemError } from '@effect/platform/Error';
import { FileSystem } from '@effect/platform/FileSystem';
import { Effect, Layer, Sink, Stream } from 'effect';

const notImplemented = (method: string) => Effect.die(`TestFileSystem: ${method} not implemented`);

const notImplementedSink = (method: string) =>
	Sink.die(`TestFileSystem: ${method} not implemented`);

const notImplementedStream = (method: string) =>
	Stream.die(`TestFileSystem: ${method} not implemented`);

/**
 * Create an in-memory FileSystem layer for testing.
 *
 * @param files - Record of path → content for files that "exist"
 * @returns Layer<FileSystem>
 *
 * @example
 * ```ts
 * const testFs = makeTestFileSystem({
 *   '/path/to/config.json': '{"key": "value"}',
 *   '/path/to/data.txt': 'hello',
 * });
 * const result = Effect.runSync(
 *   program.pipe(Effect.provide(testFs)),
 * );
 * ```
 */
export function makeTestFileSystem(files: Record<string, string> = {}): Layer.Layer<FileSystem> {
	// Mutable store for the in-memory filesystem
	const store = new Map<string, string>(Object.entries(files));
	const directories = new Set<string>();

	// Pre-populate directories from file paths
	for (const filePath of Object.keys(files)) {
		const parts = filePath.split('/');
		for (let i = 1; i < parts.length; i++) {
			directories.add(parts.slice(0, i).join('/'));
		}
	}

	const makeNotFoundError = (path: string, method: string) =>
		new SystemError({
			reason: 'NotFound',
			module: 'FileSystem',
			method,
			pathOrDescriptor: path,
			description: `ENOENT: no such file or directory, ${method} '${path}'`,
		});

	const fs: FileSystem = {
		access: (path) =>
			store.has(path) || directories.has(path)
				? Effect.void
				: Effect.fail(makeNotFoundError(path, 'access')),

		copy: () => notImplemented('copy') as any,
		copyFile: () => notImplemented('copyFile') as any,
		chmod: () => notImplemented('chmod') as any,
		chown: () => notImplemented('chown') as any,

		exists: (path) => Effect.succeed(store.has(path) || directories.has(path)),

		link: () => notImplemented('link') as any,

		makeDirectory: (path, options) =>
			Effect.sync(() => {
				if (options?.recursive) {
					const parts = path.split('/');
					for (let i = 1; i <= parts.length; i++) {
						directories.add(parts.slice(0, i).join('/'));
					}
				} else {
					directories.add(path);
				}
			}),

		makeTempDirectory: () => notImplemented('makeTempDirectory') as any,
		makeTempDirectoryScoped: () => notImplemented('makeTempDirectoryScoped') as any,
		makeTempFile: () => notImplemented('makeTempFile') as any,
		makeTempFileScoped: () => notImplemented('makeTempFileScoped') as any,
		open: () => notImplemented('open') as any,

		readDirectory: (path) =>
			Effect.sync(() => {
				const prefix = path.endsWith('/') ? path : path + '/';
				const entries = new Set<string>();
				for (const key of store.keys()) {
					if (key.startsWith(prefix)) {
						const rest = key.slice(prefix.length);
						const firstPart = rest.split('/')[0];
						if (firstPart) entries.add(firstPart);
					}
				}
				for (const dir of directories) {
					if (dir.startsWith(prefix)) {
						const rest = dir.slice(prefix.length);
						const firstPart = rest.split('/')[0];
						if (firstPart) entries.add(firstPart);
					}
				}
				return Array.from(entries);
			}),

		readFile: (path) =>
			store.has(path)
				? Effect.succeed(new TextEncoder().encode(store.get(path)!))
				: Effect.fail(makeNotFoundError(path, 'readFile')),

		readFileString: (path) =>
			store.has(path)
				? Effect.succeed(store.get(path)!)
				: Effect.fail(makeNotFoundError(path, 'readFileString')),

		readLink: () => notImplemented('readLink') as any,

		realPath: (path) =>
			store.has(path) || directories.has(path)
				? Effect.succeed(path)
				: Effect.fail(makeNotFoundError(path, 'realPath')),

		remove: (path) =>
			Effect.sync(() => {
				store.delete(path);
				directories.delete(path);
			}),

		rename: (oldPath, newPath) =>
			Effect.sync(() => {
				if (store.has(oldPath)) {
					store.set(newPath, store.get(oldPath)!);
					store.delete(oldPath);
				}
			}),

		sink: () => notImplementedSink('sink') as any,

		stat: () => notImplemented('stat') as any,
		stream: () => notImplementedStream('stream') as any,
		symlink: () => notImplemented('symlink') as any,
		truncate: () => notImplemented('truncate') as any,
		utimes: () => notImplemented('utimes') as any,
		watch: () => notImplementedStream('watch') as any,

		writeFile: (path, data) =>
			Effect.sync(() => {
				store.set(path, new TextDecoder().decode(data));
			}),

		writeFileString: (path, data) =>
			Effect.sync(() => {
				store.set(path, data);
			}),
	};

	return Layer.succeed(FileSystem, fs);
}
