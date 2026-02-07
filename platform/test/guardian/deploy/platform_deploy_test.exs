defmodule Guardian.Deploy.PlatformDeployTest do
  use ExUnit.Case, async: true

  alias Guardian.Deploy.PlatformDeploy

  # --- Test helpers ---

  defp recording_shell(overrides \\ %{}) do
    log = Agent.start_link(fn -> [] end) |> elem(1)

    shell = fn cmd, args, opts ->
      Agent.update(log, fn entries -> [{cmd, args, opts} | entries] end)
      key = "#{cmd} #{Enum.join(args, " ")}"

      result =
        Enum.find_value(overrides, {:ok, ""}, fn {pattern, response} ->
          if String.contains?(key, pattern), do: response
        end)

      result
    end

    {log, shell}
  end

  defp logged(log) do
    Agent.get(log, & &1) |> Enum.reverse()
  end

  defp cmds(log) do
    logged(log) |> Enum.map(fn {cmd, args, _} -> "#{cmd} #{Enum.join(args, " ")}" end)
  end

  # --- Tests ---

  describe "deploy/2" do
    test "dry-run prints plan but runs no commands" do
      {log, shell} = recording_shell()
      assert :ok = PlatformDeploy.deploy(true, shell: shell)
      assert logged(log) == []
    end

    test "happy path runs full pipeline" do
      {log, shell} = recording_shell()
      assert :ok = PlatformDeploy.deploy(false, shell: shell)

      commands = cmds(log)
      assert Enum.any?(commands, &String.contains?(&1, "mix test"))
      assert Enum.any?(commands, &String.contains?(&1, "rsync"))
      assert Enum.any?(commands, &String.contains?(&1, "ssh"))
      assert Enum.any?(commands, &String.contains?(&1, "systemctl restart"))
      assert Enum.any?(commands, &String.contains?(&1, "curl"))
    end

    test "stops on test failure" do
      {log, shell} =
        recording_shell(%{
          "mix test" => {:error, {1, "test failure"}}
        })

      assert {:error, "test", _} = PlatformDeploy.deploy(false, shell: shell)

      commands = cmds(log)
      assert Enum.any?(commands, &String.contains?(&1, "mix test"))
      refute Enum.any?(commands, &String.contains?(&1, "rsync"))
    end

    test "stops on rsync failure" do
      {log, shell} =
        recording_shell(%{
          "rsync" => {:error, {1, "rsync failed"}}
        })

      assert {:error, "rsync", _} = PlatformDeploy.deploy(false, shell: shell)

      commands = cmds(log)
      refute Enum.any?(commands, &String.contains?(&1, "systemctl"))
    end

    test "stops on health check failure" do
      {_log, shell} =
        recording_shell(%{
          "curl" => {:error, {7, "connection refused"}}
        })

      assert {:error, "health", _} = PlatformDeploy.deploy(false, shell: shell)
    end
  end
end
