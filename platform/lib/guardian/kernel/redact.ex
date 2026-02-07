defmodule Guardian.Kernel.Redact do
  @moduledoc """
  Pure secret redaction engine — port of redact.ts.
  Scrubs WhatsApp JIDs, phone numbers, API keys, tokens, and sensitive paths.
  """

  @built_in_patterns [
    # WhatsApp JIDs: 1234567890@s.whatsapp.net
    {:whatsapp_jid, ~r/\d+@s\.whatsapp\.net/, "[JID]"},
    # WhatsApp group JIDs: 1234567890-1234567890@g.us
    {:whatsapp_group, ~r/\d+-\d+@g\.us/, "[GROUP_JID]"},
    # Phone numbers: +1234567890 (international, 10-15 digits after +)
    {:phone, ~r/\+\d{10,15}/, "[PHONE]"},
    # Anthropic API keys
    {:anthropic_key, ~r/sk-ant-[A-Za-z0-9_-]{20,}/, "[ANTHROPIC_KEY]"},
    # OpenAI API keys
    {:openai_key, ~r/sk-[A-Za-z0-9]{20,}/, "[OPENAI_KEY]"},
    # GitHub tokens
    {:github_token, ~r/gh[ps]_[A-Za-z0-9]{36,}/, "[GITHUB_TOKEN]"},
    # ElevenLabs API keys
    {:elevenlabs_key, ~r/xi-[A-Za-z0-9]{20,}/, "[ELEVENLABS_KEY]"},
    # Bearer tokens
    {:bearer, ~r/Bearer [A-Za-z0-9._-]{20,}/, "Bearer [TOKEN]"},
    # JWTs
    {:jwt, ~r/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "[JWT]"},
    # Home directory paths: /Users/username/...
    {:home_path, ~r/\/Users\/[\w.\/-]+/, "[HOME_PATH]"}
  ]

  @doc """
  Redact secrets from a line of text.
  Returns the redacted string.
  """
  @spec redact_line(String.t()) :: String.t()
  def redact_line(line) do
    Enum.reduce(@built_in_patterns, line, fn {_name, regex, replacement}, acc ->
      Regex.replace(regex, acc, replacement)
    end)
  end

  @doc """
  Returns the list of built-in pattern names.
  """
  @spec pattern_names() :: [atom()]
  def pattern_names do
    Enum.map(@built_in_patterns, fn {name, _regex, _replacement} -> name end)
  end
end
