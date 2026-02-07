defmodule Guardian.Kernel.MountSecurityTest do
  use ExUnit.Case, async: true

  alias Guardian.Kernel.MountSecurity

  @valid_allowlist Jason.encode!(%{
                    "allowedRoots" => [
                      %{
                        "path" => "/tmp/test-projects",
                        "allowReadWrite" => true,
                        "description" => "Test projects"
                      },
                      %{
                        "path" => "/tmp/test-readonly",
                        "allowReadWrite" => false,
                        "description" => "Read-only root"
                      }
                    ],
                    "blockedPatterns" => ["password"],
                    "nonMainReadOnly" => true
                  })

  defp stub_opts(allowlist_content, paths_exist \\ true) do
    [
      path: "/fake/allowlist.json",
      read_file: fn
        "/fake/allowlist.json" -> {:ok, allowlist_content}
        _ -> {:error, :enoent}
      end,
      home_dir: "/home/test",
      real_path: fn path ->
        if paths_exist do
          {:ok, path}
        else
          {:error, :enoent}
        end
      end
    ]
  end

  describe "load_allowlist/1" do
    test "loads and merges default blocked patterns" do
      opts = stub_opts(@valid_allowlist)
      {:ok, allowlist} = MountSecurity.load_allowlist(opts)

      # Should contain both default and custom patterns
      assert "password" in allowlist["blockedPatterns"]
      assert ".ssh" in allowlist["blockedPatterns"]
      assert ".env" in allowlist["blockedPatterns"]
    end

    test "returns error when file not found" do
      opts = [path: "/fake/missing.json", read_file: fn _ -> {:error, :enoent} end]
      assert {:error, msg} = MountSecurity.load_allowlist(opts)
      assert msg =~ "not found"
    end

    test "returns error on invalid JSON" do
      opts = [path: "/fake/bad.json", read_file: fn _ -> {:ok, "not json"} end]
      assert {:error, msg} = MountSecurity.load_allowlist(opts)
      assert msg =~ "Invalid JSON"
    end

    test "returns error on invalid schema" do
      opts = [path: "/fake/bad.json", read_file: fn _ -> {:ok, ~s({"wrong": true})} end]
      assert {:error, msg} = MountSecurity.load_allowlist(opts)
      assert msg =~ "Invalid allowlist schema"
    end
  end

  describe "validate_mount/3" do
    test "allows mount under allowed root" do
      opts = stub_opts(@valid_allowlist)

      result =
        MountSecurity.validate_mount(
          %{"hostPath" => "/tmp/test-projects/myapp", "containerPath" => "myapp", "readonly" => false},
          true,
          opts
        )

      assert result.allowed
      assert result.effective_readonly == false
    end

    test "rejects mount not under any allowed root" do
      opts = stub_opts(@valid_allowlist)

      result =
        MountSecurity.validate_mount(
          %{"hostPath" => "/etc/secrets", "containerPath" => "secrets", "readonly" => true},
          true,
          opts
        )

      refute result.allowed
      assert result.reason =~ "not under any allowed root"
    end

    test "rejects mount matching blocked pattern" do
      opts = stub_opts(@valid_allowlist)

      result =
        MountSecurity.validate_mount(
          %{"hostPath" => "/tmp/test-projects/.ssh", "containerPath" => "ssh", "readonly" => true},
          true,
          opts
        )

      refute result.allowed
      assert result.reason =~ "blocked pattern"
      assert result.reason =~ ".ssh"
    end

    test "rejects custom blocked pattern" do
      opts = stub_opts(@valid_allowlist)

      result =
        MountSecurity.validate_mount(
          %{
            "hostPath" => "/tmp/test-projects/password-store",
            "containerPath" => "pw",
            "readonly" => true
          },
          true,
          opts
        )

      refute result.allowed
      assert result.reason =~ "password"
    end

    test "rejects invalid container path with .." do
      opts = stub_opts(@valid_allowlist)

      result =
        MountSecurity.validate_mount(
          %{"hostPath" => "/tmp/test-projects/app", "containerPath" => "../escape", "readonly" => true},
          true,
          opts
        )

      refute result.allowed
      assert result.reason =~ "Invalid container path"
    end

    test "rejects absolute container path" do
      opts = stub_opts(@valid_allowlist)

      result =
        MountSecurity.validate_mount(
          %{"hostPath" => "/tmp/test-projects/app", "containerPath" => "/absolute", "readonly" => true},
          true,
          opts
        )

      refute result.allowed
      assert result.reason =~ "Invalid container path"
    end

    test "rejects empty container path" do
      opts = stub_opts(@valid_allowlist)

      result =
        MountSecurity.validate_mount(
          %{"hostPath" => "/tmp/test-projects/app", "containerPath" => "", "readonly" => true},
          true,
          opts
        )

      refute result.allowed
    end

    test "forces read-only for non-main group when nonMainReadOnly is true" do
      opts = stub_opts(@valid_allowlist)

      result =
        MountSecurity.validate_mount(
          %{
            "hostPath" => "/tmp/test-projects/myapp",
            "containerPath" => "myapp",
            "readonly" => false
          },
          false,
          opts
        )

      assert result.allowed
      assert result.effective_readonly == true
    end

    test "forces read-only when root does not allow read-write" do
      opts = stub_opts(@valid_allowlist)

      result =
        MountSecurity.validate_mount(
          %{
            "hostPath" => "/tmp/test-readonly/data",
            "containerPath" => "data",
            "readonly" => false
          },
          true,
          opts
        )

      assert result.allowed
      assert result.effective_readonly == true
    end

    test "rejects when host path does not exist" do
      opts = stub_opts(@valid_allowlist, false)

      result =
        MountSecurity.validate_mount(
          %{
            "hostPath" => "/tmp/test-projects/missing",
            "containerPath" => "missing",
            "readonly" => true
          },
          true,
          opts
        )

      refute result.allowed
      assert result.reason =~ "does not exist"
    end

    test "rejects when no allowlist configured" do
      opts = [
        path: "/fake/missing.json",
        read_file: fn _ -> {:error, :enoent} end,
        home_dir: "/home/test",
        real_path: fn path -> {:ok, path} end
      ]

      result =
        MountSecurity.validate_mount(
          %{"hostPath" => "/tmp/app", "containerPath" => "app", "readonly" => true},
          true,
          opts
        )

      refute result.allowed
      assert result.reason =~ "not found"
    end
  end

  describe "validate_additional_mounts/4" do
    test "returns only allowed mounts with /workspace/extra/ prefix" do
      opts = stub_opts(@valid_allowlist)

      mounts = [
        %{"hostPath" => "/tmp/test-projects/app1", "containerPath" => "app1", "readonly" => false},
        %{"hostPath" => "/etc/secrets", "containerPath" => "secrets", "readonly" => true}
      ]

      result = MountSecurity.validate_additional_mounts(mounts, "test-group", true, opts)

      assert length(result) == 1
      assert hd(result).container_path == "/workspace/extra/app1"
    end

    test "returns empty list when all rejected" do
      opts = stub_opts(@valid_allowlist)

      mounts = [
        %{"hostPath" => "/etc/secrets", "containerPath" => "secrets", "readonly" => true}
      ]

      result = MountSecurity.validate_additional_mounts(mounts, "test-group", true, opts)
      assert result == []
    end
  end
end
