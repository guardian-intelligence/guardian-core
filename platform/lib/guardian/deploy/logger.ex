defmodule Guardian.Deploy.Logger do
  @moduledoc """
  ANSI console logging + JSONL file session for deploy tasks.
  """

  # ANSI codes
  @blue "\e[34m"
  @green "\e[32m"
  @yellow "\e[33m"
  @red "\e[31m"
  @nc "\e[0m"

  @doc "Print an info message with blue arrow prefix."
  @spec info(String.t()) :: :ok
  def info(msg), do: IO.puts("#{@blue}→#{@nc} #{msg}")

  @doc "Print a success message with green checkmark prefix."
  @spec ok(String.t()) :: :ok
  def ok(msg), do: IO.puts("#{@green}✓#{@nc} #{msg}")

  @doc "Print a warning message with yellow exclamation prefix."
  @spec warn(String.t()) :: :ok
  def warn(msg), do: IO.puts("#{@yellow}!#{@nc} #{msg}")

  @doc "Print a failure message with red X prefix."
  @spec fail(String.t()) :: :ok
  def fail(msg), do: IO.puts("#{@red}✗#{@nc} #{msg}")

  @doc "Print a plain message (no icon)."
  @spec plain(String.t()) :: :ok
  def plain(msg), do: IO.puts(msg)

  # --- JSONL session ---

  @doc """
  Start a JSONL log session. Returns `{:ok, pid}` for the file device,
  or `:error` if the log directory can't be created.
  """
  @spec start_session(String.t()) :: {:ok, pid()} | :error
  def start_session(target) do
    log_dir = Guardian.Deploy.Config.log_dir()
    File.mkdir_p!(log_dir)
    prune_old_logs(log_dir, 20)

    timestamp = DateTime.utc_now() |> DateTime.to_iso8601() |> String.replace(~r/[:.]/u, "-")
    filename = "#{target}-#{timestamp}.jsonl"
    filepath = Path.join(log_dir, filename)

    case File.open(filepath, [:write, :utf8]) do
      {:ok, fd} ->
        latest = Path.join(log_dir, "#{target}-latest.jsonl")
        File.rm(latest)
        File.ln_s(filename, latest)
        {:ok, fd}

      _ ->
        :error
    end
  end

  @doc "Write a JSONL entry to the log session."
  @spec write_entry(pid(), String.t(), String.t(), map()) :: :ok
  def write_entry(fd, level, message, extra \\ %{}) do
    entry =
      %{
        timestamp: DateTime.utc_now() |> DateTime.to_iso8601(),
        level: level,
        message: message
      }
      |> Map.merge(extra)

    IO.write(fd, Jason.encode!(entry) <> "\n")
  end

  @doc "Close a JSONL log session."
  @spec stop_session(pid()) :: :ok
  def stop_session(fd), do: File.close(fd)

  defp prune_old_logs(dir, keep) do
    case File.ls(dir) do
      {:ok, files} ->
        jsonl_files =
          files
          |> Enum.filter(&(String.ends_with?(&1, ".jsonl") and not String.contains?(&1, "-latest")))
          |> Enum.sort()

        to_remove = Enum.slice(jsonl_files, 0, max(length(jsonl_files) - keep, 0))
        Enum.each(to_remove, &File.rm(Path.join(dir, &1)))

      _ ->
        :ok
    end
  end
end
