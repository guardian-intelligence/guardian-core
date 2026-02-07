{ config, lib, pkgs, ... }:

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
      EnvironmentFile = "/opt/guardian-platform/.env";
      LimitNOFILE = 65535;
    };
  };
}
