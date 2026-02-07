/**
 * DatabaseService — Effect port of db.ts
 *
 * Wraps better-sqlite3 operations in Effect. All ops are synchronous.
 * Exports both the Effect service and legacy wrappers (drop-in replacement).
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { proto } from '@whiskeysockets/baileys';
import { Context, Effect, Layer } from 'effect';

import { STORE_DIR } from './config.js';
import { DatabaseInitError, DatabaseQueryError } from './errors.js';
import { logger } from './logger.js';
import { NewMessage, ScheduledTask, TaskRunLog } from './types.js';

// --- Types re-exported for consumers ---

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

// --- Effect service interface ---

export interface DatabaseServiceShape {
  readonly initDatabase: Effect.Effect<void, DatabaseInitError>;
  readonly storeChatMetadata: (
    chatJid: string,
    timestamp: string,
    name?: string,
  ) => Effect.Effect<void, DatabaseQueryError>;
  readonly updateChatName: (
    chatJid: string,
    name: string,
  ) => Effect.Effect<void, DatabaseQueryError>;
  readonly getAllChats: Effect.Effect<ChatInfo[], DatabaseQueryError>;
  readonly getLastGroupSync: Effect.Effect<string | null, DatabaseQueryError>;
  readonly setLastGroupSync: Effect.Effect<void, DatabaseQueryError>;
  readonly storeMessage: (
    msg: proto.IWebMessageInfo,
    chatJid: string,
    isFromMe: boolean,
    pushName?: string,
  ) => Effect.Effect<void, DatabaseQueryError>;
  readonly getNewMessages: (
    jids: string[],
    lastTimestamp: string,
    botPrefix: string,
  ) => Effect.Effect<
    { messages: NewMessage[]; newTimestamp: string },
    DatabaseQueryError
  >;
  readonly getMessagesSince: (
    chatJid: string,
    sinceTimestamp: string,
    botPrefix: string,
  ) => Effect.Effect<NewMessage[], DatabaseQueryError>;
  readonly createTask: (
    task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
  ) => Effect.Effect<void, DatabaseQueryError>;
  readonly getTaskById: (
    id: string,
  ) => Effect.Effect<ScheduledTask | undefined, DatabaseQueryError>;
  readonly getTasksForGroup: (
    groupFolder: string,
  ) => Effect.Effect<ScheduledTask[], DatabaseQueryError>;
  readonly getAllTasks: Effect.Effect<ScheduledTask[], DatabaseQueryError>;
  readonly updateTask: (
    id: string,
    updates: Partial<
      Pick<
        ScheduledTask,
        'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
      >
    >,
  ) => Effect.Effect<void, DatabaseQueryError>;
  readonly deleteTask: (
    id: string,
  ) => Effect.Effect<void, DatabaseQueryError>;
  readonly getDueTasks: Effect.Effect<ScheduledTask[], DatabaseQueryError>;
  readonly updateTaskAfterRun: (
    id: string,
    nextRun: string | null,
    lastResult: string,
  ) => Effect.Effect<void, DatabaseQueryError>;
  readonly logTaskRun: (
    log: TaskRunLog,
  ) => Effect.Effect<void, DatabaseQueryError>;
  readonly getTaskRunLogs: (
    taskId: string,
    limit?: number,
  ) => Effect.Effect<TaskRunLog[], DatabaseQueryError>;
}

export class DatabaseService extends Context.Tag('DatabaseService')<
  DatabaseService,
  DatabaseServiceShape
>() {}

// --- Service implementation ---

const makeDatabaseService = Effect.gen(function* () {
  let db: Database.Database;

  const initDatabaseFn: DatabaseServiceShape['initDatabase'] = Effect.gen(
    function* () {
      yield* Effect.try({
        try: () => {
          const dbPath = path.join(STORE_DIR, 'messages.db');
          fs.mkdirSync(path.dirname(dbPath), { recursive: true });

          db = new Database(dbPath);
          db.exec(`
            CREATE TABLE IF NOT EXISTS chats (
              jid TEXT PRIMARY KEY,
              name TEXT,
              last_message_time TEXT
            );
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT,
              chat_jid TEXT,
              sender TEXT,
              sender_name TEXT,
              content TEXT,
              timestamp TEXT,
              is_from_me INTEGER,
              PRIMARY KEY (id, chat_jid),
              FOREIGN KEY (chat_jid) REFERENCES chats(jid)
            );
            CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

            CREATE TABLE IF NOT EXISTS scheduled_tasks (
              id TEXT PRIMARY KEY,
              group_folder TEXT NOT NULL,
              chat_jid TEXT NOT NULL,
              prompt TEXT NOT NULL,
              schedule_type TEXT NOT NULL,
              schedule_value TEXT NOT NULL,
              next_run TEXT,
              last_run TEXT,
              last_result TEXT,
              status TEXT DEFAULT 'active',
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
            CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

            CREATE TABLE IF NOT EXISTS task_run_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              task_id TEXT NOT NULL,
              run_at TEXT NOT NULL,
              duration_ms INTEGER NOT NULL,
              status TEXT NOT NULL,
              result TEXT,
              error TEXT,
              FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
            );
            CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);
          `);

          // Migrations for existing DBs
          try {
            db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT`);
          } catch {
            /* column already exists */
          }
          try {
            db.exec(
              `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
            );
          } catch {
            /* column already exists */
          }
        },
        catch: (err) =>
          new DatabaseInitError({
            message: err instanceof Error ? err.message : String(err),
            cause: err,
          }),
      });
    },
  ).pipe(Effect.withLogSpan('db.initDatabase'));

  const storeChatMetadataFn: DatabaseServiceShape['storeChatMetadata'] = (
    chatJid,
    timestamp,
    name?,
  ) =>
    Effect.try({
      try: () => {
        if (name) {
          db.prepare(
            `
            INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
            ON CONFLICT(jid) DO UPDATE SET
              name = excluded.name,
              last_message_time = MAX(last_message_time, excluded.last_message_time)
          `,
          ).run(chatJid, name, timestamp);
        } else {
          db.prepare(
            `
            INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
            ON CONFLICT(jid) DO UPDATE SET
              last_message_time = MAX(last_message_time, excluded.last_message_time)
          `,
          ).run(chatJid, chatJid, timestamp);
        }
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'storeChatMetadata',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(
      Effect.annotateLogs({ chatJid }),
      Effect.withLogSpan('db.storeChatMetadata'),
    );

  const updateChatNameFn: DatabaseServiceShape['updateChatName'] = (
    chatJid,
    name,
  ) =>
    Effect.try({
      try: () => {
        db.prepare(
          `
          INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
          ON CONFLICT(jid) DO UPDATE SET name = excluded.name
        `,
        ).run(chatJid, name, new Date().toISOString());
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'updateChatName',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(
      Effect.annotateLogs({ chatJid }),
      Effect.withLogSpan('db.updateChatName'),
    );

  const getAllChatsFn: DatabaseServiceShape['getAllChats'] = Effect.try({
    try: () =>
      db
        .prepare(
          `
          SELECT jid, name, last_message_time
          FROM chats
          ORDER BY last_message_time DESC
        `,
        )
        .all() as ChatInfo[],
    catch: (err) =>
      new DatabaseQueryError({
        operation: 'getAllChats',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      }),
  }).pipe(Effect.withLogSpan('db.getAllChats'));

  const getLastGroupSyncFn: DatabaseServiceShape['getLastGroupSync'] =
    Effect.try({
      try: () => {
        const row = db
          .prepare(
            `SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`,
          )
          .get() as { last_message_time: string } | undefined;
        return row?.last_message_time || null;
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'getLastGroupSync',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(Effect.withLogSpan('db.getLastGroupSync'));

  const setLastGroupSyncFn: DatabaseServiceShape['setLastGroupSync'] =
    Effect.try({
      try: () => {
        const now = new Date().toISOString();
        db.prepare(
          `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
        ).run(now);
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'setLastGroupSync',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(Effect.withLogSpan('db.setLastGroupSync'));

  const storeMessageFn: DatabaseServiceShape['storeMessage'] = (
    msg,
    chatJid,
    isFromMe,
    pushName?,
  ) =>
    Effect.try({
      try: () => {
        if (!msg.key) return;

        const content =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.message?.imageMessage?.caption ||
          msg.message?.videoMessage?.caption ||
          '';

        const timestamp = new Date(
          Number(msg.messageTimestamp) * 1000,
        ).toISOString();
        const sender = msg.key.participant || msg.key.remoteJid || '';
        const senderName = pushName || sender.split('@')[0];
        const msgId = msg.key.id || '';

        db.prepare(
          `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(msgId, chatJid, sender, senderName, content, timestamp, isFromMe ? 1 : 0);
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'storeMessage',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(
      Effect.annotateLogs({ chatJid }),
      Effect.withLogSpan('db.storeMessage'),
    );

  const getNewMessagesFn: DatabaseServiceShape['getNewMessages'] = (
    jids,
    lastTimestamp,
    botPrefix,
  ) =>
    Effect.try({
      try: () => {
        if (jids.length === 0)
          return { messages: [], newTimestamp: lastTimestamp };

        const placeholders = jids.map(() => '?').join(',');
        const sql = `
          SELECT id, chat_jid, sender, sender_name, content, timestamp
          FROM messages
          WHERE timestamp > ? AND chat_jid IN (${placeholders}) AND content NOT LIKE ?
          ORDER BY timestamp
        `;

        const rows = db
          .prepare(sql)
          .all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

        let newTimestamp = lastTimestamp;
        for (const row of rows) {
          if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
        }

        return { messages: rows, newTimestamp };
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'getNewMessages',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(Effect.withLogSpan('db.getNewMessages'));

  const getMessagesSinceFn: DatabaseServiceShape['getMessagesSince'] = (
    chatJid,
    sinceTimestamp,
    botPrefix,
  ) =>
    Effect.try({
      try: () => {
        const sql = `
          SELECT id, chat_jid, sender, sender_name, content, timestamp
          FROM messages
          WHERE chat_jid = ? AND timestamp > ? AND content NOT LIKE ?
          ORDER BY timestamp
        `;
        return db
          .prepare(sql)
          .all(chatJid, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'getMessagesSince',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(
      Effect.annotateLogs({ chatJid }),
      Effect.withLogSpan('db.getMessagesSince'),
    );

  const createTaskFn: DatabaseServiceShape['createTask'] = (task) =>
    Effect.try({
      try: () => {
        db.prepare(
          `
          INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          task.id,
          task.group_folder,
          task.chat_jid,
          task.prompt,
          task.schedule_type,
          task.schedule_value,
          task.context_mode || 'isolated',
          task.next_run,
          task.status,
          task.created_at,
        );
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'createTask',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(
      Effect.annotateLogs({ taskId: task.id }),
      Effect.withLogSpan('db.createTask'),
    );

  const getTaskByIdFn: DatabaseServiceShape['getTaskById'] = (id) =>
    Effect.try({
      try: () =>
        db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
          | ScheduledTask
          | undefined,
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'getTaskById',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(Effect.withLogSpan('db.getTaskById'));

  const getTasksForGroupFn: DatabaseServiceShape['getTasksForGroup'] = (
    groupFolder,
  ) =>
    Effect.try({
      try: () =>
        db
          .prepare(
            'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
          )
          .all(groupFolder) as ScheduledTask[],
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'getTasksForGroup',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(Effect.withLogSpan('db.getTasksForGroup'));

  const getAllTasksFn: DatabaseServiceShape['getAllTasks'] = Effect.try({
    try: () =>
      db
        .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
        .all() as ScheduledTask[],
    catch: (err) =>
      new DatabaseQueryError({
        operation: 'getAllTasks',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      }),
  }).pipe(Effect.withLogSpan('db.getAllTasks'));

  const updateTaskFn: DatabaseServiceShape['updateTask'] = (id, updates) =>
    Effect.try({
      try: () => {
        const fields: string[] = [];
        const values: unknown[] = [];

        if (updates.prompt !== undefined) {
          fields.push('prompt = ?');
          values.push(updates.prompt);
        }
        if (updates.schedule_type !== undefined) {
          fields.push('schedule_type = ?');
          values.push(updates.schedule_type);
        }
        if (updates.schedule_value !== undefined) {
          fields.push('schedule_value = ?');
          values.push(updates.schedule_value);
        }
        if (updates.next_run !== undefined) {
          fields.push('next_run = ?');
          values.push(updates.next_run);
        }
        if (updates.status !== undefined) {
          fields.push('status = ?');
          values.push(updates.status);
        }

        if (fields.length === 0) return;

        values.push(id);
        db.prepare(
          `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
        ).run(...values);
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'updateTask',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(
      Effect.annotateLogs({ taskId: id }),
      Effect.withLogSpan('db.updateTask'),
    );

  const deleteTaskFn: DatabaseServiceShape['deleteTask'] = (id) =>
    Effect.try({
      try: () => {
        db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
        db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'deleteTask',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(
      Effect.annotateLogs({ taskId: id }),
      Effect.withLogSpan('db.deleteTask'),
    );

  const getDueTasksFn: DatabaseServiceShape['getDueTasks'] = Effect.try({
    try: () => {
      const now = new Date().toISOString();
      return db
        .prepare(
          `
          SELECT * FROM scheduled_tasks
          WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
          ORDER BY next_run
        `,
        )
        .all(now) as ScheduledTask[];
    },
    catch: (err) =>
      new DatabaseQueryError({
        operation: 'getDueTasks',
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      }),
  }).pipe(Effect.withLogSpan('db.getDueTasks'));

  const updateTaskAfterRunFn: DatabaseServiceShape['updateTaskAfterRun'] = (
    id,
    nextRun,
    lastResult,
  ) =>
    Effect.try({
      try: () => {
        const now = new Date().toISOString();
        db.prepare(
          `
          UPDATE scheduled_tasks
          SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
          WHERE id = ?
        `,
        ).run(nextRun, now, lastResult, nextRun, id);
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'updateTaskAfterRun',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(
      Effect.annotateLogs({ taskId: id }),
      Effect.withLogSpan('db.updateTaskAfterRun'),
    );

  const logTaskRunFn: DatabaseServiceShape['logTaskRun'] = (log) =>
    Effect.try({
      try: () => {
        db.prepare(
          `
          INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        ).run(
          log.task_id,
          log.run_at,
          log.duration_ms,
          log.status,
          log.result,
          log.error,
        );
      },
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'logTaskRun',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(
      Effect.annotateLogs({ taskId: log.task_id }),
      Effect.withLogSpan('db.logTaskRun'),
    );

  const getTaskRunLogsFn: DatabaseServiceShape['getTaskRunLogs'] = (
    taskId,
    limit = 10,
  ) =>
    Effect.try({
      try: () =>
        db
          .prepare(
            `
          SELECT task_id, run_at, duration_ms, status, result, error
          FROM task_run_logs
          WHERE task_id = ?
          ORDER BY run_at DESC
          LIMIT ?
        `,
          )
          .all(taskId, limit) as TaskRunLog[],
      catch: (err) =>
        new DatabaseQueryError({
          operation: 'getTaskRunLogs',
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    }).pipe(Effect.withLogSpan('db.getTaskRunLogs'));

  return {
    initDatabase: initDatabaseFn,
    storeChatMetadata: storeChatMetadataFn,
    updateChatName: updateChatNameFn,
    getAllChats: getAllChatsFn,
    getLastGroupSync: getLastGroupSyncFn,
    setLastGroupSync: setLastGroupSyncFn,
    storeMessage: storeMessageFn,
    getNewMessages: getNewMessagesFn,
    getMessagesSince: getMessagesSinceFn,
    createTask: createTaskFn,
    getTaskById: getTaskByIdFn,
    getTasksForGroup: getTasksForGroupFn,
    getAllTasks: getAllTasksFn,
    updateTask: updateTaskFn,
    deleteTask: deleteTaskFn,
    getDueTasks: getDueTasksFn,
    updateTaskAfterRun: updateTaskAfterRunFn,
    logTaskRun: logTaskRunFn,
    getTaskRunLogs: getTaskRunLogsFn,
  } satisfies DatabaseServiceShape;
});

export const DatabaseServiceLive = Layer.effect(
  DatabaseService,
  makeDatabaseService,
);

// --- Legacy wrappers (drop-in replacement for original db.ts exports) ---

/** Stateless service instance created once at module load */
const legacyService = Effect.runSync(makeDatabaseService);

export function initDatabase(): void {
  Effect.runSync(
    legacyService.initDatabase.pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'Database initialization failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
): void {
  Effect.runSync(
    legacyService.storeChatMetadata(chatJid, timestamp, name).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'storeChatMetadata failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function updateChatName(chatJid: string, name: string): void {
  Effect.runSync(
    legacyService.updateChatName(chatJid, name).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'updateChatName failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function getAllChats(): ChatInfo[] {
  return Effect.runSync(
    legacyService.getAllChats.pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'getAllChats failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function getLastGroupSync(): string | null {
  return Effect.runSync(
    legacyService.getLastGroupSync.pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'getLastGroupSync failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function setLastGroupSync(): void {
  Effect.runSync(
    legacyService.setLastGroupSync.pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'setLastGroupSync failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function storeMessage(
  msg: proto.IWebMessageInfo,
  chatJid: string,
  isFromMe: boolean,
  pushName?: string,
): void {
  Effect.runSync(
    legacyService.storeMessage(msg, chatJid, isFromMe, pushName).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'storeMessage failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  return Effect.runSync(
    legacyService.getNewMessages(jids, lastTimestamp, botPrefix).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'getNewMessages failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  return Effect.runSync(
    legacyService.getMessagesSince(chatJid, sinceTimestamp, botPrefix).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'getMessagesSince failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  Effect.runSync(
    legacyService.createTask(task).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'createTask failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return Effect.runSync(
    legacyService.getTaskById(id).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'getTaskById failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return Effect.runSync(
    legacyService.getTasksForGroup(groupFolder).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'getTasksForGroup failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function getAllTasks(): ScheduledTask[] {
  return Effect.runSync(
    legacyService.getAllTasks.pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'getAllTasks failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  Effect.runSync(
    legacyService.updateTask(id, updates).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'updateTask failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function deleteTask(id: string): void {
  Effect.runSync(
    legacyService.deleteTask(id).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'deleteTask failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function getDueTasks(): ScheduledTask[] {
  return Effect.runSync(
    legacyService.getDueTasks.pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'getDueTasks failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  Effect.runSync(
    legacyService.updateTaskAfterRun(id, nextRun, lastResult).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'updateTaskAfterRun failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function logTaskRun(log: TaskRunLog): void {
  Effect.runSync(
    legacyService.logTaskRun(log).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'logTaskRun failed');
        return Effect.die(err);
      }),
    ),
  );
}

export function getTaskRunLogs(taskId: string, limit = 10): TaskRunLog[] {
  return Effect.runSync(
    legacyService.getTaskRunLogs(taskId, limit).pipe(
      Effect.catchAll((err) => {
        logger.error({ err }, 'getTaskRunLogs failed');
        return Effect.die(err);
      }),
    ),
  );
}
