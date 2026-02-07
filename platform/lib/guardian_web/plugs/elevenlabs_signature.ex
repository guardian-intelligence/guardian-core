defmodule GuardianWeb.Plugs.ElevenLabsSignature do
  @moduledoc """
  Plug that verifies ElevenLabs webhook signatures.

  Parses the `ElevenLabs-Signature` header (`t=<ts>,v0=<hex>`),
  computes HMAC-SHA256 of `"<timestamp>.<raw_body>"`, and performs
  timing-safe comparison. Rejects requests with >5 min timestamp drift.

  Stores the parsed JSON body in `conn.assigns.parsed_body`.
  """

  import Plug.Conn
  @behaviour Plug

  @max_drift_ms 5 * 60 * 1000

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    secret = Application.get_env(:guardian, :elevenlabs_webhook_secret)

    if is_nil(secret) do
      conn
      |> put_resp_content_type("application/json")
      |> send_resp(500, Jason.encode!(%{error: "Server misconfigured"}))
      |> halt()
    else
      verify(conn, secret)
    end
  end

  defp verify(conn, secret) do
    case get_req_header(conn, "elevenlabs-signature") do
      [header] -> verify_header(conn, secret, header)
      _ -> reject(conn, 401, "Missing signature")
    end
  end

  defp verify_header(conn, secret, header) do
    parts = parse_signature_header(header)
    timestamp = parts["t"]
    signature = parts["v0"]

    cond do
      is_nil(timestamp) or is_nil(signature) ->
        reject(conn, 401, "Invalid signature format")

      not valid_timestamp?(timestamp) ->
        reject(conn, 401, "Invalid timestamp")

      timestamp_drifted?(timestamp) ->
        reject(conn, 401, "Timestamp too old")

      true ->
        raw_body = conn.assigns[:raw_body] || ""
        message = "#{timestamp}.#{raw_body}"
        expected = :crypto.mac(:hmac, :sha256, secret, message) |> Base.encode16(case: :lower)

        if Plug.Crypto.secure_compare(expected, signature) do
          parsed = Jason.decode!(raw_body)
          assign(conn, :parsed_body, parsed)
        else
          reject(conn, 401, "Invalid signature")
        end
    end
  end

  defp parse_signature_header(header) do
    header
    |> String.split(",")
    |> Enum.map(fn part ->
      case String.split(part, "=", parts: 2) do
        [key, value] -> {key, value}
        _ -> nil
      end
    end)
    |> Enum.reject(&is_nil/1)
    |> Map.new()
  end

  defp valid_timestamp?(ts) do
    case Integer.parse(ts) do
      {_n, ""} -> true
      _ -> false
    end
  end

  defp timestamp_drifted?(ts) do
    {unix_seconds, ""} = Integer.parse(ts)
    timestamp_ms = unix_seconds * 1000
    now_ms = System.system_time(:millisecond)
    abs(now_ms - timestamp_ms) > @max_drift_ms
  end

  defp reject(conn, status, message) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(%{error: message}))
    |> halt()
  end
end
