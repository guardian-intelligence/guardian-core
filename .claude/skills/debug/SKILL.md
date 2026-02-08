---
name: debug
description: Debug container agent issues. Use when things aren't working, container fails, authentication problems, or to understand how the container system works. Covers logs, environment variables, mounts, and common issues.
---

# Guardian Core Container Debugging

This guide covers debugging the containerized agent execution system.

## Architecture Overview

```
Host (Linux)                          Container (Docker)
─────────────────────────────────────────────────────────────
container_runner.ex                   container/agent-runner/
    │                                      │
    │ spawns Docker               │ runs Claude Agent SDK
    │ with volume mounts                   │ with MCP servers
    │                                      │
    ├── data/env/env ──────────────> /workspace/env-dir/env
    ├── groups/{folder} ───────────> /workspace/group
    ├── data/ipc/{folder} ────────> /workspace/ipc
    ├── data/sessions/{folder}/.claude/ ──> /home/node/.claude/ (isolated per-group)
    └── (main only) project root ──> /workspace/project
```

**Important:** The container runs as user `node` with `HOME=/home/node`. Session files must be mounted to `/home/node/.claude/` (not `/root/.claude/`) for session resumption to work.

## Log Locations

| Log | Location | Content |
|-----|----------|---------|
| **Main app logs** | `logs/guardian-core.log` | Host-side WhatsApp, routing, container spawning |
| **Main app errors** | `logs/guardian-core.error.log` | Host-side errors |
| **Container run logs** | `groups/{folder}/logs/container-*.log` | Per-run: input, mounts, stderr, stdout |
| **Claude sessions** | `~/.claude/projects/` | Claude Code session history |

## Enabling Debug Logging

Set `LOG_LEVEL=debug` for verbose output:

```bash
# For development
LOG_LEVEL=debug mix phx.server

# For systemd service, add to environment override:
# systemctl --user edit guardian-core
# [Service]
# Environment=LOG_LEVEL=debug
```

Debug level shows:
- Full mount configurations
- Container command arguments
- Real-time container stderr

## Common Issues

### 1. "Claude Code process exited with code 1"

**Check the container log file** in `groups/{folder}/logs/container-*.log`

Common causes:

#### Missing Authentication
```
Invalid API key · Please run /login
```
**Fix:** Ensure `.env` file exists with the OAuth token:
```bash
cat .env  # Should show:
# CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

#### Root User Restriction
```
--dangerously-skip-permissions cannot be used with root/sudo privileges
```
**Fix:** Container must run as non-root user. Check Dockerfile has `USER node`.

### 2. Environment Variables Not Passing

**Docker env policy:** This project intentionally mounts a filtered env file instead of passing arbitrary `-e` variables.

**Reason:** The system extracts only authentication variables (`CLAUDE_CODE_OAUTH_TOKEN`) from `.env` and mounts them for sourcing inside the container. Other env vars are not exposed.

To verify env vars are reaching the container:
```bash
echo '{}' | docker run -i \
  --mount type=bind,source=$(pwd)/data/env,target=/workspace/env-dir,readonly \
  --entrypoint /bin/bash guardian-core-agent:latest \
  -c 'export $(cat /workspace/env-dir/env | xargs); echo "OAuth: ${#CLAUDE_CODE_OAUTH_TOKEN} chars"'
```

### 3. Mount Issues

**Docker mount notes:**
- Bind mounts can target files or directories.
- Read-only can be expressed with either `:ro` or `--mount ... readonly`:
  ```bash
  # Readonly: use --mount
  --mount "type=bind,source=/path,target=/container/path,readonly"

  # Read-write: use -v
  -v /path:/container/path
  ```

To check what's mounted inside a container:
```bash
docker run --rm --entrypoint /bin/bash guardian-core-agent:latest -c 'ls -la /workspace/'
```

Expected structure:
```
/workspace/
├── env-dir/env           # Environment file (CLAUDE_CODE_OAUTH_TOKEN)
├── group/                # Current group folder (cwd)
├── project/              # Project root (main channel only)
├── global/               # Global CLAUDE.md (non-main only)
├── ipc/                  # Inter-process communication
│   ├── messages/         # Outgoing WhatsApp messages
│   ├── tasks/            # Scheduled task commands
│   ├── current_tasks.json    # Read-only: scheduled tasks visible to this group
│   └── available_groups.json # Read-only: WhatsApp groups for activation (main only)
└── extra/                # Additional custom mounts
```

### 4. Permission Issues

The container runs as user `node` (uid 1000). Check ownership:
```bash
docker run --rm --entrypoint /bin/bash guardian-core-agent:latest -c '
  whoami
  ls -la /workspace/
  ls -la /app/
'
```

All of `/workspace/` and `/app/` should be owned by `node`.

### 5. Session Not Resuming / "Claude Code process exited with code 1"

If sessions aren't being resumed (new session ID every time), or Claude Code exits with code 1 when resuming:

**Root cause:** The SDK looks for sessions at `$HOME/.claude/projects/`. Inside the container, `HOME=/home/node`, so it looks at `/home/node/.claude/projects/`.

**Check the mount path:**
```bash
# In container_runner.ex, verify mount is to /home/node/.claude/, NOT /root/.claude/
grep -A3 "claude" platform/lib/guardian/kernel/container_runner.ex
```

**Verify sessions are accessible:**
```bash
docker run --rm --entrypoint /bin/bash \
  -v ~/.claude:/home/node/.claude \
  guardian-core-agent:latest -c '
