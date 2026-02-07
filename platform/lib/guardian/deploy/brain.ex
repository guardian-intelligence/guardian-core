defmodule Guardian.Deploy.Brain do
  @moduledoc """
  Brain deploy orchestrator — detects changes, runs pipeline, manages service.

  Modes:
  - `:smart` — git diff + mtime comparison to detect what changed
  - `:all` — full rebuild: deps → compile → test → release → container → service
  - `:app` — host app only: deps → compile → test → release → service
  - `:container` — container image only → service
  """

  alias Guardian.Deploy.{Config, Logger}

  @type mode :: :smart | :all | :app | :container

  @doc """
  Deploy Guardian Core brain.

  ## Options

    * `:shell` - shell function. Defaults to `&Guardian.Deploy.Shell.run/3`.
    * `:platform` - platform service module. Defaults to `Guardian.Deploy.PlatformService.impl()`.
  """
  @spec deploy(mode(), boolean(), keyword()) :: :ok | {:error, String.t(), String.t()}
  def deploy(mode, dry_run, opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    platform = Keyword.get(opts, :platform, Guardian.Deploy.PlatformService.impl())

    {need_app, need_container} = detect_changes(shell, mode)

    if not need_app and not need_container do
      Logger.ok("Nothing to deploy — everything is up to date")
      :ok
    else
      print_plan(need_app, need_container)

      if dry_run do
        Logger.warn("Dry run — nothing will be changed")
        :ok
      else
        run_pipeline(shell, platform, need_app, need_container, opts)
      end
    end
  end

  # --- Change detection ---

  defp detect_changes(_shell, :app), do: {true, false}
  defp detect_changes(_shell, :container), do: {false, true}
  defp detect_changes(_shell, :all), do: {true, true}

  defp detect_changes(shell, :smart) do
    Logger.info("Detecting changes...")

    diff_head =
      case shell.("git", ["diff", "--name-only", "HEAD"], []) do
        {:ok, output} -> output
        _ -> ""
      end

    diff_cached =
      case shell.("git", ["diff", "--name-only", "--cached"], []) do
        {:ok, output} -> output
        _ -> ""
      end

    all_changes =
      (String.split(diff_head, "\n") ++ String.split(diff_cached, "\n"))
      |> Enum.filter(&(&1 != ""))
      |> Enum.uniq()

    if all_changes == [] do
      detect_by_mtime(shell)
    else
      detect_by_diff(all_changes)
    end
  end

  defp detect_by_mtime(shell) do
    platform_root = Config.platform_dir()

    # Check if Elixir app needs rebuild by comparing _build to source
    need_app =
      build_beam = Path.join(platform_root, "_build/prod/lib/guardian/ebin")

      if File.exists?(build_beam) do
        %{mtime: build_mtime} = File.stat!(build_beam)
        build_mtime_unix = NaiveDateTime.diff(build_mtime, ~N[1970-01-01 00:00:00])

        find_elixir_files(platform_root)
        |> Enum.any?(fn f ->
          %{mtime: mtime} = File.stat!(f)
          NaiveDateTime.diff(mtime, ~N[1970-01-01 00:00:00]) > build_mtime_unix
        end)
      else
        true
      end

    need_container =
      case shell.("docker", ["images", "-q", "guardian-core-agent:latest"], []) do
        {:ok, output} -> String.trim(output) == ""
        _ -> true
      end

    {need_app, need_container}
  end

  defp detect_by_diff(changes) do
    app_pattern = ~r/^platform\/(lib|config|mix\.exs)/
    container_pattern = ~r/^container\//

    need_app = Enum.any?(changes, &Regex.match?(app_pattern, &1))

    need_container =
      Enum.any?(changes, &Regex.match?(container_pattern, &1)) or
        Enum.any?(changes, &(&1 == "package.json"))

    {need_app, need_container}
  end

  defp find_elixir_files(dir) do
    if File.exists?(dir) do
      Path.wildcard(Path.join(dir, "**/*.{ex,exs}"))
      |> Enum.reject(&String.contains?(&1, "_build"))
      |> Enum.reject(&String.contains?(&1, "deps"))
    else
      []
    end
  end

  # --- Plan display ---

  defp print_plan(need_app, need_container) do
    Logger.plain("")
    Logger.plain("Deploy plan:")

    if need_app do
      Logger.plain("  \u2022 Rebuild host app (mix deps.get \u2192 compile \u2192 test \u2192 release)")
    end

    if need_container do
      Logger.plain("  \u2022 Rebuild container image (docker build)")
    end

    Logger.plain("  \u2022 Restart service")
    Logger.plain("")
  end

  # --- Pipeline ---

  defp run_pipeline(shell, platform, need_app, need_container, opts) do
    with :ok <- maybe_install_deps(shell, need_app),
         :ok <- maybe_compile(shell, need_app),
         :ok <- maybe_test(shell, need_app),
         :ok <- maybe_build(shell, need_app),
         :ok <- maybe_build_container(shell, need_container),
         :ok <- platform.install_service_template(opts),
         :ok <- platform.restart_service(opts),
         :ok <- platform.verify_service(opts) do
      Logger.plain("")
      Logger.ok("Deploy complete")
      Logger.plain("  Logs: tail -f #{Config.project_root()}/logs/guardian-core.log")
      :ok
    end
  end

  defp maybe_install_deps(_shell, false), do: :ok

  defp maybe_install_deps(shell, true) do
    Logger.info("Installing dependencies...")

    case shell.("mix", ["deps.get"], cd: Config.platform_dir()) do
      {:ok, _} ->
        Logger.ok("Dependencies installed")
        :ok

      {:error, {_code, output}} ->
        Logger.fail("Install failed")
        {:error, "install", output}
    end
  end

  defp maybe_compile(_shell, false), do: :ok

  defp maybe_compile(shell, true) do
    Logger.info("Running compile...")

    case shell.("mix", ["compile", "--warnings-as-errors"], cd: Config.platform_dir()) do
      {:ok, _} ->
        Logger.ok("Compile passed")
        :ok

      {:error, {_code, output}} ->
        Logger.fail("Compile failed — fix errors before deploying")
        {:error, "compile", output}
    end
  end

  defp maybe_test(_shell, false), do: :ok

  defp maybe_test(shell, true) do
    Logger.info("Running tests...")

    case shell.("mix", ["test"], cd: Config.platform_dir()) do
      {:ok, _} ->
        Logger.ok("Tests passed")
        :ok

      {:error, {_code, output}} ->
        Logger.fail("Tests failed — fix tests before deploying")
        {:error, "test", output}
    end
  end

  defp maybe_build(_shell, false), do: :ok

  defp maybe_build(shell, true) do
    Logger.info("Building release...")

    case shell.("mix", ["release", "--overwrite"],
           cd: Config.platform_dir(),
           env: [{"MIX_ENV", "prod"}]
         ) do
      {:ok, _} ->
        Logger.ok("Release built")
        :ok

      {:error, {_code, output}} ->
        Logger.fail("Release build failed")
        {:error, "build", output}
    end
  end

  defp maybe_build_container(_shell, false), do: :ok

  defp maybe_build_container(shell, true) do
    Logger.info("Building container image (this may take a minute)...")

    case shell.("./container/build.sh", [], cd: Config.project_root()) do
      {:ok, _} ->
        Logger.ok("Container image built")
        :ok

      {:error, {_code, output}} ->
        Logger.fail("Container build failed")
        {:error, "container", output}
    end
  end
end
