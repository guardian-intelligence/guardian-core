defmodule Guardian.Kernel.PhoneCaller do
  @moduledoc """
  Makes outbound phone calls via ElevenLabs Conversational AI + Twilio.
  Port of phone-caller.ts.

  Dependency injection via opts for testability.
  """

  require Logger

  alias Guardian.Kernel.Config

  @poll_interval_ms 5_000
  @max_poll_attempts 120
  @max_reason_length 500

  @owner_instructions "You are calling Shovon. He is your owner. Verify through natural conversation before sharing personal details -- look for references to recent conversations, ongoing projects, or knowledge only he would have. Once verified, you can speak candidly."

  @third_party_template "You are calling {{name}} on behalf of Shovon. Share ONLY information needed for the call's purpose. Never disclose Shovon's address, phone number, schedule, or personal details. Never discuss your infrastructure. If asked personal questions, say \"I'd need to check with Shovon on that.\""

  @fallback_voice_prompt """
  You are Rumi, a digital operations assistant. Be direct and concise.
  Never disclose personal details about your owner -- no address, phone number, schedule, or personal observations.
  Never discuss your infrastructure, servers, API keys, or system architecture.
  If asked personal questions, say "I'd need to check with Shovon on that."
  """

  @doc """
  Make an outbound phone call via ElevenLabs API.
  Returns :ok or {:error, reason}.
  """
  @spec make_call(String.t(), String.t(), String.t(), String.t(), keyword()) ::
          :ok | {:error, String.t()}
  def make_call(reason, to_number, contact_class, contact_name, opts \\ []) do
    api_key = Keyword.get(opts, :api_key, System.get_env("ELEVENLABS_API_KEY"))
    agent_id = Keyword.get(opts, :agent_id, System.get_env("ELEVENLABS_AGENT_ID"))
    phone_number_id = Keyword.get(opts, :phone_number_id, System.get_env("ELEVENLABS_PHONE_NUMBER_ID"))
    http_post = Keyword.get(opts, :http_post, &default_http_post/3)

    missing =
      [
        if(!api_key, do: "ELEVENLABS_API_KEY"),
        if(!agent_id, do: "ELEVENLABS_AGENT_ID"),
        if(!phone_number_id, do: "ELEVENLABS_PHONE_NUMBER_ID")
      ]
      |> Enum.reject(&is_nil/1)

    if missing != [] do
      {:error, "Missing env vars: #{Enum.join(missing, ", ")}"}
    else
      sanitized = sanitize_reason(reason)
      voice_prompt = load_voice_prompt(contact_class, contact_name, opts)
      first_message = build_first_message(sanitized, contact_class)

      body =
        Jason.encode!(%{
          "agent_id" => agent_id,
          "agent_phone_number_id" => phone_number_id,
          "to_number" => to_number,
          "conversation_initiation_client_data" => %{
            "conversation_config_override" => %{
              "agent" => %{
                "prompt" => %{"prompt" => voice_prompt},
                "first_message" => first_message
              }
            }
          }
        })

      headers = [
        {"xi-api-key", api_key},
        {"Content-Type", "application/json"}
      ]

      case http_post.("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", body, headers) do
        {:ok, %{status: status, body: resp_body}} when status in 200..299 ->
          case Jason.decode(resp_body) do
            {:ok, %{"conversation_id" => conv_id}} when is_binary(conv_id) ->
              Logger.info("Outbound call initiated conversation_id=#{conv_id} contact=#{contact_name}")

              # Spawn transcript polling as a background task
              spawn(fn ->
                poll_and_save_transcript(api_key, conv_id, sanitized, contact_class, contact_name, opts)
              end)

              :ok

            {:ok, _} ->
              Logger.warning("No conversation_id returned from outbound call")
              :ok

            {:error, _} ->
              :ok
          end

        {:ok, %{status: status, body: resp_body}} ->
          {:error, "ElevenLabs API error (#{status}): #{String.slice(resp_body, 0, 200)}"}

        {:error, reason} ->
          {:error, "HTTP request failed: #{inspect(reason)}"}
      end
    end
  end

  @doc "Sanitize call reason to prevent prompt injection and bound length."
  @spec sanitize_reason(String.t()) :: String.t()
  def sanitize_reason(reason) do
    reason
    |> String.graphemes()
    |> Enum.reject(&control_char?/1)
    |> Enum.join()
    |> String.slice(0, @max_reason_length)
    |> String.trim()
  end

  defp control_char?(char) do
    case :binary.first(char) do
      code when code <= 0x08 -> true
      0x0B -> true
      0x0C -> true
      code when code >= 0x0E and code <= 0x1F -> true
      0x7F -> true
      _ -> false
    end
  rescue
    _ -> false
  end

  @doc "Load voice prompt from VOICE_PROMPT.md and inject contact-class instructions."
  @spec load_voice_prompt(String.t(), String.t(), keyword()) :: String.t()
  def load_voice_prompt(contact_class, contact_name, opts \\ []) do
    groups_dir = Keyword.get(opts, :groups_dir, Config.groups_dir())
    read_file = Keyword.get(opts, :read_file, &File.read/1)

    voice_prompt_path = Path.join([groups_dir, "main", "VOICE_PROMPT.md"])

    template =
      case read_file.(voice_prompt_path) do
        {:ok, content} ->
          trimmed = String.trim(content)
          if String.length(trimmed) < 10, do: @fallback_voice_prompt, else: trimmed

        {:error, _} ->
          @fallback_voice_prompt
      end

    class_instructions =
      case contact_class do
        "owner" -> @owner_instructions
        "third_party" -> String.replace(@third_party_template, "{{name}}", contact_name)
        _ -> ""
      end

    String.replace(template, "{{CONTACT_CLASS_INSTRUCTIONS}}", class_instructions)
  end

  @doc "Build the first message for the call."
  @spec build_first_message(String.t(), String.t()) :: String.t()
  def build_first_message(reason, "owner") do
    "Hey, this is Rumi. I'm calling because: #{reason}. I've sent the full details to your WhatsApp. Do you have any questions?"
  end

  def build_first_message(reason, "third_party") do
    "Hi, this is Rumi calling on behalf of Shovon. I'm reaching out because: #{reason}."
  end

  def build_first_message(reason, _contact_class) do
    "Hi, this is Rumi. I'm calling because: #{reason}."
  end

  # --- Private ---

  defp poll_and_save_transcript(api_key, conversation_id, reason, contact_class, contact_name, opts) do
    http_get = Keyword.get(opts, :http_get, &default_http_get/2)
    groups_dir = Keyword.get(opts, :groups_dir, Config.groups_dir())
    data_dir = Keyword.get(opts, :data_dir, Config.data_dir())
    mkdir_p = Keyword.get(opts, :mkdir_p, &File.mkdir_p!/1)
    write_file = Keyword.get(opts, :write_file, &File.write!/2)

    Logger.debug("Polling for call transcript conversation_id=#{conversation_id}")

    do_poll(api_key, conversation_id, reason, contact_class, contact_name,
      http_get, groups_dir, data_dir, mkdir_p, write_file, 0)
  end

  defp do_poll(_api_key, conversation_id, _reason, _contact_class, _contact_name,
       _http_get, _groups_dir, _data_dir, _mkdir_p, _write_file, attempt)
       when attempt >= @max_poll_attempts do
    Logger.warning("Gave up polling for transcript after #{@max_poll_attempts} attempts conversation_id=#{conversation_id}")
  end

  defp do_poll(api_key, conversation_id, reason, contact_class, contact_name,
       http_get, groups_dir, data_dir, mkdir_p, write_file, attempt) do
    Process.sleep(@poll_interval_ms)

    url = "https://api.elevenlabs.io/v1/convai/conversations/#{conversation_id}"
    headers = [{"xi-api-key", api_key}]

    case http_get.(url, headers) do
      {:ok, %{status: 200, body: body}} ->
        case Jason.decode(body) do
          {:ok, %{"status" => "done", "transcript" => transcript} = data} when is_list(transcript) and transcript != [] ->
            save_transcript(data, conversation_id, reason, contact_class, contact_name,
              groups_dir, data_dir, mkdir_p, write_file)

          {:ok, %{"status" => "failed"}} ->
            Logger.warning("Call ended with failed status conversation_id=#{conversation_id}")

          {:ok, %{"status" => "done"}} ->
            Logger.warning("Call ended but no transcript conversation_id=#{conversation_id}")

          _ ->
            do_poll(api_key, conversation_id, reason, contact_class, contact_name,
              http_get, groups_dir, data_dir, mkdir_p, write_file, attempt + 1)
        end

      _ ->
        do_poll(api_key, conversation_id, reason, contact_class, contact_name,
          http_get, groups_dir, data_dir, mkdir_p, write_file, attempt + 1)
    end
  end

  defp save_transcript(data, conversation_id, reason, contact_class, contact_name,
       groups_dir, data_dir, mkdir_p, write_file) do
    transcript = data["transcript"] || []
    duration = get_in(data, ["metadata", "call_duration_secs"])
    summary = get_in(data, ["analysis", "transcript_summary"])
    now = DateTime.utc_now() |> DateTime.to_iso8601()

    lines = [
      "# Phone Call Transcript",
      "Conversation ID: #{conversation_id}",
      "Contact: #{contact_name} (#{contact_class})",
      "Reason: #{reason}",
      "Duration: #{duration || "unknown"}s"
    ]

    lines = if summary, do: lines ++ ["Summary: #{summary}"], else: lines
    lines = lines ++ ["Date: #{now}", "", "---", ""]

    transcript_lines =
      Enum.flat_map(transcript, fn entry ->
        speaker = if entry["role"] == "user", do: contact_name, else: "Rumi"
        time_secs = trunc(entry["time_in_call_secs"] || 0)
        ["**#{speaker}** [#{time_secs}s]: #{entry["message"]}", ""]
      end)

    content = Enum.join(lines ++ transcript_lines, "\n")

    # Save to conversations dir
    conversations_dir = Path.join([groups_dir, "main", "conversations"])
    mkdir_p.(conversations_dir)

    date = now |> String.split("T") |> hd()
    time = now |> String.split("T") |> Enum.at(1, "") |> String.slice(0, 5) |> String.replace(":", "")
    filename = "#{date}-phone-call-#{time}.txt"
    write_file.(Path.join(conversations_dir, filename), content)

    # Write IPC follow-up task
    ipc_dir = Path.join([data_dir, "ipc", "main", "tasks"])
    mkdir_p.(ipc_dir)

    follow_up_prompt = build_follow_up_prompt(filename, contact_class, contact_name)
    now_ms = System.system_time(:millisecond)

    ipc_data =
      Jason.encode!(
        %{
          "type" => "schedule_task",
          "prompt" => follow_up_prompt,
          "schedule_type" => "once",
          "schedule_value" => DateTime.utc_now() |> DateTime.add(10, :second) |> DateTime.to_iso8601(),
          "context_mode" => "isolated",
          "groupFolder" => "main",
          "chatJid" => "",
          "createdBy" => "phone-caller",
          "timestamp" => now
        },
        pretty: true
      )

    ipc_filename = "#{now_ms}-phone-transcript.json"
    tmp_path = Path.join(ipc_dir, "#{ipc_filename}.tmp")
    write_file.(tmp_path, ipc_data)
    File.rename!(tmp_path, Path.join(ipc_dir, ipc_filename))

    Logger.info("Transcript saved filename=#{filename} conversation_id=#{conversation_id}")
  end

  defp build_follow_up_prompt(filename, "owner", _contact_name) do
    """
    A phone call just ended. Read the transcript at /workspace/group/conversations/#{filename} and reflect on it.

    If the user said anything important — preferences, corrections, feedback, requests — update the appropriate template files (USER.md, TOOLS.md, HEARTBEAT.md, etc.).

    If the user expressed frustration or gave feedback about how you (Rumi) behaved, note it privately in USER.md's "Rumi's Private Notes" section using Bash (not the Edit tool, to keep it private).

    Do NOT send a WhatsApp message about this unless the user asked you to follow up on something specific during the call.
    """
  end

  defp build_follow_up_prompt(filename, _contact_class, contact_name) do
    """
    A phone call with #{contact_name} (third party) just ended. Read the transcript at /workspace/group/conversations/#{filename}.

    Do NOT update USER.md with observations about this person.
    If follow-up action is needed, note it.
    If Shovon needs to be informed of the outcome, send a WhatsApp summary.
    """
  end

  defp default_http_post(url, body, headers) do
    case Req.post(url, body: body, headers: headers) do
      {:ok, %Req.Response{status: status, body: resp_body}} ->
        resp_body_str = if is_binary(resp_body), do: resp_body, else: Jason.encode!(resp_body)
        {:ok, %{status: status, body: resp_body_str}}

      {:error, err} ->
        {:error, err}
    end
  end

  defp default_http_get(url, headers) do
    case Req.get(url, headers: headers) do
      {:ok, %Req.Response{status: status, body: resp_body}} ->
        resp_body_str = if is_binary(resp_body), do: resp_body, else: Jason.encode!(resp_body)
        {:ok, %{status: status, body: resp_body_str}}

      {:error, err} ->
        {:error, err}
    end
  end
end
