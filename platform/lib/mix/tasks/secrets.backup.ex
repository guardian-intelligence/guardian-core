defmodule Mix.Tasks.Secrets.Backup do
  @moduledoc "Encrypt .env files to age archives."
  @shortdoc "Backup secrets (age encrypt)"

  use Mix.Task

  @impl Mix.Task
  def run(args) do
    dry_run = "--dry-run" in args

    case Guardian.Deploy.Secrets.backup(dry_run) do
      :ok -> :ok
      {:error, stage, msg} ->
        Mix.shell().error("Backup failed at #{stage}: #{msg}")
        exit({:shutdown, 1})
    end
  end
end
