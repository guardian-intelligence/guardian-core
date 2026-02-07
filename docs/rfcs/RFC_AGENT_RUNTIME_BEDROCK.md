# RFC: Agent Runtime Bedrock (NixOS-First, MCP-Free, Elixir OTP Kernel)

Status: Proposed  
Date: 2026-02-07  
Owner: Runtime Architecture  
Amends: `RFC_AGENT_RUNTIME_BEDROCK_AMENDMENTS.md`  
Cross-Reference: `OODA_WAVE.md` (Phase A implementation spec)  
Related:
- `docs/theory/unified_theory.json`
- `docs/theory/laws.json`
- `docs/theory/agent_native_architecture.json`
- `docs/security/SECURITY_POLICY.md`
- `docs/security/THREAT_MODEL.md`

## 1. Abstract

This RFC defines the long-term architecture for Guardian-class assistants (including Rumi) as a durable, secure, high-throughput digital operations runtime.

The system is built on:
1. Elixir/OTP for orchestration and supervision.
2. Dolt (MySQL-compatible) for durable state and lineage.
3. MCP-free typed envelopes for all actuation.
4. A strict security split between reasoning and permissioned world mutation.

Critical design consequence:
Rumi does not perform world mutations through CLI calls. Rumi submits typed requests to the Elixir backend, and only backend policy/capability gates can authorize external actions.

## 2. Decision Summary

This RFC adopts the following architectural decisions:
1. Backend runtime language: Elixir/OTP.
2. Database: Dolt via Ecto + MyXQL.
3. TypeScript retained only where required by Claude Agent SDK in `container/agent-runner/`.
4. All existing MCP tool intents are cut over to typed `OutboxActionEnvelope` payloads.
5. Payment kernel is deferred to a future dedicated RFC.
6. Sensitive data access is mediated by a deterministic Data Access Broker, not by LLM-to-LLM trust.
7. Wave/process spawning is expected to be common; LLM agent spawning should be bounded and not default for simple flows.
8. Post-quantum cryptography (PQC) is required from day 1 for key establishment and high-risk capability/token paths.

## 3. Problem Statement

Current architecture proves core viability but mixes:
1. model output and authority decisions,
2. tool wiring and policy enforcement,
3. orchestration and adapter behavior.

To operate safely across many integrations and high-impact domains, the runtime needs:
1. explicit durable state machines,
2. immutable security kernel boundaries,
3. idempotent side effects with receipts,
4. replayable lineage across event -> wave -> action -> receipt,
5. scalability primitives for large observation surfaces.

## 4. Goals

1. Build a durable OODA runtime that survives crashes and retries without duplicate high-impact effects.
2. Make security properties enforceable by architecture, not prompt wording.
3. Support many integrations through a single typed adapter contract.
4. Preserve operability for one owner while maintaining strong guardrails.
5. Make incident analysis and rollback first-class operational paths.

## 5. Non-Goals

1. Preserving legacy MCP names or protocol compatibility.
2. Retaining file-IPC payload formats for compatibility reasons.
3. Solving payment-grade authorization in this RFC.
4. Multi-node distributed consensus.

## 6. Scope and Platform

### 6.1 Platform Policy

1. Production support target is NixOS.
2. Nix toolchain (`nix develop`) remains the canonical development environment.
3. If macOS is used during migration on a brain host, it is a transitional convenience path, not a long-term support target.

### 6.2 Runtime Topology Scope

In scope:
1. Brain-side ingress (WhatsApp, container requests, local scheduler).
2. Server-side ingress (webhooks, Twilio, email, external APIs).
3. Shared durable state in Dolt.
4. Elixir orchestration kernel, adapter workers, and policy gates.

Out of scope:
1. Cross-origin event federation guarantees beyond common schema compatibility.
2. Federated multi-tenant isolation model.

## 7. Architecture Overview

## 7.1 System Components

Elixir umbrella project:

