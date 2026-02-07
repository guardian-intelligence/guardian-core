defmodule Guardian.Deploy.SecretsTest do
  use ExUnit.Case, async: true

  alias Guardian.Deploy.Secrets

  # --- Test helpers ---

  defp recording_shell(overrides \\ %{}) do
    log = Agent.start_link(fn -> [] end) |> elem(1)

    shell = fn cmd, args, opts ->
      Agent.update(log, fn entries -> [{cmd, args, opts} | entries] end)
      key = "#{cmd} #{Enum.join(args, " ")}"

      result =
        Enum.find_value(overrides, nil, fn {pattern, response} ->
          if String.contains?(key, pattern), do: response
        end)

      result || {:ok, ""}
    end

    {log, shell}
  end

  defp cmds(log) do
    Agent.get(log, & &1)
    |> Enum.reverse()
    |> Enum.map(fn {cmd, args, _} -> "#{cmd} #{Enum.join(args, " ")}" end)
  end

  defp all_exist(_path), do: true
  defp valid_pem_content(_path), do: {:ok, "GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nMIIE..."}

  defp git_not_tracked(cmd, args, _opts) do
    key = "#{cmd} #{Enum.join(args, " ")}"

    if String.contains?(key, "git ls-files") do
      {:error, {1, "not tracked"}}
    else
      {:ok, "age1pubkeyhere"}
    end
  end

  # --- Backup preconditions ---

  describe "backup preconditions" do
    test "fails when .env missing" do
      {_log, shell} = recording_shell()

      file_exists = fn path ->
        not String.ends_with?(path, ".env") or String.contains?(path, "server")
      end

      assert {:error, "backup", msg} =
               Secrets.backup(false,
                 shell: shell,
                 file_exists: file_exists,
                 read_file: &valid_pem_content/1
               )

      assert String.contains?(msg, ".env")
    end

    test "fails when server/.env missing" do
      {_log, shell} = recording_shell()

      file_exists = fn path ->
        not String.contains?(path, "server/.env") or String.contains?(path, ".age")
      end

      assert {:error, "backup", msg} =
               Secrets.backup(false,
                 shell: shell,
                 file_exists: file_exists,
                 read_file: &valid_pem_content/1
               )

      assert String.contains?(msg, "server/.env")
    end

    test "fails when .env is git-tracked" do
      shell = fn cmd, args, opts ->
        key = "#{cmd} #{Enum.join(args, " ")}"

        if String.contains?(key, "git ls-files --error-unmatch .env") do
          {:ok, ".env"}
        else
          {:ok, ""}
        end
      end

      assert {:error, "backup", msg} =
               Secrets.backup(false,
                 shell: shell,
                 file_exists: &all_exist/1,
                 read_file: &valid_pem_content/1
               )

      assert String.contains?(msg, "tracked by git")
    end

    test "fails when age key missing" do
      file_exists = fn path ->
        not String.contains?(path, "secrets.key")
      end

      assert {:error, "backup", msg} =
               Secrets.backup(false,
                 shell: &git_not_tracked/3,
                 file_exists: file_exists,
                 read_file: &valid_pem_content/1
               )

      assert String.contains?(msg, "No age identity")
    end

    test "fails when PEM validation fails" do
      bad_pem = fn _path ->
        {:ok, "GITHUB_APP_PRIVATE_KEY=\"-----BEGIN RSA PRIVATE KEY-----\""}
      end

      assert {:error, "backup", msg} =
               Secrets.backup(false,
                 shell: &git_not_tracked/3,
                 file_exists: &all_exist/1,
                 read_file: bad_pem
               )

      assert String.contains?(msg, "PEM validation failed")
    end
  end

  # --- Restore preconditions ---

  describe "restore preconditions" do
    test "fails when .age files missing" do
      file_exists = fn path ->
        not String.contains?(path, ".age")
      end

      {_log, shell} = recording_shell()

      assert {:error, "restore", msg} =
               Secrets.restore(false,
                 shell: shell,
                 file_exists: file_exists,
                 read_file: &valid_pem_content/1
               )

      assert String.contains?(msg, "was found in")
    end
  end

  # --- Dry-run tests ---

  describe "dry-run" do
    test "backup dry-run runs preconditions but no mutation" do
      {log, shell} =
        recording_shell(%{
          "git ls-files" => {:error, {1, "not tracked"}},
          "shasum" => {:ok, "abc123  .env"}
        })

      assert :ok =
               Secrets.backup(true,
                 shell: shell,
                 file_exists: &all_exist/1,
                 read_file: &valid_pem_content/1
               )

      commands = cmds(log)
      refute Enum.any?(commands, &String.contains?(&1, "age -R"))
      refute Enum.any?(commands, &String.contains?(&1, "shasum"))
    end

    test "restore dry-run runs preconditions but no mutation" do
      {log, shell} = recording_shell()

      assert :ok =
               Secrets.restore(true,
                 shell: shell,
                 file_exists: &all_exist/1,
                 read_file: &valid_pem_content/1
               )

      commands = cmds(log)
      refute Enum.any?(commands, &String.contains?(&1, "age -d"))
      refute Enum.any?(commands, &String.contains?(&1, "install -m"))
    end

    test "deploy dry-run runs preflight but no SCP/SSH install" do
      {log, shell} =
        recording_shell(%{
          "ssh" => {:ok, "Write access OK"}
        })

      assert :ok =
               Secrets.deploy_secrets(true,
                 shell: shell,
                 file_exists: &all_exist/1,
                 read_file: &valid_pem_content/1
               )

      commands = cmds(log)
      # Preflight SSH runs
      assert Enum.any?(commands, &String.contains?(&1, "ssh"))
      # But no SCP or age decrypt
      refute Enum.any?(commands, &String.contains?(&1, "scp"))
      refute Enum.any?(commands, &String.contains?(&1, "age -d"))
    end
  end

  # --- Happy paths ---

  describe "backup happy path" do
    test "encrypts both files and logs checksums" do
      {log, shell} =
        recording_shell(%{
          "git ls-files" => {:error, {1, "not tracked"}},
          "shasum" => {:ok, "abc123  .env"},
          "age-keygen" => {:ok, "age1pubkeyhere"}
        })

      assert :ok =
               Secrets.backup(false,
                 shell: shell,
                 file_exists: &all_exist/1,
                 read_file: &valid_pem_content/1
               )

      commands = cmds(log)
      assert Enum.any?(commands, &String.contains?(&1, "age -R"))
      assert Enum.any?(commands, &String.contains?(&1, "guardian-core.env.age"))
      assert Enum.any?(commands, &String.contains?(&1, "server.env.age"))
      assert Enum.any?(commands, &String.contains?(&1, "shasum"))
    end
  end

  describe "verify" do
    test "passes when all checks succeed" do
      {_log, shell} =
        recording_shell(%{
          "stat -c" => {:ok, "600 rumi:users /opt/guardian-core/.env\n600 rumi:users /opt/guardian-core/server/.env"},
          "systemctl is-active" => {:ok, "active\nactive"},
          "curl" => {:ok, "OK"}
        })

      assert :ok = Secrets.verify(shell: shell)
    end

    test "fails when permissions are wrong" do
      {_log, shell} =
        recording_shell(%{
          "stat -c" => {:ok, "644 root:root /opt/guardian-core/.env\n644 root:root /opt/guardian-core/server/.env"},
          "systemctl is-active" => {:ok, "active\nactive"},
          "curl" => {:ok, "OK"}
        })

      assert {:error, "verify", msg} = Secrets.verify(shell: shell)
      assert String.contains?(msg, "mode 600")
    end
  end

  # --- Error propagation ---

  describe "error propagation" do
    test "propagates shell failure during age encrypt" do
      shell = fn cmd, args, _opts ->
        key = "#{cmd} #{Enum.join(args, " ")}"

        cond do
          String.contains?(key, "git ls-files") -> {:error, {1, "not tracked"}}
          cmd == "age" and Enum.member?(args, "-o") -> {:error, {1, "age: encryption failed"}}
          true -> {:ok, "age1pubkeyhere"}
        end
      end

      assert {:error, "backup", _} =
               Secrets.backup(false,
                 shell: shell,
                 file_exists: &all_exist/1,
                 read_file: &valid_pem_content/1
               )
    end

    test "propagates SSH preflight failure" do
      shell = fn cmd, args, _opts ->
        key = "#{cmd} #{Enum.join(args, " ")}"

        if cmd == "ssh" and String.contains?(key, "test -w") do
          {:error, {255, "SSH connection refused"}}
        else
          {:ok, ""}
        end
      end

      assert {:error, "deploy", msg} =
               Secrets.deploy_secrets(false,
                 shell: shell,
                 file_exists: &all_exist/1,
                 read_file: &valid_pem_content/1
               )

      assert String.contains?(msg, "SSH preflight failed")
    end
  end
end
