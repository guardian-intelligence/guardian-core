defmodule Guardian.Deploy.TemplateCommit do
  @moduledoc """
  Auto-commit template changes (BCP for Rumi's memory files).

  Checks template files for git changes, stages and commits with timestamp.
  Runs on a schedule via systemd timer or mix task.
  """

  alias Guardian.Deploy.{Config, Logger}

  @doc """
  Check for template changes and commit if any found.

  Returns:
  - `:ok` — changes committed
  - `{:noop, reason}` — nothing to do
  - `{:error, stage, message}` — failure

  ## Options

    * `:shell` - shell function. Defaults to `&Guardian.Deploy.Shell.run/3`.
  """
  @spec run(keyword()) :: :ok | {:noop, String.t()} | {:error, String.t(), String.t()}
  def run(opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    root = Config.project_root()

    case check_for_changes(shell, root) do
      {:ok, []} ->
        Logger.info("No template changes to commit")
        {:noop, "no changes"}

      {:ok, changed} ->
        Logger.info("Found #{length(changed)} changed template(s): #{Enum.join(changed, ", ")}")

        with :ok <- stage_files(shell, changed, root),
             :ok <- commit_snapshot(shell, root) do
          Logger.ok("Template snapshot committed")
          :ok
        end

      {:error, stage, msg} ->
        {:error, stage, msg}
    end
  end

  defp check_for_changes(shell, root) do
    paths = Config.template_paths()

    changed =
      Enum.filter(paths, fn path ->
        full_path = Path.join(root, path)

        if File.exists?(full_path) do
          has_changes?(shell, path, root)
        else
          false
        end
      end)

    {:ok, changed}
  rescue
    e -> {:error, "check", "Failed to check for changes: #{inspect(e)}"}
  end

  defp has_changes?(shell, path, root) do
    # Check if file has uncommitted changes
    case shell.("git", ["diff", "--quiet", "--", path], cd: root) do
      {:ok, _} ->
        # No diff — check if untracked
        case shell.("git", ["ls-files", "--error-unmatch", path], cd: root) do
          {:ok, _} -> false
          {:error, _} -> true
        end

      {:error, _} ->
        # diff --quiet failed → file has changes
        true
    end
  end

  defp stage_files(shell, paths, root) do
    Enum.reduce_while(paths, :ok, fn path, :ok ->
      case shell.("git", ["add", path], cd: root) do
        {:ok, _} -> {:cont, :ok}
        {:error, {_code, output}} -> {:halt, {:error, "stage", "Failed to stage #{path}: #{output}"}}
      end
    end)
  end

  defp commit_snapshot(shell, root) do
    timestamp =
      DateTime.utc_now()
      |> DateTime.to_iso8601()
      |> String.replace("T", " ")
      |> String.slice(0, 16)

    message = "auto: template snapshot #{timestamp}"

    case shell.("git", ["commit", "-m", message, "--no-verify"], cd: root) do
      {:ok, _} -> :ok
      {:error, {_code, output}} -> {:error, "commit", "Failed to commit: #{output}"}
    end
  end
end
