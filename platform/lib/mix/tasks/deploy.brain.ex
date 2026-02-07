defmodule Mix.Tasks.Deploy.Brain do
  @moduledoc "Deploy Guardian Core brain (TypeScript kernel + container)."
  @shortdoc "Deploy brain (Guardian Core) locally"

  use Mix.Task

  @impl Mix.Task
  def run(args) do
    dry_run = "--dry-run" in args

    mode =
      cond do
        "--all" in args -> :all
        "--app" in args -> :app
        "--container" in args -> :container
        true -> :smart
      end

    case Guardian.Deploy.Brain.deploy(mode, dry_run) do
      :ok ->
        :ok

      {:error, stage, message} ->
        Mix.shell().error("Deploy failed at #{stage}: #{message}")
        exit({:shutdown, 1})
    end
  end
end
