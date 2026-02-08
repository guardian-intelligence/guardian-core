---
name: development
description: Development environment, Nix flakes, NixOS infrastructure, sops-nix secrets, systemd services, deployment, Elixir platform, Docker containers, and CI pipeline reference. Use when working on infrastructure, Nix configuration, secrets management, service definitions, deploy scripts, build pipelines, or troubleshooting dev environment issues.
---

# Guardian Core Development & Infrastructure Reference

Comprehensive reference for all development, infrastructure, and operations concerns. Cross-references `/debug` for container issues and `/self-update` for deploy commands.

---

## 1. Dev Environment

### Bootstrap

```bash
scripts/bootstrap.sh   # Idempotent; installs Nix, direnv, pins flake.lock, runs bun install
```

Works on macOS (Apple Silicon/Intel), NixOS, and non-NixOS Linux. Detects NixOS via `/etc/NIXOS`.

### Nix devShell Contents

Activated automatically via `.envrc` (`use flake`) + direnv, or manually with `nix develop`.

| Tool | Version / Source | Notes |
|------|-----------------|-------|
| Node.js | `nodejs_22` (nixpkgs) | Used by WhatsApp bridge, container runtime |
| Bun | `1.3.8` (pinned, asserted) | Runtime + package manager; shellHook aborts on mismatch |
| Git | nixpkgs | — |
| Docker client | `docker-client` (nixpkgs) | CLI only; daemon runs on host |
| age | nixpkgs | For local secret editing |
| Elixir | `1.18` (erlang_27) | `beam.packages.erlang_27.elixir_1_18` |
| Erlang/OTP | `27` | `beam.packages.erlang_27.erlang` |

### Shell Environment

Set by `shellHook` in `flake.nix`:

```
PATH prepends: $PWD/node_modules/.bin, $MIX_HOME/bin, $MIX_HOME/escripts
MIX_HOME = $PWD/.nix-mix
HEX_HOME = $PWD/.nix-hex
BUN_VERSION_PIN = 1.3.8
```

### direnv Integration

| File | Purpose |
|------|---------|
| `.envrc` | Contains `use flake` — activates devShell on cd |
| `.nix-mix/` | Local Mix home (gitignored) |
| `.nix-hex/` | Local Hex home (gitignored) |

---

## 2. Nix Flake Architecture

### Source: `flake.nix`

```
inputs:
  nixpkgs        → github:NixOS/nixpkgs/nixpkgs-unstable
  flake-utils    → github:numtide/flake-utils
  sops-nix       → github:Mic92/sops-nix
  private-config → path:/etc/guardian-private  (flake = false)
```

### Outputs

| Output | System | Purpose |
|--------|--------|---------|
| `devShells.default` | `eachDefaultSystem` | Dev toolchain (Node 22, Bun 1.3.8, Elixir 1.18/OTP 27) |
| `nixosConfigurations.rumi-vps` | `x86_64-linux` | Full NixOS system config for production VPS |

### Private Config Pattern

Nix flakes can only see git-tracked files. Host-specific config lives at `/etc/guardian-private/` (external flake input, `flake = false`):

| File | Contents |
|------|----------|
| `/etc/guardian-private/private.nix` | Hostname, SSH keys, domain, sops age keyFile path |
| `/etc/guardian-private/hardware-configuration.private.nix` | Boot loader, disk/filesystem, kernel modules |

`hardware-configuration.nix` (tracked) delegates to `private-config + "/hardware-configuration.private.nix"`.

### Updating Flake Inputs

```bash
nix flake update                    # Update all inputs
nix flake lock --update-input nixpkgs  # Update only nixpkgs
```

**Pitfall:** After updating nixpkgs, rebuild to verify nothing breaks before deploying.

---

## 3. NixOS System Configuration

### Host: `rumi-vps` (`167.114.144.68`, x86_64-linux)

### Module Import Chain

`configuration.nix` imports:
1. `./hardware-configuration.nix` → delegates to `private-config`
2. `./services/guardian-core.nix`
3. `./services/rumi-platform.nix`
4. `./services/server.nix`
5. `./sops-secrets.nix`
6. `private-config + "/private.nix"`

### System Settings

| Setting | Value |
|---------|-------|
| `system.stateVersion` | `24.11` |
| `time.timeZone` | `UTC` |
| Nix experimental features | `nix-command`, `flakes` |
| Trusted users | `root`, `rumi` |

