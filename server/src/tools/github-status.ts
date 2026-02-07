import type { Context } from "hono";
import { getOctokit } from "../lib/github.ts";

interface StatusParams {
	owner?: string;
	repo?: string;
}

export async function handleGithubStatus(c: Context) {
	const params = c.get("parsedBody") as StatusParams;
	const { owner, repo } = params;

	if (!owner || !repo) {
		return c.json({ error: "owner and repo are required" }, 400);
	}

	if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
		return c.json({ error: "Invalid owner or repo format" }, 400);
	}

	const octokit = getOctokit();

	const [pullsRes, commitsRes] = await Promise.all([
		octokit.pulls.list({ owner, repo, state: "open", per_page: 10 }),
		octokit.repos.listCommits({ owner, repo, per_page: 5 }),
	]);

	const openPrs = await Promise.all(
		pullsRes.data.map(async (pr) => {
			let ciStatus = "unknown";
			try {
				const checks = await octokit.checks.listForRef({
					owner,
					repo,
					ref: pr.head.sha,
					per_page: 100,
				});
				const statuses = checks.data.check_runs.map((r) => r.conclusion);
				if (statuses.length === 0) {
					ciStatus = "pending";
				} else if (statuses.every((s) => s === "success")) {
					ciStatus = "success";
				} else if (statuses.some((s) => s === "failure")) {
					ciStatus = "failure";
				} else {
					ciStatus = "in_progress";
				}
			} catch {
				ciStatus = "unknown";
			}
			return {
				number: pr.number,
				title: pr.title,
				author: pr.user?.login ?? "unknown",
				ci_status: ciStatus,
			};
		}),
	);

	const recentCommits = commitsRes.data.map((commit) => ({
		sha: commit.sha.slice(0, 7),
		message: commit.commit.message.split("\n")[0] ?? "",
		date: commit.commit.committer?.date ?? "",
	}));

	const failingChecks = openPrs
		.filter((pr) => pr.ci_status === "failure")
		.map((pr) => ({ pr_number: pr.number, title: pr.title }));

	const lastCommitDate = recentCommits[0]?.date;
	const timeAgo = lastCommitDate ? formatTimeAgo(new Date(lastCommitDate)) : "unknown";

	const summary = `${openPrs.length} open PR${openPrs.length === 1 ? "" : "s"}, ${
		failingChecks.length === 0 ? "all CI passing" : `${failingChecks.length} failing`
	}, last commit ${timeAgo}`;

	return c.json({
		open_prs: openPrs,
		recent_commits: recentCommits,
		failing_checks: failingChecks,
		summary,
	});
}

function formatTimeAgo(date: Date): string {
	const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
