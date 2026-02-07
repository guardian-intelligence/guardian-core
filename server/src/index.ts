import { Hono } from "hono";
import { verifyElevenLabsSignature } from "./middleware/elevenlabs.ts";
import { handleCreateIssue } from "./tools/github-issue.ts";
import { handleGithubStatus } from "./tools/github-status.ts";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.use("/tools/*", verifyElevenLabsSignature);

app.post("/tools/github-status", handleGithubStatus);
app.post("/tools/github-issue", handleCreateIssue);

const port = Number(process.env.PORT) || 3000;

console.log(`rumi-server listening on :${port}`);

export default {
	port,
	fetch: app.fetch,
};