### User: `rumi`

| Property | Value |
|----------|-------|
| `isNormalUser` | `true` |
| `extraGroups` | `docker`, `wheel` |
| Passwordless sudo | Yes (`security.sudo.wheelNeedsPassword = false`) |

### SSH

| Setting | Value |
|---------|-------|
| `PasswordAuthentication` | `false` |
| `PermitRootLogin` | `prohibit-password` |

**Critical:** Port 22 MUST remain in `allowedTCPPorts` — SSH is via public IP, not Tailscale only.

### Caddy Reverse Proxy

```nix
services.caddy.enable = true;
services.caddy.globalConfig = ''acme_ca https://acme-v02.api.letsencrypt.org/directory'';
```

Virtual host definitions live in `private.nix` (host-specific domains).

### Tailscale

```nix
services.tailscale.enable = true;
```

### Firewall

| Rule | Value |
|------|-------|
| `allowedTCPPorts` | `22`, `80`, `443` |
| `trustedInterfaces` | `tailscale0` |

### System Packages (VPS)

`git`, `curl`, `htop`, `jq`, `bun`, `nodejs_22`, `docker-client`

### Other

| Feature | Value |
|---------|-------|
| `programs.nix-ld.enable` | `true` (run generic Linux binaries) |
| Docker autoPrune | Weekly |

---

## 4. Secrets Management (sops-nix + age)

### Architecture

```
.sops.yaml                          # Creation rules: path_regex → age keys
infra/nixos/secrets/*.env           # Encrypted dotenv files (tracked in git)
/var/lib/sops-nix/key.txt           # age private key (0400 root:root)
/run/secrets/*                      # Decrypted at runtime to tmpfs
```

### Security Controls

| Control | Rule |
|---------|------|
| **SP-SECRET-001** | No plaintext secrets in repo; encrypted dotenv only (**non-waivable**) |
| **SP-SECRET-002** | systemd hardening on all services (**non-waivable**) |
| **SP-SECRET-003** | sops-nix runtime injection via EnvironmentFile; fail-closed on missing secret |
| **SP-GATE-SECRETS** | gitleaks scan blocks release on detected secrets |

### Encrypted Secret Files

| File | sops secret name | Owner | Mode |
|------|-----------------|-------|------|
| `infra/nixos/secrets/guardian-core.env` | `guardian-core-env` | `rumi:users` | `0400` |
| `infra/nixos/secrets/rumi-platform.env` | `rumi-platform-env` | `rumi:users` | `0400` |
| `infra/nixos/secrets/rumi-server.env` | `rumi-server-env` | `rumi:users` | `0400` |

All defined in `infra/nixos/sops-secrets.nix` with `format = "dotenv"`.

### .sops.yaml

```yaml
keys:
  - &rumi-vps age1gngjsgsqhdjre3yjnk2dqregh3dt7n38273uxsjx52xqszz3jujqfcthcp
creation_rules:
  - path_regex: infra/nixos/secrets/.*\.env$
    key_groups:
      - age:
          - *rumi-vps
```

### Editing Secrets

`age` and `sops` are NOT installed system-wide on the VPS. Use nix-shell:

```bash
nix-shell -p sops age --run \
  "SOPS_AGE_KEY_FILE=/var/lib/sops-nix/key.txt sops infra/nixos/secrets/<file>.env"
```

### Adding a New Secret File

1. Create the encrypted file:
   ```bash
   nix-shell -p sops age --run \
     "SOPS_AGE_KEY_FILE=/var/lib/sops-nix/key.txt sops infra/nixos/secrets/new-service.env"
   ```
2. Add entry in `infra/nixos/sops-secrets.nix`:
   ```nix
   sops.secrets."new-service-env" = {
     sopsFile = ./secrets/new-service.env;
     format = "dotenv";
     owner = "rumi";
     group = "users";
     mode = "0400";
   };
   ```
3. Reference in service unit: `EnvironmentFile = config.sops.secrets."new-service-env".path;`
4. Commit the encrypted `.env` file to git.

### Fail-Closed Pattern

All three service `.nix` files use a `throw` guard:

```nix
envFile =
  if builtins.hasAttr envSecretName config.sops.secrets then
    config.sops.secrets.${envSecretName}.path
  else
    throw "<service> requires sops secret ${envSecretName}; do not use plaintext .env files.";
```

