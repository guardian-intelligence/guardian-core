{ config, lib, pkgs, ... }:

let
  envSecretName = "rumi-platform-env";
  envFile =
    if builtins.hasAttr envSecretName config.sops.secrets then
      config.sops.secrets.${envSecretName}.path
    else
      throw "rumi-platform requires sops secret ${envSecretName}; do not use plaintext .env files.";
in
{
  systemd.services.rumi-platform = {
    description = "Guardian Platform (Elixir Phoenix)";
    after = [ "network.target" ];
    wantedBy = [ "multi-user.target" ];

    serviceConfig = {
      Type = "exec";
      User = "rumi";
      Group = "users";
      WorkingDirectory = "/opt/guardian-platform";
      ExecStart = "/opt/guardian-platform/bin/guardian start";
      ExecStop = "/opt/guardian-platform/bin/guardian stop";
      Restart = "always";
      RestartSec = 5;
      EnvironmentFile = envFile;
      LimitNOFILE = 65535;

      # SP-SECRET-002: Prevent secret leakage via systemd hardening
      NoNewPrivileges = true;
      PrivateTmp = true;
      ProtectSystem = "strict";
      ReadWritePaths = [ "/opt/guardian-platform" ];
      ProtectHome = true;
    };
  };
}