```text
guardian/
├── apps/
│   ├── guardian_kernel/    # Wave runtime, inbox/outbox, policy, capabilities, dispatch
│   ├── guardian_web/       # Phoenix API, webhook handlers, auth/cap middleware
│   └── guardian_shared/    # Ecto schemas, typed contracts, IDs
├── container/              # TypeScript Claude agent runner (retained)
│   └── agent-runner/
├── infra/
│   ├── nixos/
│   ├── systemd/
│   └── launchd/            # Transitional dev convenience only
└── flake.nix
```

## 7.2 Control Surface: Rumi Calls Backend API, Not CLI

Rumi's execution model:
1. Rumi reasons in the container runner.
2. Rumi emits typed intent/action envelopes.
3. Envelopes are posted to Elixir backend ingress (`guardian_web`) over local trusted transport.
4. Backend persists, evaluates policy/capability, and dispatches through adapters.

No direct mutation path via shell command is considered authoritative.

## 7.3 Dual-Origin Event Topology

Two origins feed a shared event model:
1. Server-side ingress: Phoenix API receives webhooks and external events.
2. Brain-side ingress: local processes (WhatsApp bridge, scheduler, container envelopes) enqueue events.

Both paths must produce the same typed `EventEnvelope` and converge on the same durable state machine.

## 7.4 Interaction Classes

### Class 1: Direct Reply (expected majority)
1. Event arrives.
2. Single wave runs minimal phases.
3. One reply action dispatched.
4. Wave completes.

Typical transition path:
`created -> acting -> completed`

### Class 2: Orchestrated Flow (multi-step)
1. Observe/orient/decide phases run explicitly.
2. Parent wave spawns child waves for bounded parallel work.
3. Dependencies resolved, then response/outcomes dispatched.

Typical transition path:
`created -> orienting -> deciding -> acting -> learning -> completed`

### Class 3: Proactive/Scheduled
1. Scheduler emits synthetic event.
2. Flow executes as Class 1 or Class 2 depending on complexity/risk.

## 7.5 Durable Execution Primitives

### Primitive 1: Wave as Supervised Actor
Each wave runs as a supervised OTP process:
1. exclusive in-memory ownership while active,
2. restartable from durable state,
3. wake-up support via persisted `wake_at`,
4. parent-child coordination via supervisor tree.

### Primitive 2: Outbox + Receipts + Saga Compensation
1. Decisions create outbox records before dispatch.
2. Dispatch is idempotent and receipt-bound.
3. Compensation actions are explicit (`compensation_for`) with max compensation depth 1.
4. Continue-as-new is supported for long-running waves.
5. Replay verification is structural: re-derive expected actions from stored plan and compare with receipts; do not rely on opaque code replay.

### Primitive 3: State Lineage via Dolt
1. wave completion checkpoints can be committed (`dolt_commit`).
2. diff and history are queryable (`dolt_diff`, `dolt_history_*`).
3. speculative branch execution is possible for high-risk paths.

## 8. Technology Stack Decisions

## 8.1 Elixir/OTP Backend

Rationale:
1. supervision and crash recovery are native,
2. process isolation is cheap,
3. timer and mailbox semantics align with wave orchestration,
4. backpressure primitives align with queue/event topology.

Typical mapping:
1. Wave runtime: `GenServer` or `gen_statem`.
2. Supervision: `DynamicSupervisor`.
3. Event pipeline: Broadway/GenStage.
4. Adapter calls: supervised tasks with explicit timeout and retry policy.
5. WhatsApp Baileys runs as supervised Node.js port process with JSON stdin/stdout bridge to Elixir.

## 8.2 Dolt Persistence

Rationale:
1. MySQL compatibility with operational familiarity.
2. Native branch/commit/diff/time-travel for incident and replay workflows.
3. Strong fit for lineage-heavy architectures.

Stack:
1. Ecto schemas and migrations.
2. MyXQL driver.
3. Dolt procedures for checkpoint/diff/branch workflows.

