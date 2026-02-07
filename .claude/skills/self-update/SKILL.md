---
name: self-update
description: Deploy Guardian Core (brain) or platform (Elixir Phoenix). Use when user says "deploy", "update", "self-update", "push changes", or "ship it". Covers local Mac/Linux brain and remote Phoenix platform.
---

# Self-Update / Deploy

Two systems can be deployed from this repo:

| System | Alias | Where | Command |
|--------|-------|-------|---------|
| **Guardian Core** | brain | Local Mac (launchd) or Linux (systemd) | `cd platform && mix deploy.brain` |
| **Phoenix Platform** | platform | OVH VPS (`rumi-server`, `/opt/guardian-platform`) | `cd platform && mix deploy.platform` |

## Decision Tree

1. **User says "deploy" without specifying which system** → Ask:
   > Which system should I deploy?
   > - **Brain** (Guardian Core — WhatsApp bot, message routing, containers)
   > - **Platform** (Elixir Phoenix — webhook API on OVH)
   > - **Both**

2. **User says "deploy brain" / "deploy guardian-core" / "self-update"** → Deploy brain
3. **User says "deploy platform" / "deploy phoenix"** → Deploy platform
4. **User says "deploy both" / "deploy everything"** → Deploy brain first, then platform

## Deploying Brain (Guardian Core)

The brain deploy Mix task (`mix deploy.brain`) handles:
1. `mix deps.get` (if dependencies changed)
2. `mix compile --warnings-as-errors` (aborts on failure)
3. `mix test` (aborts on failure)
4. `mix release --overwrite` (builds Elixir release)
5. Container image rebuild (if container files changed)
6. Install launchd/systemd service from template
7. Restart the service
8. Verify the service is running

### Commands

```bash
cd platform && mix deploy.brain               # Smart deploy (detects what changed)
cd platform && mix deploy.brain --app         # Host app only (Elixir changes)
cd platform && mix deploy.brain --container   # Container image only (Dockerfile/agent-runner)
cd platform && mix deploy.brain --all         # Full rebuild of everything
cd platform && mix deploy.brain --dry-run     # Preview without executing
```

### Troubleshooting Brain

| Symptom | Fix |
|---------|-----|
| Compile fails | Fix compilation errors before deploying |
| Tests fail | Fix failing tests — deploy aborts on test failure |
| Service won't start | Check `logs/guardian-core.log` and `logs/guardian-core.error.log` |
| Container build fails | Run `docker builder prune -af` then retry |
| launchd not loading | `launchctl load ~/Library/LaunchAgents/com.guardian-core.plist` |

## Deploying Platform (Elixir Phoenix)

The platform deploy Mix task (`mix deploy.platform`) handles:
1. Local `mix test` (aborts on failure)
2. rsync `platform/` to OVH (excludes `_build`, `deps`, `.elixir_ls`, `.env`)
3. SSH: `mix deps.get --only prod` + `MIX_ENV=prod mix release --overwrite`
4. SSH: `sudo systemctl restart rumi-platform`
5. Health verification (`curl localhost:4000/health`)

### Commands

```bash
cd platform && mix deploy.platform            # Full deploy to OVH
cd platform && mix deploy.platform --dry-run  # Preview without executing
```

### Troubleshooting Platform

| Symptom | Fix |
|---------|-----|
| SSH connection fails | Check `~/.ssh/rch_ovh_ed25519` exists and `rumi-server` is in `~/.ssh/config` |
| Mix test fails | Fix test failures in `platform/` before deploying |
| Release build fails | `ssh rumi-server "cd /opt/guardian-platform/src && mix deps.get --only prod"` |
| Service won't start | `ssh rumi-server "journalctl -u rumi-platform -n 50"` |
| Health check fails | `ssh rumi-server "curl -sf localhost:4000/health"` |
| Missing env vars | Check `/opt/guardian-platform/.env` has all required vars |

## Debugging Deploy Failures

The brain deploy script writes structured JSONL logs alongside the ANSI console output. When a deploy fails, read the log file for detailed diagnostics.

### Log Locations

| Target | Latest log | All logs |
|--------|-----------|----------|
| Brain | `logs/deploy/brain-latest.jsonl` | `logs/deploy/brain-*.jsonl` |

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
| `"stage": "compile"` in cause | Compilation errors | Fix errors shown in stderr |
| `"stage": "test"` in cause | Test failures | Run `cd platform && mix test` locally to see full output |
| `"stage": "shell"` + `exitCode: 127` | Command not found | Ensure `docker`/`mix` are in PATH |
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
