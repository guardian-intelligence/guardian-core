defmodule Guardian.Repo.MigrationsTest do
  use ExUnit.Case, async: false

  alias Guardian.Repo
  alias Guardian.Repo.Migrations

  setup do
    # Repo is started by test_helper via Application — just ensure migrations ran
    :ok = Migrations.run!(Repo)
    :ok
  end

  test "all tables exist after migration" do
    tables =
      Ecto.Adapters.SQL.query!(Repo, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      |> Map.get(:rows)
      |> List.flatten()

    assert "chats" in tables
    assert "messages" in tables
    assert "scheduled_tasks" in tables
    assert "task_run_logs" in tables
  end

  test "chats table has expected columns" do
    columns = get_columns("chats")
    assert "jid" in columns
    assert "name" in columns
    assert "last_message_time" in columns
  end

  test "messages table has expected columns including sender_name migration" do
    columns = get_columns("messages")
    assert "id" in columns
    assert "chat_jid" in columns
    assert "sender" in columns
    assert "sender_name" in columns
    assert "content" in columns
    assert "timestamp" in columns
    assert "is_from_me" in columns
  end

  test "scheduled_tasks table has expected columns including context_mode migration" do
    columns = get_columns("scheduled_tasks")
    assert "id" in columns
    assert "group_folder" in columns
    assert "chat_jid" in columns
    assert "prompt" in columns
    assert "schedule_type" in columns
    assert "schedule_value" in columns
    assert "context_mode" in columns
    assert "next_run" in columns
    assert "last_run" in columns
    assert "last_result" in columns
    assert "status" in columns
    assert "created_at" in columns
  end

  test "task_run_logs table has expected columns" do
    columns = get_columns("task_run_logs")
    assert "id" in columns
    assert "task_id" in columns
    assert "run_at" in columns
    assert "duration_ms" in columns
    assert "status" in columns
    assert "result" in columns
    assert "error" in columns
  end

  test "migrations are idempotent — running twice succeeds" do
    assert :ok = Migrations.run!(Repo)
    assert :ok = Migrations.run!(Repo)
  end

  test "indexes exist" do
    indexes =
      Ecto.Adapters.SQL.query!(Repo, "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      |> Map.get(:rows)
      |> List.flatten()

    assert "idx_timestamp" in indexes
    assert "idx_next_run" in indexes
    assert "idx_status" in indexes
    assert "idx_task_run_logs" in indexes
  end

  defp get_columns(table) do
    Ecto.Adapters.SQL.query!(Repo, "PRAGMA table_info(#{table})")
    |> Map.get(:rows)
    |> Enum.map(fn row -> Enum.at(row, 1) end)
  end
end
