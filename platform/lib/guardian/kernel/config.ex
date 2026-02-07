defmodule Guardian.Kernel.Config do
  @moduledoc """
  Centralizes all kernel paths and configuration.
  Reads from Application env and system env.
  All paths match the TypeScript AppConfig.ts exactly.
  """

  def project_root do
    Application.get_env(:guardian, :project_root, File.cwd!())
  end

  def store_dir, do: Path.join(project_root(), "store")
  def data_dir, do: Path.join(project_root(), "data")
  def groups_dir, do: Path.join(project_root(), "groups")
  def db_path, do: Path.join(store_dir(), "messages.db")
  def auth_dir, do: Path.join(store_dir(), "auth")
  def log_path, do: Path.join(project_root(), "logs/guardian-core.log")

  def mount_allowlist_path do
    Path.join(System.user_home!(), ".config/guardian-core/mount-allowlist.json")
  end

  def phone_contacts_path do
    Path.join(System.user_home!(), ".config/guardian-core/phone-contacts.json")
  end

  def assistant_name, do: System.get_env("ASSISTANT_NAME", "Andy")
  def container_image, do: System.get_env("CONTAINER_IMAGE", "guardian-core-agent:latest")

  def container_timeout do
    System.get_env("CONTAINER_TIMEOUT", "300000") |> String.to_integer()
  end

  def container_max_output_size do
    System.get_env("CONTAINER_MAX_OUTPUT_SIZE", "10485760") |> String.to_integer()
  end

  def main_group_folder, do: "main"
  def poll_interval, do: 2000
  def scheduler_poll_interval, do: 60_000
  def ipc_poll_interval, do: 1000

  def timezone, do: System.get_env("TZ", "America/New_York")

  def trigger_pattern do
    escaped = Regex.escape(assistant_name())
    Regex.compile!("^@#{escaped}\\b", "i")
  end

  # Router state paths
  def router_state_path, do: Path.join(data_dir(), "router_state.json")
  def sessions_path, do: Path.join(data_dir(), "sessions.json")
  def registered_groups_path, do: Path.join(data_dir(), "registered_groups.json")

  # IPC paths for a group
  def ipc_messages_dir(folder), do: Path.join([groups_dir(), folder, "ipc", "messages"])
  def ipc_tasks_dir(folder), do: Path.join([groups_dir(), folder, "ipc", "tasks"])

  # Group directory
  def group_dir(folder), do: Path.join(groups_dir(), folder)
end
