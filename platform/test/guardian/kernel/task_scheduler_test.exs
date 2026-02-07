defmodule Guardian.Kernel.TaskSchedulerTest do
  use ExUnit.Case, async: false

  alias Guardian.Kernel.TaskScheduler
  alias Guardian.Repo
  alias Guardian.Repo.Migrations

  setup do
    Migrations.run!()
    Ecto.Adapters.SQL.query!(Repo, "DELETE FROM task_run_logs")
    Ecto.Adapters.SQL.query!(Repo, "DELETE FROM scheduled_tasks")
    :ok
  end

  describe "compute_next_run/3" do
    test "cron returns a future datetime" do
      result = TaskScheduler.compute_next_run("cron", "*/5 * * * *", "America/New_York")
      assert result != nil
      assert String.ends_with?(result, "Z")
    end

    test "cron returns nil for invalid expression" do
      assert TaskScheduler.compute_next_run("cron", "invalid cron", "UTC") == nil
    end

    test "interval adds milliseconds to now" do
      result = TaskScheduler.compute_next_run("interval", "60000", "UTC")
      assert result != nil

      {:ok, dt, _} = DateTime.from_iso8601(result)
      now = DateTime.utc_now()
      diff = DateTime.diff(dt, now, :second)
      # Should be roughly 60 seconds in the future (with small tolerance)
      assert diff >= 55 and diff <= 65
    end

    test "interval returns nil for invalid value" do
      assert TaskScheduler.compute_next_run("interval", "not-a-number", "UTC") == nil
    end

    test "interval returns nil for zero/negative" do
      assert TaskScheduler.compute_next_run("interval", "0", "UTC") == nil
      assert TaskScheduler.compute_next_run("interval", "-1000", "UTC") == nil
    end

    test "once always returns nil" do
      assert TaskScheduler.compute_next_run("once", "2030-01-01T00:00:00Z", "UTC") == nil
    end

    test "unknown type returns nil" do
      assert TaskScheduler.compute_next_run("daily", "whatever", "UTC") == nil
    end
  end

  describe "scheduler GenServer" do
    test "starts in disabled mode" do
      name = :"scheduler_#{System.unique_integer([:positive])}"

      {:ok, pid} =
        TaskScheduler.start_link(
          name: name,
          enabled: false
        )

      assert Process.alive?(pid)
    end

    test "polls and runs due tasks" do
      # Insert a due task
      now = DateTime.utc_now() |> DateTime.add(-60, :second) |> DateTime.to_iso8601()

      Ecto.Adapters.SQL.query!(Repo,
        """
        INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        """,
        ["test-task-1", "main", "123@g.us", "do something", "once", now, "isolated", now, "active", now]
      )

      # Start a state server
      state_name = :"state_sched_#{System.unique_integer([:positive])}"

      {:ok, _} =
        Guardian.Kernel.State.start_link(
          name: state_name,
          config_mod: Guardian.Kernel.Config,
          read_file: fn _ -> {:error, :enoent} end,
          write_file: fn _, _ -> :ok end,
          mkdir_p: fn _ -> :ok end
        )

      # Register a group
      Guardian.Kernel.State.register_group(
        "123@g.us",
        %{"name" => "Main", "folder" => "main"},
        state_name
      )

      # Mock container runner
      test_pid = self()

      mock_run = fn _group, input, _opts ->
        send(test_pid, {:container_ran, input})
        {:ok, %{status: "success", result: "done", new_session_id: nil, error: nil}}
      end

      name = :"scheduler_poll_#{System.unique_integer([:positive])}"

      {:ok, pid} =
        TaskScheduler.start_link(
          name: name,
          poll_interval: 100_000,
          enabled: false,
          state_server: state_name,
          run_container_fn: mock_run
        )

      # Trigger poll manually
      send(pid, :poll)

      assert_receive {:container_ran, input}, 5000
      assert input.prompt == "do something"
      assert input.is_scheduled_task == true

      # Verify task was updated (once → completed)
      Process.sleep(100)

      {:ok, %{rows: rows}} =
        Ecto.Adapters.SQL.query(Repo, "SELECT status FROM scheduled_tasks WHERE id = ?1", [
          "test-task-1"
        ])

      assert hd(rows) == ["completed"]
    end
  end
end
