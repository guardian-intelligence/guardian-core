defmodule Guardian.Deploy.TemplateCommitTest do
  use ExUnit.Case, async: true

  alias Guardian.Deploy.TemplateCommit

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

  # --- Tests ---

  describe "run/1" do
    test "no changes returns noop" do
      # All files tracked and unchanged: diff --quiet succeeds, ls-files succeeds
      {log, shell} = recording_shell()

      assert {:noop, "no changes"} = TemplateCommit.run(shell: shell)

      commands = cmds(log)
      # Should have checked git diff for template files
      assert Enum.any?(commands, &String.contains?(&1, "git diff --quiet"))
      # No commit
      refute Enum.any?(commands, &String.contains?(&1, "git commit"))
    end

    test "files changed triggers stage and commit" do
      # diff --quiet fails for some files = changes detected
      {log, shell} =
        recording_shell(%{
          "git diff --quiet" => {:error, {1, ""}},
          "git add" => {:ok, ""},
          "git commit" => {:ok, ""}
        })

      assert :ok = TemplateCommit.run(shell: shell)

      commands = cmds(log)
      assert Enum.any?(commands, &String.contains?(&1, "git add"))
      assert Enum.any?(commands, &String.contains?(&1, "git commit"))
      assert Enum.any?(commands, &String.contains?(&1, "--no-verify"))
      assert Enum.any?(commands, &String.contains?(&1, "auto: template snapshot"))
    end

    test "git commit failure returns error" do
      {_log, shell} =
        recording_shell(%{
          "git diff --quiet" => {:error, {1, ""}},
          "git commit" => {:error, {1, "nothing to commit"}}
        })

      assert {:error, "commit", _} = TemplateCommit.run(shell: shell)
    end
  end
end
