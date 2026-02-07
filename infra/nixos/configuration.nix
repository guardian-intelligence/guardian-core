{ config, lib, pkgs, ... }:

{
  imports = [
    ./hardware-configuration.nix
    ./services/guardian-core.nix
    ./services/rumi-platform.nix
  ];

  # System
  system.stateVersion = "24.11";
  networking.hostName = "rumi-vps";
  time.timeZone = "UTC";

  # Nix settings
  nix.settings = {
    experimental-features = [ "nix-command" "flakes" ];
    trusted-users = [ "root" "rumi" ];
  };

  # User
  users.users.rumi = {
    isNormalUser = true;
    extraGroups = [ "docker" "wheel" ];
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILKQukb2F24qn538p6Bc+gEXl+P8hgDvRdvNlOpZZVeN rch-worker-ovh"
    ];
  };

  # Passwordless sudo for wheel
  security.sudo.wheelNeedsPassword = false;

  # Root SSH access (same key as rumi)
  users.users.root.openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILKQukb2F24qn538p6Bc+gEXl+P8hgDvRdvNlOpZZVeN rch-worker-ovh"
  ];

  # SSH
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      PermitRootLogin = "prohibit-password";
    };
  };

  # Docker
  virtualisation.docker = {
    enable = true;
    autoPrune = {
      enable = true;
      dates = "weekly";
    };
  };

  # Caddy reverse proxy
  services.caddy = {
    enable = true;
    globalConfig = ''
      acme_ca https://acme-v02.api.letsencrypt.org/directory
    '';
    virtualHosts."self.rumi.engineering" = {
      extraConfig = ''
        reverse_proxy 127.0.0.1:4000
      '';
    };
  };

  # Tailscale
  services.tailscale.enable = true;

  # Firewall
  networking.firewall = {
    enable = true;
    allowedTCPPorts = [ 22 80 443 ];
    trustedInterfaces = [ "tailscale0" ];
  };

  # System packages
  environment.systemPackages = with pkgs; [
    git
    curl
    htop
    jq
    bun
    nodejs_22
    docker-client
  ];
}
