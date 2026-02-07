defmodule Guardian.Deploy.Shell do
  @moduledoc """
  Shell execution wrapper for deploy tasks.

  Live implementation delegates to `System.cmd/3`. Tests inject a recording
  closure via the `:shell` option on every service function.
  """

  @type shell_fn :: (String.t(), [String.t()], keyword() -> shell_result())
  @type shell_result :: {:ok, String.t()} | {:error, {non_neg_integer(), String.t()}}

  @doc """
  Run a command via `System.cmd/3`. Returns `{:ok, output}` on exit 0,
  `{:error, {code, output}}` otherwise.
  """
  @spec run(String.t(), [String.t()], keyword()) :: shell_result()
  def run(cmd, args, opts \\ []) do
    cd = Keyword.get(opts, :cd, Guardian.Deploy.Config.project_root())
    env = Keyword.get(opts, :env, [])

    try do
      {output, code} = System.cmd(cmd, args, cd: cd, env: env, stderr_to_stdout: true)

      case code do
        0 -> {:ok, String.trim(output)}
        _ -> {:error, {code, String.trim(output)}}
      end
    rescue
      e in ErlangError ->
        {:error, {1, "Command not found or failed to execute: #{cmd} — #{inspect(e)}"}}
    end
  end
end
