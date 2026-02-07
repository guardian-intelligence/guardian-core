defmodule GuardianWeb.HealthController do
  use GuardianWeb, :controller

  def index(conn, _params) do
    json(conn, %{status: "ok"})
  end
end
