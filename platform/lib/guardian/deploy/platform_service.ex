defmodule Guardian.Deploy.PlatformService do
  @moduledoc """
  Behaviour for OS service management (launchd on macOS, systemd on Linux).
  """

  @callback install_service_template(keyword()) :: :ok | {:error, String.t(), String.t()}
  @callback restart_service(keyword()) :: :ok | {:error, String.t(), String.t()}
  @callback verify_service(keyword()) :: :ok | {:error, String.t(), String.t()}

  @doc "Return the platform module for the current OS."
  @spec impl() :: module()
  def impl do
    case :os.type() do
      {:unix, :darwin} -> Guardian.Deploy.Platform.Darwin
      {:unix, :linux} -> Guardian.Deploy.Platform.Linux
      other -> raise "Unsupported platform: #{inspect(other)}"
    end
  end
end
