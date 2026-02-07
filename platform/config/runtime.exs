import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere.

# Resolve project root for kernel paths (DB, groups, etc.)
project_root = System.get_env("GUARDIAN_PROJECT_ROOT", File.cwd!())
config :guardian, :project_root, project_root

# SQLite database path — resolved at runtime to match TS kernel's store/messages.db
if config_env() != :test do
  db_path = Path.join([project_root, "store", "messages.db"])
  File.mkdir_p!(Path.dirname(db_path))
  config :guardian, Guardian.Repo, database: db_path
end

if System.get_env("PHX_SERVER") do
  config :guardian, GuardianWeb.Endpoint, server: true
end

config :guardian, GuardianWeb.Endpoint,
  http: [port: String.to_integer(System.get_env("PORT", "4000"))]

# Enable kernel in production
if config_env() == :prod do
  config :guardian, :kernel_enabled, true
end

if config_env() == :prod do
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "self.rumi.engineering"

  config :guardian, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  config :guardian, GuardianWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [ip: {0, 0, 0, 0, 0, 0, 0, 0}],
    secret_key_base: secret_key_base

  # GitHub App — fail-closed: app won't start without these
  github_app_id =
    System.get_env("GITHUB_APP_ID") ||
      raise "environment variable GITHUB_APP_ID is missing"

  github_private_key =
    (System.get_env("GITHUB_APP_PRIVATE_KEY") ||
       raise "environment variable GITHUB_APP_PRIVATE_KEY is missing")
    |> String.replace("\\n", "\n")

  github_installation_id =
    System.get_env("GITHUB_APP_INSTALLATION_ID") ||
      raise "environment variable GITHUB_APP_INSTALLATION_ID is missing"

  config :guardian, :github,
    app_id: github_app_id,
    private_key: github_private_key,
    installation_id: github_installation_id

  # ElevenLabs webhook — fail-closed
  elevenlabs_secret =
    System.get_env("ELEVENLABS_WEBHOOK_SECRET") ||
      raise "environment variable ELEVENLABS_WEBHOOK_SECRET is missing"

  config :guardian, :elevenlabs_webhook_secret, elevenlabs_secret
end

# Dev/test: optional env-based config (won't crash if missing)
if config_env() in [:dev, :test] do
  if github_app_id = System.get_env("GITHUB_APP_ID") do
    config :guardian, :github,
      app_id: github_app_id,
      private_key: (System.get_env("GITHUB_APP_PRIVATE_KEY") || "") |> String.replace("\\n", "\n"),
      installation_id: System.get_env("GITHUB_APP_INSTALLATION_ID") || ""
  end

  if elevenlabs_secret = System.get_env("ELEVENLABS_WEBHOOK_SECRET") do
    config :guardian, :elevenlabs_webhook_secret, elevenlabs_secret
  end
end
