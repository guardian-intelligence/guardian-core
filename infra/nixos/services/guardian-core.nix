{ config, lib, pkgs, ... }:

let
  nodejs = pkgs.nodejs_22;
in
{
  systemd.services.guardian-core = {
    description = "Guardian Core — Personal Claude assistant";
    after = [ "network.target" "docker.service" ];
    requires = [ "docker.service" ];
    wantedBy = [ "multi-user.target" ];

    path = [ pkgs.bun nodejs pkgs.docker-client pkgs.git ];

    environment = {
      HOME = "/home/rumi";
      ASSISTANT_NAME = "Rumi";
    };

    serviceConfig = {
      Type = "simple";
      User = "rumi";
      Group = "users";
      WorkingDirectory = "/opt/guardian-core";
      ExecStart = "${pkgs.bun}/bin/bun dist/index.js";
      Restart = "always";
      RestartSec = 5;
      EnvironmentFile = "/opt/guardian-core/.env";
      StandardOutput = "append:/opt/guardian-core/logs/guardian-core.log";
      StandardError = "append:/opt/guardian-core/logs/guardian-core.error.log";
    };
  };
}
