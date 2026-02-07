defmodule Guardian.Kernel.TaskScheduler do
  @moduledoc """
  GenServer that polls for due scheduled tasks and runs them in containers.
  Port of task-scheduler.ts.

  Supports schedule types: cron, interval, once.
  Uses Crontab for cron expression parsing.
  """

  use GenServer
  require Logger

  alias Guardian.Kernel.Config
  alias Guardian.Kernel.ContainerRunner
  alias Guardian.Kernel.State
  alias Guardian.Repo

  # --- Public API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  # --- GenServer callbacks ---

  @impl true
  def init(opts) do
    state = %{
      poll_interval: Keyword.get(opts, :poll_interval, Config.scheduler_poll_interval()),
      main_group_folder: Keyword.get(opts, :main_group_folder, Config.main_group_folder()),
      timezone: Keyword.get(opts, :timezone, Config.timezone()),
      state_server: Keyword.get(opts, :state_server, State),
      run_container_fn: Keyword.get(opts, :run_container_fn, &ContainerRunner.run/3),
      send_message_fn: Keyword.get(opts, :send_message_fn, fn _jid, _text -> :ok end),
      enabled: Keyword.get(opts, :enabled, true)
    }

    if state.enabled do
      schedule_poll(state.poll_interval)
      Logger.info("Task scheduler started")
    end

    {:ok, state}
  end

  @impl true
  def handle_info(:poll, state) do
    poll_due_tasks(state)
    schedule_poll(state.poll_interval)
    {:noreply, state}
  end

  # --- Private ---

  defp schedule_poll(interval) do
    Process.send_after(self(), :poll, interval)
  end

  defp poll_due_tasks(state) do
    now = DateTime.utc_now() |> DateTime.to_iso8601()

    case query_due_tasks(now) do
      [] ->
        :ok

      tasks ->
        Logger.info("Found #{length(tasks)} due tasks")

        for task <- tasks do
          # Re-check task status (may have been paused/cancelled)
          case query_task_by_id(task["id"]) do
            nil ->
              :ok

            current_task ->
              if current_task["status"] == "active" do
                run_task(current_task, state)
              end
          end
        end
    end
  rescue
    e ->
      Logger.error("Error in scheduler poll: #{inspect(e)}")
  end

  defp run_task(task, state) do
    start_time = System.system_time(:millisecond)
    task_id = task["id"]
    group_folder = task["group_folder"]

    Logger.info("Running scheduled task id=#{task_id} group=#{group_folder}")

    registered_groups = State.get_registered_groups(state.state_server)

    group =
      registered_groups
      |> Map.values()
      |> Enum.find(fn g -> (g["folder"] || g[:folder]) == group_folder end)

    if is_nil(group) do
      Logger.error("Group not found for task id=#{task_id} folder=#{group_folder}")
      log_task_run(task_id, start_time, "error", nil, "Group not found: #{group_folder}")
    else
      do_run_task(task, group, state, start_time)
    end
  rescue
    e ->
      Logger.error("Error running task #{task["id"]}: #{inspect(e)}")
      log_task_run(task["id"], System.system_time(:millisecond), "error", nil, inspect(e))
  end

  defp do_run_task(task, group, state, start_time) do
    task_id = task["id"]
    group_folder = task["group_folder"]
    is_main = group_folder == state.main_group_folder

    # Write tasks snapshot
    all_tasks = query_all_tasks()

    ContainerRunner.write_tasks_snapshot(
      group_folder,
      is_main,
      Enum.map(all_tasks, fn t ->
        %{
          "id" => t["id"],
          "group_folder" => t["group_folder"],
          "prompt" => t["prompt"],
          "schedule_type" => t["schedule_type"],
          "schedule_value" => t["schedule_value"],
          "status" => t["status"],
          "next_run" => t["next_run"]
        }
      end)
    )

    # Determine session ID based on context_mode
    sessions = State.get_sessions(state.state_server)
    session_id = if task["context_mode"] == "group", do: Map.get(sessions, group_folder), else: nil

    input = %{
      prompt: task["prompt"],
      session_id: session_id,
      group_folder: group_folder,
      chat_jid: task["chat_jid"],
      is_main: is_main,
      is_scheduled_task: true
    }

    {status, result, error} =
      case state.run_container_fn.(group, input, []) do
        {:ok, %{status: "success", result: result}} ->
          {"success", result, nil}

        {:ok, %{status: "error", error: err}} ->
          {"error", nil, err || "Unknown error"}

        {:error, reason} ->
          {"error", nil, reason}
      end

    duration_ms = System.system_time(:millisecond) - start_time

    log_task_run(task_id, start_time, status, result, error)

    # Calculate next_run
    next_run = compute_next_run(task["schedule_type"], task["schedule_value"], state.timezone)

    result_summary =
      cond do
        error -> "Error: #{error}"
        result -> String.slice(result, 0, 200)
        true -> "Completed"
      end

    update_task_after_run(task_id, next_run, result_summary)

    Logger.info("Task completed id=#{task_id} duration=#{duration_ms}ms status=#{status}")
  end

  @doc false
  def compute_next_run("cron", cron_expression, _timezone) do
    case Crontab.CronExpression.Parser.parse(cron_expression) do
      {:ok, expr} ->
        case Crontab.Scheduler.get_next_run_date(expr) do
          {:ok, next} ->
            next |> NaiveDateTime.to_string() |> Kernel.<>("Z")

          {:error, _} ->
            nil
        end

      {:error, _} ->
        Logger.warning("Invalid cron expression: #{cron_expression}")
        nil
    end
  end

  def compute_next_run("interval", ms_string, _timezone) do
    case Integer.parse(ms_string) do
      {ms, _} when ms > 0 ->
        DateTime.utc_now()
        |> DateTime.add(ms, :millisecond)
        |> DateTime.to_iso8601()

      _ ->
        Logger.warning("Invalid interval: #{ms_string}")
        nil
    end
  end

  def compute_next_run("once", _value, _timezone), do: nil

  def compute_next_run(type, _value, _timezone) do
    Logger.warning("Unknown schedule type: #{type}")
    nil
  end

  # --- DB helpers ---

  defp query_due_tasks(now) do
    sql = """
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?1
    ORDER BY next_run
    """

    case Ecto.Adapters.SQL.query(Repo, sql, [now]) do
      {:ok, %{rows: rows, columns: columns}} ->
        Enum.map(rows, fn row -> Enum.zip(columns, row) |> Map.new() end)

      {:error, _} ->
        []
    end
  end

  defp query_task_by_id(id) do
    case Ecto.Adapters.SQL.query(Repo, "SELECT * FROM scheduled_tasks WHERE id = ?1", [id]) do
      {:ok, %{rows: [row], columns: columns}} ->
        Enum.zip(columns, row) |> Map.new()

      _ ->
        nil
    end
  end

  defp query_all_tasks do
    case Ecto.Adapters.SQL.query(Repo, "SELECT * FROM scheduled_tasks ORDER BY created_at DESC") do
      {:ok, %{rows: rows, columns: columns}} ->
        Enum.map(rows, fn row -> Enum.zip(columns, row) |> Map.new() end)

      {:error, _} ->
        []
    end
  end

  defp log_task_run(task_id, start_time, status, result, error) do
    now = DateTime.utc_now() |> DateTime.to_iso8601()
    duration_ms = System.system_time(:millisecond) - start_time

    Ecto.Adapters.SQL.query(Repo,
      "INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      [task_id, now, duration_ms, status, result, error]
    )
  end

  defp update_task_after_run(task_id, next_run, result_summary) do
    now = DateTime.utc_now() |> DateTime.to_iso8601()

    Ecto.Adapters.SQL.query(Repo,
      """
      UPDATE scheduled_tasks
      SET next_run = ?1, last_run = ?2, last_result = ?3,
          status = CASE WHEN ?1 IS NULL THEN 'completed' ELSE status END
      WHERE id = ?4
      """,
      [next_run, now, result_summary, task_id]
    )
  end

end
