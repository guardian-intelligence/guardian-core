defmodule Guardian.Deploy.Test.StubPlatform do
  @moduledoc false
  @behaviour Guardian.Deploy.PlatformService

  # Uses process dictionary to store the log agent PID,
  # set by the test before calling deploy.

  @impl true
  def install_service_template(_opts) do
    log = Process.get(:stub_platform_log)
    if log, do: Agent.update(log, fn entries -> [:install_service_template | entries] end)
    :ok
  end

  @impl true
  def restart_service(_opts) do
    log = Process.get(:stub_platform_log)
    if log, do: Agent.update(log, fn entries -> [:restart_service | entries] end)
    :ok
  end

  @impl true
  def verify_service(_opts) do
    log = Process.get(:stub_platform_log)
    if log, do: Agent.update(log, fn entries -> [:verify_service | entries] end)
    :ok
  end
end
