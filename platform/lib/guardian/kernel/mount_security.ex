defmodule Guardian.Kernel.MountSecurity do
  @moduledoc """
  Validates additional mounts against an allowlist stored outside the project root.
  Port of MountSecurityService.ts — pure functions with dependency injection via opts.
  """

  require Logger

  @default_blocked_patterns [
    ".ssh",
    ".gnupg",
    ".gpg",
    ".aws",
    ".azure",
    ".gcloud",
    ".kube",
    ".docker",
    "credentials",
    ".env",
    ".netrc",
    ".npmrc",
    ".pypirc",
    "id_rsa",
    "id_ed25519",
    "private_key",
    ".secret"
  ]

  @type validation_result :: %{
          allowed: boolean(),
          reason: String.t(),
          real_host_path: String.t() | nil,
          effective_readonly: boolean() | nil
        }

  @doc """
  Load the mount allowlist JSON file.
  Returns {:ok, allowlist} or {:error, reason}.
  """
  @spec load_allowlist(keyword()) :: {:ok, map()} | {:error, String.t()}
  def load_allowlist(opts \\ []) do
    path = Keyword.get(opts, :path, Guardian.Kernel.Config.mount_allowlist_path())
    read_file = Keyword.get(opts, :read_file, &File.read/1)

    case read_file.(path) do
      {:ok, content} ->
        case Jason.decode(content) do
          {:ok, %{"allowedRoots" => roots, "blockedPatterns" => patterns, "nonMainReadOnly" => non_main_ro}}
          when is_list(roots) and is_list(patterns) and is_boolean(non_main_ro) ->
            merged_blocked = Enum.uniq(@default_blocked_patterns ++ patterns)

            {:ok,
             %{
               "allowedRoots" => roots,
               "blockedPatterns" => merged_blocked,
               "nonMainReadOnly" => non_main_ro
             }}

          {:ok, _} ->
            {:error, "Invalid allowlist schema at #{path}"}

          {:error, err} ->
            {:error, "Invalid JSON at #{path}: #{inspect(err)}"}
        end

      {:error, :enoent} ->
        {:error, "Allowlist not found at #{path}"}

      {:error, reason} ->
        {:error, "Failed to read #{path}: #{inspect(reason)}"}
    end
  end

  @doc """
  Validate a single mount request.
  Returns a validation_result map.
  """
  @spec validate_mount(map(), boolean(), keyword()) :: validation_result()
  def validate_mount(mount, is_main, opts \\ []) do
    home_dir = Keyword.get(opts, :home_dir, System.user_home!())
    real_path_fn = Keyword.get(opts, :real_path, &resolve_real_path/1)
    allowlist_opts = Keyword.take(opts, [:path, :read_file])

    host_path = Map.get(mount, "hostPath") || Map.get(mount, :hostPath)
    container_path = Map.get(mount, "containerPath") || Map.get(mount, :containerPath)
    mount_readonly = case {Map.get(mount, "readonly"), Map.get(mount, :readonly)} do
      {nil, val} -> val
      {val, _} -> val
    end

    case load_allowlist(allowlist_opts) do
      {:error, reason} ->
        %{allowed: false, reason: reason, real_host_path: nil, effective_readonly: nil}

      {:ok, allowlist} ->
        do_validate_mount(host_path, container_path, mount_readonly, is_main, allowlist, home_dir, real_path_fn)
    end
  end

  @doc """
  Validate a list of additional mounts. Returns only the allowed mounts
  with their resolved paths and effective readonly flags.
  """
  @spec validate_additional_mounts([map()], String.t(), boolean(), keyword()) ::
          [%{host_path: String.t(), container_path: String.t(), readonly: boolean()}]
  def validate_additional_mounts(mounts, group_name, is_main, opts \\ []) do
    Enum.reduce(mounts, [], fn mount, acc ->
      result = validate_mount(mount, is_main, opts)

      if result.allowed do
        container_path = mount["containerPath"] || mount[:containerPath]

        Logger.debug(
          "Mount validated for group=#{group_name} host=#{result.real_host_path} " <>
            "container=#{container_path} readonly=#{result.effective_readonly}"
        )

        [
          %{
            host_path: result.real_host_path,
            container_path: "/workspace/extra/#{container_path}",
            readonly: result.effective_readonly
          }
          | acc
        ]
      else
        host_path = mount["hostPath"] || mount[:hostPath]

        Logger.warning(
          "Mount REJECTED for group=#{group_name} path=#{host_path} reason=#{result.reason}"
        )

        acc
      end
    end)
    |> Enum.reverse()
  end

  # --- Private ---

  defp do_validate_mount(host_path, container_path, mount_readonly, is_main, allowlist, home_dir, real_path_fn) do
    cond do
      not valid_container_path?(container_path) ->
        %{
          allowed: false,
          reason: "Invalid container path: \"#{container_path}\" - must be relative, non-empty, and not contain \"..\"",
          real_host_path: nil,
          effective_readonly: nil
        }

      true ->
        expanded = expand_path(host_path, home_dir)

        case real_path_fn.(expanded) do
          {:ok, real_host_path} ->
            blocked = matches_blocked_pattern(real_host_path, allowlist["blockedPatterns"])

            if blocked do
              %{
                allowed: false,
                reason: "Path matches blocked pattern \"#{blocked}\": \"#{real_host_path}\"",
                real_host_path: nil,
                effective_readonly: nil
              }
            else
              case find_allowed_root(real_host_path, allowlist["allowedRoots"], home_dir, real_path_fn) do
                nil ->
                  roots =
                    allowlist["allowedRoots"]
                    |> Enum.map(fn r -> expand_path(r["path"], home_dir) end)
                    |> Enum.join(", ")

                  %{
                    allowed: false,
                    reason: "Path \"#{real_host_path}\" is not under any allowed root. Allowed roots: #{roots}",
                    real_host_path: nil,
                    effective_readonly: nil
                  }

                root ->
                  requested_rw = mount_readonly == false
                  effective_readonly = compute_effective_readonly(requested_rw, is_main, allowlist, root)

                  %{
                    allowed: true,
                    reason: "Allowed under root \"#{root["path"]}\"" <>
                      if(root["description"], do: " (#{root["description"]})", else: ""),
                    real_host_path: real_host_path,
                    effective_readonly: effective_readonly
                  }
              end
            end

          {:error, _} ->
            %{
              allowed: false,
              reason: "Host path does not exist: \"#{host_path}\" (expanded: \"#{expanded}\")",
              real_host_path: nil,
              effective_readonly: nil
            }
        end
    end
  end

  defp compute_effective_readonly(false, _is_main, _allowlist, _root), do: true

  defp compute_effective_readonly(true, is_main, allowlist, root) do
    cond do
      not is_main and allowlist["nonMainReadOnly"] -> true
      not root["allowReadWrite"] -> true
      true -> false
    end
  end

  defp expand_path("~/" <> rest, home_dir), do: Path.join(home_dir, rest)
  defp expand_path("~", home_dir), do: home_dir
  defp expand_path(p, _home_dir), do: Path.expand(p)

  defp valid_container_path?(nil), do: false
  defp valid_container_path?(p) when is_binary(p) do
    p = String.trim(p)
    p != "" and not String.contains?(p, "..") and not String.starts_with?(p, "/")
  end

  defp matches_blocked_pattern(real_path, blocked_patterns) do
    parts = Path.split(real_path)

    Enum.find(blocked_patterns, fn pattern ->
      Enum.any?(parts, fn part ->
        part == pattern or String.contains?(part, pattern)
      end) or String.contains?(real_path, pattern)
    end)
  end

  defp find_allowed_root(real_path, roots, home_dir, real_path_fn) do
    Enum.find(roots, fn root ->
      expanded_root = expand_path(root["path"], home_dir)

      case real_path_fn.(expanded_root) do
        {:ok, real_root} ->
          relative = Path.relative_to(real_path, real_root)
          relative != real_path and not String.starts_with?(relative, "..")

        {:error, _} ->
          false
      end
    end)
  end

  defp resolve_real_path(path) do
    case File.stat(path) do
      {:ok, _} ->
        # Use :file.read_link_all for symlink resolution, fall back to path itself
        case :file.read_link_all(String.to_charlist(path)) do
          {:ok, target} -> {:ok, Path.expand(to_string(target), Path.dirname(path))}
          {:error, :einval} -> {:ok, path}
          {:error, _} -> {:ok, path}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end
end
