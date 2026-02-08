---
name: convert-to-docker
description: Verify and enforce Docker runtime alignment in Guardian Core. Use when users ask to convert to Docker, validate Docker setup, or clean legacy runtime drift.
---

# Guardian Core Docker Alignment

Guardian Core is already Docker-based. This skill verifies Docker readiness and removes stale runtime references.

## Use Cases

- User asks to "convert to docker"
- User asks to validate container runtime setup
- User asks to clean runtime drift in docs/skills/scripts

## Procedure

### 1. Verify Docker availability

```bash
docker --version
docker info
```

If Docker is unavailable:
- Linux: install Docker Engine and run `sudo systemctl start docker`

### 2. Verify project runtime commands

```bash
rg -n 'container\\s+(system|run|builder|images)' -S . --hidden --glob '!.git'
```

Expected result: no runtime command drift (tool output should be empty or only internal log labels).

### 3. Verify image build + smoke test

```bash
./container/build.sh
echo '{}' | docker run -i --entrypoint /bin/echo guardian-core-agent:latest "Container OK"
```

### 4. Verify docs and skills consistency

```bash
rg -n "Docker|docker" -S README.md docs CLAUDE.md .claude/skills --hidden
```

Ensure runtime instructions use Docker-only commands.

### 5. Optional cleanup checks

```bash
cd platform && mix compile --warnings-as-errors
cd platform && mix test
```

## Success Criteria

- Docker daemon is reachable.
- Container image builds successfully.
- Runtime command references use Docker commands.
- Core validation commands pass.
