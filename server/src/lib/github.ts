import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

let client: Octokit | null = null;

export function getOctokit(): Octokit {
	if (!client) {
		const appId = process.env.GITHUB_APP_ID;
		const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
		const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

		if (!appId || !privateKey || !installationId) {
			throw new Error(
				"GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID are required",
			);
		}

		client = new Octokit({
			authStrategy: createAppAuth,
			auth: { appId, privateKey, installationId },
		});
	}
	return client;
}
