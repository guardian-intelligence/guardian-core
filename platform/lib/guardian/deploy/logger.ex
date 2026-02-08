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
end
