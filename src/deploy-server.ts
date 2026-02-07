/**
 * server deploy service — Effect TypeScript.
 *
 * Deploys server to rumi-vps via rsync + SSH.
 * Entry point: scripts/deploy-server.ts
 */
import path from 'node:path';

import { Context, Effect, Layer } from 'effect';

import { fail, info, ok, warn } from './DeployLogger.js';
import { ShellService } from './deploy.js';
import { DeployError } from './errors.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REMOTE = 'rumi-server';
const REMOTE_DIR = '/opt/guardian-core/server';

function projectRoot(): string {
	return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
}

// ---------------------------------------------------------------------------
// ServerDeployService
// ---------------------------------------------------------------------------

export interface ServerDeployServiceShape {
	readonly deploy: (dryRun: boolean) => Effect.Effect<void, DeployError>;
}

export class ServerDeployService extends Context.Tag('ServerDeployService')<
	ServerDeployService,
	ServerDeployServiceShape
>() {}

export const ServerDeployServiceLive = Layer.effect(
	ServerDeployService,
	Effect.gen(function* () {
		const shell = yield* ShellService;
		const rumiDir = path.join(projectRoot(), 'server');

		const rsyncArgs = (extra: readonly string[]): readonly string[] => [
			'-avz',
			'--delete',
			'--exclude',
			'node_modules',
			'--exclude',
			'.env',
			'--exclude',
			'.git',
			...extra,
			`${rumiDir}/`,
			`${REMOTE}:${REMOTE_DIR}/`,
		];

		const deploy: ServerDeployServiceShape['deploy'] = (dryRun) =>
			Effect.gen(function* () {
				yield* Effect.log(`=== Deploying server to ${REMOTE} ===`);

				// 1. Typecheck
				yield* Effect.gen(function* () {
					yield* info('Typechecking server...');
					yield* shell.run('bun', ['--cwd', rumiDir, 'run', 'typecheck']).pipe(
						Effect.catchAll((e) =>
							Effect.gen(function* () {
								yield* fail('Typecheck failed — fix errors before deploying');
								return yield* new DeployError({
									stage: 'server:typecheck',
									message: e.message,
								});
							}),
						),
					);
					yield* ok('Typecheck passed');
				}).pipe(Effect.withLogSpan('server-deploy.typecheck'));

				// 2. Dry run — show plan + rsync preview
				if (dryRun) {
					yield* Effect.log('');
					yield* Effect.log('Deploy plan:');
					yield* Effect.log(`  • rsync server/ → ${REMOTE}:${REMOTE_DIR}/`);
					yield* Effect.log('  • bun install on remote');
					yield* Effect.log('  • sudo systemctl restart server');
					yield* Effect.log('  • Verify health endpoint');
					yield* Effect.log('');

					yield* info('Files that would sync:');
					const preview = yield* shell
						.run('rsync', rsyncArgs(['--dry-run']))
						.pipe(
							Effect.catchAll(() =>
								Effect.succeed('(could not preview — SSH to rumi-server unavailable)'),
							),
						);
					yield* Effect.log(preview);
					yield* Effect.log('');
					yield* warn('Dry run — nothing will be changed');
					return;
				}

				// 3. rsync
				yield* Effect.gen(function* () {
					yield* info('Syncing files...');
					yield* shell.run('rsync', rsyncArgs([]));
					yield* ok('Files synced');
				}).pipe(Effect.withLogSpan('server-deploy.rsync'));

				// 4. Install deps + restart
				yield* Effect.gen(function* () {
					yield* info('Installing deps + restarting service...');
					yield* shell.run('ssh', [
						REMOTE,
						`cd ${REMOTE_DIR} && bun install && sudo systemctl restart rumi-server`,
					]);
					yield* ok('Service restarted');
				}).pipe(Effect.withLogSpan('server-deploy.restart'));

				// 5. Verify
				yield* Effect.gen(function* () {
					yield* info('Verifying...');
					yield* shell.run('ssh', [
						REMOTE,
						'systemctl is-active rumi-server && curl -sf localhost:3000/health',
					]);
					yield* ok('Service running and healthy');
				}).pipe(Effect.withLogSpan('server-deploy.verify'));

				yield* Effect.log('');
				yield* ok('server deployed successfully');
			}).pipe(Effect.withLogSpan('server-deploy'), Effect.annotateLogs({ dryRun }));

		return { deploy } satisfies ServerDeployServiceShape;
	}),
);
