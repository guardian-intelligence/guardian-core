{
  description = "Guardian Core — Personal Claude assistant";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    (flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        nodejs = pkgs.nodejs_22;
        bunVersion = "1.3.8";
        bun = pkgs.bun;
      in
      assert bun.version == bunVersion;
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            nodejs
            bun
            pkgs.git
            pkgs.docker-client
          ];

          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };
      }
    ))
    //
    {
      nixosConfigurations.rumi-vps = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [ ./nixos/configuration.nix ];
      };
    };
}
