import Config

# We don't run a server during test. If one is required,
# you can enable the server option below.
config :guardian, GuardianWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: "BUxqYyuNf3jxTYmfvnvunCyMD+Cv1ZJy6kHaQPsQks6sJ7A85YKq24NwpF9FpX7e",
  server: false

# Use an in-memory SQLite DB for tests
config :guardian, Guardian.Repo,
  database: ":memory:",
  pool_size: 1

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true
