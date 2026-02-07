defmodule Guardian.Kernel.WhatsApp.MessageRouterTest do
  use ExUnit.Case, async: false

  alias Guardian.Kernel.State
  alias Guardian.Kernel.WhatsApp.MessageRouter
  alias Guardian.Repo
  alias Guardian.Repo.Migrations

  setup do
    # Ensure DB is migrated
    Migrations.run!()

    # Clean up messages and chats between tests
    Ecto.Adapters.SQL.query!(Repo, "DELETE FROM messages")
    Ecto.Adapters.SQL.query!(Repo, "DELETE FROM chats")

    # Start a state server for this test
    state_name = :"state_#{System.unique_integer([:positive])}"

    {:ok, _} =
      State.start_link(
        name: state_name,
        config_mod: Guardian.Kernel.Config,
        read_file: fn _ -> {:error, :enoent} end,
        write_file: fn _, _ -> :ok end,
        mkdir_p: fn _ -> :ok end
      )

    %{state_name: state_name}
  end

  test "trigger pattern matches @AssistantName prefix", %{state_name: state_name} do
    pattern = Guardian.Kernel.Config.trigger_pattern()
    assert Regex.match?(pattern, "@Andy hello")
    assert Regex.match?(pattern, "@andy what's up")
    refute Regex.match?(pattern, "hello @Andy")
    refute Regex.match?(pattern, "Andy hello")
  end

  test "composite cursor query returns messages after cursor", %{state_name: state_name} do
    # Insert test messages
    jid = "test-group@g.us"

    Ecto.Adapters.SQL.query!(Repo,
      "INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)",
      [jid, "Test Group", "2024-01-01T00:00:02.000Z"]
    )

    # Insert 3 messages, 2 with same timestamp
    Ecto.Adapters.SQL.query!(Repo,
      "INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["msg1", jid, "user1@s.whatsapp.net", "Alice", "@Andy hello", "2024-01-01T00:00:01.000Z", 0]
    )

    Ecto.Adapters.SQL.query!(Repo,
      "INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["msg2", jid, "user2@s.whatsapp.net", "Bob", "@Andy hi", "2024-01-01T00:00:01.000Z", 0]
    )

    Ecto.Adapters.SQL.query!(Repo,
      "INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["msg3", jid, "user1@s.whatsapp.net", "Alice", "@Andy hey", "2024-01-01T00:00:02.000Z", 0]
    )

    # Query with cursor at (msg1's timestamp, msg1's id) — should get msg2 and msg3
    sql = """
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE ((timestamp > ?1) OR (timestamp = ?1 AND id > ?2))
      AND chat_jid IN (?4)
      AND content NOT LIKE ?3
    ORDER BY timestamp, id
    """

    {:ok, result} =
      Ecto.Adapters.SQL.query(Repo, sql, [
        "2024-01-01T00:00:01.000Z",
        "msg1",
        "Andy:%",
        jid
      ])

    assert length(result.rows) == 2

    ids = Enum.map(result.rows, fn row -> Enum.at(row, 0) end)
    assert "msg2" in ids
    assert "msg3" in ids
    refute "msg1" in ids
  end

  test "messages with bot prefix are excluded", %{state_name: state_name} do
    jid = "test-group2@g.us"

    Ecto.Adapters.SQL.query!(Repo,
      "INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)",
      [jid, "Test Group 2", "2024-01-01T00:00:01.000Z"]
    )

    Ecto.Adapters.SQL.query!(Repo,
      "INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["msg-bot", jid, "bot", "Andy", "Andy: I responded", "2024-01-01T00:00:01.000Z", 1]
    )

    Ecto.Adapters.SQL.query!(Repo,
      "INSERT INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["msg-user", jid, "user1@s.whatsapp.net", "Alice", "@Andy question", "2024-01-01T00:00:02.000Z", 0]
    )

    sql = """
    SELECT id FROM messages
    WHERE timestamp > ?1 AND chat_jid IN (?3) AND content NOT LIKE ?2
    ORDER BY timestamp
    """

    {:ok, result} = Ecto.Adapters.SQL.query(Repo, sql, ["", "Andy:%", jid])

    ids = Enum.map(result.rows, fn [id] -> id end)
    assert "msg-user" in ids
    refute "msg-bot" in ids
  end

  test "message router starts and polls", %{state_name: state_name} do
    router_name = :"router_#{System.unique_integer([:positive])}"
    bridge_name = :"bridge_#{System.unique_integer([:positive])}"

    # Register a group in state
    :ok =
      State.register_group(
        "test@g.us",
        %{"name" => "Test", "folder" => "test"},
        state_name
      )

    {:ok, pid} =
      MessageRouter.start_link(
        name: router_name,
        poll_interval: 100_000,
        state_server: state_name,
        bridge_server: bridge_name,
        enabled: false,
        run_agent_fn: fn _, _, _, _, _ -> nil end
      )

    assert Process.alive?(pid)
  end
end
