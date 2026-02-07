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
            pkgs.age
          ];

          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            export BUN_VERSION_PIN="${bunVersion}"

            actual_bun_version="$(bun --version)"
            if [ "$actual_bun_version" != "$BUN_VERSION_PIN" ]; then
              echo "error: expected bun $BUN_VERSION_PIN, got $actual_bun_version" >&2
              exit 1
            fi
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