This prevents NixOS from building if the secret definition is missing — **fail-closed**.

### Key Management

| Item | Value |
|------|-------|
| Age private key | `/var/lib/sops-nix/key.txt` (0400 root:root) |
| Age public key | Listed in `.sops.yaml` |
| Rotation period | 90 days (per `docs/security/secrets_management.json`) |
| Bootstrap runbook | `RUNBOOK-SOPS-BOOTSTRAP` in `docs/security/orchestration_runbook.json` |

---

## 5. Systemd Services

### Service Comparison

| Property | guardian-core | rumi-platform | rumi-server |
|----------|--------------|---------------|-------------|
| **Description** | Guardian Core — Personal Claude assistant | Guardian Platform (Elixir Phoenix) | Rumi Webhook Server |
| **Type** | `simple` | `exec` | `simple` |
| **User/Group** | `rumi` / `users` | `rumi` / `users` | `rumi` / `users` |
| **WorkingDirectory** | `/opt/guardian-core` | `/opt/guardian-platform` | `/opt/guardian-core/server` |
| **ExecStart** | `.../rel/guardian/bin/guardian start` | `/opt/guardian-platform/bin/guardian start` | `${pkgs.bun}/bin/bun run src/index.ts` |
| **ExecStop** | — (SIGTERM) | `.../bin/guardian stop` | — (SIGTERM) |
| **After** | `network.target`, `docker.service` | `network.target` | `network.target` |
| **Requires** | `docker.service` | — | — |
| **Restart** | `always` / 5s | `always` / 5s | `always` / 5s |
| **EnvironmentFile** | sops `guardian-core-env` | sops `rumi-platform-env` | sops `rumi-server-env` |
| **Log stdout** | `logs/guardian-core.log` | — (journal) | — (journal) |
| **Log stderr** | `logs/guardian-core.error.log` | — (journal) | — (journal) |
| **HOME access** | Yes (`ProtectHome=tmpfs` + `BindPaths=["/home/rumi"]`) | No (`ProtectHome=true`) | No (`ProtectHome=true`) |
| **ReadWritePaths** | `/opt/guardian-core`, `/home/rumi` | `/opt/guardian-platform` | `/opt/guardian-core/server` |
| **LimitNOFILE** | — | 65535 | — |

### Hardening (SP-SECRET-002, all services)

```nix
NoNewPrivileges = true;
PrivateTmp = true;
ProtectSystem = "strict";
```

**Key:** `ProtectSystem = "strict"` makes the entire filesystem read-only except paths listed in `ReadWritePaths`.

### guardian-core Environment Variables

Set in `services/guardian-core.nix`:

| Variable | Value |
|----------|-------|
| `HOME` | `/home/rumi` |
| `ASSISTANT_NAME` | `Rumi` |
| `MIX_ENV` | `prod` |
| `GUARDIAN_PROJECT_ROOT` | `/opt/guardian-core` |

Additional vars come from the sops EnvironmentFile (API keys, tokens).

### Systemd Service Template (non-NixOS)

`infra/systemd/guardian-core.service` is a template with `{{PLACEHOLDERS}}` resolved by `mix deploy.brain`. Used for non-NixOS Linux installs. The NixOS `.nix` definitions take precedence on rumi-vps.

---

## 6. Deploying NixOS Changes

### Command

```bash
sudo nixos-rebuild switch --flake .#rumi-vps \
  --override-input private-config path:/etc/guardian-private
```

### Dry Run

```bash
sudo nixos-rebuild dry-activate --flake .#rumi-vps \
  --override-input private-config path:/etc/guardian-private
```

### Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| `error: path '/etc/guardian-private' is not in the Nix store` | Forgot `--override-input` | Always pass `--override-input private-config path:/etc/guardian-private` |
| File not found in flake | File not git-tracked | `git add` the file first; Nix flakes only see tracked files |
| Secret decryption fails | Missing age key or wrong permissions | Verify `/var/lib/sops-nix/key.txt` exists with `0400 root:root` |
| Port 22 blocked after rebuild | Removed from `allowedTCPPorts` | **Never remove 22** — SSH is via public IP |
| Service won't start | Missing sops secret definition | fail-closed `throw` fires; add the secret to `sops-secrets.nix` |

