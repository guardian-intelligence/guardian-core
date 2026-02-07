defmodule Guardian.Deploy.PemValidator do
  @moduledoc """
  Pure PEM format validation for server .env files.

  Checks that `GITHUB_APP_PRIVATE_KEY` is:
  - Not quoted
  - Contains literal `\\n` escapes
  - Not duplicated
  """

  @doc """
  Validate a server .env file's PEM key format.
  Returns an empty list on success, or a list of error strings.
  """
  @spec validate(String.t()) :: [String.t()]
  def validate(content) do
    lines = String.split(content, "\n")
    key_lines = Enum.filter(lines, &String.starts_with?(&1, "GITHUB_APP_PRIVATE_KEY="))

    case key_lines do
      [] ->
        []

      key_lines ->
        errors = []

        errors =
          if length(key_lines) > 1 do
            ["Multiple GITHUB_APP_PRIVATE_KEY= lines found" | errors]
          else
            errors
          end

        key_line = hd(key_lines)

        errors =
          if String.starts_with?(key_line, "GITHUB_APP_PRIVATE_KEY=\"") do
            ["GITHUB_APP_PRIVATE_KEY must not be quoted" | errors]
          else
            errors
          end

        errors =
          if not String.contains?(key_line, "\\n") do
            ["GITHUB_APP_PRIVATE_KEY missing literal \\n escapes" | errors]
          else
            errors
          end

        Enum.reverse(errors)
    end
  end
end