## 8.3 TypeScript Boundary

Retained TypeScript scope:
1. `container/agent-runner/` only, because of Claude Agent SDK requirements.
2. No authority-bearing world mutation logic remains in TypeScript kernel paths.

## 8.4 Cryptography Baseline (Day 1 Requirement)

Cryptography baseline is mandatory from first production-capable release.

### Mandatory requirements
1. PQC key establishment support is enabled on day 1 for backend-to-backend secure channels and high-risk capability/token workflows.
2. Hybrid mode (classical + PQC) is used initially where interoperability requires it.
3. BLAKE3 is available on day 1 for high-throughput content hashing and integrity workflows.
4. Security-critical byte and key handling uses a dedicated crypto boundary (isolated service or tightly scoped native module), not ad hoc application code paths.
5. If required PQC primitives are unavailable at runtime, startup fails closed for high-risk operations.

### Architectural stance
1. Elixir remains the orchestration/control plane.
2. Cryptographic primitives with strict byte-level handling guarantees may run in a dedicated crypto worker boundary, exposed through typed contracts.
3. No agent/model path can bypass crypto policy checks or downgrade required algorithms.

## 9. Contract Model and MCP Cutover

All authority-bearing operations are represented as typed envelopes.

Core envelopes:
1. `EventEnvelope`
2. `FactEnvelope`
3. `ActionPlanEnvelope`
4. `OutboxActionEnvelope`
5. `ActionReceiptEnvelope`
6. `PolicyDecisionEnvelope`
7. `CapabilityEnvelope`
8. `DataAccessRequestEnvelope`
9. `DataAccessDecisionEnvelope`
10. `AuditRecordEnvelope`

Legacy MCP intent mapping:
1. `send_message` -> `messaging.send` (`target_adapter = whatsapp`)
2. `schedule_task` -> `scheduler.create`
3. `make_phone_call` -> `voice.call`
4. `register_group` -> `admin.register_group`
5. task actions -> `scheduler.pause|resume|cancel`

Transport during transition can stay file-based if needed, but payload format becomes typed outbox envelopes.

## 10. Persistence Model

## 10.1 Events with Inline Leases

Lease fields are embedded in `events`:

```sql
CREATE TABLE IF NOT EXISTS events (
  event_id            TEXT PRIMARY KEY,
  source_type         TEXT NOT NULL,
  source_ref          TEXT,
  payload_json        JSON NOT NULL,
  payload_hash        TEXT NOT NULL,
  status              TEXT NOT NULL,
  lease_owner         TEXT,
  lease_token         TEXT,
  lease_expires_at    DATETIME,
  attempts            INT NOT NULL DEFAULT 0,
  max_attempts        INT NOT NULL DEFAULT 5,
  last_error          TEXT,
  ingested_at         DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL
);
```

Lease history is recorded in `audit_log` rather than a separate lease table.

## 10.2 Wave Extensions

Wave lifecycle table includes:
1. `wake_at`,
2. `parent_wave_id`,
3. `continued_from_wave_id`.

```sql
CREATE TABLE IF NOT EXISTS wave_runs (
  wave_id                  TEXT PRIMARY KEY,
  event_id                 TEXT NOT NULL,
  state                    TEXT NOT NULL,
  wake_at                  DATETIME,
  parent_wave_id           TEXT,
  continued_from_wave_id   TEXT,
  started_at               DATETIME NOT NULL,
  completed_at             DATETIME,
  fail_code                TEXT,
  fail_reason              TEXT
);
```

## 10.3 Outbox Dependencies and Compensation

