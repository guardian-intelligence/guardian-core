# Guardian Core

A multi-agent kernel that routes messages from WhatsApp to Claude agents running in isolated Docker containers. Each agent invocation gets its own container with explicit filesystem mounts — isolation is at the OS level, not application level. The entire toolchain and production server are defined declaratively through Nix Flakes.

## Infrastructure

### Development Environment (Nix Flakes)

The `flake.nix` devShell provides the complete toolchain:

- **Node.js 22** — host runtime
- **Bun 1.3.8** — package manager, test runner, build tool (version pinned via `assert`)
- **git**, **docker**, **age** — operations and secrets

Enter the shell:

```bash
nix develop            # or use direnv with .envrc
```

CI runs every command through the same flake (`nix develop --command ...`), so local and CI environments are identical — no version drift.

### Production Server (NixOS)

The production host (`rumi-vps`) is a NixOS machine defined in `nixos/configuration.nix`:

- **Guardian Kernel** service (`nixos/services/guardian-core.nix`)
- **Webhook server** (`nixos/services/server.nix`) — Bun + Hono behind Caddy
- **Docker** with weekly auto-prune
- **Caddy** reverse proxy with automatic TLS
- **Tailscale** mesh networking
- **Firewall** — SSH, HTTP, HTTPS; Tailscale interface trusted

Deploy configuration changes:

```bash
nixos-rebuild switch --flake .#rumi-vps
```

## Architecture

```
WhatsApp ──→ Host Process (src/index.ts) ──→ Docker Container
              │                                  │
              ├─ Message routing                 ├─ Claude Agent SDK
              ├─ SQLite (chats, tasks)           ├─ Isolated filesystem
              ├─ Task scheduler                  ├─ IPC MCP tools
              └─ IPC watcher                     └─ Per-group persona & memory
```

- **Host process**: single Node.js app handling WhatsApp I/O, routing, database, scheduling, and IPC.
- **Containers**: each agent invocation runs Claude Agent SDK in a `node:22-slim` Docker container with only explicitly mounted paths visible.
- **Multi-agent**: each registered group is an independent agent with its own persona files, memory, conversation history, and tool access.

New capabilities are added via skills (code transforms) rather than feature flags — see `docs/REQUIREMENTS.md` for the philosophy.

## Quick Start

