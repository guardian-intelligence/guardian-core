defmodule Guardian.Deploy.PlatformDeploy do
  @moduledoc """
  Platform (Phoenix) deploy orchestrator.

  Runs local tests → rsync → remote release build → restart → health check.
  """

  alias Guardian.Deploy.{Config, Logger}

  @doc """
  Deploy the Phoenix platform to the remote server.

  ## Options

    * `:shell` - shell function `(cmd, args, opts) -> {:ok, output} | {:error, {code, output}}`
      Defaults to `&Guardian.Deploy.Shell.run/3`.
  """
  @spec deploy(boolean(), keyword()) :: :ok | {:error, String.t(), String.t()}
  def deploy(dry_run, opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    remote = Config.remote()
    remote_dir = Config.remote_platform_dir()
    platform_dir = Config.platform_dir()

    Logger.plain("")
    Logger.plain("Deploy plan:")
    Logger.plain("  • Run local tests")
    Logger.plain("  • Rsync platform/ to #{remote}:#{remote_dir}/src/")
    Logger.plain("  • Build release on remote")
    Logger.plain("  • Restart #{Config.platform_service()}")
    Logger.plain("  • Verify health")
    Logger.plain("")

    if dry_run do
      Logger.warn("Dry run — nothing will be changed")
      :ok
    else
      with :ok <- run_local_tests(shell, platform_dir),
           :ok <- rsync(shell, platform_dir, remote, remote_dir),
           :ok <- build_remote(shell, remote, remote_dir),
           :ok <- restart_service(shell, remote),
           :ok <- health_check(shell, remote) do
        Logger.plain("")
        Logger.ok("Deploy complete!")
        :ok
      end
    end
  end

  defp run_local_tests(shell, platform_dir) do
    Logger.info("Running local tests...")

    case shell.("mix", ["test"], cd: platform_dir) do
      {:ok, _} ->
        Logger.ok("Tests passed")
        :ok

      {:error, {_code, output}} ->
        Logger.fail("Tests failed")
        {:error, "test", output}
    end
  end

  defp rsync(shell, platform_dir, remote, remote_dir) do
    Logger.info("Syncing platform/ to #{remote}:#{remote_dir}/src/...")

    args = [
      "-avz",
      "--delete",
      "--exclude",
      "_build",
      "--exclude",
      "deps",
      "--exclude",
      ".elixir_ls",
      "--exclude",
      "*.ez",
      "--exclude",
      ".env",
      "#{platform_dir}/",
      "#{remote}:#{remote_dir}/src/"
    ]

    case shell.("rsync", args, []) do
      {:ok, _} ->
        Logger.ok("Sync complete")
        :ok

      {:error, {_code, output}} ->
        Logger.fail("Rsync failed")
        {:error, "rsync", output}
    end
  end

  defp build_remote(shell, remote, remote_dir) do
    Logger.info("Building release on remote...")

    script = """
    set -euo pipefail
    cd #{remote_dir}/src
    mix local.hex --force --if-missing
    mix deps.get --only prod
    MIX_ENV=prod mix release --overwrite
    cp -r _build/prod/rel/guardian/* #{remote_dir}/
    """

    case shell.("ssh", [remote, script], []) do
      {:ok, _} ->
        Logger.ok("Release built")
        :ok

      {:error, {_code, output}} ->
        Logger.fail("Remote build failed")
        {:error, "build", output}
    end
  end

  defp restart_service(shell, remote) do
    Logger.info("Restarting service...")

    case shell.("ssh", [remote, "sudo systemctl restart #{Config.platform_service()}"], []) do
      {:ok, _} ->
        Logger.ok("Service restarted")
        :ok

      {:error, {_code, output}} ->
        Logger.fail("Service restart failed")
        {:error, "restart", output}
    end
  end

  defp health_check(shell, remote) do
    Process.sleep(3000)
    Logger.info("Verifying health...")

    case shell.("ssh", [remote, "curl -sf localhost:4000/health"], []) do
      {:ok, output} ->
        Logger.ok("Health check: #{output}")
        :ok

      {:error, {_code, output}} ->
        Logger.fail("Health check failed")
        {:error, "health", output}
    end
  end
end
