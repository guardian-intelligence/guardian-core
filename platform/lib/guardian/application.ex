defmodule Guardian.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    kernel_enabled = Application.get_env(:guardian, :kernel_enabled, false)

    children =
      [
        GuardianWeb.Telemetry,
        {DNSCluster, query: Application.get_env(:guardian, :dns_cluster_query) || :ignore},
        {Phoenix.PubSub, name: Guardian.PubSub},
        # SQLite database
        Guardian.Repo,
        # GitHub App token cache (Agent-based)
        Guardian.GitHub,
        # Kernel supervisor (WhatsApp, scheduling, IPC, containers)
        if(kernel_enabled, do: {Guardian.Kernel.Supervisor, enabled: true}),
        # Start to serve requests, typically the last entry
        GuardianWeb.Endpoint
      ]
      |> Enum.reject(&is_nil/1)

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Guardian.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    GuardianWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
