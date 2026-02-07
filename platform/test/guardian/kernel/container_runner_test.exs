defmodule Guardian.Kernel.ContainerRunnerTest do
  use ExUnit.Case, async: true

  alias Guardian.Kernel.ContainerRunner

  @tmp_dir System.tmp_dir!()

  setup do
    test_dir = Path.join(@tmp_dir, "container_runner_test_#{System.unique_integer([:positive])}")
    File.mkdir_p!(test_dir)
    on_exit(fn -> File.rm_rf!(test_dir) end)
    %{test_dir: test_dir}
  end

  describe "parse_container_output/3" do
    test "parses sentinel-delimited output" do
      stdout = """
      some log line
      another log line
      ---GUARDIAN_CORE_OUTPUT_START---
      {"status": "success", "result": "hello world", "newSessionId": "sess-1"}
      ---GUARDIAN_CORE_OUTPUT_END---
      trailing log
      """

      assert {:ok, output} = ContainerRunner.parse_container_output(stdout, "test-group")
      assert output.status == "success"
      assert output.result == "hello world"
      assert output.new_session_id == "sess-1"
    end

    test "falls back to last line when no sentinels" do
      stdout = """
      log line 1
      log line 2
      {"status": "success", "result": "from last line"}
      """

      assert {:ok, output} = ContainerRunner.parse_container_output(stdout, "test-group")
      assert output.status == "success"
      assert output.result == "from last line"
    end

    test "returns error when JSON is invalid" do
      stdout = "not valid json"

      assert {:error, msg} = ContainerRunner.parse_container_output(stdout, "test-group")
      assert msg =~ "Failed to parse"
    end

    test "returns error when status field missing" do
      stdout = ~s({"result": "no status"})

      assert {:error, msg} = ContainerRunner.parse_container_output(stdout, "test-group")
      assert msg =~ "missing 'status'"
    end

    test "handles error status with error field" do
      stdout = """
      ---GUARDIAN_CORE_OUTPUT_START---
      {"status": "error", "result": null, "error": "something went wrong"}
      ---GUARDIAN_CORE_OUTPUT_END---
      """

      assert {:ok, output} = ContainerRunner.parse_container_output(stdout, "test-group")
      assert output.status == "error"
      assert output.error == "something went wrong"
      assert output.result == nil
    end
  end

  describe "write_tasks_snapshot/4" do
    test "writes filtered tasks for non-main group", %{test_dir: test_dir} do
      tasks = [
        %{"group_folder" => "main", "id" => "t1", "prompt" => "do stuff"},
        %{"group_folder" => "other", "id" => "t2", "prompt" => "other stuff"}
      ]

      :ok = ContainerRunner.write_tasks_snapshot("other", false, tasks,
        data_dir: test_dir,
        mkdir_p: &File.mkdir_p!/1,
        write_file: &File.write!/2
      )

      path = Path.join([test_dir, "ipc", "other", "current_tasks.json"])
      assert File.exists?(path)

      content = File.read!(path) |> Jason.decode!()
      assert length(content) == 1
      assert hd(content)["id"] == "t2"
    end

    test "writes all tasks for main group", %{test_dir: test_dir} do
      tasks = [
        %{"group_folder" => "main", "id" => "t1"},
        %{"group_folder" => "other", "id" => "t2"}
      ]

      :ok = ContainerRunner.write_tasks_snapshot("main", true, tasks,
        data_dir: test_dir,
        mkdir_p: &File.mkdir_p!/1,
        write_file: &File.write!/2
      )

      path = Path.join([test_dir, "ipc", "main", "current_tasks.json"])
      content = File.read!(path) |> Jason.decode!()
      assert length(content) == 2
    end
  end

  describe "write_groups_snapshot/4" do
    test "writes groups for main, empty for non-main", %{test_dir: test_dir} do
      groups = [%{"jid" => "abc@g.us", "name" => "ABC"}]

      :ok = ContainerRunner.write_groups_snapshot("main", true, groups,
        data_dir: test_dir,
        mkdir_p: &File.mkdir_p!/1,
        write_file: &File.write!/2
      )

      main_path = Path.join([test_dir, "ipc", "main", "available_groups.json"])
      main_content = File.read!(main_path) |> Jason.decode!()
      assert length(main_content["groups"]) == 1

      :ok = ContainerRunner.write_groups_snapshot("other", false, groups,
        data_dir: test_dir,
        mkdir_p: &File.mkdir_p!/1,
        write_file: &File.write!/2
      )

      other_path = Path.join([test_dir, "ipc", "other", "available_groups.json"])
      other_content = File.read!(other_path) |> Jason.decode!()
      assert other_content["groups"] == []
    end
  end

  describe "run/3 with mock spawn" do
    test "handles successful container output", %{test_dir: test_dir} do
      output_json = Jason.encode!(%{"status" => "success", "result" => "hello"})

      mock_spawn = fn _args, _input, _timeout ->
        {:ok, 0,
         "log line\n---GUARDIAN_CORE_OUTPUT_START---\n#{output_json}\n---GUARDIAN_CORE_OUTPUT_END---\n",
         ""}
      end

      group = %{"folder" => "test", "name" => "Test Group"}

      input = %{
        prompt: "say hello",
        session_id: nil,
        group_folder: "test",
        chat_jid: "123@g.us",
        is_main: true,
        is_scheduled_task: nil
      }

      groups_dir = Path.join(test_dir, "groups")
      data_dir = Path.join(test_dir, "data")
      File.mkdir_p!(groups_dir)
      File.mkdir_p!(data_dir)

      assert {:ok, output} =
               ContainerRunner.run(group, input,
                 spawn_fn: mock_spawn,
                 project_root: test_dir,
                 groups_dir: groups_dir,
                 data_dir: data_dir,
                 exists_fn: fn _ -> false end,
                 read_file: fn _ -> {:error, :enoent} end
               )

      assert output.status == "success"
      assert output.result == "hello"
    end

    test "handles non-zero exit code", %{test_dir: test_dir} do
      mock_spawn = fn _args, _input, _timeout ->
        {:ok, 1, "", "some error"}
      end

      group = %{"folder" => "test", "name" => "Test Group"}

      input = %{
        prompt: "fail",
        session_id: nil,
        group_folder: "test",
        chat_jid: "123@g.us",
        is_main: true,
        is_scheduled_task: nil
      }

      groups_dir = Path.join(test_dir, "groups")
      data_dir = Path.join(test_dir, "data")
      File.mkdir_p!(groups_dir)
      File.mkdir_p!(data_dir)

      assert {:error, msg} =
               ContainerRunner.run(group, input,
                 spawn_fn: mock_spawn,
                 project_root: test_dir,
                 groups_dir: groups_dir,
                 data_dir: data_dir,
                 exists_fn: fn _ -> false end,
                 read_file: fn _ -> {:error, :enoent} end
               )

      assert msg =~ "exited with code 1"
    end

    test "handles spawn error", %{test_dir: test_dir} do
      mock_spawn = fn _args, _input, _timeout ->
        {:error, "docker not found"}
      end

      group = %{"folder" => "test", "name" => "Test Group"}

      input = %{
        prompt: "fail",
        session_id: nil,
        group_folder: "test",
        chat_jid: "123@g.us",
        is_main: true,
        is_scheduled_task: nil
      }

      groups_dir = Path.join(test_dir, "groups")
      data_dir = Path.join(test_dir, "data")
      File.mkdir_p!(groups_dir)
      File.mkdir_p!(data_dir)

      assert {:error, msg} =
               ContainerRunner.run(group, input,
                 spawn_fn: mock_spawn,
                 project_root: test_dir,
                 groups_dir: groups_dir,
                 data_dir: data_dir,
                 exists_fn: fn _ -> false end,
                 read_file: fn _ -> {:error, :enoent} end
               )

      assert msg =~ "spawn error"
    end
  end
end
