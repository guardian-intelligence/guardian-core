defmodule Guardian.GitHub do
  @moduledoc """
  GitHub App authentication and API client.

  Generates RS256 JWTs from the app's private key, exchanges them for
  installation tokens, and caches tokens for up to 50 minutes.
  """

  use Agent

  @token_ttl_ms 50 * 60 * 1000

  def start_link(_opts) do
    Agent.start_link(fn -> %{token: nil, expires_at: 0} end, name: __MODULE__)
  end

  @doc """
  Returns authorization headers for GitHub API requests.
  Refreshes the installation token if expired.
  """
  def get_headers do
    token = get_or_refresh_token()
    [{"authorization", "token #{token}"}, {"accept", "application/vnd.github+json"}]
  end

  @doc """
  Makes a GET request to the GitHub API.
  """
  def get!(path, params \\ []) do
    url = "https://api.github.com#{path}"
    Req.get!(url, headers: get_headers(), params: params)
  end

  @doc """
  Makes a POST request to the GitHub API.
  """
  def post!(path, body) do
    url = "https://api.github.com#{path}"
    Req.post!(url, headers: get_headers(), json: body)
  end

  defp get_or_refresh_token do
    state = Agent.get(__MODULE__, & &1)
    now = System.system_time(:millisecond)

    if state.token && now < state.expires_at do
      state.token
    else
      token = fetch_installation_token()

      Agent.update(__MODULE__, fn _ ->
        %{token: token, expires_at: now + @token_ttl_ms}
      end)

      token
    end
  end

  defp fetch_installation_token do
    config = Application.fetch_env!(:guardian, :github)
    jwt = generate_jwt(config[:app_id], config[:private_key])
    installation_id = config[:installation_id]

    %{status: 201, body: body} =
      Req.post!("https://api.github.com/app/installations/#{installation_id}/access_tokens",
        headers: [
          {"authorization", "Bearer #{jwt}"},
          {"accept", "application/vnd.github+json"}
        ]
      )

    body["token"]
  end

  defp generate_jwt(app_id, private_key) do
    now = System.system_time(:second)

    claims = %{
      "iat" => now - 60,
      "exp" => now + 10 * 60,
      "iss" => app_id
    }

    jwk = JOSE.JWK.from_pem(private_key)
    jws = %{"alg" => "RS256"}

    {_, token} = JOSE.JWT.sign(jwk, jws, claims) |> JOSE.JWS.compact()
    token
  end
end
