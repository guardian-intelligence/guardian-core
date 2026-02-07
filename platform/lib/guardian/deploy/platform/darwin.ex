defmodule Guardian.Deploy.Platform.Darwin do
  @moduledoc "launchd service management for macOS."

  @behaviour Guardian.Deploy.PlatformService

  alias Guardian.Deploy.{Config, Logger}

  @impl true
  def install_service_template(opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    src = Config.launchd_plist_src()
    dst = Config.launchd_plist_dst()

    if not File.exists?(src) do
      {:error, "installServiceTemplate", "Template not found: #{src}"}
    else
      Logger.info("Installing launchd plist...")
      content = resolve_template(src)
      File.mkdir_p!(Path.dirname(dst))
      File.write!(dst, content)
      Logger.ok("Plist installed to #{dst}")
      # shell reference kept for interface consistency
      _ = shell
      :ok
    end
  end

  @impl true
  def restart_service(opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    dst = Config.launchd_plist_dst()
    root = Config.project_root()

    Logger.info("Restarting service...")
    File.mkdir_p!(Path.join(root, "logs"))

    # Unload may fail if not loaded — ignore errors
    shell.("launchctl", ["unload", dst], [])
    Process.sleep(1000)

    case shell.("launchctl", ["load", dst], []) do
      {:ok, _} ->
        Logger.ok("Service restarted")
        :ok

      {:error, {_code, output}} ->
        {:error, "restart", "launchctl load failed: #{output}"}
    end
  end

  @impl true
  def verify_service(opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)

    Process.sleep(2000)
    Logger.info("Verifying service...")

    case shell.("launchctl", ["list"], []) do
      {:ok, output} ->
        case Enum.find(String.split(output, "\n"), &String.contains?(&1, "com.guardian-core")) do
          nil ->
            Logger.fail("Service not found in launchctl — check the plist")
            {:error, "verify", "Service not found in launchctl"}

          line ->
            pid = line |> String.trim() |> String.split(~r/\s+/) |> hd()

            if pid != "-" and pid != "" do
              Logger.ok("Service running (PID: #{pid})")
            else
              Logger.warn("Service loaded but not running yet — check logs/guardian-core.error.log")
            end

            :ok
        end

      {:error, {_code, output}} ->
        {:error, "verify", "launchctl list failed: #{output}"}
    end
  end

  defp resolve_template(template_path) do
    root = Config.project_root()
    home = System.user_home!()

    File.read!(template_path)
    |> String.replace("{{PROJECT_ROOT}}", root)
    |> String.replace("{{HOME}}", home)
  end
end
