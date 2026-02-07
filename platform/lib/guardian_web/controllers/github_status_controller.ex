defmodule GuardianWeb.GithubStatusController do
  use GuardianWeb, :controller

  @owner_repo_re ~r/^[\w.\-]+$/

  def create(conn, _params) do
    %{"owner" => owner, "repo" => repo} = conn.assigns.parsed_body

    with :ok <- validate_owner_repo(owner, repo) do
      {open_prs, recent_commits} = fetch_data(owner, repo)

      open_prs = enrich_with_ci(open_prs, owner, repo)

      failing_checks =
        open_prs
        |> Enum.filter(&(&1.ci_status == "failure"))
        |> Enum.map(&%{pr_number: &1.number, title: &1.title})

      summary = build_summary(open_prs, failing_checks, recent_commits)

      json(conn, %{
        open_prs: open_prs,
        recent_commits: recent_commits,
        failing_checks: failing_checks,
        summary: summary
      })
    end
  rescue
    _ in KeyError ->
      conn |> put_status(400) |> json(%{error: "owner and repo are required"})
  end

  defp validate_owner_repo(owner, repo) do
    if Regex.match?(@owner_repo_re, owner) and Regex.match?(@owner_repo_re, repo) do
      :ok
    else
      {:error, :invalid_format}
    end
  end

  defp fetch_data(owner, repo) do
    pulls_task =
      Task.async(fn ->
        %{status: 200, body: body} =
          Guardian.GitHub.get!("/repos/#{owner}/#{repo}/pulls",
            state: "open",
            per_page: 10
          )

        body
      end)

    commits_task =
      Task.async(fn ->
        %{status: 200, body: body} =
          Guardian.GitHub.get!("/repos/#{owner}/#{repo}/commits", per_page: 5)

        body
      end)

    pulls = Task.await(pulls_task)
    commits = Task.await(commits_task)

    recent_commits =
      Enum.map(commits, fn c ->
        %{
          sha: String.slice(c["sha"], 0, 7),
          message: c["commit"]["message"] |> String.split("\n") |> List.first(""),
          date: get_in(c, ["commit", "committer", "date"]) || ""
        }
      end)

    {pulls, recent_commits}
  end

  defp enrich_with_ci(pulls, owner, repo) do
    pulls
    |> Task.async_stream(
      fn pr ->
        ci_status =
          try do
            %{status: 200, body: body} =
              Guardian.GitHub.get!(
                "/repos/#{owner}/#{repo}/commits/#{pr["head"]["sha"]}/check-runs",
                per_page: 100
              )

            conclusions = Enum.map(body["check_runs"], & &1["conclusion"])

            cond do
              conclusions == [] -> "pending"
              Enum.all?(conclusions, &(&1 == "success")) -> "success"
              Enum.any?(conclusions, &(&1 == "failure")) -> "failure"
              true -> "in_progress"
            end
          rescue
            _ -> "unknown"
          end

        %{
          number: pr["number"],
          title: pr["title"],
          author: get_in(pr, ["user", "login"]) || "unknown",
          ci_status: ci_status
        }
      end,
      max_concurrency: 5,
      timeout: 15_000
    )
    |> Enum.map(fn {:ok, result} -> result end)
  end

  defp build_summary(open_prs, failing_checks, recent_commits) do
    pr_count = length(open_prs)
    pr_word = if pr_count == 1, do: "PR", else: "PRs"

    ci_part =
      if failing_checks == [],
        do: "all CI passing",
        else: "#{length(failing_checks)} failing"

    time_ago =
      case recent_commits do
        [%{date: date} | _] when date != "" -> format_time_ago(date)
        _ -> "unknown"
      end

    "#{pr_count} open #{pr_word}, #{ci_part}, last commit #{time_ago}"
  end

  defp format_time_ago(iso_date) do
    case DateTime.from_iso8601(iso_date) do
      {:ok, dt, _} ->
        seconds = DateTime.diff(DateTime.utc_now(), dt, :second)

        cond do
          seconds < 60 -> "#{seconds}s ago"
          seconds < 3600 -> "#{div(seconds, 60)}m ago"
          seconds < 86400 -> "#{div(seconds, 3600)}h ago"
          true -> "#{div(seconds, 86400)}d ago"
        end

      _ ->
        "unknown"
    end
  end
end