```sql
CREATE TABLE IF NOT EXISTS outbox_actions (
  action_id              TEXT PRIMARY KEY,
  wave_id                TEXT NOT NULL,
  action_type            TEXT NOT NULL,
  target_adapter         TEXT NOT NULL,
  payload_json           JSON NOT NULL,
  idempotency_key        TEXT NOT NULL,
  status                 TEXT NOT NULL,
  depends_on_actions     JSON,
  compensation_for       TEXT,
  created_at             DATETIME NOT NULL,
  updated_at             DATETIME NOT NULL,
  UNIQUE KEY uniq_idempotency (idempotency_key)
);
```

Dispatch rule:
An action is dispatchable only if every `depends_on_actions` entry is in `confirmed`.

## 10.4 Intent Execution Ledger

```sql
CREATE TABLE IF NOT EXISTS intent_executions (
  idempotency_key TEXT PRIMARY KEY,
  intent_type     TEXT NOT NULL,
  namespace       TEXT NOT NULL,
  status          TEXT NOT NULL,
  receipt_json    JSON NOT NULL,
  executed_at     DATETIME NOT NULL
);
```

## 10.5 Dolt Lineage Operations

Examples:
1. `CALL dolt_commit('-m', 'wave W123 completed')`
2. `SELECT * FROM dolt_diff('before', 'after', 'outbox_actions')`
3. `CALL dolt_checkout('-b', 'speculative/W123')`
4. `CALL dolt_merge('speculative/W123')`
5. `CALL dolt_branch('-D', 'speculative/W123')`
6. `SELECT * FROM outbox_actions AS OF 'commit_hash'`
7. `SELECT * FROM dolt_history_outbox_actions WHERE action_id = '...'`

## 11. Security Architecture

## 11.1 Hard Security Invariants

1. No privileged action executes without valid capability and policy pass.
2. Identity for authorization is derived from trusted runtime boundary signals, never payload claims.
3. Tier 2/3 ambiguity fails closed.
4. No duplicate high-impact side effect without explicit idempotency match.
5. No secret-like material written to user-facing channels by default.
6. Required PQC and hashing algorithms must be available and policy-approved before high-risk operations are enabled.

Authorization predicate:

`Authorized(action, principal, ctx) := CapabilityValid(principal, scope(action), expiry, revocation) AND PolicyAllows(principal, action, riskTier(ctx), ctx)`

## 11.2 Data Access Broker (Deterministic, Non-LLM)

Sensitive read control is handled by a dedicated broker service.

### Request contract
`DataAccessRequestEnvelope` includes:
1. `request_id`
2. `requesting_wave_id`
3. `requesting_principal`
4. `requested_fields`
5. `purpose_code`
6. `intended_sink` (voice, message, adapter, internal-only)
7. `risk_tier`
8. `evidence_bundle`

### Decision contract
`DataAccessDecisionEnvelope` includes:
1. `decision` (`allow` | `deny` | `allow_masked`)
2. `reason_code`
3. `human_reason`
4. `suggested_follow_up`
5. `granted_handle` (ephemeral, if allowed)
6. `expires_at`

### Enforcement
1. Conversational agent never receives raw secret if a handle-based execution path exists.
2. Adapter performs privileged operation using handle/token reference.
3. Denies are explicit and user-safe, with a suggested follow-up path.

This is the architecture-grade version of the "guardian asks another entity for permission" idea, but the final authority is deterministic policy code, not another model.

## 11.3 Multi-Agent Pattern Guidance

Your proposed pattern is valid with one adjustment:
1. multiple agents can collaborate for reasoning quality and UX,
2. security decisions must still terminate in policy/capability broker code.

Recommended pattern for sensitive interactions:
1. Voice agent handles user conversation.
2. Orchestrator agent may draft action intent.
3. Data Access Broker and Policy Kernel decide access/mutation.
4. Adapter executes with minimal disclosure.

## 11.4 Illustrative Sensitive Voice Flow

Scenario: caller asks for full credit card number during a voice interaction.

