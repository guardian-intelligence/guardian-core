defmodule Guardian.Kernel.IpcWatcher do
  @moduledoc """
  GenServer that polls IPC directories for file-based messages and tasks
  from agent containers. Port of the startIpcWatcher() function in index.ts.

  Scans each registered group's IPC directories:
  - ipc/{folder}/messages/*.json → decode → send WhatsApp message → delete
  - ipc/{folder}/tasks/*.json → decode → process task IPC → delete
  """

  use GenServer
  require Logger

  alias Guardian.Kernel.Config

  # --- Public API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  # --- GenServer callbacks ---

  @impl true
  def init(opts) do
    state = %{
      data_dir: Keyword.get(opts, :data_dir, Config.data_dir()),
      main_group_folder: Keyword.get(opts, :main_group_folder, Config.main_group_folder()),
      poll_interval: Keyword.get(opts, :poll_interval, Config.ipc_poll_interval()),
      list_dir: Keyword.get(opts, :list_dir, &File.ls/1),
      read_file: Keyword.get(opts, :read_file, &File.read/1),
      delete_file: Keyword.get(opts, :delete_file, &File.rm/1),
      dir_exists: Keyword.get(opts, :dir_exists, &File.dir?/1),
      mkdir_p: Keyword.get(opts, :mkdir_p, &File.mkdir_p!/1),
      rename_file: Keyword.get(opts, :rename_file, &File.rename/2),
      is_dir: Keyword.get(opts, :is_dir, &File.dir?/1),
      # Callbacks for processing — injected for testability
      send_message_fn: Keyword.get(opts, :send_message_fn, fn _jid, _text -> :ok end),
      process_task_fn: Keyword.get(opts, :process_task_fn, fn _data, _source_group, _is_main -> :ok end),
      get_registered_groups_fn: Keyword.get(opts, :get_registered_groups_fn, fn -> %{} end)
    }

    # Ensure IPC base directory exists
    ipc_base = Path.join(state.data_dir, "ipc")
    state.mkdir_p.(ipc_base)

    schedule_poll(state.poll_interval)

    Logger.info("IPC watcher started (per-group namespaces)")

    {:ok, state}
  end

  @impl true
  def handle_info(:poll, state) do
    process_ipc_files(state)
    schedule_poll(state.poll_interval)
    {:noreply, state}
  end

  # --- Private ---

  defp schedule_poll(interval) do
    Process.send_after(self(), :poll, interval)
  end

  defp process_ipc_files(state) do
    ipc_base = Path.join(state.data_dir, "ipc")

    case state.list_dir.(ipc_base) do
      {:ok, entries} ->
        group_folders =
          Enum.filter(entries, fn entry ->
            entry != "errors" and state.is_dir.(Path.join(ipc_base, entry))
          end)

        registered_groups = state.get_registered_groups_fn.()

        for source_group <- group_folders do
          is_main = source_group == state.main_group_folder
          process_messages(source_group, is_main, registered_groups, ipc_base, state)
          process_tasks(source_group, is_main, ipc_base, state)
        end

      {:error, reason} ->
        Logger.error("Error reading IPC base directory: #{inspect(reason)}")
    end
  end

  defp process_messages(source_group, is_main, registered_groups, ipc_base, state) do
    messages_dir = Path.join([ipc_base, source_group, "messages"])

    if state.dir_exists.(messages_dir) do
      case state.list_dir.(messages_dir) do
        {:ok, files} ->
          json_files = Enum.filter(files, &String.ends_with?(&1, ".json"))

          for file <- json_files do
            file_path = Path.join(messages_dir, file)

            case state.read_file.(file_path) do
              {:ok, content} ->
                case Jason.decode(content) do
                  {:ok, %{"type" => "message", "chatJid" => chat_jid, "text" => text}}
                  when is_binary(chat_jid) and is_binary(text) ->
                    # Authorization: verify this group can send to this chatJid
                    target_group = Map.get(registered_groups, chat_jid)

                    if is_main or (target_group && (target_group["folder"] || target_group[:folder]) == source_group) do
                      assistant_name = Config.assistant_name()
                      state.send_message_fn.(chat_jid, "#{assistant_name}: #{text}")
                      Logger.info("IPC message sent chatJid=#{chat_jid} sourceGroup=#{source_group}")
                    else
                      Logger.warning("Unauthorized IPC message attempt blocked chatJid=#{chat_jid} sourceGroup=#{source_group}")
                    end

                    state.delete_file.(file_path)

                  {:ok, _} ->
                    state.delete_file.(file_path)

                  {:error, err} ->
                    Logger.error("Error parsing IPC message file=#{file} sourceGroup=#{source_group}: #{inspect(err)}")
                    move_to_errors(file_path, source_group, file, ipc_base, state)
                end

              {:error, reason} ->
                Logger.error("Error reading IPC message file=#{file}: #{inspect(reason)}")
                move_to_errors(file_path, source_group, file, ipc_base, state)
            end
          end

        {:error, reason} ->
          Logger.error("Error reading IPC messages directory: #{inspect(reason)}")
      end
    end
  end

  defp process_tasks(source_group, is_main, ipc_base, state) do
    tasks_dir = Path.join([ipc_base, source_group, "tasks"])

    if state.dir_exists.(tasks_dir) do
      case state.list_dir.(tasks_dir) do
        {:ok, files} ->
          json_files = Enum.filter(files, &String.ends_with?(&1, ".json"))

          for file <- json_files do
            file_path = Path.join(tasks_dir, file)

            case state.read_file.(file_path) do
              {:ok, content} ->
                case Jason.decode(content) do
                  {:ok, data} ->
                    state.process_task_fn.(data, source_group, is_main)
                    state.delete_file.(file_path)

                  {:error, err} ->
                    Logger.error("Error parsing IPC task file=#{file} sourceGroup=#{source_group}: #{inspect(err)}")
                    move_to_errors(file_path, source_group, file, ipc_base, state)
                end

              {:error, reason} ->
                Logger.error("Error reading IPC task file=#{file}: #{inspect(reason)}")
                move_to_errors(file_path, source_group, file, ipc_base, state)
            end
          end

        {:error, reason} ->
          Logger.error("Error reading IPC tasks directory: #{inspect(reason)}")
      end
    end
  end

  defp move_to_errors(file_path, source_group, file, ipc_base, state) do
    error_dir = Path.join(ipc_base, "errors")
    state.mkdir_p.(error_dir)
    state.rename_file.(file_path, Path.join(error_dir, "#{source_group}-#{file}"))
  end
end
