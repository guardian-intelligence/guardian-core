---
name: self-update
description: Deploy Guardian Core (brain) or server (server). Use when user says "deploy", "update", "self-update", "push changes", or "ship it". Covers both local Mac/Linux brain and remote OVH server.
---

# Self-Update / Deploy

Two systems can be deployed from this repo:

| System | Alias | Where | Script |
|--------|-------|-------|--------|
| **Guardian Core** | brain | Local Mac (launchd) or Linux (systemd) | `bun run deploy:brain` |
| **server** | server | OVH VPS (`rumi-server`, `/opt/server`) | `bun run deploy:server` |

## Decision Tree

1. **User says "deploy" without specifying which system** → Ask:
   > Which system should I deploy?
   > - **Brain** (Guardian Core — WhatsApp bot, message routing, containers)
   > - **Server** (server — webhook API on OVH)
   > - **Both**

2. **User says "deploy brain" / "deploy guardian-core" / "self-update"** → Deploy brain
3. **User says "deploy server" / "deploy rumi"** → Deploy server
4. **User says "deploy both" / "deploy everything"** → Deploy brain first, then server

## Deploying Brain (Guardian Core)

The brain deploy script (`scripts/deploy.ts`) handles:
1. `bun install` (if dependencies changed)
2. Typecheck + tests (aborts on failure)
3. `tsc` build
4. Container image rebuild (if container files changed)
5. Install launchd/systemd service from template
6. Restart the service
7. Verify the service is running

### Commands

```bash
bun run deploy:brain            # Smart deploy (detects what changed)
bun run deploy:brain:app        # Host app only (TypeScript changes)
bun run deploy:brain:container  # Container image only (Dockerfile/agent-runner)
bun run deploy:brain:all        # Full rebuild of everything
```

Add `-- --dry-run` to preview without executing.

### Troubleshooting Brain

| Symptom | Fix |
|---------|-----|
| Typecheck fails | Fix type errors before deploying |
| Tests fail | Fix failing tests — deploy aborts on test failure |
| Service won't start | Check `logs/guardian-core.log` and `logs/guardian-core.error.log` |
| Container build fails | Run `docker builder prune -af` then retry |
| launchd not loading | `launchctl load ~/Library/LaunchAgents/com.guardian-core.plist` |

## Deploying Server (server)

The server deploy script (`scripts/deploy-server.ts`) handles:
1. Local typecheck of `server/`
2. rsync files to OVH (excludes `node_modules`, `.env`, `.git`)
3. SSH: `bun install` + `sudo systemctl restart server`
4. Verify service is active and health endpoint responds

### Commands

```bash
bun run deploy:server            # Full deploy to OVH
bun run deploy:server -- --dry-run  # Preview without executing
```

### Troubleshooting Server

| Symptom | Fix |
|---------|-----|
| SSH connection fails | Check `~/.ssh/rch_ovh_ed25519` exists and `rumi-server` is in `~/.ssh/config` |
| Typecheck fails | Fix type errors in `server/` before deploying |
| Service won't start | `ssh rumi-server "journalctl -u server -n 50"` |
| Health check fails | `ssh rumi-server "curl -sf localhost:3000/health"` |
| Caddy issues | `ssh rumi-server "sudo systemctl status caddy"` |

## Debugging Deploy Failures

Both deploy scripts write structured JSONL logs alongside the ANSI console output. When a deploy fails, read the log file for detailed diagnostics.

### Log Locations

| Target | Latest log | All logs |
|--------|-----------|----------|
| Brain | `logs/deploy/brain-latest.jsonl` | `logs/deploy/brain-*.jsonl` |
| Server | `logs/deploy/server-latest.jsonl` | `logs/deploy/server-*.jsonl` |

### Reading Logs

```bash
# Show latest brain deploy log (pretty-printed)
cat logs/deploy/brain-latest.jsonl | jq .

# Find errors only
cat logs/deploy/brain-latest.jsonl | jq 'select(.level == "ERROR")'

# Find entries with stderr (shell command failures)
cat logs/deploy/brain-latest.jsonl | jq 'select(.annotations.stderr != null)'

# Show timing for each deploy stage
cat logs/deploy/brain-latest.jsonl | jq 'select(.spans) | {message, spans}'

# Show the final failure cause
cat logs/deploy/brain-latest.jsonl | jq 'select(.message == "DEPLOY_FAILED") | .annotations.prettyError'
```

### Common Failure Patterns

| Pattern in log | Meaning | Fix |
|---------------|---------|-----|
| `"stage": "typecheck"` in cause | TypeScript errors | Fix type errors shown in stderr |
| `"stage": "test"` in cause | Test failures | Run `bun run test` locally to see full output |
| `"stage": "shell"` + `exitCode: 127` | Command not found | Ensure `docker`/`bun`/`node` are in PATH |
| `"stage": "shell"` + `cmd: "./container/build.sh"` | Container build failed | Run `docker builder prune -af` then retry |
| `"stage": "verify"` | Service didn't start after deploy | Check `logs/guardian-core.log` and `logs/guardian-core.error.log` |
| `"stage": "shell"` + `cmd: "ssh"` | SSH to OVH failed | Verify `~/.ssh/rch_ovh_ed25519` and `rumi-server` SSH config |
| `"stage": "shell"` + `cmd: "rsync"` | Rsync failed | Check SSH connectivity and disk space on remote |
| `"message": "DEPLOY_FAILED"` | Top-level failure summary | Read `prettyError` annotation for full stack trace |

### Log Entry Format

Each line is a JSON object with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 timestamp |
| `level` | string | `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL` |
| `message` | string | Human-readable log message |
| `annotations` | object | Key-value context (icon, cmd, args, exitCode, stderr, etc.) |
| `spans` | object | Active log spans with elapsed time in ms (e.g. `{"deploy": 3200}`) |
| `cause` | string | Pretty-printed error cause (only present on error entries) |

### Log Rotation

The last 20 log files per target are kept. Older files are pruned automatically on each deploy.
