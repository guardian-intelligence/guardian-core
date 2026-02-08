# <NAME_TBD>

Personal assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Elixir OTP application that connects to WhatsApp (via supervised Node.js Port), routes messages to Claude Agent SDK running in Docker containers. Each group has isolated filesystem and memory. Phoenix handles webhook API (GitHub tools, ElevenLabs signatures).

## Key Files

| File | Purpose |
|------|---------|
| `platform/lib/guardian/kernel/supervisor.ex` | Kernel supervisor (rest_for_one) |
| `platform/lib/guardian/kernel/whatsapp/bridge.ex` | WhatsApp connection via Node.js Port |
| `platform/lib/guardian/kernel/whatsapp/message_router.ex` | Message routing with composite cursor |
| `platform/lib/guardian/kernel/container_runner.ex` | Spawns agent containers with mounts |
| `platform/lib/guardian/kernel/task_scheduler.ex` | Runs scheduled tasks (cron/interval/once) |
| `platform/lib/guardian/kernel/ipc_watcher.ex` | Polls IPC directories for container messages |
| `platform/lib/guardian/kernel/state.ex` | In-memory state with periodic JSON flush |
| `platform/lib/guardian/kernel/config.ex` | All kernel paths and config |
| `platform/lib/guardian/repo.ex` | Ecto.Repo (SQLite3) |
| `platform/lib/guardian/github.ex` | GitHub App auth + API client |
| `platform/lib/guardian_web/router.ex` | Phoenix API routes |
| `container/agent-runner/` | Claude Agent SDK runner (TypeScript, runs in Docker) |
| `container/shared/` | Shared TS types (IPC protocol, schemas) |
| `container/whatsapp-bridge/` | Thin Baileys bridge (JSON stdio) |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/self-update` | Deploy brain (Guardian Core) or platform (Phoenix API) |

## Development

Run commands directly — don't tell the user to run them.

```bash
# Elixir App
cd platform && mix phx.server   # Start on port 4000 (kernel disabled in dev)
cd platform && mix test         # Run all tests
cd platform && mix compile --warnings-as-errors  # Typecheck

# Container
./container/build.sh            # Rebuild agent container image
```

## Deploying Updates

Two systems: **brain** (Guardian Core, local) and **platform** (Elixir Phoenix, rumi-vps). Use `/self-update` for guided deployment. All deploy/ops tasks are Elixir Mix tasks in `platform/`.

```bash
# Brain (Guardian Core)
cd platform && mix deploy.brain               # Smart deploy (detects what changed)
cd platform && mix deploy.brain --app         # Host app only (Elixir changes)
cd platform && mix deploy.brain --container   # Container image only (Dockerfile/agent-runner)
cd platform && mix deploy.brain --all         # Full rebuild of everything
cd platform && mix deploy.brain --dry-run     # Show plan without executing

# Platform (Elixir Phoenix → rumi-vps)
cd platform && mix deploy.platform            # test, rsync, build release, restart
cd platform && mix deploy.platform --dry-run  # Show plan without executing

# Template Backup
cd platform && mix templates.commit           # Auto-commit template file changes
```

The brain deploy pipeline:
1. `mix deps.get` (if app changed)
2. `mix compile --warnings-as-errors` (aborts on failure)
3. `mix test` (aborts on failure)
4. `mix release --overwrite` (builds Elixir release)
5. Container image rebuild (if needed)
6. Install systemd service template (resolves `{{PLACEHOLDERS}}`)
7. Restart the service
8. Verify the service is running

## NixOS Infrastructure (rumi-vps)

NixOS configuration is managed via Nix flake at `infra/nixos/`. Secrets use **sops-nix** with age encryption — encrypted dotenv files are committed to the repo, decrypted at runtime to tmpfs.

### Architecture

```
infra/nixos/
├── configuration.nix              # Public system config (tracked)
├── hardware-configuration.nix     # Delegates to private input (tracked)
├── sops-secrets.nix               # SOPS secret definitions (tracked)
├── services/
│   ├── guardian-core.nix          # Brain service unit (tracked)
│   ├── rumi-platform.nix         # Phoenix platform unit (tracked)
│   └── server.nix                # Webhook server unit (tracked)
├── secrets/
│   ├── guardian-core.env          # Encrypted (sops+age, tracked)
│   ├── rumi-platform.env         # Encrypted (sops+age, tracked)
│   └── rumi-server.env           # Encrypted (sops+age, tracked)
└── .gitignore                     # Excludes private.nix, hardware-configuration.private.nix

/etc/guardian-private/              # Host-only, not in repo
├── private.nix                    # Hostname, SSH keys, domain, sops config
└── hardware-configuration.private.nix  # Boot/disk/kernel modules
```

### Deploying NixOS Changes

```bash
# Deploy from repo (pass private config as external input)
sudo nixos-rebuild switch --flake .#rumi-vps \
  --override-input private-config path:/etc/guardian-private

# Edit encrypted secrets
nix-shell -p sops age --run "SOPS_AGE_KEY_FILE=/var/lib/sops-nix/key.txt sops infra/nixos/secrets/guardian-core.env"
```

### Key Management

- Age key: `/var/lib/sops-nix/key.txt` (0400 root:root)
- Public key: listed in `.sops.yaml`
- Bootstrap: see `RUNBOOK-SOPS-BOOTSTRAP` in `docs/security/orchestration_runbook.json`
- Rotation: 90 days per `docs/security/secrets_management.json`

### Security Controls

| Control | Enforcement |
|---------|------------|
| SP-SECRET-001 | No plaintext secrets in repo; encrypted dotenv files only |
| SP-SECRET-002 | systemd hardening (NoNewPrivileges, ProtectSystem=strict, PrivateTmp) |
| SP-SECRET-003 | sops-nix runtime injection via EnvironmentFile; fail-closed on missing secret |
| SP-GATE-SECRETS | gitleaks scan blocks release on detected secrets |
