ExUnit.start()

# Run idempotent migrations for test DB
Guardian.Repo.Migrations.run!()
