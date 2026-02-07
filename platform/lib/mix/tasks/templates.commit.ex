defmodule Mix.Tasks.Templates.Commit do
  @moduledoc "Auto-commit template file changes."
  @shortdoc "Commit template snapshots"

  use Mix.Task

  @impl Mix.Task
  def run(_args) do
    case Guardian.Deploy.TemplateCommit.run() do
      :ok ->
        :ok

      {:noop, reason} ->
        Mix.shell().info("Nothing to do: #{reason}")

      {:error, stage, message} ->
        Mix.shell().error("Template commit failed at #{stage}: #{message}")
        exit({:shutdown, 1})
    end
  end
end
