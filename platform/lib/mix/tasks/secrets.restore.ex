defmodule Mix.Tasks.Secrets.Restore do
  @moduledoc "Decrypt age archives to local .env files."
  @shortdoc "Restore secrets (age decrypt)"

  use Mix.Task

  @impl Mix.Task
  def run(args) do
    dry_run = "--dry-run" in args

    case Guardian.Deploy.Secrets.restore(dry_run) do
      :ok -> :ok
      {:error, stage, msg} ->
        Mix.shell().error("Restore failed at #{stage}: #{msg}")
        exit({:shutdown, 1})
    end
  end
end
