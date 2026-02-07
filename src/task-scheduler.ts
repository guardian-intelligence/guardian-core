/**
 * TaskSchedulerService
 *
 * Polls for due tasks and runs them in containers.
 * Uses Effect.repeat(Schedule.spaced) replacing setTimeout loop.
 * Exports both the Effect service and legacy wrapper.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { Clock, Context, Effect, Either, type Fiber, Layer, Match, Ref, Schedule } from 'effect';

import { GROUPS_DIR, MAIN_GROUP_FOLDER, SCHEDULER_POLL_INTERVAL, TIMEZONE } from './AppConfig.js';
import { logger } from './AppLogger.js';
import { runContainerAgent, writeTasksSnapshot } from './container-runner.js';
import { getAllTasks, getDueTasks, getTaskById, logTaskRun, updateTaskAfterRun } from './db.js';
import { TaskSchedulerError } from './errors.js';
import type { RegisteredGroup, ScheduledTask } from './schemas.js';

export interface SchedulerDependencies {
	sendMessage: (jid: string, text: string) => Promise<void>;
	registeredGroups: () => Record<string, RegisteredGroup>;
	getSessions: () => Record<string, string>;
}

// --- Internal: run a single task ---

function runTask(
	task: ScheduledTask,
	deps: SchedulerDependencies,
	getNowIso: () => string,
	getNowMs: () => number,
): Effect.Effect<void, TaskSchedulerError> {
	return Effect.gen(function* () {
		const startTime = getNowMs();
		const groupDir = path.join(GROUPS_DIR, task.group_folder);
		fs.mkdirSync(groupDir, { recursive: true });

		logger.info({ taskId: task.id, group: task.group_folder }, 'Running scheduled task');

		const groups = deps.registeredGroups();
		const group = Object.values(groups).find((g) => g.folder === task.group_folder);

		if (!group) {
			logger.error({ taskId: task.id, groupFolder: task.group_folder }, 'Group not found for task');
			logTaskRun({
				task_id: task.id,
				run_at: getNowIso(),
				duration_ms: getNowMs() - startTime,
				status: 'error',
				result: null,
				error: `Group not found: ${task.group_folder}`,
			});
			return;
		}

		// Update tasks snapshot for container to read
		const isMain = task.group_folder === MAIN_GROUP_FOLDER;
		const tasks = getAllTasks();
		writeTasksSnapshot(
			task.group_folder,
			isMain,
			tasks.map((t) => ({
				id: t.id,
				groupFolder: t.group_folder,
				prompt: t.prompt,
				schedule_type: t.schedule_type,
				schedule_value: t.schedule_value,
				status: t.status,
				next_run: t.next_run,
			})),
		);

		const sessions = deps.getSessions();
		const sessionId = task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

		const outcome = yield* Effect.either(
			Effect.tryPromise({
				try: () =>
					runContainerAgent(group, {
						prompt: task.prompt,
						sessionId,
						groupFolder: task.group_folder,
						chatJid: task.chat_jid,
						isMain,
						isScheduledTask: true,
					}),
				catch: (err) =>
					new TaskSchedulerError({
						taskId: task.id,
						message: err instanceof Error ? err.message : String(err),
						cause: err,
					}),
			}),
		);

		const [result, error] = Either.match(outcome, {
			onLeft: (err) => {
				logger.error({ taskId: task.id, error: err.message }, 'Task failed');
				return [null, err.message] as const;
			},
			onRight: (output) => {
				logger.info({ taskId: task.id, durationMs: getNowMs() - startTime }, 'Task completed');
				return output.status === 'error'
					? ([null, output.error ?? 'Unknown error'] as const)
					: ([output.result, null] as const);
			},
		});

		const durationMs = getNowMs() - startTime;

		logTaskRun({
			task_id: task.id,
			run_at: getNowIso(),
			duration_ms: durationMs,
			status: error ? 'error' : 'success',
			result,
			error,
		});

		const nextRun = Match.value(task.schedule_type).pipe(
			Match.when('cron', () => {
				const interval = CronExpressionParser.parse(task.schedule_value, {
					tz: TIMEZONE,
				});
				return interval.next().toISOString();
			}),
			Match.when('interval', () => {
				const ms = parseInt(task.schedule_value, 10);
				return new Date(getNowMs() + ms).toISOString();
			}),
			Match.when('once', () => null),
			Match.exhaustive,
		);

		const resultSummary = error ? `Error: ${error}` : result ? result.slice(0, 200) : 'Completed';
		updateTaskAfterRun(task.id, nextRun, resultSummary);
	}).pipe(
		Effect.annotateLogs({ taskId: task.id, group: task.group_folder }),
		Effect.withLogSpan('scheduler.runTask'),
	);
}

// --- Effect service interface ---

export interface TaskSchedulerServiceShape {
	readonly startSchedulerLoop: (deps: SchedulerDependencies) => Effect.Effect<void>;
}

export class TaskSchedulerService extends Context.Tag('TaskSchedulerService')<
	TaskSchedulerService,
	TaskSchedulerServiceShape
>() {}

// --- Service implementation ---

const makeTaskSchedulerService = Effect.gen(function* () {
	const clock = yield* Clock.Clock;
	const fiberRef = yield* Ref.make<Fiber.Fiber<void> | null>(null);

	const getNowIso = (): string => new Date(clock.unsafeCurrentTimeMillis()).toISOString();
	const getNowMs = (): number => clock.unsafeCurrentTimeMillis();

	const startSchedulerLoopFn: TaskSchedulerServiceShape['startSchedulerLoop'] = (deps) =>
		Effect.gen(function* () {
			const existingFiber = yield* Ref.get(fiberRef);
			if (existingFiber !== null) {
				logger.debug('Scheduler loop already running, skipping duplicate start');
				return;
			}

			logger.info('Scheduler loop started');

			const pollOnce = Effect.gen(function* () {
				const dueTasks = getDueTasks();
				if (dueTasks.length > 0) {
					logger.info({ count: dueTasks.length }, 'Found due tasks');
				}

				for (const task of dueTasks) {
					// Re-check task status in case it was paused/cancelled
					const currentTask = getTaskById(task.id);
					if (!currentTask || currentTask.status !== 'active') {
						continue;
					}

					// Run each task, catching errors per-task so one failure doesn't stop the loop
					yield* runTask(currentTask, deps, getNowIso, getNowMs).pipe(
						Effect.catchAll((err) => {
							logger.error({ taskId: task.id, err }, 'Error running scheduled task');
							return Effect.void;
						}),
					);
				}
			}).pipe(
				Effect.catchAll((err) => {
					logger.error({ err }, 'Error in scheduler loop');
					return Effect.void;
				}),
				Effect.withLogSpan('scheduler.poll'),
			);

			// Fork the repeating loop as a fiber
			const fiber = yield* Effect.fork(
				pollOnce.pipe(
					// Run once immediately, then repeat on schedule
					Effect.repeat(Schedule.spaced(SCHEDULER_POLL_INTERVAL)),
					Effect.asVoid,
				),
			);

			yield* Ref.set(fiberRef, fiber);
		});

	return {
		startSchedulerLoop: startSchedulerLoopFn,
	} satisfies TaskSchedulerServiceShape;
});

export const TaskSchedulerServiceLive = Layer.effect(
	TaskSchedulerService,
	makeTaskSchedulerService,
);

// --- Legacy wrapper ---

let schedulerRunning = false;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
	if (schedulerRunning) {
		logger.debug('Scheduler loop already running, skipping duplicate start');
		return;
	}
	schedulerRunning = true;

	const service = Effect.runSync(
		makeTaskSchedulerService.pipe(Effect.provide(Layer.succeed(Clock.Clock, Clock.make()))),
	);
	Effect.runFork(service.startSchedulerLoop(deps));
}