1. Voice agent captures request and drafts `DataAccessRequestEnvelope`.
2. Envelope includes evidence bundle: caller identity confidence, reason, intended sink (`voice`), and requested fields.
3. Data Access Broker evaluates deterministic policy for requested fields and sink.
4. Broker returns `deny` with `reason_code` and `suggested_follow_up`.
5. Voice agent reads safe denial response and suggested next step.
6. No raw secret is ever loaded into conversational agent context.

Example deny follow-up:
1. `reason_code = sensitive_field_disallowed_for_sink`
2. `suggested_follow_up = offer secure owner-approval workflow`

This gives the conversational experience of "asking another authority" without placing security trust in a second LLM.

## 12. Spawn Strategy Guidance

Expected common operation:
1. frequent wave/process spawning,
2. occasional child wave spawning,
3. constrained LLM subagent spawning.

Policy:
1. default to Class 1 direct flow.
2. escalate to Class 2 only when required by complexity/risk.
3. cap LLM subagent depth and rate.
4. prefer deterministic service calls over additional model calls in security-critical paths.

Rationale:
OTP process spawn is cheap and deterministic; LLM spawn is expensive and probabilistic.

## 13. Adapter Model

Each adapter must declare:
1. supported action types,
2. idempotency strategy,
3. retry taxonomy,
4. max timeout and retry budget,
5. capability requirements,
6. redaction/egress policy hooks,
7. receipt normalization contract.

Required adapter behavior:
1. pure validation before side effects,
2. no implicit retries outside kernel policy,
3. return typed receipt or typed failure class,
4. never broaden scope from provided capability handle.

## 14. Payment Deferral

Payment execution is explicitly deferred.

This RFC provides substrate only:
1. risk-tier policy,
2. capability model,
3. data access broker,
4. outbox idempotency and receipts,
5. audit lineage.

Dedicated payment semantics will be defined in a future `RFC_PAYMENT_KERNEL.md` after non-payment high-risk controls are proven in production-like operation.

## 15. NixOS Deployment and Hardening

Core unit classes:
1. `guardian_kernel`
2. `guardian_web`
3. `guardian_adapter_*`
4. `guardian_ingress_*`

Required hardening baseline:
1. restricted filesystem paths,
2. least-privilege service users,
3. minimal network egress per unit,
4. secret injection via secure runtime paths,
5. structured logging with redaction by default.

## 16. Migration Plan

## Phase 0: Elixir + Dolt Skeleton

Deliver:
1. Elixir umbrella project.
2. Dolt-backed core tables.
3. Wave skeleton and outbox skeleton.
4. Phoenix ingress API.
5. Crypto boundary with PQC + BLAKE3 capability probes and fail-closed startup policy.

Gate:
Event -> wave -> action -> receipt -> ack works in simulation, and PQC baseline checks pass at startup.

## Phase 1: Brain Integration and Envelope Cutover

Deliver:
1. Container runner emits typed outbox envelopes.
2. WhatsApp bridge and scheduler feed event pipeline.
3. MCP tool semantics mapped to outbox action types.

Gate:
WhatsApp message -> agent -> backend -> reply outbox -> confirmed receipt.

## Phase 2: Adapter Convergence

Deliver:
1. WhatsApp and voice adapters on common adapter behavior.
2. Legacy TypeScript kernel paths removed.

Gate:
Policy deny and idempotency tests pass for messaging and voice.

## Phase 3: Browser + Email + Security Hardening

Deliver:
1. browser and email adapters,
2. data access broker enforcement,
3. egress redaction policies.

Gate:
adversarial prompt-injection and exfiltration tests pass.

## Phase 4: Operational Excellence

Deliver:
1. replay and DLQ tooling,
2. dashboards and incident analysis workflows using Dolt lineage features.

Gate:
replay verification and incident diff workflows validated on production-like traces.

## 17. Verification Strategy

## 17.1 Correctness

1. Type/schema validation for all envelopes.
2. FSM transition tests for events/waves/actions.
3. idempotency determinism tests.
4. dependency and compensation flow tests.

