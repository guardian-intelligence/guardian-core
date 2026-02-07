#!/usr/bin/env bash
# Bootstrap Guardian Core development environment
# Idempotent — safe to run multiple times
# Works on: macOS (Apple Silicon/Intel), NixOS, non-NixOS Linux
set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

IS_NIXOS=false
if [ -f /etc/NIXOS ]; then
  IS_NIXOS=true
fi

OS="$(uname -s)"

# ── 1. Nix ────────────────────────────────────────────────────────────
if command -v nix &>/dev/null; then
  green "✓ Nix already installed ($(nix --version))"
elif [ "$IS_NIXOS" = true ]; then
  # NixOS always has Nix — if we're here, PATH is broken
  echo "ERROR: Running NixOS but 'nix' not in PATH. Check your shell config." >&2
  exit 1
else
  bold "Installing Nix (Determinate Systems installer)..."
  curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install --no-confirm
  # Source nix in current shell so subsequent steps work
  if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
    # shellcheck disable=SC1091
    . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
  fi
  green "✓ Nix installed"
fi

# Ensure flakes are enabled (NixOS may not have it by default)
if ! nix flake --help &>/dev/null 2>&1; then
  yellow "⚠ Flakes not enabled. Adding experimental features..."
  mkdir -p "$HOME/.config/nix"
  if [ ! -f "$HOME/.config/nix/nix.conf" ] || ! grep -q 'experimental-features' "$HOME/.config/nix/nix.conf" 2>/dev/null; then
    echo "experimental-features = nix-command flakes" >> "$HOME/.config/nix/nix.conf"
    green "✓ Flakes enabled in ~/.config/nix/nix.conf"
  fi
fi

# ── 2. direnv ─────────────────────────────────────────────────────────
if command -v direnv &>/dev/null; then
  green "✓ direnv already installed ($(direnv version))"
elif [ "$IS_NIXOS" = true ]; then
  yellow "⚠ direnv not found. Add 'programs.direnv.enable = true;' to your NixOS config."
  yellow "  Then run: sudo nixos-rebuild switch"
  yellow "  Continuing without direnv (you can use 'nix develop' manually)..."
else
  bold "Installing direnv via Nix..."
  nix profile install nixpkgs#direnv
  green "✓ direnv installed"
fi

# ── 3. Shell hook ─────────────────────────────────────────────────────
if command -v direnv &>/dev/null; then
  SHELL_NAME="$(basename "${SHELL:-/bin/bash}")"
  case "$SHELL_NAME" in
    zsh)  RC_FILE="$HOME/.zshrc";  HOOK='eval "$(direnv hook zsh)"' ;;
    bash) RC_FILE="$HOME/.bashrc"; HOOK='eval "$(direnv hook bash)"' ;;
    fish) RC_FILE="$HOME/.config/fish/config.fish"; HOOK='direnv hook fish | source' ;;
    *)    RC_FILE=""; HOOK="" ;;
  esac

  if [ -n "$RC_FILE" ]; then
    if grep -q 'direnv hook' "$RC_FILE" 2>/dev/null; then
      green "✓ direnv hook already in $RC_FILE"
    else
      echo "" >> "$RC_FILE"
      echo "# direnv — auto-activate Nix dev shells" >> "$RC_FILE"
      echo "$HOOK" >> "$RC_FILE"
      green "✓ Added direnv hook to $RC_FILE"
    fi
  else
    yellow "⚠ Unknown shell '$SHELL_NAME' — add direnv hook manually"
    yellow "  See: https://direnv.net/docs/hook.html"
  fi
fi

# ── 4. Flake lock ────────────────────────────────────────────────────
if [ ! -f "$PROJECT_ROOT/flake.lock" ]; then
  bold "Generating flake.lock (pinning nixpkgs)..."
  nix flake lock "$PROJECT_ROOT"
  green "✓ flake.lock created"
else
  green "✓ flake.lock exists"
fi

# ── 5. direnv allow ──────────────────────────────────────────────────
if command -v direnv &>/dev/null; then
  bold "Allowing direnv for this project..."
  direnv allow "$PROJECT_ROOT"
  green "✓ direnv allowed"
fi

# ── 6. bun install ───────────────────────────────────────────────────
bold "Installing Bun dependencies (inside Nix shell)..."
nix develop "$PROJECT_ROOT" --command bun install
green "✓ Bun dependencies installed"

# ── Done ─────────────────────────────────────────────────────────────
echo ""
bold "Guardian Core dev environment ready!"
echo ""
echo "  Open a new terminal, cd into the project, and everything activates."
echo ""
echo "  Verify:"
echo "    which bun       → /nix/store/.../bin/bun"
echo "    bun --version   → 1.3.x"
echo "    bun run build   → compiles"
echo ""
if [ "$IS_NIXOS" = true ]; then
  echo "  NixOS detected. For service management, use systemd instead of launchd."
  echo ""
fi
