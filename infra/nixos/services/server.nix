{ config, lib, pkgs, ... }:

let
  envSecretName = "rumi-server-env";
  envFile =
    if builtins.hasAttr envSecretName config.sops.secrets then
      config.sops.secrets.${envSecretName}.path
    else
      throw "rumi-server requires sops secret ${envSecretName}; do not use plaintext .env files.";
in
{
  systemd.services.rumi-server = {
    description = "Rumi Webhook Server";
    after = [ "network.target" ];
    wantedBy = [ "multi-user.target" ];

    serviceConfig = {
      Type = "simple";
      User = "rumi";
      Group = "users";
      WorkingDirectory = "/opt/guardian-core/server";
      ExecStart = "${pkgs.bun}/bin/bun run src/index.ts";
      Restart = "always";
      RestartSec = 5;
      EnvironmentFile = envFile;

      # SP-SECRET-002: Prevent secret leakage via systemd hardening
      NoNewPrivileges = true;
      PrivateTmp = true;
      ProtectSystem = "strict";
      ReadWritePaths = [ "/opt/guardian-core/server" ];
      ProtectHome = true;
    };
  };
}
