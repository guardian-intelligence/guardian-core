# Threat Model

## Scope
Single assistant + subagents, voice/webhook ingress, local runtime, external APIs, and operator workflows.

## Adversary Assumptions
- Caller ID spoofing and social engineering attempts occur.
- Prompt injection can arrive via messages, calls, and fetched content.
- Credential leaks can happen through logs or misconfigured mounts.
- Compromised dependencies and webhook replay attempts are plausible.
- Malicious or buggy subagent behavior is expected and must be constrained.

## Security Boundary
Trust only:
- verified identity/context evidence appropriate to the action tier,
- scoped capabilities validated at enforcement points,
- and durable, auditable execution state.

## Primary Attack Surfaces
1. Voice ingress and delegated trust resolution.
2. Webhook/API auth and replay handling.
3. Tool invocation and capability enforcement.
4. Subagent spawn and resource budget controls.
5. Data persistence/logging paths for secrets and sensitive memory.

## Threat Classes and Controls

### 1) Identity and Social Engineering
Threats:
- impersonated caller,
- coerced disclosure,
- fake urgency.

Required controls:
- trust-level policy per principal,
- step-up verification for Tier 2+,
- deny sensitive disclosure to low-confidence identities.

### 2) Delegation and Confused Deputy
Threats:
- delegate obtains owner-only action,
- subagent invokes wider permissions.

Required controls:
- strict-subset capability delegation,
- capability-bound policy checks,
- full audit trail for privileged operations.

### 3) Replay and Idempotency Failures
Threats:
- replayed webhooks,
- duplicate side effects.

Required controls:
- idempotency keys,
- durable inbox with lease/ack,
- bounded retry + dead-letter queues.

### 4) Prompt Injection and Data Exfiltration
Threats:
- malicious tool output influences privileged actions,
- secrets emitted in logs/replies.

Required controls:
- policy gate between model output and actuation,
- output redaction,
- sensitive data classification and egress checks.

### 5) Availability and Spawn Storms
Threats:
- unbounded subagent recursion,
- expensive tasks starving primary assistant.

Required controls:
- per-principal/per-session budgets,
- spawn depth limits,
- timeout and circuit-breaker controls.

## High-Value Security Properties
1. No Tier 2-3 action without policy and capability checks.
2. No delegation widening.
3. No secret exposure by default logging paths.
4. No unbounded subagent spawning.
5. No trust in unaudited side effects.
