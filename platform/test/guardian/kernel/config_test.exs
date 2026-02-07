defmodule Guardian.Kernel.ConfigTest do
  use ExUnit.Case, async: true

  alias Guardian.Kernel.Config

  test "project_root returns a directory path" do
    root = Config.project_root()
    assert is_binary(root)
    assert root != ""
  end

  test "store_dir is under project_root" do
    assert Config.store_dir() == Path.join(Config.project_root(), "store")
  end

  test "data_dir is under project_root" do
    assert Config.data_dir() == Path.join(Config.project_root(), "data")
  end

  test "groups_dir is under project_root" do
    assert Config.groups_dir() == Path.join(Config.project_root(), "groups")
  end

  test "db_path is store/messages.db" do
    assert Config.db_path() == Path.join(Config.store_dir(), "messages.db")
  end

  test "auth_dir is store/auth" do
    assert Config.auth_dir() == Path.join(Config.store_dir(), "auth")
  end

  test "mount_allowlist_path is under ~/.config/guardian-core/" do
    path = Config.mount_allowlist_path()
    assert String.contains?(path, ".config/guardian-core/mount-allowlist.json")
  end

  test "phone_contacts_path is under ~/.config/guardian-core/" do
    path = Config.phone_contacts_path()
    assert String.contains?(path, ".config/guardian-core/phone-contacts.json")
  end

  test "assistant_name defaults to Andy" do
    assert Config.assistant_name() == "Andy"
  end

  test "main_group_folder is main" do
    assert Config.main_group_folder() == "main"
  end

  test "poll_interval is 2000" do
    assert Config.poll_interval() == 2000
  end

  test "scheduler_poll_interval is 60_000" do
    assert Config.scheduler_poll_interval() == 60_000
  end

  test "ipc_poll_interval is 1000" do
    assert Config.ipc_poll_interval() == 1000
  end

  test "container_timeout defaults to 300000" do
    assert Config.container_timeout() == 300_000
  end

  test "container_max_output_size defaults to 10MB" do
    assert Config.container_max_output_size() == 10_485_760
  end

  test "trigger_pattern matches @AssistantName" do
    pattern = Config.trigger_pattern()
    assert Regex.match?(pattern, "@Andy hello")
    assert Regex.match?(pattern, "@andy hello")
    refute Regex.match?(pattern, "hello @Andy")
    refute Regex.match?(pattern, "Andy hello")
  end

  test "router_state_path is data/router_state.json" do
    assert Config.router_state_path() == Path.join(Config.data_dir(), "router_state.json")
  end

  test "sessions_path is data/sessions.json" do
    assert Config.sessions_path() == Path.join(Config.data_dir(), "sessions.json")
  end

  test "registered_groups_path is data/registered_groups.json" do
    assert Config.registered_groups_path() == Path.join(Config.data_dir(), "registered_groups.json")
  end

  test "ipc_messages_dir includes group folder" do
    dir = Config.ipc_messages_dir("test-group")
    assert String.ends_with?(dir, "groups/test-group/ipc/messages")
  end

  test "ipc_tasks_dir includes group folder" do
    dir = Config.ipc_tasks_dir("test-group")
    assert String.ends_with?(dir, "groups/test-group/ipc/tasks")
  end

  test "group_dir includes folder" do
    dir = Config.group_dir("main")
    assert String.ends_with?(dir, "groups/main")
  end
end
