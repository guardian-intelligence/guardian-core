{ config, lib, pkgs, ... }:

# This file lives at /etc/guardian-private/private.nix on the host.
# It is passed to the flake via --override-input private-config path:/etc/guardian-private
# See RUNBOOK-SOPS-BOOTSTRAP in docs/security/orchestration_runbook.json for setup.
{
  # Host identity and domain routing
  networking.hostName = "example-vps";

  services.caddy.virtualHosts."example.com" = {
    extraConfig = ''
      reverse_proxy 127.0.0.1:4000
    '';
  };

  # SSH authorized keys
  users.users.rumi.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAA... replace-with-your-key comment"
  ];

  users.users.root.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAA... replace-with-your-key comment"
  ];

  # SOPS age key location (host-specific)
  # sops.secrets definitions are in infra/nixos/sops-secrets.nix (tracked in repo)
  sops = {
    age.keyFile = "/var/lib/sops-nix/key.txt";
    validateSopsFiles = true;
  };
}
