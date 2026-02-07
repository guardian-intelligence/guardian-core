{ lib, private-config, ... }:

{
  imports = [ (private-config + "/hardware-configuration.private.nix") ];
}
