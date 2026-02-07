defmodule GuardianWeb.GithubIssueController do
  use GuardianWeb, :controller

  @owner_repo_re ~r/^[\w.\-]+$/

  def create(conn, _params) do
    body = conn.assigns.parsed_body

    with {:ok, owner} <- require_string(body, "owner"),
         {:ok, repo} <- require_string(body, "repo"),
         {:ok, title} <- require_string(body, "title"),
         :ok <- validate_owner_repo(owner, repo),
         :ok <- validate_title_length(title) do
      labels = body["labels"] || []

      unless is_list(labels) do
        throw(:invalid_labels)
      end

      %{status: 201, body: result} =
        Guardian.GitHub.post!("/repos/#{owner}/#{repo}/issues", %{
          title: title,
          body: body["body"] || "",
          labels: labels
        })

      json(conn, %{
        issue_number: result["number"],
        url: result["html_url"],
        status: "created"
      })
    else
      {:error, :missing, _field} ->
        conn |> put_status(400) |> json(%{error: "owner, repo, and title are required"})

      {:error, :invalid_format} ->
        conn |> put_status(400) |> json(%{error: "Invalid owner or repo format"})

      {:error, :title_too_long} ->
        conn |> put_status(400) |> json(%{error: "Title must be 256 characters or fewer"})
    end
  catch
    :invalid_labels ->
      conn |> put_status(400) |> json(%{error: "labels must be an array of strings"})
  end

  defp require_string(body, key) do
    case body[key] do
      val when is_binary(val) and val != "" -> {:ok, val}
      _ -> {:error, :missing, key}
    end
  end

  defp validate_owner_repo(owner, repo) do
    if Regex.match?(@owner_repo_re, owner) and Regex.match?(@owner_repo_re, repo) do
      :ok
    else
      {:error, :invalid_format}
    end
  end

  defp validate_title_length(title) do
    if String.length(title) <= 256, do: :ok, else: {:error, :title_too_long}
  end
end
