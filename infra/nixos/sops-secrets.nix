{ config, lib, pkgs, ... }:

{
  # SOPS secret definitions — references encrypted files tracked in repo.
  # The age keyFile and host identity live in the external private input.
  sops.secrets."guardian-core-env" = {
    sopsFile = ./secrets/guardian-core.env;
    format = "dotenv";
    owner = "rumi";
    group = "users";
    mode = "0400";
  };

  sops.secrets."rumi-platform-env" = {
    sopsFile = ./secrets/rumi-platform.env;
    format = "dotenv";
    owner = "rumi";
    group = "users";
    mode = "0400";
  };

  sops.secrets."rumi-server-env" = {
    sopsFile = ./secrets/rumi-server.env;
    format = "dotenv";
    owner = "rumi";
    group = "users";
    mode = "0400";
  };
}
