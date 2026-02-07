defmodule Guardian.Deploy.BrainTest do
  use ExUnit.Case, async: false

  alias Guardian.Deploy.Brain

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

  defp stub_platform do
    log = Agent.start_link(fn -> [] end) |> elem(1)
    Process.put(:stub_platform_log, log)
    {log, Guardian.Deploy.Test.StubPlatform}
  end

  defp cmds(log) do
    Agent.get(log, & &1)
    |> Enum.reverse()
    |> Enum.map(fn {cmd, args, _} -> "#{cmd} #{Enum.join(args, " ")}" end)
  end

  defp platform_calls(log) do
    Agent.get(log, & &1) |> Enum.reverse()
  end

  # --- Tests ---

  describe "deploy/3 all mode" do
    test "runs full pipeline" do
      {shell_log, shell} = recording_shell()
      {plat_log, platform} = stub_platform()

      assert :ok = Brain.deploy(:all, false, shell: shell, platform: platform)

      commands = cmds(shell_log)
      assert Enum.any?(commands, &String.contains?(&1, "mix deps.get"))
      assert Enum.any?(commands, &String.contains?(&1, "mix compile --warnings-as-errors"))
      assert Enum.any?(commands, &String.contains?(&1, "mix test"))
      assert Enum.any?(commands, &String.contains?(&1, "mix release"))
      assert Enum.any?(commands, &String.contains?(&1, "./container/build.sh"))

      assert platform_calls(plat_log) == [
               :install_service_template,
               :restart_service,
               :verify_service
             ]
    end
  end

  describe "deploy/3 app mode" do
    test "only runs app steps" do
      {shell_log, shell} = recording_shell()
      {_plat_log, platform} = stub_platform()

      assert :ok = Brain.deploy(:app, false, shell: shell, platform: platform)

      commands = cmds(shell_log)
      assert Enum.any?(commands, &String.contains?(&1, "mix deps.get"))
      assert Enum.any?(commands, &String.contains?(&1, "mix release"))
      refute Enum.any?(commands, &String.contains?(&1, "./container/build.sh"))
    end
  end

  describe "deploy/3 container mode" do
    test "only runs container step" do
      {shell_log, shell} = recording_shell()
      {_plat_log, platform} = stub_platform()

      assert :ok = Brain.deploy(:container, false, shell: shell, platform: platform)

      commands = cmds(shell_log)
      refute Enum.any?(commands, &String.contains?(&1, "mix deps.get"))
      refute Enum.any?(commands, &String.contains?(&1, "mix compile"))
      refute Enum.any?(commands, &String.contains?(&1, "mix test"))
      refute Enum.any?(commands, &String.contains?(&1, "mix release"))
      assert Enum.any?(commands, &String.contains?(&1, "./container/build.sh"))
    end
  end

  describe "deploy/3 dry-run" do
    test "prints plan but runs no commands" do
      {shell_log, shell} = recording_shell()
      {plat_log, platform} = stub_platform()

      assert :ok = Brain.deploy(:all, true, shell: shell, platform: platform)

      commands = cmds(shell_log)
      refute Enum.any?(commands, &String.contains?(&1, "mix deps.get"))
      refute Enum.any?(commands, &String.contains?(&1, "mix release"))
      refute Enum.any?(commands, &String.contains?(&1, "./container/build.sh"))
      assert platform_calls(plat_log) == []
    end
  end

  describe "deploy/3 error propagation" do
    test "stops on compile failure" do
      {_shell_log, shell} =
        recording_shell(%{
          "mix compile" => {:error, {1, "Compilation error"}}
        })

      {plat_log, platform} = stub_platform()

      assert {:error, "compile", _} =
               Brain.deploy(:app, false, shell: shell, platform: platform)

      assert platform_calls(plat_log) == []
    end
  end

  describe "deploy/3 smart mode" do
    test "detects git changes" do
      {shell_log, shell} =
        recording_shell(%{
          "git diff --name-only HEAD" =>
            {:ok, "platform/lib/guardian/kernel/state.ex\ncontainer/Dockerfile"},
          "git diff --name-only --cached" => {:ok, ""}
        })

      {_plat_log, platform} = stub_platform()

      assert :ok = Brain.deploy(:smart, true, shell: shell, platform: platform)

      commands = cmds(shell_log)
      assert Enum.any?(commands, &String.contains?(&1, "git diff --name-only HEAD"))
    end
  end
end
