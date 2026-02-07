# <NAME_TBD>

Personal assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in Apple Container (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Main app: WhatsApp connection, message routing, IPC |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/self-update` | Deploy brain (Guardian Core) or server (webhook API) |

## Development

Run commands directly—don't tell the user to run them.

```bash
bun run dev          # Run with hot reload
bun run build        # Compile TypeScript
bun run typecheck    # Type-check without emitting
bun run test             # Run tests
./container/build.sh # Rebuild agent container
```

## Deploying Updates

Two systems: **brain** (Guardian Core, local) and **server** (webhook API, rumi-vps). Use `/self-update` for guided deployment.

```bash
# Brain (Guardian Core)
bun run deploy:brain            # Smart deploy (detects what changed)
bun run deploy:brain:app        # Host app only (TypeScript changes)
bun run deploy:brain:container  # Container image only (Dockerfile/agent-runner)
bun run deploy:brain:all        # Full rebuild of everything

# Server (webhook API → rumi-vps)
bun run deploy:server           # rsync + restart on rumi-vps
```

`bun run deploy` is kept as an alias for `deploy:brain` (backwards compat).

The brain deploy script (`scripts/deploy.ts`) handles:
1. `bun install` (if app changed)
2. Typecheck + tests (aborts on failure)
3. `tsc` build
4. Container image rebuild (if needed)
5. Install launchd plist from template (resolves `{{PLACEHOLDERS}}`)
6. Restart the launchd service
7. Verify the service is running

Manual service management:
```bash
launchctl load ~/Library/LaunchAgents/com.guardian-core.plist
launchctl unload ~/Library/LaunchAgents/com.guardian-core.plist
launchctl kickstart -k gui/$(id -u)/com.guardian-core  # Force restart
```