## 17.2 Reliability

1. crash/restart recovery tests.
2. lease expiry reclaim tests.
3. timeout and retry classification tests.
4. continue-as-new tests.

## 17.3 Security

1. capability scope bypass attempts.
2. identity spoof attempts from payload claims.
3. data broker deny/allow/allow_masked behavior tests.
4. transcript and outbound redaction tests.
5. policy fail-closed tests for Tier 2/3 ambiguity.
6. PQC downgrade resistance tests (required algorithms missing/disabled -> fail closed).
7. BLAKE3 integrity tests for envelope/blob hashing paths.

## 17.4 Fault Injection

1. DB write failure before ack.
2. adapter timeout after persisted dispatch.
3. duplicate ingress with same idempotency key.
4. stale or revoked capability token.
5. policy engine transient unavailability.

Expected result:
safe retry, explicit deny, or terminal failure with durable audit trail.

## 18. Observability and Audit

Minimum metrics:
1. queue depth by state,
2. oldest claimable/leased age,
3. outbox backlog and latency,
4. adapter error classes,
5. policy deny rate by tier,
6. data access broker deny rate and reason code distribution,
7. DLQ size and age.

Minimum audit correlation keys:
1. `event_id`
2. `wave_id`
3. `action_id`
4. `receipt_id`
5. `request_id` (for data access broker)
6. `capability_token_id`

## 19. Forward-Looking Guidance

1. Preserve strict separation between reasoning quality and authority.
2. Expand adapters through typed contracts, never through ad hoc direct calls.
3. Keep high-risk data in handle-based access paths where possible.
4. Treat LLM subagents as optional cognitive workers, not security authorities.
5. Favor deterministic services for permission and mutation decisions.
6. Enforce bounded compute at every fanout boundary.
7. Keep replay tooling as a release gate, not an afterthought.

## 20. Scenario Trace: Coordinated Multi-Party Task

Example: "Coordinate babysitter and dog sitter schedules for Tuesday."

1. Parent wave `W1` creates child waves `W2` and `W3`.
2. `W2` executes `voice.call` babysitter and confirms receipt.
3. `W3` attempt 1 fails (retryable), persists retry state and `wake_at`, process crashes, supervisor restarts, attempt 2 succeeds.
4. Parent resumes when dependencies resolve.
5. Parent computes overlap and dispatches owner summary via `messaging.send`.
6. If no overlap, parent emits compensation path action (for example, re-negotiate one side), then sends updated result.
7. Dolt diff/history can show exactly what changed for this orchestration chain.

## 21. Acceptance Criteria

This RFC is considered active when all are true:
1. Rumi calls backend APIs with typed envelopes for world mutations.
2. No authority-bearing mutation originates from CLI-only paths.
3. Event/wave/action/receipt lineage is durable and queryable.
4. Policy/capability checks gate all privileged actions.
5. Data Access Broker mediates sensitive reads with explicit evidence and reasoned denies.
6. Payments remain out of scope until dedicated RFC approval.
7. Day-1 PQC + BLAKE3 crypto baseline is implemented and enforced by startup/runtime policy.

## 22. Open Questions

1. Should cross-origin event forwarding (brain <-> server) use direct DB writes or signed relay envelopes?
2. What subset of Dolt commit operations should be automatic vs operator-triggered?
3. What retention budget applies to blob-backed evidence artifacts?
4. Should capability handles be per-action or short session-scoped for specific adapter families?
5. What exact escalation UX should be used for denied sensitive-data requests over voice?
6. What is the v2 cryptography migration strategy beyond the v1 baseline defined below?

## 23. Appendix A: v1 Cryptography Policy (Normative)

This appendix is normative for v1 runtime implementation.

### 23.1 Policy Versioning

1. `crypto_policy_version = 1` is mandatory for v1.
2. Every capability issuance, high-risk action dispatch, and evidence bundle must record `crypto_policy_version`.
3. Policy changes are versioned and auditable; no silent policy mutation is allowed.

