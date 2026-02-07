{
  description = "Guardian Core — Personal Claude assistant";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    sops-nix.url = "github:Mic92/sops-nix";
    private-config = {
      url = "path:/etc/guardian-private";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, sops-nix, private-config }:
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
            pkgs.beam.packages.erlang_27.elixir_1_18
            pkgs.beam.packages.erlang_27.erlang
          ];

          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            export BUN_VERSION_PIN="${bunVersion}"

            actual_bun_version="$(bun --version)"
            if [ "$actual_bun_version" != "$BUN_VERSION_PIN" ]; then
              echo "error: expected bun $BUN_VERSION_PIN, got $actual_bun_version" >&2
              exit 1
            fi

            export MIX_HOME="$PWD/.nix-mix"
            export HEX_HOME="$PWD/.nix-hex"
            export PATH="$MIX_HOME/bin:$MIX_HOME/escripts:$PATH"
          '';
        };
      }
    ))
    //
    {
      nixosConfigurations.rumi-vps = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        specialArgs = { inherit private-config; };
        modules = [
          sops-nix.nixosModules.sops
          ./infra/nixos/configuration.nix
        ];
      };
    };
}
