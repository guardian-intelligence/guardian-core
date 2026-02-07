defmodule GuardianWeb.Plugs.CacheBodyReader do
  @moduledoc """
  Custom body reader that caches the raw request body in `conn.assigns.raw_body`.

  Used by `Plug.Parsers` via the `:body_reader` option so that
  downstream plugs (like HMAC signature verification) can access
  the original bytes after parsing.
  """

  def read_body(conn, opts) do
    case Plug.Conn.read_body(conn, opts) do
      {:ok, body, conn} ->
        existing = conn.assigns[:raw_body] || ""
        conn = Plug.Conn.assign(conn, :raw_body, existing <> body)
        {:ok, body, conn}

      {:more, body, conn} ->
        existing = conn.assigns[:raw_body] || ""
        conn = Plug.Conn.assign(conn, :raw_body, existing <> body)
        {:more, body, conn}

      {:error, reason} ->
        {:error, reason}
    end
  end
end
