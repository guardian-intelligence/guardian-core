defmodule Guardian.Kernel.ContainerRunner do
  @moduledoc """
  Spawns agent execution in Docker containers and parses sentinel-delimited output.
  Port of container-runner.ts.

  Uses System.cmd/Port for Docker interaction.
  Dependency injection via opts for testability.
  """

  require Logger

  alias Guardian.Kernel.Config
  alias Guardian.Kernel.MountSecurity

  @output_start_marker "---GUARDIAN_CORE_OUTPUT_START---"
  @output_end_marker "---GUARDIAN_CORE_OUTPUT_END---"

  @type container_input :: %{
          prompt: String.t(),
          session_id: String.t() | nil,
          group_folder: String.t(),
          chat_jid: String.t(),
          is_main: boolean(),
          is_scheduled_task: boolean() | nil
        }

  @type container_output :: %{
          status: String.t(),
          result: String.t() | nil,
          new_session_id: String.t() | nil,
          error: String.t() | nil
        }

  @doc """
  Run a container agent for the given group with the provided input.
  Returns {:ok, output} or {:error, reason}.
  """
  @spec run(map(), container_input(), keyword()) :: {:ok, container_output()} | {:error, String.t()}
  def run(group, input, opts \\ []) do
    project_root = Keyword.get(opts, :project_root, Config.project_root())
    groups_dir = Keyword.get(opts, :groups_dir, Config.groups_dir())
    data_dir = Keyword.get(opts, :data_dir, Config.data_dir())
    container_image = Keyword.get(opts, :container_image, Config.container_image())
    container_timeout = Keyword.get(opts, :container_timeout, Config.container_timeout())
    max_output_size = Keyword.get(opts, :max_output_size, Config.container_max_output_size())
    spawn_fn = Keyword.get(opts, :spawn_fn, &default_spawn/3)
    mkdir_p = Keyword.get(opts, :mkdir_p, &File.mkdir_p!/1)
    write_file = Keyword.get(opts, :write_file, &File.write!/2)
    exists_fn = Keyword.get(opts, :exists_fn, &File.exists?/1)
    read_file = Keyword.get(opts, :read_file, &File.read/1)

    folder = group["folder"] || group[:folder]
    name = group["name"] || group[:name]
    is_main = input.is_main

    # Ensure group directory exists
    group_dir = Path.join(groups_dir, folder)
    mkdir_p.(group_dir)

    # Build volume mounts
    mounts = build_volume_mounts(group, is_main, project_root, groups_dir, data_dir, mkdir_p, write_file, exists_fn, read_file, opts)

    # Build container args
    safe_name = String.replace(folder, ~r/[^a-zA-Z0-9-]/, "-")
    timestamp = System.system_time(:millisecond)
    container_name = "guardian-core-#{safe_name}-#{timestamp}"
    container_args = build_container_args(mounts, container_name, container_image)

    Logger.info("Spawning container agent group=#{name} container=#{container_name} mounts=#{length(mounts)}")

    # Build JSON input matching TS ContainerInput format
    json_input =
      %{
        "prompt" => input.prompt,
        "groupFolder" => input.group_folder,
        "chatJid" => input.chat_jid,
        "isMain" => input.is_main
      }
      |> maybe_put("sessionId", input[:session_id] || input.session_id)
      |> maybe_put("isScheduledTask", input[:is_scheduled_task] || input.is_scheduled_task)
      |> Jason.encode!()

    # Spawn container
    case spawn_fn.(container_args, json_input, container_timeout) do
      {:ok, exit_code, stdout, stderr} ->
        logs_dir = Path.join([groups_dir, folder, "logs"])
        mkdir_p.(logs_dir)
        write_container_log(logs_dir, name, is_main, exit_code, stdout, stderr, timestamp, write_file)

        if exit_code != 0 do
          Logger.error("Container exited with code #{exit_code} group=#{name}")
          {:error, "Container exited with code #{exit_code}: #{String.slice(stderr, -200..-1//1) || ""}"}
        else
          parse_container_output(stdout, name, max_output_size)
        end

      {:error, reason} ->
        Logger.error("Container spawn error group=#{name}: #{reason}")
        {:error, "Container spawn error: #{reason}"}
    end
  end

  @doc """
  Write a current_tasks.json snapshot to the group's IPC directory.
  """
  @spec write_tasks_snapshot(String.t(), boolean(), [map()], keyword()) :: :ok
  def write_tasks_snapshot(group_folder, is_main, tasks, opts \\ []) do
    data_dir = Keyword.get(opts, :data_dir, Config.data_dir())
    mkdir_p = Keyword.get(opts, :mkdir_p, &File.mkdir_p!/1)
    write_file = Keyword.get(opts, :write_file, &File.write!/2)

    ipc_dir = Path.join([data_dir, "ipc", group_folder])
    mkdir_p.(ipc_dir)

    filtered = if is_main, do: tasks, else: Enum.filter(tasks, &(&1["group_folder"] == group_folder || &1[:group_folder] == group_folder))

    write_file.(Path.join(ipc_dir, "current_tasks.json"), Jason.encode!(filtered, pretty: true))
    :ok
  end

  @doc """
  Write an available_groups.json snapshot to the group's IPC directory.
  """
  @spec write_groups_snapshot(String.t(), boolean(), [map()], keyword()) :: :ok
  def write_groups_snapshot(group_folder, is_main, groups, opts \\ []) do
    data_dir = Keyword.get(opts, :data_dir, Config.data_dir())
    mkdir_p = Keyword.get(opts, :mkdir_p, &File.mkdir_p!/1)
    write_file = Keyword.get(opts, :write_file, &File.write!/2)

    ipc_dir = Path.join([data_dir, "ipc", group_folder])
    mkdir_p.(ipc_dir)

    visible = if is_main, do: groups, else: []

    data = %{"groups" => visible, "lastSync" => DateTime.utc_now() |> DateTime.to_iso8601()}
    write_file.(Path.join(ipc_dir, "available_groups.json"), Jason.encode!(data, pretty: true))
    :ok
  end

  @doc """
  Parse sentinel-delimited output from container stdout.
  Exported for testing.
  """
  @spec parse_container_output(String.t(), String.t(), non_neg_integer()) ::
          {:ok, container_output()} | {:error, String.t()}
  def parse_container_output(stdout, group_name, _max_output_size \\ 10_485_760) do
    start_idx = :binary.match(stdout, @output_start_marker)
    end_idx = :binary.match(stdout, @output_end_marker)

    json_line =
      case {start_idx, end_idx} do
        {{s_pos, s_len}, {e_pos, _}} when e_pos > s_pos ->
          stdout
          |> binary_part(s_pos + s_len, e_pos - s_pos - s_len)
          |> String.trim()

        _ ->
          # Fall back to last line
          stdout |> String.trim() |> String.split("\n") |> List.last("")
      end

    case Jason.decode(json_line) do
      {:ok, %{"status" => status} = output} ->
        {:ok, %{
          status: status,
          result: output["result"],
          new_session_id: output["newSessionId"],
          error: output["error"]
        }}

      {:ok, _} ->
        {:error, "Container output missing 'status' field for group #{group_name}"}

      {:error, err} ->
        Logger.error("Failed to parse container output for group=#{group_name}: #{inspect(err)}")
        {:error, "Failed to parse container output: #{inspect(err)}"}
    end
  end

  # --- Private ---

  defp build_volume_mounts(group, is_main, project_root, groups_dir, data_dir, mkdir_p, write_file, exists_fn, read_file, opts) do
    folder = group["folder"] || group[:folder]
    mounts = []

    # Project/group mounts
    mounts =
      if is_main do
        [
          %{host_path: project_root, container_path: "/workspace/project", readonly: false},
          %{host_path: Path.join(groups_dir, folder), container_path: "/workspace/group", readonly: false}
          | mounts
        ]
      else
        global_dir = Path.join(groups_dir, "global")

        base = [
          %{host_path: Path.join(groups_dir, folder), container_path: "/workspace/group", readonly: false}
          | mounts
        ]

        if exists_fn.(global_dir) do
          [%{host_path: global_dir, container_path: "/workspace/global", readonly: true} | base]
        else
          base
        end
      end

    # Sessions mount
    sessions_dir = Path.join([data_dir, "sessions", folder, ".claude"])
    mkdir_p.(sessions_dir)
    mounts = [%{host_path: sessions_dir, container_path: "/home/node/.claude", readonly: false} | mounts]

    # IPC mount
    ipc_dir = Path.join([data_dir, "ipc", folder])
    mkdir_p.(Path.join(ipc_dir, "messages"))
    mkdir_p.(Path.join(ipc_dir, "tasks"))
    mounts = [%{host_path: ipc_dir, container_path: "/workspace/ipc", readonly: false} | mounts]

    # Filtered env mount
    env_dir = Path.join(data_dir, "env")
    mkdir_p.(env_dir)
    env_file = Path.join(project_root, ".env")

    mounts =
      if exists_fn.(env_file) do
        case read_file.(env_file) do
          {:ok, content} ->
            allowed_vars = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]

            filtered =
              content
              |> String.split("\n")
              |> Enum.filter(fn line ->
                trimmed = String.trim(line)
                trimmed != "" and not String.starts_with?(trimmed, "#") and
                  Enum.any?(allowed_vars, &String.starts_with?(trimmed, "#{&1}="))
              end)

            if filtered != [] do
              write_file.(Path.join(env_dir, "env"), Enum.join(filtered, "\n") <> "\n")
              [%{host_path: env_dir, container_path: "/workspace/env-dir", readonly: true} | mounts]
            else
              mounts
            end

          {:error, _} ->
            mounts
        end
      else
        mounts
      end

    # Additional mounts from container config
    container_config = group["containerConfig"] || group[:containerConfig]
    additional = container_config && (container_config["additionalMounts"] || container_config[:additionalMounts])

    mounts =
      if additional && additional != [] do
        group_name = group["name"] || group[:name]
        mount_opts = Keyword.take(opts, [:path, :read_file, :home_dir, :real_path])
        validated = MountSecurity.validate_additional_mounts(additional, group_name, is_main, mount_opts)

        validated
        |> Enum.map(fn m -> %{host_path: m.host_path, container_path: m.container_path, readonly: m.readonly} end)
        |> Enum.concat(mounts)
      else
        mounts
      end

    Enum.reverse(mounts)
  end

  defp build_container_args(mounts, container_name, image) do
    volume_args =
      Enum.flat_map(mounts, fn mount ->
        if mount.readonly do
          ["-v", "#{mount.host_path}:#{mount.container_path}:ro"]
        else
          ["-v", "#{mount.host_path}:#{mount.container_path}"]
        end
      end)

    ["run", "-i", "--rm", "--name", container_name] ++ volume_args ++ [image]
  end

  defp default_spawn(container_args, json_input, timeout_ms) do
    port =
      Port.open({:spawn_executable, System.find_executable("docker")}, [
        {:args, container_args},
        {:line, 1_048_576},
        :use_stdio,
        :exit_status,
        :stderr_to_stdout
      ])

    Port.command(port, json_input)
    Port.command(port, :eof)

    collect_port_output(port, [], timeout_ms)
  end

  defp collect_port_output(port, lines, timeout_ms) do
    receive do
      {^port, {:data, {:eol, line}}} ->
        collect_port_output(port, [to_string(line) | lines], timeout_ms)

      {^port, {:data, {:noeol, line}}} ->
        collect_port_output(port, [to_string(line) | lines], timeout_ms)

      {^port, {:exit_status, code}} ->
        stdout = lines |> Enum.reverse() |> Enum.join("\n")
        {:ok, code, stdout, ""}
    after
      timeout_ms ->
        Port.close(port)
        {:error, "Container timed out after #{timeout_ms}ms"}
    end
  end

  defp write_container_log(logs_dir, name, is_main, exit_code, _stdout, stderr, timestamp, write_file) do
    ts = DateTime.utc_now() |> DateTime.to_iso8601() |> String.replace(~r/[:.]/u, "-")
    log_file = Path.join(logs_dir, "container-#{ts}.log")

    log_lines = [
      "=== Container Run Log ===",
      "Timestamp: #{DateTime.utc_now() |> DateTime.to_iso8601()}",
      "Group: #{name}",
      "IsMain: #{is_main}",
      "Duration: #{System.system_time(:millisecond) - timestamp}ms",
      "Exit Code: #{exit_code}",
      ""
    ]

    log_lines =
      if exit_code != 0 do
        log_lines ++ [
          "=== Stderr (last 500 chars) ===",
          String.slice(stderr, -500..-1//1) || "",
          ""
        ]
      else
        log_lines
      end

    write_file.(log_file, Enum.join(log_lines, "\n"))
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)
end
