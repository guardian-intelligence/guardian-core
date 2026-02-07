defmodule Mix.Tasks.Secrets.Deploy do
  @moduledoc "Deploy secrets to remote server (decrypt + SCP + SSH install + restart)."
  @shortdoc "Deploy secrets to VPS"

  use Mix.Task

  @impl Mix.Task
  def run(args) do
    dry_run = "--dry-run" in args

    case Guardian.Deploy.Secrets.deploy_secrets(dry_run) do
      :ok -> :ok
      {:error, stage, msg} ->
        Mix.shell().error("Deploy failed at #{stage}: #{msg}")
        exit({:shutdown, 1})
    end
  end
end