### Post-Deploy Verification

```bash
systemctl status guardian-core rumi-platform rumi-server
journalctl -u guardian-core -n 20 --no-pager
journalctl -u rumi-platform -n 20 --no-pager
journalctl -u rumi-server -n 20 --no-pager
```

---

## 7. Elixir Development

### Project: `platform/`

| Property | Value |
|----------|-------|
| App name | `:guardian` |
| Version | `0.1.0` |
| Elixir requirement | `~> 1.15` |
| OTP (devShell) | Erlang 27, Elixir 1.18 |
| Web framework | Phoenix `~> 1.8.3` |
| HTTP server | Bandit `~> 1.5` |
| Database | SQLite3 (`ecto_sqlite3 ~> 0.17`) |
| JSON | Jason `~> 1.2` |
| HTTP client | Req `~> 0.5` |
| JWT | JOSE `~> 1.11` |
| Cron | Crontab `~> 1.1` |
| Linting | Credo `~> 1.7` (dev/test only) |
| Static analysis | Dialyxir `~> 1.4` (dev/test only) |

### Common Commands

```bash
cd platform && mix deps.get          # Fetch dependencies
cd platform && mix compile            # Compile
cd platform && mix compile --warnings-as-errors  # Strict compile
cd platform && mix test               # Run tests
cd platform && mix phx.server         # Start dev server (port 4000, kernel disabled)
cd platform && mix format             # Format code
cd platform && mix credo              # Lint
cd platform && mix dialyzer           # Static type analysis
cd platform && mix precommit          # compile --warnings-as-errors + unlock unused + format + test
```

### Config Hierarchy

| File | Env | Key settings |
|------|-----|-------------|
| `config/config.exs` | All | `kernel_enabled: false`, Repo db path, Endpoint, Logger, Jason |
| `config/dev.exs` | Dev | Bind `127.0.0.1`, code_reloader, debug_errors, dev_routes |
| `config/test.exs` | Test | Port 4002, in-memory SQLite (`:memory:`), server: false |
| `config/prod.exs` | Prod | force_ssl, log level: info |
| `config/runtime.exs` | All (runtime) | `GUARDIAN_PROJECT_ROOT`, SQLite path, PHX_SERVER, kernel_enabled in prod |

### Required Env Vars (prod)

| Variable | Source | Required |
|----------|--------|----------|
| `SECRET_KEY_BASE` | sops | Yes (raises on missing) |
| `PHX_HOST` | sops or default | No (defaults to `self.rumi.engineering`) |
| `PORT` | env | No (defaults to `4000`) |
| `GITHUB_APP_ID` | sops | Yes (raises on missing) |
| `GITHUB_APP_PRIVATE_KEY` | sops | Yes (raises on missing) |
| `GITHUB_APP_INSTALLATION_ID` | sops | Yes (raises on missing) |
| `ELEVENLABS_WEBHOOK_SECRET` | sops | No (optional) |
| `GUARDIAN_PROJECT_ROOT` | systemd env | No (defaults to `File.cwd!()`) |
| `PHX_SERVER` | systemd env | No (enables HTTP server when set) |

### Building a Release

```bash
cd platform && MIX_ENV=prod mix release --overwrite
# Output: platform/_build/prod/rel/guardian/bin/guardian
```

### Mix Aliases

| Alias | Expands to |
|-------|-----------|
| `mix setup` | `deps.get` |
| `mix precommit` | `compile --warnings-as-errors` + `deps.unlock --unused` + `format` + `test` |

---

## 8. Docker Container Development

### Image: `guardian-core-agent`

