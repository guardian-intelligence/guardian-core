{ config, lib, pkgs, private-config, ... }:

{
  imports = [
    ./hardware-configuration.nix
    ./services/guardian-core.nix
    ./services/rumi-platform.nix
    ./services/server.nix
    ./sops-secrets.nix
    (private-config + "/private.nix")
  ];

  # System
  system.stateVersion = "24.11";
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
  };

  # Passwordless sudo for wheel
  security.sudo.wheelNeedsPassword = false;

  # SSH
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      PermitRootLogin = "prohibit-password";
    };
  };

  # Allow running generic Linux dynamic binaries (e.g., vendor CLIs)
  programs.nix-ld.enable = true;

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
  };

  # Tailscale
  services.tailscale.enable = true;

  # Firewall
  networking.firewall = {
    enable = true;
    allowedTCPPorts = [ 22 80 443 ];
    trustedInterfaces = [ "tailscale0" ];
  };

  # Shell aliases
  environment.interactiveShellInit = ''
    export PATH="$HOME/.npm-global/bin:$PATH"
    alias cc="$HOME/.npm-global/bin/claude --dangerously-skip-permissions"
    alias cod='codex --yolo'
    alias gmi='gemini --yolo'
  '';

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
