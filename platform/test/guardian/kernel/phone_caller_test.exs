defmodule Guardian.Kernel.PhoneCallerTest do
  use ExUnit.Case, async: true

  alias Guardian.Kernel.PhoneCaller

  describe "sanitize_reason/1" do
    test "passes through normal text" do
      assert PhoneCaller.sanitize_reason("Server is down, check immediately") ==
               "Server is down, check immediately"
    end

    test "truncates to max length" do
      long = String.duplicate("a", 600)
      result = PhoneCaller.sanitize_reason(long)
      assert String.length(result) == 500
    end

    test "trims whitespace" do
      assert PhoneCaller.sanitize_reason("  hello  ") == "hello"
    end
  end

  describe "load_voice_prompt/3" do
    test "uses fallback when file not found" do
      prompt =
        PhoneCaller.load_voice_prompt("owner", "Shovon",
          read_file: fn _ -> {:error, :enoent} end
        )

      assert prompt =~ "Rumi"
      assert prompt =~ "digital operations assistant"
    end

    test "injects owner instructions" do
      template = "Base prompt. {{CONTACT_CLASS_INSTRUCTIONS}}"

      prompt =
        PhoneCaller.load_voice_prompt("owner", "Shovon",
          read_file: fn _ -> {:ok, template} end
        )

      assert prompt =~ "your owner"
      refute prompt =~ "{{CONTACT_CLASS_INSTRUCTIONS}}"
    end

    test "injects third_party instructions with name" do
      template = "Base prompt. {{CONTACT_CLASS_INSTRUCTIONS}}"

      prompt =
        PhoneCaller.load_voice_prompt("third_party", "Alice",
          read_file: fn _ -> {:ok, template} end
        )

      assert prompt =~ "calling Alice"
      refute prompt =~ "{{name}}"
    end
  end

  describe "build_first_message/2" do
    test "owner message mentions WhatsApp" do
      msg = PhoneCaller.build_first_message("server is down", "owner")
      assert msg =~ "server is down"
      assert msg =~ "WhatsApp"
    end

    test "third_party message mentions Shovon" do
      msg = PhoneCaller.build_first_message("delivery update", "third_party")
      assert msg =~ "delivery update"
      assert msg =~ "Shovon"
    end
  end

  describe "make_call/5" do
    test "returns error when env vars missing" do
      assert {:error, msg} =
               PhoneCaller.make_call("reason", "+1234", "owner", "Test",
                 api_key: nil,
                 agent_id: nil,
                 phone_number_id: nil
               )

      assert msg =~ "Missing env vars"
    end

    test "makes HTTP call with correct payload" do
      test_pid = self()

      mock_post = fn url, body, headers ->
        send(test_pid, {:http_post, url, body, headers})

        {:ok,
         %{
           status: 200,
           body: Jason.encode!(%{"conversation_id" => "conv-123"})
         }}
      end

      :ok =
        PhoneCaller.make_call("server down", "+14155551234", "owner", "Shovon",
          api_key: "fake-key",
          agent_id: "agent-1",
          phone_number_id: "phone-1",
          http_post: mock_post,
          # Disable transcript polling for test
          http_get: fn _url, _headers -> {:ok, %{status: 200, body: ~s({"status": "done", "transcript": []})}} end,
          read_file: fn _ -> {:error, :enoent} end
        )

      assert_receive {:http_post, url, body, headers}
      assert url =~ "elevenlabs.io"
      assert is_binary(body)

      decoded = Jason.decode!(body)
      assert decoded["agent_id"] == "agent-1"
      assert decoded["to_number"] == "+14155551234"

      assert Enum.any?(headers, fn {k, v} -> k == "xi-api-key" and v == "fake-key" end)
    end

    test "handles API error response" do
      mock_post = fn _url, _body, _headers ->
        {:ok, %{status: 422, body: "Invalid request"}}
      end

      assert {:error, msg} =
               PhoneCaller.make_call("reason", "+1234", "owner", "Test",
                 api_key: "key",
                 agent_id: "agent",
                 phone_number_id: "phone",
                 http_post: mock_post
               )

      assert msg =~ "422"
    end
  end
end