| Property | Value |
|----------|-------|
| Base | `node:22-slim` |
| Bun version | `1.3.8` (matches flake pin) |
| Runtime user | `node` (non-root, required for `--dangerously-skip-permissions`) |
| Working directory | `/workspace/group` |
| Entry point | `/app/entrypoint.sh` (sources env, pipes stdin to `node /app/dist/index.js`) |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk@0.2.29` |

### Build Pipeline (`container/build.sh`)

```
1. cd container/
2. Build @guardian/shared types (npx tsc in shared/)
3. Copy shared/dist + package.json → .shared-cache/
4. docker build -t guardian-core-agent:<tag> .
```

```bash
./container/build.sh          # Build with tag "latest"
./container/build.sh v1.2     # Build with custom tag
```

### Dockerfile Layer Order

```
1. FROM node:22-slim
2. apt-get: Chromium + system deps + GitHub CLI (gh)
3. Install Bun 1.3.8 to /opt/bun
4. Set AGENT_BROWSER_EXECUTABLE_PATH, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH → /usr/bin/chromium
5. bun add -g agent-browser @anthropic-ai/claude-code
6. COPY .shared-cache/ /shared/
7. COPY agent-runner/package.json + bun.lock → /app/
8. bun install
9. COPY agent-runner/ → /app/
10. bun run build (TypeScript compilation)
11. mkdir /workspace/{group,global,extra,ipc/messages,ipc/tasks}
12. Create /app/entrypoint.sh
13. chown -R node:node /workspace
14. USER node
```

### .dockerignore

```
**/node_modules
**/.tsbuildinfo
```

### Container Packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/claude-agent-sdk` | `0.2.29` | Claude Agent SDK for container agent |
| `@guardian/shared` | `file:../shared` | Shared TS types (IPC protocol, schemas) |
| `cron-parser` | `^5.0.0` | Parse cron expressions for task scheduling |
| `zod` | `^4.0.0` | Runtime schema validation |

### Testing Container

```bash
# Quick test
echo '{"prompt":"What is 2+2?","groupFolder":"test","chatJid":"test@g.us","isMain":false}' | \
  docker run -i guardian-core-agent:latest

# Interactive shell
docker run --rm -it --entrypoint /bin/bash guardian-core-agent:latest

# Full test with mounts (see /debug skill for details)
```

### Rebuilding

```bash
./container/build.sh                    # Normal rebuild
docker builder prune -af && ./container/build.sh  # Clean rebuild
```

---

## 9. CI Pipeline

### Source: `.github/workflows/ci.yml`

Triggers: push to `main`, all pull requests.

### Jobs

| Job | Runs On | Steps |
|-----|---------|-------|
| **root** | `ubuntu-latest` | checkout → nix install → magic-nix-cache → `bun install --frozen-lockfile` → typecheck → test → build → lint |
| **server** | `ubuntu-latest` | checkout → nix install → magic-nix-cache → `bun --cwd server install --frozen-lockfile` → typecheck |
| **agent-runner** | `ubuntu-latest` | checkout → nix install → magic-nix-cache → `bun --cwd container/agent-runner install --frozen-lockfile` → build |

### Nix in CI

All jobs use:
- `DeterminateSystems/nix-installer-action@main` — installs Nix
- `DeterminateSystems/magic-nix-cache-action@main` — caches Nix store

All commands run inside `nix develop --command ...` to use the pinned devShell.

### What's NOT in CI

- Elixir compilation/tests (platform/)
- Docker image builds
- NixOS configuration checks
- Secret decryption

---

## 10. Project Directory Reference

### Tracked in Git

| Path | Purpose |
|------|---------|
| `flake.nix` | Nix flake: devShell + NixOS config |
| `flake.lock` | Pinned input versions |
| `.envrc` | direnv: `use flake` |
| `.sops.yaml` | sops creation rules + age public key |
| `infra/nixos/configuration.nix` | NixOS system config |
| `infra/nixos/hardware-configuration.nix` | Delegates to private input |
| `infra/nixos/sops-secrets.nix` | sops secret definitions |
| `infra/nixos/services/*.nix` | systemd service modules (3 files) |
| `infra/nixos/secrets/*.env` | Encrypted dotenv files (3 files) |
| `infra/systemd/guardian-core.service` | Systemd template (non-NixOS, `{{PLACEHOLDERS}}`) |
| `platform/` | Elixir Phoenix application |
| `container/Dockerfile` | Agent container image definition |
| `container/build.sh` | Container build script |
| `container/agent-runner/` | Claude Agent SDK runner (TypeScript) |
| `container/shared/` | Shared TS types (`@guardian/shared`) |
| `container/whatsapp-bridge/` | Baileys WhatsApp bridge (Node.js) |
| `scripts/bootstrap.sh` | Dev environment bootstrap |
| `.github/workflows/ci.yml` | CI pipeline |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `docs/security/*.json` | Security policy, checklist, waivers |

### Runtime (Not in Git)

