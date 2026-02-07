import { Effect } from 'effect';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock better-sqlite3 before importing db module
const mockStatement = {
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
};

const mockDb = {
  exec: vi.fn(),
  prepare: vi.fn(() => mockStatement),
};

vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => mockDb),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
    },
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import {
  DatabaseService,
  DatabaseServiceLive,
  initDatabase,
  storeChatMetadata,
  updateChatName,
  getAllChats,
  getLastGroupSync,
  setLastGroupSync,
  getNewMessages,
  getMessagesSince,
  createTask,
  getTaskById,
  getTasksForGroup,
  getAllTasks,
  updateTask,
  deleteTask,
  getDueTasks,
  updateTaskAfterRun,
  logTaskRun,
  getTaskRunLogs,
} from '../db.js';

describe('DatabaseService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('legacy wrappers', () => {
    it('initDatabase should create tables without throwing', () => {
      expect(() => initDatabase()).not.toThrow();
      expect(mockDb.exec).toHaveBeenCalled();
    });

    it('storeChatMetadata should insert with name', () => {
      storeChatMetadata('group@g.us', '2026-01-01T00:00:00Z', 'Test Group');
      expect(mockStatement.run).toHaveBeenCalledWith(
        'group@g.us',
        'Test Group',
        '2026-01-01T00:00:00Z',
      );
    });

    it('storeChatMetadata should insert without name', () => {
      storeChatMetadata('group@g.us', '2026-01-01T00:00:00Z');
      expect(mockStatement.run).toHaveBeenCalledWith(
        'group@g.us',
        'group@g.us',
        '2026-01-01T00:00:00Z',
      );
    });

    it('updateChatName should update name', () => {
      updateChatName('group@g.us', 'New Name');
      expect(mockStatement.run).toHaveBeenCalledWith(
        'group@g.us',
        'New Name',
        expect.any(String),
      );
    });

    it('getAllChats should return array', () => {
      mockStatement.all.mockReturnValue([
        { jid: 'a@g.us', name: 'A', last_message_time: '2026-01-01' },
      ]);
      const chats = getAllChats();
      expect(chats).toHaveLength(1);
      expect(chats[0].jid).toBe('a@g.us');
    });

    it('getLastGroupSync should return null when no sync entry', () => {
      mockStatement.get.mockReturnValue(undefined);
      expect(getLastGroupSync()).toBeNull();
    });

    it('getLastGroupSync should return timestamp when sync exists', () => {
      mockStatement.get.mockReturnValue({
        last_message_time: '2026-01-01T00:00:00Z',
      });
      expect(getLastGroupSync()).toBe('2026-01-01T00:00:00Z');
    });

    it('setLastGroupSync should insert sync marker', () => {
      setLastGroupSync();
      expect(mockStatement.run).toHaveBeenCalledWith(expect.any(String));
    });

    it('getNewMessages should return empty for empty jids', () => {
      const result = getNewMessages([], '2026-01-01T00:00:00Z', 'Andy');
      expect(result.messages).toHaveLength(0);
      expect(result.newTimestamp).toBe('2026-01-01T00:00:00Z');
    });

    it('getNewMessages should query and track timestamp', () => {
      mockStatement.all.mockReturnValue([
        {
          id: 'msg1',
          chat_jid: 'g@g.us',
          sender: 's',
          sender_name: 'S',
          content: 'hello',
          timestamp: '2026-01-02T00:00:00Z',
        },
      ]);
      const result = getNewMessages(
        ['g@g.us'],
        '2026-01-01T00:00:00Z',
        'Andy',
      );
      expect(result.messages).toHaveLength(1);
      expect(result.newTimestamp).toBe('2026-01-02T00:00:00Z');
    });

    it('getMessagesSince should query messages', () => {
      mockStatement.all.mockReturnValue([]);
      const result = getMessagesSince('g@g.us', '2026-01-01', 'Andy');
      expect(result).toEqual([]);
    });

    it('createTask should insert task', () => {
      createTask({
        id: 'task-1',
        group_folder: 'main',
        chat_jid: 'g@g.us',
        prompt: 'Do something',
        schedule_type: 'once',
        schedule_value: '2026-02-01T00:00:00Z',
        context_mode: 'isolated',
        next_run: '2026-02-01T00:00:00Z',
        status: 'active',
        created_at: '2026-01-01T00:00:00Z',
      });
      expect(mockStatement.run).toHaveBeenCalledWith(
        'task-1',
        'main',
        'g@g.us',
        'Do something',
        'once',
        '2026-02-01T00:00:00Z',
        'isolated',
        '2026-02-01T00:00:00Z',
        'active',
        '2026-01-01T00:00:00Z',
      );
    });

    it('getTaskById should return task or undefined', () => {
      mockStatement.get.mockReturnValue({ id: 'task-1', status: 'active' });
      expect(getTaskById('task-1')).toEqual({
        id: 'task-1',
        status: 'active',
      });

      mockStatement.get.mockReturnValue(undefined);
      expect(getTaskById('nonexistent')).toBeUndefined();
    });

    it('getTasksForGroup should return tasks', () => {
      mockStatement.all.mockReturnValue([{ id: 'task-1' }]);
      expect(getTasksForGroup('main')).toHaveLength(1);
    });

    it('getAllTasks should return tasks', () => {
      mockStatement.all.mockReturnValue([]);
      expect(getAllTasks()).toEqual([]);
    });

    it('updateTask should build dynamic SET clause', () => {
      updateTask('task-1', { status: 'paused', prompt: 'new prompt' });
      expect(mockStatement.run).toHaveBeenCalledWith(
        'new prompt',
        'paused',
        'task-1',
      );
    });

    it('updateTask should no-op when no fields', () => {
      updateTask('task-1', {});
      // prepare is called but run is not (early return)
      expect(mockStatement.run).not.toHaveBeenCalled();
    });

    it('deleteTask should delete logs then task', () => {
      deleteTask('task-1');
      expect(mockDb.prepare).toHaveBeenCalledTimes(2);
      expect(mockStatement.run).toHaveBeenCalledTimes(2);
    });

    it('getDueTasks should query active tasks', () => {
      mockStatement.all.mockReturnValue([]);
      expect(getDueTasks()).toEqual([]);
    });

    it('updateTaskAfterRun should update task', () => {
      updateTaskAfterRun('task-1', null, 'Completed');
      expect(mockStatement.run).toHaveBeenCalledWith(
        null,
        expect.any(String),
        'Completed',
        null,
        'task-1',
      );
    });

    it('logTaskRun should insert log', () => {
      logTaskRun({
        task_id: 'task-1',
        run_at: '2026-01-01T00:00:00Z',
        duration_ms: 1000,
        status: 'success',
        result: 'OK',
        error: null,
      });
      expect(mockStatement.run).toHaveBeenCalledWith(
        'task-1',
        '2026-01-01T00:00:00Z',
        1000,
        'success',
        'OK',
        null,
      );
    });

    it('getTaskRunLogs should return logs with default limit', () => {
      mockStatement.all.mockReturnValue([]);
      expect(getTaskRunLogs('task-1')).toEqual([]);
      expect(mockStatement.all).toHaveBeenCalledWith('task-1', 10);
    });

    it('getTaskRunLogs should use custom limit', () => {
      mockStatement.all.mockReturnValue([]);
      getTaskRunLogs('task-1', 5);
      expect(mockStatement.all).toHaveBeenCalledWith('task-1', 5);
    });
  });

  describe('Effect service', () => {
    it('should provide service via layer', () => {
      const program = Effect.gen(function* () {
        const service = yield* DatabaseService;
        yield* service.initDatabase;
        return yield* service.getAllChats;
      });

      mockStatement.all.mockReturnValue([]);
      const result = Effect.runSync(
        program.pipe(Effect.provide(DatabaseServiceLive)),
      );
      expect(result).toEqual([]);
    });

    it('should propagate DatabaseQueryError on failure', () => {
      const program = Effect.gen(function* () {
        const service = yield* DatabaseService;
        yield* service.initDatabase;
        return yield* service.getAllChats;
      });

      mockStatement.all.mockImplementation(() => {
        throw new Error('SQLITE_ERROR');
      });

      const exit = Effect.runSyncExit(
        program.pipe(Effect.provide(DatabaseServiceLive)),
      );
      expect(exit._tag).toBe('Failure');
    });
  });
});
