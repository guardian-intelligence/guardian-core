defmodule Guardian.Kernel.WhatsApp.Bridge do
  @moduledoc """
  GenServer supervising a thin Node.js WhatsApp bridge via Port.

  Protocol: JSON-over-stdio, line-delimited ({:line, 65536}).
  The bridge writes one JSON object per line to stdout.
  Commands are sent as one JSON line to the bridge's stdin.

  On port exit, reconnects with exponential backoff (1s, 2s, 4s... max 60s).
  """

  use GenServer
  require Logger

  alias Guardian.Kernel.Config
  alias Guardian.Kernel.State
  alias Guardian.Repo

  @max_backoff 60_000

  # --- Public API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  @doc "Send a WhatsApp text message."
  def send_message(jid, text, server \\ __MODULE__) do
    GenServer.call(server, {:send_message, jid, text})
  end

  @doc "Send typing presence indicator."
  def send_presence(jid, presence, server \\ __MODULE__) do
    GenServer.cast(server, {:send_presence, jid, presence})
  end

  @doc "Request group metadata fetch from WhatsApp."
  def fetch_groups(server \\ __MODULE__) do
    GenServer.cast(server, :fetch_groups)
  end

  # --- GenServer callbacks ---

  @impl true
  def init(opts) do
    state = %{
      port: nil,
      backoff: 1000,
      node_path: Keyword.get(opts, :node_path, find_node()),
      bridge_script: Keyword.get(opts, :bridge_script, bridge_script_path()),
      project_root: Keyword.get(opts, :project_root, Config.project_root()),
      auth_dir: Keyword.get(opts, :auth_dir, Config.auth_dir()),
      state_server: Keyword.get(opts, :state_server, State),
      # Callback for message storage — injected for testability
      on_message: Keyword.get(opts, :on_message, &default_on_message/1),
      on_connection: Keyword.get(opts, :on_connection, &default_on_connection/1),
      enabled: Keyword.get(opts, :enabled, true)
    }

    if state.enabled do
      send(self(), :connect)
    end

    {:ok, state}
  end

  @impl true
  def handle_call({:send_message, jid, text}, _from, %{port: port} = state) when port != nil do
    cmd = Jason.encode!(%{type: "send_message", jid: jid, text: text})
    Port.command(port, cmd <> "\n")
    {:reply, :ok, state}
  end

  def handle_call({:send_message, _jid, _text}, _from, state) do
    {:reply, {:error, :not_connected}, state}
  end

  @impl true
  def handle_cast({:send_presence, jid, presence}, %{port: port} = state) when port != nil do
    cmd = Jason.encode!(%{type: "send_presence", jid: jid, presence: presence})
    Port.command(port, cmd <> "\n")
    {:noreply, state}
  end

  def handle_cast({:send_presence, _jid, _presence}, state) do
    {:noreply, state}
  end

  def handle_cast(:fetch_groups, %{port: port} = state) when port != nil do
    cmd = Jason.encode!(%{type: "fetch_groups"})
    Port.command(port, cmd <> "\n")
    {:noreply, state}
  end

  def handle_cast(:fetch_groups, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info(:connect, state) do
    port = open_port(state)
    Logger.info("WhatsApp bridge started")
    {:noreply, %{state | port: port, backoff: 1000}}
  end

  def handle_info({port, {:data, {:eol, line}}}, %{port: port} = state) do
    handle_bridge_event(to_string(line), state)
    {:noreply, state}
  end

  def handle_info({port, {:data, {:noeol, _line}}}, %{port: port} = state) do
    # Partial line — shouldn't happen with {:line, 65536} but handle gracefully
    {:noreply, state}
  end

  def handle_info({port, {:exit_status, code}}, %{port: port} = state) do
    Logger.warning("WhatsApp bridge exited with code #{code}, reconnecting in #{state.backoff}ms")
    Process.send_after(self(), :connect, state.backoff)
    next_backoff = min(state.backoff * 2, @max_backoff)
    {:noreply, %{state | port: nil, backoff: next_backoff}}
  end

  def handle_info(_msg, state) do
    {:noreply, state}
  end

  @impl true
  def terminate(_reason, %{port: port}) when port != nil do
    Port.close(port)
  end

  def terminate(_reason, _state), do: :ok

  # --- Private ---

  defp open_port(state) do
    env =
      [
        {~c"WHATSAPP_AUTH_DIR", String.to_charlist(state.auth_dir)},
        {~c"LOG_LEVEL", ~c"warn"}
      ]

    Port.open({:spawn_executable, state.node_path}, [
      {:args, [state.bridge_script]},
      {:cd, state.project_root},
      {:env, env},
      {:line, 65536},
      :use_stdio,
      :exit_status
    ])
  end

  defp handle_bridge_event(line, state) do
    case Jason.decode(line) do
      {:ok, event} ->
        dispatch_event(event, state)

      {:error, _} ->
        Logger.debug("Bridge non-JSON output: #{String.slice(line, 0, 200)}")
    end
  end

  defp dispatch_event(%{"type" => "message"} = event, state) do
    state.on_message.(event)
  end

  defp dispatch_event(%{"type" => "connection"} = event, state) do
    status = event["status"]
    Logger.info("WhatsApp connection: #{status}")
    state.on_connection.(event)

    if status == "open" do
      # Fetch groups after connection
      if state.port, do: fetch_groups(self())
    end
  end

  defp dispatch_event(%{"type" => "contacts_update", "lid" => lid, "phone" => phone}, state) do
    State.put_lid_mapping(lid, phone, state.state_server)
    Logger.debug("LID mapping: #{lid} -> #{phone}")
  end

  defp dispatch_event(%{"type" => "groups", "groups" => groups}, _state) do
    for {jid, %{"subject" => subject}} <- groups do
      try do
        Repo.insert!(
          %Repo.Chat{jid: jid, name: subject, last_message_time: DateTime.utc_now() |> DateTime.to_iso8601()},
          on_conflict: [set: [name: subject]],
          conflict_target: :jid
        )
      rescue
        _ -> :ok
      end
    end

    Logger.info("Group metadata synced: #{map_size(groups)} groups")
  end

  defp dispatch_event(%{"type" => "creds_update"}, _state) do
    Logger.debug("WhatsApp credentials updated")
  end

  defp dispatch_event(event, _state) do
    Logger.debug("Unknown bridge event: #{inspect(event["type"])}")
  end

  defp default_on_message(event) do
    key = event["key"] || %{}
    jid = key["remoteJid"]
    msg = event["message"] || %{}

    if jid do
      # Translate LID JID
      translated_jid = State.translate_jid(jid)
      timestamp_epoch = event["messageTimestamp"]

      timestamp =
        if is_integer(timestamp_epoch) or is_binary(timestamp_epoch) do
          epoch = if is_binary(timestamp_epoch), do: String.to_integer(timestamp_epoch), else: timestamp_epoch
          DateTime.from_unix!(epoch) |> DateTime.to_iso8601()
        else
          DateTime.utc_now() |> DateTime.to_iso8601()
        end

      # Store chat metadata
      try do
        Repo.insert!(
          %Repo.Chat{jid: translated_jid, name: translated_jid, last_message_time: timestamp},
          on_conflict: [set: [last_message_time: timestamp]],
          conflict_target: :jid
        )
      rescue
        _ -> :ok
      end

      # Store message if group is registered
      registered = State.get_registered_groups()

      if Map.has_key?(registered, translated_jid) do
        content =
          msg["conversation"] ||
            get_in(msg, ["extendedTextMessage", "text"]) ||
            get_in(msg, ["imageMessage", "caption"]) ||
            get_in(msg, ["videoMessage", "caption"]) ||
            ""

        sender = key["participant"] || key["remoteJid"] || ""
        push_name = event["pushName"] || String.split(sender, "@") |> hd()
        msg_id = key["id"] || ""
        is_from_me = if key["fromMe"], do: 1, else: 0

        try do
          Ecto.Adapters.SQL.query!(Repo,
            "INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [msg_id, translated_jid, sender, push_name, content, timestamp, is_from_me]
          )
        rescue
          e -> Logger.error("Failed to store message: #{inspect(e)}")
        end
      end
    end
  end

  defp default_on_connection(_event), do: :ok

  defp find_node do
    System.find_executable("node") || "/usr/local/bin/node"
  end

  defp bridge_script_path do
    Path.join([Config.project_root(), "container", "whatsapp-bridge", "index.js"])
  end
end
