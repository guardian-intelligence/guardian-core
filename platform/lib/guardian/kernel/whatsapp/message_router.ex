defmodule Guardian.Kernel.WhatsApp.MessageRouter do
  @moduledoc """
  GenServer that polls the database for new messages and routes them to agent containers.

  Uses a composite (timestamp, message_id) cursor to avoid edge-case drops
  when multiple messages share the same ISO timestamp.

  Polling loop: Process.send_after(self(), :poll, poll_interval)
  """

  use GenServer
  require Logger

  alias Guardian.Kernel.Config
  alias Guardian.Kernel.ContainerRunner
  alias Guardian.Kernel.State
  alias Guardian.Kernel.WhatsApp.Bridge
  alias Guardian.Repo

  # --- Public API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  # --- GenServer callbacks ---

  @impl true
  def init(opts) do
    state = %{
      poll_interval: Keyword.get(opts, :poll_interval, Config.poll_interval()),
      assistant_name: Keyword.get(opts, :assistant_name, Config.assistant_name()),
      trigger_pattern: Keyword.get(opts, :trigger_pattern, Config.trigger_pattern()),
      main_group_folder: Keyword.get(opts, :main_group_folder, Config.main_group_folder()),
      state_server: Keyword.get(opts, :state_server, State),
      bridge_server: Keyword.get(opts, :bridge_server, Bridge),
      run_agent_fn: Keyword.get(opts, :run_agent_fn, &default_run_agent/5),
      enabled: Keyword.get(opts, :enabled, true)
    }

    if state.enabled do
      schedule_poll(state.poll_interval)
      Logger.info("Message router started (trigger: @#{state.assistant_name})")
    end

    {:ok, state}
  end

  @impl true
  def handle_info(:poll, state) do
    poll_messages(state)
    schedule_poll(state.poll_interval)
    {:noreply, state}
  end

  # --- Private ---

  defp schedule_poll(interval) do
    Process.send_after(self(), :poll, interval)
  end

  defp poll_messages(state) do
    registered_groups = State.get_registered_groups(state.state_server)
    jids = Map.keys(registered_groups)

    if jids == [] do
      :ok
    else
      router_state = State.get_router_state(state.state_server)
      last_timestamp = router_state["last_timestamp"] || ""
      last_message_id = router_state["last_message_id"] || ""

      messages = query_new_messages(jids, last_timestamp, last_message_id, state.assistant_name)

      if messages != [] do
        Logger.info("New messages: #{length(messages)}")
      end

      for msg <- messages do
        try do
          group = Map.get(registered_groups, msg.chat_jid)

          if group do
            is_main = (group["folder"] || group[:folder]) == state.main_group_folder

            # Main group responds to all; others require trigger
            should_respond =
              is_main or Regex.match?(state.trigger_pattern, String.trim(msg.content))

            if should_respond do
              process_message(msg, group, is_main, state)
            end

            # Advance cursor after successful processing
            State.update_router_state(msg.timestamp, msg.id, state.state_server)
          end
        rescue
          e ->
            Logger.error("Error processing message #{msg.id}: #{inspect(e)}")
            # Stop batch on error — failed message retried next poll
            throw(:stop_batch)
        end
      end
    end
  catch
    :stop_batch -> :ok
  end

  defp process_message(msg, group, is_main, state) do
    _folder = group["folder"] || group[:folder]
    group_name = group["name"] || group[:name]

    # Get recent messages for context
    last_agent_ts = State.get_last_agent_timestamp(msg.chat_jid, state.state_server)

    context_messages =
      query_messages_since(msg.chat_jid, last_agent_ts, state.assistant_name)

    # Format as XML for the agent
    lines =
      Enum.map(context_messages, fn m ->
        sender = escape_xml(m.sender_name || "")
        content = escape_xml(m.content || "")
        ~s(<message sender="#{sender}" time="#{m.timestamp}">#{content}</message>)
      end)

    prompt = "<messages>\n#{Enum.join(lines, "\n")}\n</messages>"

    Logger.info("Processing message group=#{group_name} messageCount=#{length(context_messages)}")

    # Set typing indicator
    Bridge.send_presence(msg.chat_jid, "composing", state.bridge_server)

    # Run the agent
    response = state.run_agent_fn.(group, prompt, msg.chat_jid, is_main, state)

    Bridge.send_presence(msg.chat_jid, "paused", state.bridge_server)

    if response do
      State.set_last_agent_timestamp(msg.chat_jid, msg.timestamp, state.state_server)
      Bridge.send_message(msg.chat_jid, "#{state.assistant_name}: #{response}", state.bridge_server)
    end
  end

  defp default_run_agent(group, prompt, chat_jid, is_main, state) do
    folder = group["folder"] || group[:folder]
    session_id = State.get_sessions(state.state_server) |> Map.get(folder)

    # Write snapshots for the container
    tasks = query_all_tasks()

    ContainerRunner.write_tasks_snapshot(folder, is_main,
      Enum.map(tasks, fn t ->
        %{
          "id" => t.id,
          "group_folder" => t.group_folder,
          "prompt" => t.prompt,
          "schedule_type" => t.schedule_type,
          "schedule_value" => t.schedule_value,
          "status" => t.status,
          "next_run" => t.next_run
        }
      end)
    )

    all_chats = query_all_chats()
    registered_groups = State.get_registered_groups(state.state_server)
    registered_jids = Map.keys(registered_groups) |> MapSet.new()

    available_groups =
      all_chats
      |> Enum.filter(&(&1.jid != "__group_sync__" and String.ends_with?(&1.jid, "@g.us")))
      |> Enum.map(fn c ->
        %{
          "jid" => c.jid,
          "name" => c.name,
          "lastActivity" => c.last_message_time,
          "isRegistered" => MapSet.member?(registered_jids, c.jid)
        }
      end)

    ContainerRunner.write_groups_snapshot(folder, is_main, available_groups)

    input = %{
      prompt: prompt,
      session_id: session_id,
      group_folder: folder,
      chat_jid: chat_jid,
      is_main: is_main,
      is_scheduled_task: nil
    }

    case ContainerRunner.run(group, input) do
      {:ok, %{status: "success", result: result, new_session_id: new_session_id}} ->
        if new_session_id do
          State.set_session(folder, new_session_id, state.state_server)
        end

        result

      {:ok, %{status: "error", error: error}} ->
        Logger.error("Container error for group #{folder}: #{error}")
        nil

      {:error, reason} ->
        Logger.error("Container failed for group #{folder}: #{reason}")
        nil
    end
  end

  # --- DB queries (direct SQL to match exact TS behavior) ---

  defp query_new_messages(jids, last_timestamp, last_message_id, bot_prefix) do
    # Exqlite uses ?1, ?2... for positional params
    placeholders = Enum.map_join(1..length(jids), ", ", fn i -> "?#{i + 3}" end)

    # Composite cursor: (timestamp > last_ts) OR (timestamp = last_ts AND id > last_msg_id)
    sql = """
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE ((timestamp > ?1) OR (timestamp = ?1 AND id > ?2))
      AND chat_jid IN (#{placeholders})
      AND content NOT LIKE ?3
    ORDER BY timestamp, id
    """

    params = [last_timestamp, last_message_id, "#{bot_prefix}:%"] ++ jids

    case Ecto.Adapters.SQL.query(Repo, sql, params) do
      {:ok, %{rows: rows, columns: columns}} ->
        Enum.map(rows, fn row ->
          Enum.zip(columns, row) |> Map.new() |> to_message_struct()
        end)

      {:error, err} ->
        Logger.error("Failed to query new messages: #{inspect(err)}")
        []
    end
  end

  defp query_messages_since(chat_jid, since_timestamp, bot_prefix) do
    sql = """
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = ?1 AND timestamp > ?2 AND content NOT LIKE ?3
    ORDER BY timestamp
    """

    case Ecto.Adapters.SQL.query(Repo, sql, [chat_jid, since_timestamp, "#{bot_prefix}:%"]) do
      {:ok, %{rows: rows, columns: columns}} ->
        Enum.map(rows, fn row ->
          Enum.zip(columns, row) |> Map.new() |> to_message_struct()
        end)

      {:error, err} ->
        Logger.error("Failed to query messages since: #{inspect(err)}")
        []
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

  defp query_all_chats do
    case Ecto.Adapters.SQL.query(Repo, "SELECT jid, name, last_message_time FROM chats ORDER BY last_message_time DESC") do
      {:ok, %{rows: rows}} ->
        Enum.map(rows, fn [jid, name, lmt] -> %{jid: jid, name: name, last_message_time: lmt} end)

      {:error, _} ->
        []
    end
  end

  defp to_message_struct(map) do
    %{
      id: map["id"],
      chat_jid: map["chat_jid"],
      sender: map["sender"],
      sender_name: map["sender_name"],
      content: map["content"],
      timestamp: map["timestamp"]
    }
  end

  defp escape_xml(s) do
    s
    |> String.replace("&", "&amp;")
    |> String.replace("<", "&lt;")
    |> String.replace(">", "&gt;")
    |> String.replace("\"", "&quot;")
  end
end
