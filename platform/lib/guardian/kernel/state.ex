defmodule Guardian.Kernel.State do
  @moduledoc """
  GenServer holding in-memory kernel state with periodic JSON flush.

  Manages:
  - registered_groups — %{jid => map}
  - sessions — %{group_folder => session_id}
  - router_state — %{last_timestamp, last_message_id}
  - lid_to_phone_map — %{lid => phone}
  - last_agent_timestamp — %{group => timestamp}
  """

  use GenServer
  require Logger

  @flush_interval 30_000

  # --- Public API ---

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, __MODULE__))
  end

  def get_registered_groups(server \\ __MODULE__) do
    GenServer.call(server, :get_registered_groups)
  end

  def register_group(jid, group, server \\ __MODULE__) do
    GenServer.call(server, {:register_group, jid, group})
  end

  def get_sessions(server \\ __MODULE__) do
    GenServer.call(server, :get_sessions)
  end

  def set_session(group_folder, session_id, server \\ __MODULE__) do
    GenServer.cast(server, {:set_session, group_folder, session_id})
  end

  def get_router_state(server \\ __MODULE__) do
    GenServer.call(server, :get_router_state)
  end

  def update_router_state(last_timestamp, last_message_id, server \\ __MODULE__) do
    GenServer.cast(server, {:update_router_state, last_timestamp, last_message_id})
  end

  def get_last_agent_timestamp(group, server \\ __MODULE__) do
    GenServer.call(server, {:get_last_agent_timestamp, group})
  end

  def set_last_agent_timestamp(group, timestamp, server \\ __MODULE__) do
    GenServer.cast(server, {:set_last_agent_timestamp, group, timestamp})
  end

  def put_lid_mapping(lid, phone, server \\ __MODULE__) do
    GenServer.cast(server, {:put_lid_mapping, lid, phone})
  end

  def translate_jid(jid, server \\ __MODULE__) do
    GenServer.call(server, {:translate_jid, jid})
  end

  def flush(server \\ __MODULE__) do
    GenServer.call(server, :flush)
  end

  # --- GenServer callbacks ---

  @impl true
  def init(opts) do
    config_mod = Keyword.get(opts, :config_mod, Guardian.Kernel.Config)
    read_file = Keyword.get(opts, :read_file, &File.read/1)
    write_file = Keyword.get(opts, :write_file, &atomic_write/2)
    mkdir_p = Keyword.get(opts, :mkdir_p, &File.mkdir_p!/1)

    state = %{
      registered_groups: load_json(config_mod.registered_groups_path(), %{}, read_file),
      sessions: load_json(config_mod.sessions_path(), %{}, read_file),
      router_state: load_router_state(config_mod.router_state_path(), read_file),
      lid_to_phone_map: %{},
      last_agent_timestamp: %{},
      config_mod: config_mod,
      write_file: write_file,
      mkdir_p: mkdir_p,
      dirty: false
    }

    # Load last_agent_timestamp from router_state file
    state =
      case load_json(config_mod.router_state_path(), %{}, read_file) do
        %{"last_agent_timestamp" => lat} when is_map(lat) ->
          %{state | last_agent_timestamp: lat}

        _ ->
          state
      end

    schedule_flush()

    Logger.info("Kernel state loaded: #{map_size(state.registered_groups)} groups registered")

    {:ok, state}
  end

  @impl true
  def handle_call(:get_registered_groups, _from, state) do
    {:reply, state.registered_groups, state}
  end

  def handle_call({:register_group, jid, group}, _from, state) do
    groups = Map.put(state.registered_groups, jid, group)
    state = %{state | registered_groups: groups, dirty: true}

    # Write immediately for group registration (important state change)
    do_save_registered_groups(state)

    # Ensure group directory exists
    folder = group["folder"] || group[:folder]

    if folder do
      group_dir = state.config_mod.group_dir(folder)
      state.mkdir_p.(Path.join(group_dir, "logs"))
    end

    {:reply, :ok, state}
  end

  def handle_call(:get_sessions, _from, state) do
    {:reply, state.sessions, state}
  end

  def handle_call(:get_router_state, _from, state) do
    {:reply, state.router_state, state}
  end

  def handle_call({:get_last_agent_timestamp, group}, _from, state) do
    {:reply, Map.get(state.last_agent_timestamp, group, ""), state}
  end

  def handle_call({:translate_jid, jid}, _from, state) do
    if String.ends_with?(jid, "@lid") do
      lid_user = jid |> String.split("@") |> hd() |> String.split(":") |> hd()

      case Map.get(state.lid_to_phone_map, lid_user) do
        nil -> {:reply, jid, state}
        phone_jid -> {:reply, phone_jid, state}
      end
    else
      {:reply, jid, state}
    end
  end

  def handle_call(:flush, _from, state) do
    state = do_flush(state)
    {:reply, :ok, state}
  end

  @impl true
  def handle_cast({:set_session, group_folder, session_id}, state) do
    sessions = Map.put(state.sessions, group_folder, session_id)
    {:noreply, %{state | sessions: sessions, dirty: true}}
  end

  def handle_cast({:update_router_state, last_timestamp, last_message_id}, state) do
    router_state = %{
      "last_timestamp" => last_timestamp,
      "last_message_id" => last_message_id
    }

    {:noreply, %{state | router_state: router_state, dirty: true}}
  end

  def handle_cast({:set_last_agent_timestamp, group, timestamp}, state) do
    lat = Map.put(state.last_agent_timestamp, group, timestamp)
    {:noreply, %{state | last_agent_timestamp: lat, dirty: true}}
  end

  def handle_cast({:put_lid_mapping, lid, phone}, state) do
    lid_map = Map.put(state.lid_to_phone_map, lid, phone)
    {:noreply, %{state | lid_to_phone_map: lid_map}}
  end

  @impl true
  def handle_info(:flush, state) do
    state = do_flush(state)
    schedule_flush()
    {:noreply, state}
  end

  @impl true
  def terminate(_reason, state) do
    do_flush(state)
    :ok
  end

  # --- Private ---

  defp schedule_flush do
    Process.send_after(self(), :flush, @flush_interval)
  end

  defp do_flush(%{dirty: false} = state), do: state

  defp do_flush(state) do
    do_save_router_state(state)
    do_save_sessions(state)
    %{state | dirty: false}
  end

  defp do_save_router_state(state) do
    data =
      Map.merge(state.router_state, %{
        "last_agent_timestamp" => state.last_agent_timestamp
      })

    path = state.config_mod.router_state_path()
    state.mkdir_p.(Path.dirname(path))
    state.write_file.(path, Jason.encode!(data, pretty: true))
  end

  defp do_save_sessions(state) do
    path = state.config_mod.sessions_path()
    state.mkdir_p.(Path.dirname(path))
    state.write_file.(path, Jason.encode!(state.sessions, pretty: true))
  end

  defp do_save_registered_groups(state) do
    path = state.config_mod.registered_groups_path()
    state.mkdir_p.(Path.dirname(path))
    state.write_file.(path, Jason.encode!(state.registered_groups, pretty: true))
  end

  defp load_json(path, default, read_file) do
    case read_file.(path) do
      {:ok, content} ->
        case Jason.decode(content) do
          {:ok, data} -> data
          {:error, _} -> default
        end

      {:error, _} ->
        default
    end
  end

  defp load_router_state(path, read_file) do
    case load_json(path, %{}, read_file) do
      %{"last_timestamp" => ts} = data ->
        %{
          "last_timestamp" => ts,
          "last_message_id" => Map.get(data, "last_message_id", "")
        }

      _ ->
        %{"last_timestamp" => "", "last_message_id" => ""}
    end
  end

  defp atomic_write(path, content) do
    tmp = path <> ".tmp.#{System.unique_integer([:positive])}"
    File.write!(tmp, content)
    File.rename!(tmp, path)
  end
end
