defmodule Guardian.Kernel.StateTest do
  use ExUnit.Case, async: true

  alias Guardian.Kernel.State

  defmodule TestConfig do
    def registered_groups_path, do: "/fake/registered_groups.json"
    def sessions_path, do: "/fake/sessions.json"
    def router_state_path, do: "/fake/router_state.json"
    def group_dir(folder), do: "/fake/groups/#{folder}"
  end

  setup do
    # Track writes in an Agent
    {:ok, writes} = Agent.start_link(fn -> %{} end)

    write_file = fn path, content ->
      Agent.update(writes, fn state -> Map.put(state, path, content) end)
    end

    read_file = fn _path -> {:error, :enoent} end
    mkdir_p = fn _path -> :ok end

    name = :"state_#{System.unique_integer([:positive])}"

    {:ok, pid} =
      State.start_link(
        name: name,
        config_mod: TestConfig,
        read_file: read_file,
        write_file: write_file,
        mkdir_p: mkdir_p
      )

    %{pid: pid, name: name, writes: writes}
  end

  test "starts with empty state when files don't exist", %{name: name} do
    assert State.get_registered_groups(name) == %{}
    assert State.get_sessions(name) == %{}

    router = State.get_router_state(name)
    assert router["last_timestamp"] == ""
    assert router["last_message_id"] == ""
  end

  test "register_group stores group and writes immediately", %{name: name, writes: writes} do
    group = %{"name" => "Test Group", "folder" => "test-group"}
    :ok = State.register_group("123@g.us", group, name)

    groups = State.get_registered_groups(name)
    assert Map.has_key?(groups, "123@g.us")
    assert groups["123@g.us"]["name"] == "Test Group"

    # Should have written to file immediately
    written = Agent.get(writes, fn s -> s end)
    assert Map.has_key?(written, "/fake/registered_groups.json")
  end

  test "set_session and get_sessions", %{name: name} do
    State.set_session("main", "session-123", name)
    # Give cast time to process
    _ = State.get_sessions(name)
    sessions = State.get_sessions(name)
    assert sessions["main"] == "session-123"
  end

  test "update_router_state and get_router_state", %{name: name} do
    State.update_router_state("2024-01-01T00:00:00.000Z", "msg-123", name)
    # Give cast time to process
    _ = State.get_router_state(name)
    router = State.get_router_state(name)
    assert router["last_timestamp"] == "2024-01-01T00:00:00.000Z"
    assert router["last_message_id"] == "msg-123"
  end

  test "set/get last_agent_timestamp", %{name: name} do
    State.set_last_agent_timestamp("main", "2024-01-01T00:00:00.000Z", name)
    # Give cast time to process
    _ = State.get_last_agent_timestamp("main", name)
    ts = State.get_last_agent_timestamp("main", name)
    assert ts == "2024-01-01T00:00:00.000Z"
  end

  test "get_last_agent_timestamp returns empty string for unknown group", %{name: name} do
    assert State.get_last_agent_timestamp("unknown", name) == ""
  end

  test "put_lid_mapping and translate_jid", %{name: name} do
    State.put_lid_mapping("12345", "1234567890@s.whatsapp.net", name)
    # Give cast time to process
    _ = State.translate_jid("12345@lid", name)
    assert State.translate_jid("12345@lid", name) == "1234567890@s.whatsapp.net"
  end

  test "translate_jid passes through non-LID JIDs", %{name: name} do
    assert State.translate_jid("1234567890@s.whatsapp.net", name) == "1234567890@s.whatsapp.net"
  end

  test "translate_jid returns original when no mapping exists", %{name: name} do
    assert State.translate_jid("99999@lid", name) == "99999@lid"
  end

  test "flush writes state files", %{name: name, writes: writes} do
    State.update_router_state("ts-1", "msg-1", name)
    State.set_session("main", "sess-1", name)
    # Wait for casts
    _ = State.get_router_state(name)

    :ok = State.flush(name)

    written = Agent.get(writes, fn s -> s end)
    assert Map.has_key?(written, "/fake/router_state.json")
    assert Map.has_key?(written, "/fake/sessions.json")

    router_data = Jason.decode!(written["/fake/router_state.json"])
    assert router_data["last_timestamp"] == "ts-1"
    assert router_data["last_message_id"] == "msg-1"
  end

  test "loads state from existing JSON files" do
    name = :"state_load_#{System.unique_integer([:positive])}"

    read_file = fn
      "/fake/registered_groups.json" ->
        {:ok, Jason.encode!(%{"abc@g.us" => %{"name" => "ABC", "folder" => "abc"}})}

      "/fake/sessions.json" ->
        {:ok, Jason.encode!(%{"main" => "old-session"})}

      "/fake/router_state.json" ->
        {:ok,
         Jason.encode!(%{
           "last_timestamp" => "2024-06-01T00:00:00.000Z",
           "last_message_id" => "old-msg",
           "last_agent_timestamp" => %{"main" => "2024-06-01T00:00:00.000Z"}
         })}

      _ ->
        {:error, :enoent}
    end

    {:ok, _pid} =
      State.start_link(
        name: name,
        config_mod: TestConfig,
        read_file: read_file,
        write_file: fn _, _ -> :ok end,
        mkdir_p: fn _ -> :ok end
      )

    groups = State.get_registered_groups(name)
    assert groups["abc@g.us"]["name"] == "ABC"

    sessions = State.get_sessions(name)
    assert sessions["main"] == "old-session"

    router = State.get_router_state(name)
    assert router["last_timestamp"] == "2024-06-01T00:00:00.000Z"
    assert router["last_message_id"] == "old-msg"

    assert State.get_last_agent_timestamp("main", name) == "2024-06-01T00:00:00.000Z"
  end
end
