# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :guardian,
  generators: [timestamp_type: :utc_datetime],
  ecto_repos: [Guardian.Repo],
  kernel_enabled: false

# Ecto SQLite3 — db_path resolved at runtime in config/runtime.exs
config :guardian, Guardian.Repo,
  database: "store/messages.db"

# Configure the endpoint
config :guardian, GuardianWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: GuardianWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Guardian.PubSub,
  live_view: [signing_salt: "7rPYgvyL"]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
