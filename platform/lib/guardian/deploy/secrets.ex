defmodule Guardian.Deploy.Secrets do
  @moduledoc """
  Secrets management — encrypt/decrypt .env files with age,
  deploy to remote via SCP + SSH.
  """

  alias Guardian.Deploy.{Config, Logger, PemValidator}

  @remote_install_script """
  set -euo pipefail
  umask 077

  ROOT="/opt/guardian-core"

  # Stage in target directories — same filesystem = true atomic rename
  STAGE_ENV="$(mktemp "$ROOT/.env.XXXXXX")"
  STAGE_SERVER_ENV="$(mktemp "$ROOT/server/.env.XXXXXX")"

  trap 'rm -f "$STAGE_ENV" "$STAGE_SERVER_ENV"' EXIT

  # Move uploaded files to stage locations
  mv -f /tmp/guardian-env-tmp "$STAGE_ENV"
  mv -f /tmp/guardian-server-env-tmp "$STAGE_SERVER_ENV"

  # Validate non-empty
  [ -s "$STAGE_ENV" ] || { echo "ERROR: staged .env is empty" >&2; exit 1; }
  [ -s "$STAGE_SERVER_ENV" ] || { echo "ERROR: staged server/.env is empty" >&2; exit 1; }

  chmod 600 "$STAGE_ENV" "$STAGE_SERVER_ENV"

  # Backup for rollback
  BAK_ENV="" BAK_SERVER_ENV=""
  [ -f "$ROOT/.env" ] && { BAK_ENV="$(mktemp "$ROOT/.env.bak.XXXXXX")"; cp -p "$ROOT/.env" "$BAK_ENV"; }
  [ -f "$ROOT/server/.env" ] && { BAK_SERVER_ENV="$(mktemp "$ROOT/server/.env.bak.XXXXXX")"; cp -p "$ROOT/server/.env" "$BAK_SERVER_ENV"; }

  # Atomic rename
  if ! { mv -f "$STAGE_ENV" "$ROOT/.env" && mv -f "$STAGE_SERVER_ENV" "$ROOT/server/.env"; }; then
    echo "ERROR: Install failed, rolling back..." >&2
    [ -n "$BAK_ENV" ] && mv -f "$BAK_ENV" "$ROOT/.env"
    [ -n "$BAK_SERVER_ENV" ] && mv -f "$BAK_SERVER_ENV" "$ROOT/server/.env"
    echo "Rollback complete" >&2
    exit 1
  fi

  rm -f "$BAK_ENV" "$BAK_SERVER_ENV"
  trap - EXIT
  echo "Secrets installed (mode 600)"
  """

  # --- Public API ---

  @doc """
  Encrypt .env files to age archives.

  ## Options

    * `:shell` - shell function. Defaults to `&Guardian.Deploy.Shell.run/3`.
    * `:file_exists` - `(path) -> boolean()`. Defaults to `&File.exists?/1`.
    * `:read_file` - `(path) -> {:ok, binary()} | {:error, term()}`. Defaults to `&File.read/1`.
  """
  @spec backup(boolean(), keyword()) :: :ok | {:error, String.t(), String.t()}
  def backup(dry_run, opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    file_exists = Keyword.get(opts, :file_exists, &File.exists?/1)
    read_file = Keyword.get(opts, :read_file, &File.read/1)

    root = Config.project_root()
    env_file = Path.join(root, ".env")
    server_env_file = Path.join(root, "server/.env")

    with :ok <- assert_file_exists(env_file, ".env", "backup", file_exists),
         :ok <- assert_file_exists(server_env_file, "server/.env", "backup", file_exists),
         :ok <- check_not_tracked(shell, ".env", "backup", root),
         :ok <- check_not_tracked(shell, "server/.env", "backup", root),
         :ok <- validate_pem(server_env_file, "backup", read_file),
         :ok <- init_key(shell, "backup", file_exists),
         recipient_args <- build_recipient_args("backup", file_exists, read_file) do
      case recipient_args do
        {:error, _, _} = err ->
          err

        args when is_list(args) ->
          secrets_dir = Config.secrets_dir()
          File.mkdir_p!(secrets_dir)

          Logger.plain("")
          Logger.plain("Backup plan:")
          Logger.plain("  • Encrypt .env → secrets/#{Config.primary_env_archive()}")
          Logger.plain("  • Encrypt server/.env → secrets/#{Config.server_env_archive()}")
          Logger.plain("")

          if dry_run do
            Logger.warn("Dry run — nothing will be changed")
            :ok
          else
            primary_archive = Path.join(secrets_dir, Config.primary_env_archive())
            server_archive = Path.join(secrets_dir, Config.server_env_archive())

            with :ok <- run_age_encrypt(shell, args, primary_archive, env_file, "backup"),
                 :ok <-
                   run_age_encrypt(shell, args, server_archive, server_env_file, "backup") do
              Logger.ok("Encrypted to #{secrets_dir}/")
              Logger.info("Checksums (for roundtrip verification):")
              log_checksum(shell, env_file)
              log_checksum(shell, server_env_file)
              :ok
            end
          end
      end
    end
  end

  @doc """
  Decrypt age archives to local .env files.

  ## Options

    * `:shell` - shell function.
    * `:file_exists` - file existence check.
  """
  @spec restore(boolean(), keyword()) :: :ok | {:error, String.t(), String.t()}
  def restore(dry_run, opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    file_exists = Keyword.get(opts, :file_exists, &File.exists?/1)
    read_file = Keyword.get(opts, :read_file, &File.read/1)

    root = Config.project_root()
    secrets_dir = Config.secrets_dir()
    age_server_env = Path.join(secrets_dir, Config.server_env_archive())

    with {:ok, env_archive_path, env_archive_label} <-
           resolve_host_env_archive("restore", file_exists),
         :ok <- assert_file_exists(age_server_env, Config.server_env_archive(), "restore", file_exists),
         :ok <- init_key(shell, "restore", file_exists) do
      _ = read_file

      Logger.plain("")
      Logger.plain("Restore plan:")
      Logger.plain("  • Decrypt secrets/#{env_archive_label} → .env")
      Logger.plain("  • Decrypt secrets/#{Config.server_env_archive()} → server/.env")
      Logger.plain("  • Set permissions to 600")
      Logger.plain("")

      if dry_run do
        Logger.warn("Dry run — nothing will be changed")
        :ok
      else
        run_restore(shell, root, env_archive_path, age_server_env)
      end
    end
  end

  @doc """
  Deploy secrets to remote server: decrypt → SCP → SSH atomic install → restart.

  ## Options

    * `:shell` - shell function.
    * `:file_exists` - file existence check.
  """
  @spec deploy_secrets(boolean(), keyword()) :: :ok | {:error, String.t(), String.t()}
  def deploy_secrets(dry_run, opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    file_exists = Keyword.get(opts, :file_exists, &File.exists?/1)
    read_file = Keyword.get(opts, :read_file, &File.read/1)

    remote = Config.remote()
    remote_root = Config.remote_root()
    secrets_dir = Config.secrets_dir()
    age_server_env = Path.join(secrets_dir, Config.server_env_archive())

    with {:ok, env_archive_path, _label} <- resolve_host_env_archive("deploy", file_exists),
         :ok <- assert_file_exists(age_server_env, Config.server_env_archive(), "deploy", file_exists),
         :ok <- init_key(shell, "deploy", file_exists),
         :ok <- preflight_ssh(shell, remote, remote_root) do
      _ = read_file

      Logger.plain("")
      Logger.plain("Deploy plan:")
      Logger.plain("  • Decrypt .age files locally")
      Logger.plain("  • SCP to #{remote}:/tmp/")
      Logger.plain("  • SSH atomic install to #{remote_root}/")
      Logger.plain("  • Restart #{Config.core_service()} + #{Config.server_service()}")
      Logger.plain("  • Verify remote state")
      Logger.plain("")

      if dry_run do
        Logger.warn("Dry run — nothing will be changed")
        :ok
      else
        run_deploy(shell, remote, env_archive_path, age_server_env, opts)
      end
    end
  end

  @doc """
  Verify remote secrets state: file permissions, service status, health check.

  ## Options

    * `:shell` - shell function.
  """
  @spec verify(keyword()) :: :ok | {:error, String.t(), String.t()}
  def verify(opts \\ []) do
    shell = Keyword.get(opts, :shell, &Guardian.Deploy.Shell.run/3)
    remote = Config.remote()
    remote_root = Config.remote_root()
    core_service = Config.core_service()
    server_service = Config.server_service()

    failures = []

    # 1. Check file permissions
    Logger.info("=== Remote file permissions ===")

    failures =
      case shell.("ssh", [remote, "stat -c '%a %U:%G %n' #{remote_root}/.env #{remote_root}/server/.env"], []) do
        {:ok, output} ->
          Logger.plain(output)

          output
          |> String.split("\n")
          |> Enum.filter(&(String.trim(&1) != ""))
          |> Enum.reduce(failures, fn line, acc ->
            parts = line |> String.trim() |> String.split(~r/\s+/)

            case parts do
              [mode, owner_group, file_name | _] ->
                acc = if mode != "600", do: ["Expected mode 600, got #{mode} for #{file_name}" | acc], else: acc
                if owner_group != "rumi:users", do: ["Expected owner rumi:users, got #{owner_group} for #{file_name}" | acc], else: acc

              _ ->
                acc
            end
          end)

        {:error, _} ->
          ["Could not stat .env files on remote" | failures]
      end

    # 2. Check service status
    Logger.plain("")
    Logger.info("=== Service status ===")

    failures =
      case shell.("ssh", [remote, "systemctl is-active #{core_service} #{server_service}"], []) do
        {:ok, output} ->
          Logger.plain(output)
          failures

        {:error, _} ->
          ["One or more services not active" | failures]
      end

    # 3. Health check
    Logger.plain("")
    Logger.info("=== Health check ===")

    failures =
      case shell.("ssh", [remote, "curl -sf localhost:3000/health"], []) do
        {:ok, output} ->
          Logger.ok("#{output} OK")
          failures

        {:error, _} ->
          ["Health check failed" | failures]
      end

    # Report
    if failures == [] do
      Logger.plain("")
      Logger.ok("All checks passed.")
      :ok
    else
      failures = Enum.reverse(failures)

      Enum.each(failures, fn f ->
        Logger.fail("FAILED: #{f}")
      end)

      {:error, "verify",
       "Verification failed:\n#{Enum.map_join(failures, "\n", &("  - " <> &1))}"}
    end
  end

  # --- Internal helpers ---

  defp assert_file_exists(path, label, stage, file_exists) do
    if file_exists.(path) do
      :ok
    else
      {:error, stage, "#{label} not found: #{path}"}
    end
  end

  defp check_not_tracked(shell, file, stage, root) do
    case shell.("git", ["ls-files", "--error-unmatch", file], cd: root) do
      {:ok, _} ->
        # File IS tracked — bad
        {:error, stage, "#{file} is tracked by git. Run: git rm --cached #{file}"}

      {:error, _} ->
        # Not tracked — good
        :ok
    end
  end

  defp validate_pem(server_env_file, stage, read_file) do
    case read_file.(server_env_file) do
      {:ok, content} ->
        errors = PemValidator.validate(content)

        if errors == [] do
          :ok
        else
          {:error, stage,
           "PEM validation failed:\n#{Enum.map_join(errors, "\n", &("  - " <> &1))}"}
        end

      {:error, reason} ->
        {:error, stage, "Failed to read server/.env: #{inspect(reason)}"}
    end
  end

  defp init_key(shell, stage, file_exists) do
    age_key = Config.age_key_path()
    age_pub = Config.age_pub_path()

    if not file_exists.(age_key) do
      cfg = Config.config_dir()

      {:error, stage,
       "No age identity found at #{age_key}\n  Run: mkdir -p #{cfg} && age-keygen -o #{age_key}\n  Then: age-keygen -y #{age_key} > #{age_pub}"}
    else
      if not file_exists.(age_pub) do
        case shell.("age-keygen", ["-y", age_key], []) do
          {:ok, pub_key} ->
            File.write!(age_pub, String.trim(pub_key) <> "\n")
            Logger.info("Derived public key to #{age_pub}")
            :ok

          {:error, {_code, output}} ->
            {:error, stage, "Failed to derive public key: #{output}"}
        end
      else
        :ok
      end
    end
  end

  defp build_recipient_args(stage, file_exists, read_file) do
    age_pub = Config.age_pub_path()
    recovery_pub = Config.recovery_pub_path()

    args = ["-R", age_pub]

    args =
      if file_exists.(recovery_pub) do
        args = args ++ ["-R", recovery_pub]

        case read_file.(recovery_pub) do
          {:ok, content} ->
            Logger.info("Recovery recipient: #{content |> String.split("\n") |> hd()}")
            args

          {:error, reason} ->
            return_error = {:error, stage, "Failed to read #{recovery_pub}: #{inspect(reason)}"}
            throw(return_error)
        end
      else
        args
      end

    case read_file.(age_pub) do
      {:ok, content} ->
        Logger.info("Primary recipient: #{String.trim(content)}")
        args

      {:error, reason} ->
        {:error, stage, "Failed to read #{age_pub}: #{inspect(reason)}"}
    end
  catch
    {:error, _, _} = err -> err
  end

  defp resolve_host_env_archive(stage, file_exists) do
    secrets_dir = Config.secrets_dir()
    primary = Path.join(secrets_dir, Config.primary_env_archive())

    if file_exists.(primary) do
      {:ok, primary, Config.primary_env_archive()}
    else
      {:error, stage,
       "#{Config.primary_env_archive()} was not found in #{secrets_dir}"}
    end
  end

  defp run_age_encrypt(shell, recipient_args, output_path, input_path, stage) do
    case shell.("age", recipient_args ++ ["-o", output_path, input_path], []) do
      {:ok, _} -> :ok
      {:error, {_code, output}} -> {:error, stage, "age encrypt failed: #{output}"}
    end
  end

  defp log_checksum(shell, file) do
    root = Config.project_root()

    case shell.("shasum", ["-a", "256", file], []) do
      {:ok, output} ->
        hash = output |> String.split(~r/\s+/) |> hd()
        label = Path.relative_to(file, root)
        Logger.info("  #{label}: #{hash}")

      _ ->
        :ok
    end
  end

  defp preflight_ssh(shell, remote, remote_root) do
    Logger.info("Preflight: checking remote write access...")

    case shell.(
           "ssh",
           [
             remote,
             "test -w #{remote_root}/.env -o -w #{remote_root} && test -w #{remote_root}/server/.env -o -w #{remote_root}/server && echo \"Write access OK\""
           ],
           []
         ) do
      {:ok, _} -> :ok
      {:error, {_code, output}} -> {:error, "deploy", "SSH preflight failed: #{output}"}
    end
  end

  defp run_restore(shell, root, env_archive_path, age_server_env) do
    age_key = Config.age_key_path()
    tmp_dir = System.tmp_dir!()
    tmp_env = Path.join(tmp_dir, "guardian-restore-env-#{System.unique_integer([:positive])}")
    tmp_server_env = Path.join(tmp_dir, "guardian-restore-server-env-#{System.unique_integer([:positive])}")

    try do
      with {:ok, _} <-
             shell.("age", ["-d", "-i", age_key, "-o", tmp_env, env_archive_path], [])
             |> wrap_error("restore", "decrypt .env failed"),
           {:ok, _} <-
             shell.("age", ["-d", "-i", age_key, "-o", tmp_server_env, age_server_env], [])
             |> wrap_error("restore", "decrypt server/.env failed"),
           :ok <- verify_non_empty(tmp_env, ".env", "restore"),
           :ok <- verify_non_empty(tmp_server_env, "server/.env", "restore"),
           {:ok, _} <-
             shell.("install", ["-m", "600", tmp_env, Path.join(root, ".env")], [])
             |> wrap_error("restore", "install .env failed"),
           {:ok, _} <-
             shell.("install", ["-m", "600", tmp_server_env, Path.join(root, "server/.env")], [])
             |> wrap_error("restore", "install server/.env failed") do
        Logger.ok("Restored .env files (mode 600)")
        Logger.info("Checksums:")
        log_checksum(shell, Path.join(root, ".env"))
        log_checksum(shell, Path.join(root, "server/.env"))
        :ok
      end
    after
      File.rm(tmp_env)
      File.rm(tmp_server_env)
    end
  end

  defp run_deploy(shell, remote, env_archive_path, age_server_env, _opts) do
    age_key = Config.age_key_path()
    core_service = Config.core_service()
    server_service = Config.server_service()
    tmp_dir = System.tmp_dir!()
    tmp_env = Path.join(tmp_dir, "guardian-deploy-env-#{System.unique_integer([:positive])}")
    tmp_server_env = Path.join(tmp_dir, "guardian-deploy-server-env-#{System.unique_integer([:positive])}")

    Logger.info("Deploying secrets to #{remote}...")

    try do
      with {:ok, _} <-
             shell.("age", ["-d", "-i", age_key, "-o", tmp_env, env_archive_path], [])
             |> wrap_error("deploy", "decrypt .env failed"),
           {:ok, _} <-
             shell.("age", ["-d", "-i", age_key, "-o", tmp_server_env, age_server_env], [])
             |> wrap_error("deploy", "decrypt server/.env failed"),
           :ok <- verify_non_empty(tmp_env, ".env", "deploy"),
           :ok <- verify_non_empty(tmp_server_env, "server/.env", "deploy"),
           {:ok, _} <-
             shell.("scp", [tmp_env, "#{remote}:/tmp/guardian-env-tmp"], [])
             |> wrap_error("deploy", "SCP .env failed"),
           {:ok, _} <-
             shell.("scp", [tmp_server_env, "#{remote}:/tmp/guardian-server-env-tmp"], [])
             |> wrap_error("deploy", "SCP server/.env failed"),
           {:ok, _} <-
             shell.("ssh", [remote, @remote_install_script], [])
             |> wrap_error("deploy", "Remote install failed"),
           {:ok, _} <-
             shell.("ssh", [remote, "sudo systemctl restart #{core_service} #{server_service}"], [])
             |> wrap_error("deploy", "Service restart failed") do
        Logger.ok("Services restarted")
        verify(shell: shell)
      end
    after
      File.rm(tmp_env)
      File.rm(tmp_server_env)
    end
  end

  defp verify_non_empty(path, label, stage) do
    case File.stat(path) do
      {:ok, %{size: size}} when size > 0 -> :ok
      {:ok, %{size: 0}} -> {:error, stage, "Decrypted #{label} is empty"}
      {:error, reason} -> {:error, stage, "Cannot stat #{label}: #{inspect(reason)}"}
    end
  end

  defp wrap_error({:ok, output}, _stage, _prefix), do: {:ok, output}

  defp wrap_error({:error, {_code, output}}, stage, prefix),
    do: {:error, stage, "#{prefix}: #{output}"}
end
