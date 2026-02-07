defmodule Guardian.Repo.Migrations do
  @moduledoc """
  Idempotent database migrations. Runs CREATE TABLE IF NOT EXISTS
  followed by ALTER TABLE migrations wrapped in try/rescue.

  Called on application startup — safe to run repeatedly.
  """

  require Logger

  def run!(repo \\ Guardian.Repo) do
    create_tables(repo)
    alter_tables(repo)
    :ok
  end

  defp create_tables(repo) do
    Ecto.Adapters.SQL.query!(repo, """
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    )
    """)

    Ecto.Adapters.SQL.query!(repo, """
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
    )
    """)

    Ecto.Adapters.SQL.query!(repo, """
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp)
    """)

    Ecto.Adapters.SQL.query!(repo, """
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
    )
    """)

    Ecto.Adapters.SQL.query!(repo, """
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run)
    """)

    Ecto.Adapters.SQL.query!(repo, """
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status)
    """)

    Ecto.Adapters.SQL.query!(repo, """
    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    )
    """)

    Ecto.Adapters.SQL.query!(repo, """
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at)
    """)
  end

  defp alter_tables(repo) do
    # Migration 1: messages.sender_name (may already exist)
    try do
      Ecto.Adapters.SQL.query!(repo, "ALTER TABLE messages ADD COLUMN sender_name TEXT")
    rescue
      _ -> :ok
    end

    # Migration 2: scheduled_tasks.context_mode (may already exist)
    try do
      Ecto.Adapters.SQL.query!(
        repo,
        "ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'"
      )
    rescue
      _ -> :ok
    end
  end
end