echo "HOME=$HOME"
ls -la $HOME/.claude/projects/ 2>&1 | head -5
'
```

**Fix:** Ensure `container_runner.ex` mounts to `/home/node/.claude/`. Check the mount configuration in `platform/lib/guardian/kernel/container_runner.ex`.

### 6. MCP Server Failures

If an MCP server fails to start, the agent may exit. Check the container logs for MCP initialization errors.

## Manual Container Testing

### Test the full agent flow:
```bash
# Set up env file
mkdir -p data/env groups/test
cp .env data/env/env

# Run test query
echo '{"prompt":"What is 2+2?","groupFolder":"test","chatJid":"test@g.us","isMain":false}' | \
  docker run -i \
  --mount "type=bind,source=$(pwd)/data/env,target=/workspace/env-dir,readonly" \
  -v $(pwd)/groups/test:/workspace/group \
  -v $(pwd)/data/ipc:/workspace/ipc \
  guardian-core-agent:latest
```

### Test Claude Code directly:
```bash
docker run --rm --entrypoint /bin/bash \
  --mount "type=bind,source=$(pwd)/data/env,target=/workspace/env-dir,readonly" \
  guardian-core-agent:latest -c '
  export $(cat /workspace/env-dir/env | xargs)
  claude -p "Say hello" --dangerously-skip-permissions --allowedTools ""
'
```

### Interactive shell in container:
```bash
docker run --rm -it --entrypoint /bin/bash guardian-core-agent:latest
```

## SDK Options Reference

The agent-runner uses these Claude Agent SDK options:

```typescript
query({
  prompt: input.prompt,
  options: {
    cwd: '/workspace/group',
    allowedTools: ['Bash', 'Read', 'Write', ...],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,  // Required with bypassPermissions
    settingSources: ['project'],
    mcpServers: { ... }
  }
})
```

**Important:** `allowDangerouslySkipPermissions: true` is required when using `permissionMode: 'bypassPermissions'`. Without it, Claude Code exits with code 1.

## Rebuilding After Changes

```bash
# Rebuild main app
cd platform && mix compile

# Rebuild container (use --no-cache for clean rebuild)
./container/build.sh

# Or force full rebuild
docker builder prune -af
./container/build.sh
```

## Checking Container Image

```bash
# List images
docker images

# Check what's in the image
docker run --rm --entrypoint /bin/bash guardian-core-agent:latest -c '
  echo "=== Node version ==="
  node --version

  echo "=== Claude Code version ==="
  claude --version

  echo "=== Installed packages ==="
  ls /app/node_modules/
'
```

## Session Persistence

Claude sessions are stored per-group in `data/sessions/{group}/.claude/` for security isolation. Each group has its own session directory, preventing cross-group access to conversation history.

**Critical:** The mount path must match the container user's HOME directory:
- Container user: `node`
- Container HOME: `/home/node`
- Mount target: `/home/node/.claude/` (NOT `/root/.claude/`)

To clear sessions:

```bash
# Clear all sessions for all groups
rm -rf data/sessions/

# Clear sessions for a specific group
rm -rf data/sessions/{groupFolder}/.claude/

# Also clear the session ID from Guardian Core's tracking
echo '{}' > data/sessions.json
```

To verify session resumption is working, check the logs for the same session ID across messages:
```bash
grep "Session initialized" logs/guardian-core.log | tail -5
# Should show the SAME session ID for consecutive messages in the same group
```

## IPC Debugging

The container communicates back to the host via files in `/workspace/ipc/`:

```bash
# Check pending messages
ls -la data/ipc/messages/

# Check pending task operations
ls -la data/ipc/tasks/

# Read a specific IPC file
cat data/ipc/messages/*.json

# Check available groups (main channel only)
cat data/ipc/main/available_groups.json

# Check current tasks snapshot
cat data/ipc/{groupFolder}/current_tasks.json
```

**IPC file types:**
- `messages/*.json` - Agent writes: outgoing WhatsApp messages
- `tasks/*.json` - Agent writes: task operations (schedule, pause, resume, cancel, refresh_groups)
- `current_tasks.json` - Host writes: read-only snapshot of scheduled tasks
- `available_groups.json` - Host writes: read-only list of WhatsApp groups (main only)

## Quick Diagnostic Script

Run this to check common issues:

```bash
echo "=== Checking Guardian Core Container Setup ==="

echo -e "\n1. Authentication configured?"
[ -f .env ] && grep -q "CLAUDE_CODE_OAUTH_TOKEN=sk-" .env && echo "OK" || echo "MISSING - add CLAUDE_CODE_OAUTH_TOKEN to .env"

echo -e "\n2. Env file copied for container?"
[ -f data/env/env ] && echo "OK" || echo "MISSING - will be created on first run"

echo -e "\n3. Docker daemon reachable?"
docker info &>/dev/null && echo "OK" || echo "NOT RUNNING - run sudo systemctl start docker"

echo -e "\n4. Container image exists?"
echo '{}' | docker run -i --entrypoint /bin/echo guardian-core-agent:latest "OK" 2>/dev/null || echo "MISSING - run ./container/build.sh"

echo -e "\n5. Session mount path correct?"
grep -q "home/node/.claude" platform/lib/guardian/kernel/container_runner.ex 2>/dev/null && echo "OK" || echo "WRONG - should mount to /home/node/.claude/, not /root/.claude/"

echo -e "\n6. Groups directory?"
ls -la groups/ 2>/dev/null || echo "MISSING - run setup"

echo -e "\n7. Recent container logs?"
ls -t groups/*/logs/container-*.log 2>/dev/null | head -3 || echo "No container logs yet"

echo -e "\n8. Session continuity working?"
SESSIONS=$(grep "Session initialized" logs/guardian-core.log 2>/dev/null | tail -5 | awk '{print $NF}' | sort -u | wc -l)
[ "$SESSIONS" -le 2 ] && echo "OK (recent sessions reusing IDs)" || echo "CHECK - multiple different session IDs, may indicate resumption issues"
```
