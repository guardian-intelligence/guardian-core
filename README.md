# Guardian Core

A multi-agent system with two backends: an Elixir Phoenix API for webhook handling (GitHub tools, signature verification) and an Elixir OTP kernel that routes WhatsApp messages to Claude agents running in isolated Docker containers. The entire toolchain and production server are defined declaratively through Nix Flakes.

## Architecture

```
WhatsApp ──→ Elixir Kernel (platform/lib/guardian/kernel/) ──→ Docker Container
              │                                                  │
              ├─ Message routing                                 ├─ Claude Agent SDK
              ├─ SQLite (chats, tasks)                           ├─ Isolated filesystem
              ├─ Task scheduler                                  ├─ IPC MCP tools
              └─ IPC watcher                                     └─ Per-group persona & memory

ElevenLabs ──→ Phoenix API (platform/) ──→ GitHub API
               │
               ├─ HMAC signature verification
               ├─ GitHub App JWT auth
               ├─ Repo status + issue creation
               └─ Agent-cached installation tokens
```

## Directory Structure

```
guardian-core/
├── platform/                  # Elixir Phoenix API + OTP kernel
│   ├── lib/guardian/          #   Kernel, GitHub App client, business logic
│   ├── lib/guardian_web/      #   Controllers, plugs, router
│   ├── config/                #   Environment configs (dev/test/prod/runtime)
│   └── test/                  #   ExUnit tests
├── container/                 # Docker image for agent containers
│   ├── Dockerfile
│   └── agent-runner/          #   MCP IPC bridge (runs inside container)
├── infra/
│   ├── nixos/                 # NixOS server config (rumi-vps)
│   │   ├── configuration.nix  #   Main config (Caddy, Docker, SSH, Tailscale)
│   │   └── services/          #   guardian-core.nix, rumi-platform.nix
│   └── systemd/               # Linux service templates
├── groups/                    # Per-group memory and personas
├── flake.nix                  # Nix devShell + NixOS config
└── package.json               # Convenience deploy script aliases
```

## Infrastructure

### Development Environment (Nix Flakes)

The `flake.nix` devShell provides the complete toolchain:

- **Elixir 1.18 / Erlang/OTP 27** — kernel and Phoenix platform backend
- **git**, **docker**, **age** — operations and secrets

```bash
nix develop            # or use direnv with .envrc
```

### Production Server (NixOS)

The production host (`rumi-vps`) is a NixOS machine defined in `infra/nixos/configuration.nix`:

- **Guardian Kernel** service (`services/guardian-core.nix`) — WhatsApp message routing
- **Phoenix Platform** service (`services/rumi-platform.nix`) — webhook API
- **Docker** with weekly auto-prune
- **Caddy** reverse proxy with automatic TLS → Phoenix on port 4000
- **Tailscale** mesh networking
- **Firewall** — SSH, HTTP, HTTPS; Tailscale interface trusted

## Quick Start

Prerequisites: [Nix with flakes enabled](https://zero-to-nix.com/start/install)

```bash
git clone <repo-url> && cd guardian-core
nix develop

# Phoenix Platform + Kernel
cd platform && mix deps.get
cd platform && mix test         # ExUnit
cd platform && mix phx.server   # Port 4000
```

## Deploying

Two systems: **brain** (Guardian Core kernel) and **platform** (Elixir Phoenix, rumi-vps).

```bash
# Brain (Guardian Core)
cd platform && mix deploy.brain               # Smart deploy (detects what changed)
cd platform && mix deploy.brain --app         # Host app only
cd platform && mix deploy.brain --container   # Container image only
cd platform && mix deploy.brain --all         # Full rebuild

# Platform (Elixir Phoenix → rumi-vps)
cd platform && mix deploy.platform            # test, rsync, build release, restart
```

## Environment Variables

### Phoenix Platform (`platform/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY_BASE` | prod | Phoenix secret (generate via `mix phx.gen.secret`) |
| `PORT` | no | HTTP port (default: 4000) |
| `GITHUB_APP_ID` | prod | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | prod | GitHub App RSA private key (PEM, `\n` escaped) |
| `GITHUB_APP_INSTALLATION_ID` | prod | GitHub App installation ID |
| `ELEVENLABS_WEBHOOK_SECRET` | no | HMAC secret for webhook signature verification |

### Guardian Kernel (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | yes | Claude OAuth token |
| `ELEVENLABS_API_KEY` | yes | ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | yes | ElevenLabs agent ID |
| `ELEVENLABS_PHONE_NUMBER_ID` | no | ElevenLabs phone number (for outbound calls) |
