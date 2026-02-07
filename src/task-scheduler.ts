/**
 * TaskSchedulerService — Effect port of task-scheduler.ts
 *
 * Polls for due tasks and runs them in containers.
 * Uses Effect.repeat(Schedule.spaced) instead of setTimeout loop.
 * Exports both the Effect service and legacy wrapper (drop-in replacement).
 */
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';
import path from 'path';

import { Context, Effect, Fiber, Layer, Ref, Schedule } from 'effect';

import {
  DATA_DIR,
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  SCHEDULER_POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import { runContainerAgent, writeTasksSnapshot } from './container-runner.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  logTaskRun,
  updateTaskAfterRun,
} from './db.js';
import { TaskSchedulerError } from './errors.js';
import { logger } from './logger.js';
import { RegisteredGroup, ScheduledTask } from './types.js';

export interface SchedulerDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
}

// --- Internal: run a single task ---

function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Effect.Effect<void, TaskSchedulerError> {
  return Effect.gen(function* () {
    const startTime = Date.now();
    const groupDir = path.join(GROUPS_DIR, task.group_folder);
    fs.mkdirSync(groupDir, { recursive: true });

    logger.info(
      { taskId: task.id, group: task.group_folder },
      'Running scheduled task',
    );

    const groups = deps.registeredGroups();
    const group = Object.values(groups).find(
      (g) => g.folder === task.group_folder,
    );

    if (!group) {
      logger.error(
        { taskId: task.id, groupFolder: task.group_folder },
        'Group not found for task',
      );
      logTaskRun({
        task_id: task.id,
        run_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
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

    let result: string | null = null;
    let error: string | null = null;

    const sessions = deps.getSessions();
    const sessionId =
      task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

    try {
      const output = yield* Effect.tryPromise({
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
      });

      if (output.status === 'error') {
        error = output.error || 'Unknown error';
      } else {
        result = output.result;
      }

      logger.info(
        { taskId: task.id, durationMs: Date.now() - startTime },
        'Task completed',
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.error({ taskId: task.id, error }, 'Task failed');
    }

    const durationMs = Date.now() - startTime;

    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: durationMs,
      status: error ? 'error' : 'success',
      result,
      error,
    });

    let nextRun: string | null = null;
    if (task.schedule_type === 'cron') {
      const interval = CronExpressionParser.parse(task.schedule_value, {
        tz: TIMEZONE,
      });
      nextRun = interval.next().toISOString();
    } else if (task.schedule_type === 'interval') {
      const ms = parseInt(task.schedule_value, 10);
      nextRun = new Date(Date.now() + ms).toISOString();
    }
    // 'once' tasks have no next run

    const resultSummary = error
      ? `Error: ${error}`
      : result
        ? result.slice(0, 200)
        : 'Completed';
    updateTaskAfterRun(task.id, nextRun, resultSummary);
  }).pipe(
    Effect.annotateLogs({ taskId: task.id, group: task.group_folder }),
    Effect.withLogSpan('scheduler.runTask'),
  );
}

// --- Effect service interface ---

export interface TaskSchedulerServiceShape {
  readonly startSchedulerLoop: (
    deps: SchedulerDependencies,
  ) => Effect.Effect<void>;
}

export class TaskSchedulerService extends Context.Tag('TaskSchedulerService')<
  TaskSchedulerService,
  TaskSchedulerServiceShape
>() {}

// --- Service implementation ---

const makeTaskSchedulerService = Effect.gen(function* () {
  const fiberRef = yield* Ref.make<Fiber.Fiber<void> | null>(null);

  const startSchedulerLoopFn: TaskSchedulerServiceShape['startSchedulerLoop'] =
    (deps) =>
      Effect.gen(function* () {
        const existingFiber = yield* Ref.get(fiberRef);
        if (existingFiber !== null) {
          logger.debug(
            'Scheduler loop already running, skipping duplicate start',
          );
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
            yield* runTask(currentTask, deps).pipe(
              Effect.catchAll((err) => {
                logger.error(
                  { taskId: task.id, err },
                  'Error running scheduled task',
                );
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

// --- Legacy wrapper (drop-in replacement for original task-scheduler.ts export) ---

let schedulerRunning = false;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;

  const service = Effect.runSync(makeTaskSchedulerService);
  Effect.runFork(service.startSchedulerLoop(deps));
}
