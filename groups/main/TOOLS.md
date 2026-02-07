# Tools

Skills are shared. Your setup is yours. This file documents the environment-specific config that makes everything work.

## SSH Hosts

| Host | Address | Access |
|------|---------|--------|
| ovh-beast | 148.113.198.223 | `ssh -F /workspace/extra/ssh-keys/config ovh-beast` |
| headscale-vps | 100.64.0.1 | `ssh -F /workspace/extra/ssh-keys/config headscale-vps` |

## GitHub

- Org: rumi-engineering
- Main repo: rumi-engineering/apm2
- `gh` CLI available with GITHUB_TOKEN

## Phone Alerts

- Outbound calls via ElevenLabs + Twilio
- Use `make_phone_call` tool (critical alerts only)
- Always send WhatsApp first, call second

## Skills Repo

- Path: `/workspace/extra/skills-repo/`
- Git-managed, push after updates

## OVH Box (ovh-beast)

- apm2 workspace: `~/Projects/apm2`
- Rust toolchain installed
- Built binaries at `target/release/`

Update this file when environment config changes (new servers, new tools, new repos).
