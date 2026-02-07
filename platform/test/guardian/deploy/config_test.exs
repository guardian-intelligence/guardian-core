defmodule Guardian.Deploy.ConfigTest do
  use ExUnit.Case, async: true

  alias Guardian.Deploy.Config

  describe "project_root/0" do
    test "resolves to directory containing package.json" do
      root = Config.project_root()
      assert File.exists?(Path.join(root, "package.json"))
    end
  end

  describe "derived paths" do
    test "secrets_dir is under project root" do
      assert String.starts_with?(Config.secrets_dir(), Config.project_root())
    end

    test "config_dir is under home" do
      assert String.starts_with?(Config.config_dir(), System.user_home!())
    end

    test "log_dir is under project root" do
      assert String.starts_with?(Config.log_dir(), Config.project_root())
    end

    test "platform_dir is under project root" do
      assert String.starts_with?(Config.platform_dir(), Config.project_root())
      assert String.ends_with?(Config.platform_dir(), "platform")
    end
  end

  describe "constants" do
    test "remote host is set" do
      assert Config.remote() == "rumi-server"
    end

    test "template_paths is a non-empty list" do
      paths = Config.template_paths()
      assert is_list(paths)
      assert length(paths) > 0
      assert Enum.all?(paths, &is_binary/1)
    end

    test "archive names are .age files" do
      assert String.ends_with?(Config.primary_env_archive(), ".age")
      assert String.ends_with?(Config.server_env_archive(), ".age")
    end
  end
end
