defmodule Mix.Tasks.Deploy.Platform do
  @moduledoc "Deploy the Phoenix platform to the remote server."
  @shortdoc "Deploy platform (Phoenix) to rumi-vps"

  use Mix.Task

  @impl Mix.Task
  def run(args) do
    dry_run = "--dry-run" in args

    case Guardian.Deploy.PlatformDeploy.deploy(dry_run) do
      :ok ->
        :ok

      {:error, stage, message} ->
        Mix.shell().error("Deploy failed at #{stage}: #{message}")
        exit({:shutdown, 1})
    end
  end
end