### 23.2 Required Algorithm Baseline

#### Hashing and integrity

1. BLAKE3 is required for internal high-throughput integrity paths (envelope and blob integrity).
2. SHA-256 is retained as interoperability digest where required by external systems.
3. New internal contracts should store both:
   - `digest_blake3` (required)
   - `digest_sha256` (interop/optional by endpoint policy)

#### Key establishment

1. PQC is required day 1 for high-risk service-to-service secure channels and capability issuance flows.
2. Required hybrid KEM baseline:
   - `X25519 + ML-KEM-768` (default)
3. High-assurance profile (Tier 3 capable environments):
   - `X25519 + ML-KEM-1024` (policy-selectable)

#### Signatures

1. Required hybrid signature baseline for high-trust internal artifacts (capabilities, audit evidence, high-risk decision receipts):
   - `Ed25519 + ML-DSA-65` (default)
2. High-assurance profile (optional by policy):
   - `Ed25519 + ML-DSA-87`

#### Symmetric crypto and AEAD

1. `AES-256-GCM` and `ChaCha20-Poly1305` are approved.
2. Minimum key length and nonce management rules are enforced centrally by crypto boundary API.

### 23.3 Byte-Level and Secret-Handling Requirements

1. Security-critical byte and key operations run in a dedicated crypto boundary (isolated process/service preferred).
2. Application services never implement custom crypto primitives directly.
3. Raw secret values must not be serialized into logs, transcripts, or user-facing replies.
4. Where supported, secret buffers must use bounded lifetime and explicit zeroization in crypto boundary implementations.
5. Handle-based access is required for high-risk secrets; conversational agents must not receive raw secret material when a handle path exists.

### 23.4 Fail-Closed and Downgrade Resistance

1. On startup, backend must run crypto capability probes for required KEM/signature/hash suites.
2. If required PQC suites are unavailable, high-risk operations are disabled and service enters fail-closed mode for those paths.
3. Algorithm downgrade is prohibited:
   - No silent fallback from required hybrid suites to classical-only suites for high-risk operations.
4. Downgrade attempts emit security audit events with severity at least guarded mode.

### 23.5 Token and Key Lifetime Policy

1. Capability tokens:
   - default TTL: 5 minutes
   - max TTL without explicit owner approval: 30 minutes
2. Data access handles:
   - default TTL: 60 seconds
   - single-purpose and sink-bound
3. Service identity key material:
   - rotation target: every 30 days
4. High-trust signing keys (evidence/capability authority):
   - rotation target: every 90 days
5. Emergency revocation must take effect immediately and be auditable.

### 23.6 Evidence Bundle Crypto Requirements

Every high-risk evidence bundle must include:
1. `crypto_policy_version`
2. algorithm suite identifiers (KEM/signature/hash)
3. digest(s) over canonicalized payload
4. signature material and key identifier
5. issuance and expiry timestamps

Evidence verification must reject:
1. mismatched policy version,
2. missing required digest/signature components,
3. expired or revoked signing material,
4. downgraded suite identifiers for risk tier.

### 23.7 Runtime Verification Gates

The following are required release gates:
1. PQC availability probe tests (required suites present).
2. Downgrade rejection tests (forced weaker suite => deny).
3. BLAKE3 integrity tests for envelope and blob paths.
4. Hybrid signature verification tests for capability/evidence artifacts.
5. Revocation and expiry enforcement tests for handles and capability tokens.

### 23.8 Migration and Deprecation Rules

1. Introducing a new cryptography suite requires:
   - new `crypto_policy_version`,
   - compatibility matrix,
   - rollout plan,
   - rollback plan.
2. Deprecating a suite requires:
   - explicit warning window,
   - observable usage metrics,
   - cutover gate date recorded in policy changelog.
3. No cryptography policy change may bypass audit logging or change-control workflow.
