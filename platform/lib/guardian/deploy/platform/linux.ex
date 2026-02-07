defmodule Guardian.Deploy.Platform.Linux do
  @moduledoc "systemd service management for Linux."

  @behaviour Guardian.Deploy.PlatformService

  alias Guardian.Deploy.{Config, Logger}

  @impl true
  def install_service_template(opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    src = Config.systemd_unit_src()
    dst = Config.systemd_unit_dst()

    if not File.exists?(src) do
      {:error, "installServiceTemplate", "Template not found: #{src}"}
    else
      Logger.info("Installing systemd unit...")
      content = resolve_template(src)
      File.mkdir_p!(Path.dirname(dst))
      File.write!(dst, content)
      Logger.ok("Unit installed to #{dst}")
      _ = shell
      :ok
    end
  end

  @impl true
  def restart_service(opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    root = Config.project_root()

    Logger.info("Restarting service...")
    File.mkdir_p!(Path.join(root, "logs"))

    with {:ok, _} <- shell.("systemctl", ["--user", "daemon-reload"], []),
         {:ok, _} <- shell.("systemctl", ["--user", "restart", "guardian-core"], []) do
      Logger.ok("Service restarted")
      :ok
    else
      {:error, {_code, output}} ->
        {:error, "restart", "systemctl failed: #{output}"}
    end
  end

  @impl true
  def verify_service(opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)

    Process.sleep(2000)
    Logger.info("Verifying service...")

    case shell.("systemctl", ["--user", "is-active", "guardian-core"], []) do
      {:ok, output} ->
        status = String.trim(output)

        if status == "active" do
          Logger.ok("Service running")
        else
          Logger.warn("Service status: #{status} — check logs/guardian-core.error.log")
        end

        :ok

      {:error, {_code, output}} ->
        {:error, "verify", "Service check failed: #{output}"}
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
