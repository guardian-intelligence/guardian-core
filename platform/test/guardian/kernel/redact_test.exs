defmodule Guardian.Kernel.RedactTest do
  use ExUnit.Case, async: true

  alias Guardian.Kernel.Redact

  test "redacts WhatsApp individual JIDs" do
    assert Redact.redact_line("from 1234567890@s.whatsapp.net") == "from [JID]"
  end

  test "redacts WhatsApp group JIDs" do
    assert Redact.redact_line("group 120363123456789012-1234567890@g.us") == "group [GROUP_JID]"
  end

  test "redacts phone numbers" do
    assert Redact.redact_line("call +14155551234") == "call [PHONE]"
  end

  test "redacts Anthropic API keys" do
    assert Redact.redact_line("key sk-ant-abcdefghij1234567890") == "key [ANTHROPIC_KEY]"
  end

  test "redacts OpenAI API keys" do
    assert Redact.redact_line("key sk-abcdefghijklmnopqrstuv") == "key [OPENAI_KEY]"
  end

  test "redacts GitHub tokens" do
    token = "ghp_" <> String.duplicate("a", 36)
    assert Redact.redact_line("token #{token}") == "token [GITHUB_TOKEN]"
  end

  test "redacts ElevenLabs API keys" do
    assert Redact.redact_line("key xi-abcdefghijklmnopqrstuv") == "key [ELEVENLABS_KEY]"
  end

  test "redacts Bearer tokens" do
    assert Redact.redact_line("Authorization: Bearer eyJhbGciOiJSUzI1NiJ9") ==
             "Authorization: Bearer [TOKEN]"
  end

  test "redacts JWTs" do
    jwt = "eyJhbGciOiJSUzI.eyJzdWIiOiIxMjM.SflKxwRJSMeKKF2"
    assert Redact.redact_line("token #{jwt}") == "token [JWT]"
  end

  test "redacts macOS home directory paths" do
    assert Redact.redact_line("reading /Users/shovon/secrets/key.pem") ==
             "reading [HOME_PATH]"
  end

  test "leaves normal text unchanged" do
    assert Redact.redact_line("hello world") == "hello world"
  end

  test "redacts multiple patterns in one line" do
    line = "from 1234567890@s.whatsapp.net to +14155551234"
    assert Redact.redact_line(line) == "from [JID] to [PHONE]"
  end

  test "pattern_names returns all 10 patterns" do
    names = Redact.pattern_names()
    assert length(names) == 10
    assert :whatsapp_jid in names
    assert :whatsapp_group in names
    assert :phone in names
    assert :anthropic_key in names
    assert :openai_key in names
    assert :github_token in names
    assert :elevenlabs_key in names
    assert :bearer in names
    assert :jwt in names
    assert :home_path in names
  end
end
