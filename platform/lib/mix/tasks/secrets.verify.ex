defmodule Mix.Tasks.Secrets.Verify do
  @moduledoc "Verify remote secrets state (file perms, services, health)."
  @shortdoc "Verify remote secrets"

  use Mix.Task

  @impl Mix.Task
  def run(_args) do
    case Guardian.Deploy.Secrets.verify() do
      :ok -> :ok
      {:error, stage, msg} ->
        Mix.shell().error("Verify failed at #{stage}: #{msg}")
        exit({:shutdown, 1})
    end
  end
end