Prerequisites: [Nix with flakes enabled](https://zero-to-nix.com/start/install)

```bash
git clone <repo-url> && cd guardian-core
nix develop
bun install
bun run auth          # WhatsApp QR authentication
bun run dev           # Start with hot reload
```

Or use the guided setup: run Claude Code and invoke `/setup`.

## Commands

### Root app

```bash
bun run dev
bun run build
bun run start
bun run typecheck
bun run test
bun run test:ci
bun run check:fast
bun run check
bun run auth
bun run verify:bun            # Bun pin check (expects Nix dev shell version)
```

### Deploy

```bash
bun run deploy                 # smart mode
bun run deploy:brain:app
bun run deploy:brain:container
bun run deploy:brain:all
bun run deploy:server
```

### Container image

```bash
./container/build.sh
```

### Server subproject

```bash
(cd server && bun run dev)
(cd server && bun run typecheck)
(cd server && bun run check)
```

### Test log verbosity

```bash
bun run test                         # quiet defaults for local agent loops
VITEST_DEBUG_LOGS=1 bun run test     # include runtime logs while debugging
```

## Operating Spec

> Reference for developers and agents working on kernel internals.

### 1. Scope

- Audience: developers and autonomous coding agents.
- Primary codebase: root app (`src/`), container runner (`container/agent-runner/`), webhook server (`server/`), deploy tooling (`scripts/`, `src/deploy*.ts`), infrastructure (`nixos/`).
- Runtime truth source order:
  1. `src/**/*.ts`, `container/agent-runner/src/**/*.ts`, `server/src/**/*.ts`
  2. `scripts/**/*.ts`, `launchd/*.plist`, `systemd/*.service`, `nixos/**/*.nix`
  3. `docs/*.md`, `.claude/skills/*` (can be stale)

### 2. Current Runtime Topology

- Host process: Node.js app (`src/index.ts`) for WhatsApp I/O, routing, DB, IPC watcher, scheduler.
- Agent execution: Docker container per invocation (`src/container-runner.ts`).
- Container image: `guardian-core-agent:latest` built from `container/Dockerfile`.
- Container agent runtime: Claude Agent SDK (`container/agent-runner/src/index.ts`) with IPC MCP tools (`container/agent-runner/src/ipc-mcp.ts`).
- Optional webhook server: Bun + Hono (`server/src/index.ts`) for ElevenLabs-signed GitHub tool endpoints.

### 3. Repository Map

| Path | Role |
|---|---|
| `src/index.ts` | Host runtime entrypoint |
| `src/container-runner.ts` | Docker spawn, mount setup, container output parsing |
| `src/task-scheduler.ts` | Due-task loop, scheduled execution |
| `src/db.ts` | SQLite schema + query layer |
| `src/MountSecurityService.ts` | Mount allowlist validation (active) |
| `src/phone-caller.ts` | ElevenLabs outbound call + transcript capture |
| `container/agent-runner/src/index.ts` | Container-side Claude query loop |
| `container/agent-runner/src/ipc-mcp.ts` | MCP tools writing IPC files |
| `server/src/index.ts` | Webhook tool API |
| `src/deploy.ts` | Brain deploy pipeline |
| `src/deploy-server.ts` | Server deploy pipeline |

### 4. Host Runtime Behavior (`src/index.ts`)

#### Startup sequence

1. `ensureDockerRunning()` checks `docker info`.
2. `initDatabase()` creates/migrates SQLite tables.
3. Load state from `data/router_state.json`, `data/sessions.json`, `data/registered_groups.json`.
4. Migrate `ALERT_PHONE_NUMBER` to `~/.config/guardian-core/phone-contacts.json` if needed.
5. Connect WhatsApp (Baileys).
6. On connection open:
   - Start scheduler loop (guarded singleton).
   - Start IPC watcher (guarded singleton).
   - Start message loop (guarded singleton).
   - Run group metadata sync (daily cache + timer).

#### Message ingestion and routing

- All incoming chats: only metadata stored (`chats` table).
- Full message content stored only for registered groups (`messages` table).
- Group resolution key: `chat_jid` in `data/registered_groups.json`.
- Trigger behavior:
  - Main group (`folder === "main"`): responds to all messages.
  - Non-main groups: requires `TRIGGER_PATTERN` (`^@ASSISTANT_NAME\b`, case-insensitive).
- Prompt format to container:
  - XML-like payload containing all missed messages since last agent timestamp:
    - `<messages><message sender="..." time="...">...</message>...</messages>`
- Response dispatch:
  - Host always prefixes outgoing message with `${ASSISTANT_NAME}: `.

#### Group registration

- Registration path: IPC task type `register_group` (main only), then `registerGroup()`.
- Creates `groups/{folder}/logs`.
- Stored fields include `trigger`, but runtime trigger check uses global `ASSISTANT_NAME`; per-group trigger is not enforced by `processMessage()`.

### 5. Container Execution Contract

#### Input JSON (host -> container stdin)

```json
{
  "prompt": "string",
  "sessionId": "string | undefined",
  "groupFolder": "string",
  "chatJid": "string",
  "isMain": "boolean",
  "isScheduledTask": "boolean | undefined"
}
```

#### Output JSON (container -> host stdout)

- Wrapped between sentinels:
  - `---GUARDIAN_CORE_OUTPUT_START---`
  - `---GUARDIAN_CORE_OUTPUT_END---`
- Payload:

```json
{
  "status": "success | error",
  "result": "string | null",
  "newSessionId": "string | undefined",
  "error": "string | undefined"
}
```

#### Mount model (`src/container-runner.ts`)

- Main group mounts:
  - host project root -> `/workspace/project` (rw)
  - group folder -> `/workspace/group` (rw)
- Non-main mounts:
  - group folder -> `/workspace/group` (rw)
  - `groups/global` -> `/workspace/global` (ro, if exists)
- Always mounted:
  - `data/sessions/{group}/.claude` -> `/home/node/.claude` (rw)
  - `data/ipc/{group}` -> `/workspace/ipc` (rw)
  - filtered auth env dir -> `/workspace/env-dir` (ro, only if generated)
- Optional:
  - validated additional mounts -> `/workspace/extra/{containerPath}`

#### Timeouts and output limits

- Default timeout: `CONTAINER_TIMEOUT` (300000ms).
- Group override: `registeredGroups[*].containerConfig.timeout`.
- Stdout/stderr cap: `CONTAINER_MAX_OUTPUT_SIZE` per stream (default 10MB).
- Timeout handling: `docker stop` first, then SIGKILL fallback.

#### Container logs

- Path: `groups/{folder}/logs/container-<timestamp>.log`.
- Verbose mode if `LOG_LEVEL` is `debug` or `trace`:
  - includes full input, args, mounts, full stderr/stdout.

### 6. Container Agent Behavior (`container/agent-runner/src/index.ts`)

#### Tools allowed to Claude Agent SDK

- `Bash`
- `Read`, `Write`, `Edit`, `Glob`, `Grep`
- `WebSearch`, `WebFetch`
- `mcp__guardian_core__*`

#### Prompt augmentation

- On each run, backup template files from `/workspace/group` into `_backups/<timestamp>/` (rolling keep 5).
- Template files loaded (if present and valid):
  - `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOT.md`, `VOICE_PROMPT.md`, `THREAT_MODEL.json`
- Injected as:
  - `<context><FILE>...</FILE>...</context>` prepended to prompt.
- Corruption heuristic:
  - file content `< 10` chars -> attempt restore from latest backup.
- Scheduled task marker prepended when `isScheduledTask=true`.

#### Session compaction hook

- PreCompact hook archives transcript into `/workspace/group/conversations/<date>-<name>.md`.
- Title source:
  - session summary from `sessions-index.json` if available.
  - fallback timestamp-based name.

### 7. IPC Protocol (container <-> host)

#### Directory model

- Per group namespace: `data/ipc/{groupFolder}/`.
- Subdirs:
  - `messages/` (container writes outbound messages)
  - `tasks/` (container writes task/control ops)
- Host-generated snapshots:
  - `current_tasks.json`
  - `available_groups.json`
- Parse failures moved to: `data/ipc/errors/`.

#### MCP tools emitted by container (`ipc-mcp.ts`)

- `send_message`
- `schedule_task`
- `list_tasks`
- `pause_task`
- `resume_task`
- `cancel_task`
- `make_phone_call` (main only)
- `register_group` (main only)

#### Host authorization rules (`processTaskIpc`)

- `schedule_task`: non-main may only target own group.
- `pause/resume/cancel_task`: non-main may only manage own tasks.
- `refresh_groups`: main only.
- `phone_call`: main only.
- `register_group`: main only.
- Message send: main can send anywhere; non-main only to own mapped chat.

### 8. Scheduler Semantics (`src/task-scheduler.ts`)

- Poll interval: `SCHEDULER_POLL_INTERVAL` (60000ms).
- Due query: active tasks with `next_run <= now`.
- Execution context:
  - `context_mode = group` -> reuse current group session id.
  - `context_mode = isolated` -> no resume session.
- After run:
  - task run logged in `task_run_logs`.
  - `next_run` recomputed for cron/interval.
  - `once` becomes completed (`next_run = null`).
- Timezone for cron parse:
  - `TIMEZONE` from `TZ` env or system timezone.

### 9. SQLite Schema (`src/db.ts`)

- DB file: `store/messages.db`.

#### Tables

- `chats(jid PK, name, last_message_time)`
- `messages(id, chat_jid, sender, sender_name, content, timestamp, is_from_me, PK(id, chat_jid))`
- `scheduled_tasks(id PK, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, last_run, last_result, status, created_at)`
- `task_run_logs(id PK AUTOINCREMENT, task_id FK, run_at, duration_ms, status, result, error)`

#### Notable behavior

- Bot message filtering uses content prefix `${ASSISTANT_NAME}:` (not `is_from_me`).
- Group discovery uses chat metadata for all chats; full content only registered groups.
- Group metadata sync timestamp stored via synthetic chat row `jid='__group_sync__'`.

### 10. Security Model

#### Core boundary

- Primary isolation boundary: Docker container filesystem/process boundary.

#### Additional mount protection

- Allowlist file path: `~/.config/guardian-core/mount-allowlist.json` (outside repo).
- Validation service: `src/MountSecurityService.ts`.
- Rules:
  - host path must exist and resolve (realpath).
  - must fall under an allowed root.
  - blocked patterns rejected.
  - container path must be relative, non-empty, no `..`.
  - non-main groups can be forced read-only (`nonMainReadOnly`).

#### Default blocked patterns

- `.ssh`, `.gnupg`, `.gpg`, `.aws`, `.azure`, `.gcloud`, `.kube`, `.docker`,
  `credentials`, `.env`, `.netrc`, `.npmrc`, `.pypirc`, `id_rsa`, `id_ed25519`,
  `private_key`, `.secret`.

#### Credential exposure

- Host `.env` is filtered before mounting into container.
- Exposed vars to container env file:
  - `CLAUDE_CODE_OAUTH_TOKEN`
  - `ANTHROPIC_API_KEY`
  - `GITHUB_TOKEN`

### 11. Phone Call Subsystem (`src/phone-caller.ts`)

- Outbound API: ElevenLabs Conversational AI Twilio endpoint.
- Required env vars (host):
  - `ELEVENLABS_API_KEY`
  - `ELEVENLABS_AGENT_ID`
  - `ELEVENLABS_PHONE_NUMBER_ID`
- Contact source:
  - `~/.config/guardian-core/phone-contacts.json`
- Migration fallback:
  - if contacts file missing and `ALERT_PHONE_NUMBER` set, auto-generates contacts file.
- Reason sanitization:
  - control chars stripped, max 500 chars.
- Transcript polling:
  - polls conversation status every 5s up to 10 minutes.
  - saves transcript under `groups/main/conversations/`.
  - enqueues follow-up scheduled task in main IPC.

### 12. Webhook Server (`server/`)

- Runtime: Bun + Hono.
- Health endpoint: `GET /health`.
- Tool endpoints (signed):
  - `POST /tools/github-status`
  - `POST /tools/github-issue`
- Signature verification:
  - header `ElevenLabs-Signature` with `t=<unix>,v0=<hex>`.
  - HMAC-SHA256 over `${timestamp}.${body}` with `ELEVENLABS_WEBHOOK_SECRET`.
  - max drift: 5 minutes.
- GitHub auth env:
  - `GITHUB_APP_ID`
  - `GITHUB_APP_PRIVATE_KEY`
  - `GITHUB_APP_INSTALLATION_ID`

### 13. Deployment System

#### Brain deploy (`src/deploy.ts`, `scripts/deploy.ts`)

- Modes:
  - `smart`, `app`, `container`, `all`.
- Smart detection:
  - checks uncommitted git diff (`HEAD` + staged).
  - fallback timestamp/image checks when no diff.
- App pipeline:
  1. `bun install`
  2. `bun run typecheck`
  3. `bun run test`
  4. `bun run build`
- Container pipeline:
  1. `./container/build.sh`
- Service management:
  - Darwin: install/update `~/Library/LaunchAgents/com.guardian-core.plist`, restart via `launchctl`.
  - Linux: install/update `~/.config/systemd/user/guardian-core.service`, restart via `systemctl --user`.

#### Server deploy (`src/deploy-server.ts`, `scripts/deploy-server.ts`)

- Remote alias: `rumi-server`.
- Sync target: `/opt/guardian-core/server`.
- Flow:
  1. server typecheck
  2. `rsync` with excludes (`node_modules`, `.env`, `.git`)
  3. remote `bun install`
  4. remote `sudo systemctl restart rumi-server`
  5. health verification (`systemctl is-active` + `curl localhost:3000/health`)

#### Deploy logs

- JSONL + console dual logging.
- Path: `logs/deploy/`.
- Symlink: `<target>-latest.jsonl`.

### 14. Environment Variables

| Var | Scope | Default | Usage |
|---|---|---|---|
| `ASSISTANT_NAME` | Host | `Andy` | Trigger regex + response prefix |
| `CONTAINER_IMAGE` | Host | `guardian-core-agent:latest` | Docker image tag |
| `CONTAINER_TIMEOUT` | Host | `300000` | Container timeout |
| `CONTAINER_MAX_OUTPUT_SIZE` | Host | `10485760` | Stdout/stderr cap |
| `TZ` | Host | system timezone | Cron parsing timezone |
| `LOG_LEVEL` | Host | `info` | Pino log level |
| `CLAUDE_CODE_OAUTH_TOKEN` | Mounted to container | none | Claude auth |
| `ANTHROPIC_API_KEY` | Mounted to container | none | Claude auth |
| `GITHUB_TOKEN` | Mounted to container | none | In-container `gh` usage |
| `ELEVENLABS_API_KEY` | Host | none | Phone calls |
| `ELEVENLABS_AGENT_ID` | Host | none | Phone calls |
| `ELEVENLABS_PHONE_NUMBER_ID` | Host | none | Phone calls |
| `ALERT_PHONE_NUMBER` | Host | none | Legacy migration to contacts file |
| `PORT` | Server | `3000` | Webhook server port |
| `ELEVENLABS_WEBHOOK_SECRET` | Server | none | Request verification |
| `GITHUB_APP_ID` | Server | none | GitHub App auth |
| `GITHUB_APP_PRIVATE_KEY` | Server | none | GitHub App auth |
| `GITHUB_APP_INSTALLATION_ID` | Server | none | GitHub App auth |

### 15. State and Data Files

| Path | Producer | Notes |
|---|---|---|
| `data/registered_groups.json` | Host / IPC | JID -> group config |
| `data/sessions.json` | Host | group folder -> session id |
| `data/router_state.json` | Host | message cursor timestamps |
| `data/ipc/{group}/...` | Host + container | IPC namespace |
| `data/sessions/{group}/.claude` | Host-mounted | per-group Claude session store |
| `store/messages.db` | Host | main SQLite DB |
| `store/auth/` | Baileys | WhatsApp auth state |
| `groups/{group}/logs/` | Host | per-run container logs |
| `logs/guardian-core.log` | Host service | stdout |
| `logs/guardian-core.error.log` | Host service | stderr |

### 16. Tests and Coverage

- Test runner: Vitest (`bun run test`).
- Present test suites:
  - `src/__tests__/MountSecurityService.test.ts`
  - `src/__tests__/bypass-guard.test.ts`
  - `src/__tests__/db.test.ts`
  - `src/__tests__/deploy.test.ts`
  - `src/__tests__/logger-integration.test.ts`
  - `src/__tests__/phone-caller.test.ts`
  - `src/__tests__/redact.test.ts`
- No integration/e2e coverage for WhatsApp flow, Docker execution, IPC watcher, scheduler, or phone-caller network calls.

### 17. Coupled Change Matrix

| Change target | Required companion updates |
|---|---|
| Container input/output fields | `src/container-runner.ts`, `container/agent-runner/src/index.ts` |
| MCP tool schemas/actions | `container/agent-runner/src/ipc-mcp.ts`, `src/index.ts` (`processTaskIpc`) |
| Task schema/state fields | `src/types.ts`, `src/schemas.ts`, `src/db.ts`, scheduler logic |
| Mount security rules | `src/MountSecurityService.ts`, `config-examples/mount-allowlist.json`, tests |
| Deploy behavior | `src/deploy.ts`, `scripts/deploy.ts`, service templates, deploy tests |
| Server tool contracts | `server/src/tools/*.ts`, webhook callers, signature middleware |

### 18. Agent Editing Rules (Repository-Specific)

- Do not hand-edit `dist/`; regenerate via `bun run build`.
- Avoid modifying live runtime state under `data/`, `store/`, `logs/` unless task explicitly targets state repair.
- Preserve IPC authorization boundaries when adding new IPC task types.
- Preserve per-group session isolation (`/home/node/.claude` mount target).
- Preserve prefix-based bot-message filtering unless replacing with a proven same-account-safe strategy.
