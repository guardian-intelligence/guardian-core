defmodule Guardian.Deploy.Config do
  @moduledoc """
  Path resolution, remote host, service names, and constants for deploy tasks.
  """

  @remote "rumi-server"
  @remote_root "/opt/guardian-core"
  @remote_platform_dir "/opt/guardian-platform"
  @core_service "guardian-core"
  @server_service "rumi-server"
  @platform_service "rumi-platform"

  @template_paths [
    "groups/main/SOUL.md",
    "groups/main/IDENTITY.md",
    "groups/main/USER.md",
    "groups/main/TOOLS.md",
    "groups/main/HEARTBEAT.md",
    "groups/main/BOOT.md",
    "groups/main/CLAUDE.md",
    "groups/main/VOICE_PROMPT.md",
    "groups/main/THREAT_MODEL.json",
    "groups/global/CLAUDE.md"
  ]

  # --- Path resolution ---

  @doc """
  Discover the project root by walking up from the platform directory
  to find the directory containing `package.json`.
  """
  @spec project_root() :: String.t()
  def project_root do
    # platform/ is one level below the project root
    Path.join(File.cwd!(), "..") |> Path.expand() |> find_root()
  end

  defp find_root(dir) do
    if File.exists?(Path.join(dir, "package.json")) do
      dir
    else
      parent = Path.dirname(dir)

      if parent == dir do
        # Fallback: cwd itself
        File.cwd!()
      else
        find_root(parent)
      end
    end
  end

  # --- Derived paths ---

  @spec config_dir() :: String.t()
  def config_dir do
    xdg = System.get_env("XDG_CONFIG_HOME")

    base =
      if xdg && xdg != "" do
        xdg
      else
        Path.join(System.user_home!(), ".config")
      end

    Path.join(base, "guardian")
  end

  @spec log_dir() :: String.t()
  def log_dir, do: Path.join(project_root(), "logs/deploy")

  @spec platform_dir() :: String.t()
  def platform_dir, do: Path.join(project_root(), "platform")

  # --- Systemd paths ---

  @spec systemd_unit_src() :: String.t()
  def systemd_unit_src, do: Path.join(project_root(), "infra/systemd/guardian-core.service")

  @spec systemd_unit_dst() :: String.t()
  def systemd_unit_dst,
    do: Path.join(System.user_home!(), ".config/systemd/user/guardian-core.service")

  # --- Constants ---

  def remote, do: @remote
  def remote_root, do: @remote_root
  def remote_platform_dir, do: @remote_platform_dir
  def core_service, do: @core_service
  def server_service, do: @server_service
  def platform_service, do: @platform_service
  def template_paths, do: @template_paths
end
