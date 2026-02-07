defmodule GuardianWeb.Plugs.ElevenLabsSignatureTest do
  use ExUnit.Case, async: true
  import Plug.Test
  import Plug.Conn

  alias GuardianWeb.Plugs.ElevenLabsSignature

  @secret "test-webhook-secret"

  setup do
    Application.put_env(:guardian, :elevenlabs_webhook_secret, @secret)
    on_exit(fn -> Application.delete_env(:guardian, :elevenlabs_webhook_secret) end)
    :ok
  end

  defp sign_body(body, opts) do
    timestamp = opts[:timestamp] || System.system_time(:second)
    secret = opts[:secret] || @secret
    message = "#{timestamp}.#{body}"
    signature = :crypto.mac(:hmac, :sha256, secret, message) |> Base.encode16(case: :lower)
    "t=#{timestamp},v0=#{signature}"
  end

  defp build_signed_conn(body, opts \\ []) do
    header = sign_body(body, opts)

    conn(:post, "/tools/github-status", body)
    |> put_req_header("content-type", "application/json")
    |> put_req_header("elevenlabs-signature", header)
    |> Plug.Conn.assign(:raw_body, body)
  end

  test "valid signature assigns parsed_body" do
    body = Jason.encode!(%{owner: "test", repo: "repo"})
    conn = build_signed_conn(body) |> ElevenLabsSignature.call([])

    refute conn.halted
    assert conn.assigns.parsed_body == %{"owner" => "test", "repo" => "repo"}
  end

  test "missing signature header returns 401" do
    conn =
      conn(:post, "/tools/github-status", "")
      |> put_req_header("content-type", "application/json")
      |> Plug.Conn.assign(:raw_body, "")
      |> ElevenLabsSignature.call([])

    assert conn.status == 401
    assert Jason.decode!(conn.resp_body) == %{"error" => "Missing signature"}
  end

  test "invalid signature returns 401" do
    body = Jason.encode!(%{owner: "test", repo: "repo"})
    timestamp = System.system_time(:second)
    header = "t=#{timestamp},v0=deadbeef"

    conn =
      conn(:post, "/tools/github-status", body)
      |> put_req_header("content-type", "application/json")
      |> put_req_header("elevenlabs-signature", header)
      |> Plug.Conn.assign(:raw_body, body)
      |> ElevenLabsSignature.call([])

    assert conn.status == 401
    assert Jason.decode!(conn.resp_body) == %{"error" => "Invalid signature"}
  end

  test "expired timestamp returns 401" do
    body = Jason.encode!(%{owner: "test", repo: "repo"})
    old_timestamp = System.system_time(:second) - 600

    conn = build_signed_conn(body, timestamp: old_timestamp) |> ElevenLabsSignature.call([])

    assert conn.status == 401
    assert Jason.decode!(conn.resp_body) == %{"error" => "Timestamp too old"}
  end

  test "missing secret returns 500" do
    Application.delete_env(:guardian, :elevenlabs_webhook_secret)
    body = Jason.encode!(%{test: true})

    conn =
      conn(:post, "/tools/github-status", body)
      |> put_req_header("content-type", "application/json")
      |> Plug.Conn.assign(:raw_body, body)
      |> ElevenLabsSignature.call([])

    assert conn.status == 500
    assert Jason.decode!(conn.resp_body) == %{"error" => "Server misconfigured"}
  end
end
