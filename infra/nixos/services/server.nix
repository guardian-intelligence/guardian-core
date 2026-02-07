{ config, lib, pkgs, ... }:

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
      EnvironmentFile = "/opt/guardian-core/server/.env";
    };
  };
}
