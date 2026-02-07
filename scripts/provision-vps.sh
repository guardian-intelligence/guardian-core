#!/usr/bin/env bash
set -euo pipefail

# Provision an OVH VPS: Ubuntu → NixOS via nixos-infect
# Usage: ./scripts/provision-vps.sh <VPS_IP>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

VPS_IP="${1:?Usage: $0 <VPS_IP>}"
SSH_USER="ubuntu"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10"

info()  { echo "==> $*"; }
error() { echo "ERROR: $*" >&2; exit 1; }

# Step 1: Verify SSH access
info "Verifying SSH access to $SSH_USER@$VPS_IP..."
ssh $SSH_OPTS "$SSH_USER@$VPS_IP" "echo 'SSH OK'" || error "Cannot SSH into $VPS_IP"

# Step 2: Copy SSH authorized_keys to root for post-reboot access
info "Setting up root SSH access for post-reboot..."
ssh $SSH_OPTS "$SSH_USER@$VPS_IP" "sudo mkdir -p /root/.ssh && sudo cp ~/.ssh/authorized_keys /root/.ssh/authorized_keys"

# Step 3: Run nixos-infect
info "Running nixos-infect (this will reboot the VPS)..."
ssh $SSH_OPTS "$SSH_USER@$VPS_IP" "curl -fsSL https://raw.githubusercontent.com/elitak/nixos-infect/master/nixos-infect | NIX_CHANNEL=nixos-unstable sudo -E bash 2>&1" || true
# nixos-infect reboots the machine, so the SSH connection drops — that's expected

# Step 4: Wait for reboot
info "Waiting for VPS to reboot into NixOS..."
MAX_WAIT=300
INTERVAL=10
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    if ssh $SSH_OPTS "root@$VPS_IP" "test -f /etc/NIXOS" 2>/dev/null; then
        info "NixOS detected after ${ELAPSED}s"
        break
    fi
    echo "  Waiting... (${ELAPSED}s / ${MAX_WAIT}s)"
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    error "Timed out waiting for NixOS boot after ${MAX_WAIT}s"
fi

# Step 5: Copy hardware-configuration.nix back to repo
info "Copying hardware-configuration.nix from VPS..."
scp $SSH_OPTS "root@$VPS_IP:/etc/nixos/hardware-configuration.nix" "$REPO_ROOT/nixos/hardware-configuration.nix"

info "Done! hardware-configuration.nix saved to nixos/"
info ""
info "Next steps:"
info "  1. Review nixos/hardware-configuration.nix"
info "  2. Update the SSH key in nixos/configuration.nix"
info "  3. Sync repo and apply config:"
info "     rsync -avz --exclude node_modules --exclude .git --exclude dist ./ rumi@$VPS_IP:/opt/guardian-core/"
info "     ssh root@$VPS_IP 'cd /opt/guardian-core && nixos-rebuild switch --flake .#rumi-vps'"
