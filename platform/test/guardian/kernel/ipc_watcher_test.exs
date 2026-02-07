defmodule Guardian.Kernel.IpcWatcherTest do
  use ExUnit.Case, async: true

  alias Guardian.Kernel.IpcWatcher

  @tmp_dir System.tmp_dir!()

  setup do
    test_dir = Path.join(@tmp_dir, "ipc_watcher_test_#{System.unique_integer([:positive])}")
    File.mkdir_p!(test_dir)

    # Create IPC directory structure
    ipc_base = Path.join(test_dir, "ipc")
    File.mkdir_p!(Path.join([ipc_base, "main", "messages"]))
    File.mkdir_p!(Path.join([ipc_base, "main", "tasks"]))
    File.mkdir_p!(Path.join([ipc_base, "other", "messages"]))
    File.mkdir_p!(Path.join([ipc_base, "other", "tasks"]))

    # Track callbacks
    {:ok, sent} = Agent.start_link(fn -> [] end)
    {:ok, tasks_processed} = Agent.start_link(fn -> [] end)

    on_exit(fn -> File.rm_rf!(test_dir) end)

    %{
      test_dir: test_dir,
      ipc_base: ipc_base,
      sent: sent,
      tasks_processed: tasks_processed
    }
  end

  defp start_watcher(ctx, extra_opts \\ []) do
    name = :"ipc_watcher_#{System.unique_integer([:positive])}"

    default_opts = [
      name: name,
      data_dir: ctx.test_dir,
      main_group_folder: "main",
      poll_interval: 100_000,
      send_message_fn: fn jid, text ->
        Agent.update(ctx.sent, fn list -> [{jid, text} | list] end)
        :ok
      end,
      process_task_fn: fn data, source, is_main ->
        Agent.update(ctx.tasks_processed, fn list -> [{data, source, is_main} | list] end)
        :ok
      end,
      get_registered_groups_fn: fn ->
        %{
          "123@g.us" => %{"folder" => "main", "name" => "Main"},
          "456@g.us" => %{"folder" => "other", "name" => "Other"}
        }
      end
    ]

    opts = Keyword.merge(default_opts, extra_opts)
    {:ok, pid} = IpcWatcher.start_link(opts)

    %{pid: pid, name: name}
  end

  test "processes IPC message files from main group", ctx do
    # Write a message IPC file
    msg = %{
      "type" => "message",
      "chatJid" => "456@g.us",
      "text" => "hello from agent",
      "groupFolder" => "main"
    }

    msg_path = Path.join([ctx.ipc_base, "main", "messages", "msg1.json"])
    File.write!(msg_path, Jason.encode!(msg))

    watcher = start_watcher(ctx)

    # Trigger a poll manually
    send(watcher.pid, :poll)
    Process.sleep(50)

    # Message should have been sent
    sent = Agent.get(ctx.sent, & &1)
    assert length(sent) == 1
    {jid, text} = hd(sent)
    assert jid == "456@g.us"
    assert text =~ "hello from agent"

    # File should be deleted
    refute File.exists?(msg_path)
  end

  test "blocks unauthorized IPC message from non-main group", ctx do
    # Non-main group trying to send to a JID it doesn't own
    msg = %{
      "type" => "message",
      "chatJid" => "123@g.us",
      "text" => "hack attempt",
      "groupFolder" => "other"
    }

    msg_path = Path.join([ctx.ipc_base, "other", "messages", "msg1.json"])
    File.write!(msg_path, Jason.encode!(msg))

    watcher = start_watcher(ctx)
    send(watcher.pid, :poll)
    Process.sleep(50)

    # Message should NOT have been sent
    sent = Agent.get(ctx.sent, & &1)
    assert sent == []

    # File should still be deleted (processed, just not authorized)
    refute File.exists?(msg_path)
  end

  test "allows non-main group to send to its own JID", ctx do
    msg = %{
      "type" => "message",
      "chatJid" => "456@g.us",
      "text" => "self message",
      "groupFolder" => "other"
    }

    msg_path = Path.join([ctx.ipc_base, "other", "messages", "msg1.json"])
    File.write!(msg_path, Jason.encode!(msg))

    watcher = start_watcher(ctx)
    send(watcher.pid, :poll)
    Process.sleep(50)

    sent = Agent.get(ctx.sent, & &1)
    assert length(sent) == 1
    {jid, _text} = hd(sent)
    assert jid == "456@g.us"
  end

  test "processes IPC task files", ctx do
    task = %{
      "type" => "schedule_task",
      "prompt" => "do something",
      "schedule_type" => "once",
      "schedule_value" => "2030-01-01T00:00:00Z",
      "groupFolder" => "main"
    }

    task_path = Path.join([ctx.ipc_base, "main", "tasks", "task1.json"])
    File.write!(task_path, Jason.encode!(task))

    watcher = start_watcher(ctx)
    send(watcher.pid, :poll)
    Process.sleep(50)

    processed = Agent.get(ctx.tasks_processed, & &1)
    assert length(processed) == 1
    {data, source, is_main} = hd(processed)
    assert data["type"] == "schedule_task"
    assert source == "main"
    assert is_main == true

    refute File.exists?(task_path)
  end

  test "moves malformed JSON to errors directory", ctx do
    bad_path = Path.join([ctx.ipc_base, "main", "messages", "bad.json"])
    File.write!(bad_path, "not valid json {{{")

    watcher = start_watcher(ctx)
    send(watcher.pid, :poll)
    Process.sleep(50)

    refute File.exists?(bad_path)
    error_path = Path.join([ctx.ipc_base, "errors", "main-bad.json"])
    assert File.exists?(error_path)
  end

  test "ignores non-JSON files", ctx do
    txt_path = Path.join([ctx.ipc_base, "main", "messages", "readme.txt"])
    File.write!(txt_path, "not a message")

    watcher = start_watcher(ctx)
    send(watcher.pid, :poll)
    Process.sleep(50)

    # txt file should still exist (not processed)
    assert File.exists?(txt_path)
    sent = Agent.get(ctx.sent, & &1)
    assert sent == []
  end
end
