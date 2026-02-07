defmodule GuardianWeb.Router do
  use GuardianWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :signed do
    plug :accepts, ["json"]
    plug GuardianWeb.Plugs.ElevenLabsSignature
  end

  scope "/", GuardianWeb do
    pipe_through :api

    get "/health", HealthController, :index
  end

  scope "/tools", GuardianWeb do
    pipe_through :signed

    post "/github-status", GithubStatusController, :create
    post "/github-issue", GithubIssueController, :create
  end
end
