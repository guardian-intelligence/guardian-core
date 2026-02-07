import type { Context } from "hono";
import { getOctokit } from "../lib/github.ts";

interface IssueParams {
	owner?: string;
	repo?: string;
	title?: string;
	body?: string;
	labels?: string[];
}

export async function handleCreateIssue(c: Context) {
	const params = c.get("parsedBody") as IssueParams;
	const { owner, repo, title, body, labels } = params;

	if (!owner || !repo || !title) {
		return c.json({ error: "owner, repo, and title are required" }, 400);
	}

	if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
		return c.json({ error: "Invalid owner or repo format" }, 400);
	}

	if (title.length > 256) {
		return c.json({ error: "Title must be 256 characters or fewer" }, 400);
	}

	if (labels && !Array.isArray(labels)) {
		return c.json({ error: "labels must be an array of strings" }, 400);
	}

	const octokit = getOctokit();

	const result = await octokit.issues.create({
		owner,
		repo,
		title,
		body: body ?? "",
		labels: labels ?? [],
	});

	return c.json({
		issue_number: result.data.number,
		url: result.data.html_url,
		status: "created",
	});
}