| Path | Purpose |
|------|---------|
| `store/messages.db` | SQLite database |
| `logs/` | Application and deploy logs |
| `data/env/env` | Filtered env file for container mounts |
| `data/ipc/` | IPC directories (messages, tasks) |
| `data/sessions/` | Per-group Claude session state |
| `.nix-mix/`, `.nix-hex/` | Local Mix/Hex homes |
| `node_modules/` | Bun dependencies |
| `platform/_build/` | Elixir build artifacts |
| `platform/deps/` | Elixir dependencies |
| `container/.shared-cache/` | Pre-built shared package for Docker context |

### Host-Only (VPS, Not in Git)

| Path | Purpose |
|------|---------|
| `/etc/guardian-private/private.nix` | Hostname, SSH keys, domain, sops config |
| `/etc/guardian-private/hardware-configuration.private.nix` | Boot/disk/kernel modules |
| `/var/lib/sops-nix/key.txt` | age private key (0400 root:root) |
| `/run/secrets/*` | Decrypted secrets (tmpfs) |
| `/opt/guardian-core/` | Deployed brain |
| `/opt/guardian-platform/` | Deployed Phoenix release |

---

## 11. Troubleshooting

### Nix / devShell

| Issue | Cause | Fix |
|-------|-------|-----|
| `bun: command not found` | Not in devShell | Run `nix develop` or ensure direnv is active |
| `error: expected bun 1.3.8, got X.Y.Z` | Bun version mismatch | Update nixpkgs or adjust `bunVersion` in `flake.nix` |
| `error: assertion failed` at `bun.version == bunVersion` | nixpkgs bun doesn't match pin | Run `nix flake update` or adjust `bunVersion` |
| `use_flake: command not found` | direnv missing nix-direnv | Install nix-direnv or run `nix develop` manually |
| `elixir: command not found` | Not in devShell | Activate devShell; Elixir comes from `beam.packages.erlang_27.elixir_1_18` |

### NixOS Deployment

| Issue | Cause | Fix |
|-------|-------|-----|
| `path not in Nix store` | Missing `--override-input` | Add `--override-input private-config path:/etc/guardian-private` |
| `No such file: private.nix` | `/etc/guardian-private/` missing or empty | Create the directory and populate from backup |
| sops decryption error | Wrong/missing age key | Check `/var/lib/sops-nix/key.txt` exists, mode 0400, owned root:root |
| Service fails to start post-rebuild | Missing env vars | Check `journalctl -u <service>` for "missing" errors; edit sops secret |
| `throw` error during build | sops secret not defined | Add entry in `sops-secrets.nix` |
| Locked out of SSH | Port 22 removed from firewall | **Prevention:** never remove 22 from `allowedTCPPorts`; recovery requires VPS console |

### Elixir / Phoenix

| Issue | Cause | Fix |
|-------|-------|-----|
| `could not compile dependency` | Missing system libs or version mismatch | Ensure devShell is active (OTP 27 + Elixir 1.18) |
| `(Mix) Could not find an SCM for :dep` | Missing `mix deps.get` | Run `cd platform && mix deps.get` |
| Tests fail in CI but pass locally | Env var differences | Check `config/test.exs`; tests use in-memory SQLite, port 4002 |
| `SECRET_KEY_BASE is missing` | Prod env not configured | Set in sops secret or export for local testing |
| `GITHUB_APP_ID is missing` | Prod env not configured | Set in sops secret (fail-closed in prod) |
| Release won't start | Missing `GUARDIAN_PROJECT_ROOT` | Set env var or ensure CWD is project root |

### Docker / Container

| Issue | Cause | Fix |
|-------|-------|-----|
| `Cannot connect to Docker daemon` | Docker not running | `sudo systemctl start docker` |
| Container build fails at `bun install` | Network issue or lock mismatch | `docker builder prune -af` then retry |
| `--dangerously-skip-permissions cannot be used with root` | Running as root inside container | Verify `USER node` in Dockerfile |
| Shared types not found | `.shared-cache/` stale | Run `./container/build.sh` (rebuilds shared first) |
| Agent exits code 1 | Auth, permissions, or session issue | See `/debug` skill for detailed diagnosis |

For container-specific debugging (mounts, env vars, sessions, IPC), see the **`/debug`** skill.
For deployment commands and troubleshooting, see the **`/self-update`** skill.
