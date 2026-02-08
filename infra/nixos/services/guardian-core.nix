{ config, lib, pkgs, ... }:

let
  nodejs = pkgs.nodejs_22;
  envSecretName = "guardian-core-env";
  envFile =
    if builtins.hasAttr envSecretName config.sops.secrets then
      config.sops.secrets.${envSecretName}.path
    else
      throw "guardian-core requires sops secret ${envSecretName}; do not use plaintext .env files.";
in
{
  systemd.services.guardian-core = {
    description = "Guardian Core — Personal Claude assistant";
    after = [ "network.target" "docker.service" ];
    requires = [ "docker.service" ];
    wantedBy = [ "multi-user.target" ];

    path = [ nodejs pkgs.docker-client pkgs.git ];

    environment = {
      HOME = "/home/rumi";
      ASSISTANT_NAME = "Rumi";
      MIX_ENV = "prod";
      GUARDIAN_PROJECT_ROOT = "/opt/guardian-core";
    };

    serviceConfig = {
      Type = "simple";
      User = "rumi";
      Group = "users";
      WorkingDirectory = "/opt/guardian-core";
      ExecStart = "/opt/guardian-core/platform/_build/prod/rel/guardian/bin/guardian start";
      Restart = "always";
      RestartSec = 5;
      EnvironmentFile = envFile;
      StandardOutput = "append:/opt/guardian-core/logs/guardian-core.log";
      StandardError = "append:/opt/guardian-core/logs/guardian-core.error.log";

      # SP-SECRET-002: Prevent secret leakage via systemd hardening
      NoNewPrivileges = true;
      PrivateTmp = true;
      ProtectSystem = "strict";
      ReadWritePaths = [ "/opt/guardian-core" "/home/rumi" ];
      ProtectHome = "tmpfs";
      BindPaths = [ "/home/rumi" ];
    };
  };
}
