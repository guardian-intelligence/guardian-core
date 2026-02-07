# RFC: Adaptive Orientation Kernel for OODA Wave Runtime

Status: Proposed
Date: 2026-02-07
Owner: Runtime Architecture
Related:
- `OODA_WAVE_RUNTIME_REARCHITECTURE.md`
- `MCP_FREE_ARCHITECTURE_AMENDMENT.md`

## 1. Abstract

This RFC defines the **Adaptive Orientation Kernel** for the OODA Wave Runtime.

The goal is to let the assistant safely and dynamically change what it pays attention to over the next `N` waves while preserving hard runtime guarantees:

1. durability,
2. bounded context construction,
3. capability safety,
4. deterministic replay,
5. auditability,
6. predictable operations.

The kernel introduces a structured observation-to-orientation pipeline that can fan out from 1 to 10,000 retrieval operations, then compile those results into a bounded, policy-constrained orientation packet for decision-making.

Default orientation budget is `150,000` tokens and must be configurable.

## 2. Problem Statement

Current architecture has durable ingest and action primitives but lacks a first-class orientation control system.

Without this kernel:

1. Context selection is ad hoc and non-replayable.
2. Agent attention cannot be safely adapted over a horizon.
3. High-volume observations can overwhelm decision context.
4. Decide vs Act boundaries blur, harming correctness and recovery.

## 3. Goals

1. Implement a deterministic Observe -> Orient compiler with bounded output.
2. Support dynamic attention adaptation for next `N` waves via guarded proposals.
3. Enforce hard token budgets with mandatory floors for identity, objectives, and constraints.
4. Preserve fail-closed behavior for high-risk decisions.
5. Provide complete telemetry and audit trails for orientation quality and drift.

## 4. Non-Goals

1. Replacing the underlying OODA Wave substrate.
2. Introducing distributed consensus or multi-node coordination.
3. Allowing unrestricted self-modification of core security invariants.
4. Real-time multi-agent federation semantics.

## 5. Core Principles

1. **Determinism**: same inputs + same profile version -> same orientation packet.
2. **Boundedness**: packet must never exceed configured token budget.
3. **Separation of concerns**: Decide commits intent; Act executes intent.
4. **Guarded adaptability**: agent can tune attention weights, not safety invariants.
5. **Audit-first**: every mutation and execution path is attributable.

## 6. OODA Semantics (Authoritative)

## 6.1 Observe

Acquire and normalize facts from enabled sources.

## 6.2 Orient

Compile a bounded context packet from normalized facts + profile constraints.

## 6.3 Decide

Produce and durably persist action plan(s) and idempotency keys.

## 6.4 Act

Execute planned actions through outbox adapters and collect receipts.

## 6.5 Learn

Update projections and orientation feedback signals for future waves.

### Mandatory Distinction: Decide vs Act

1. `Decide` is a durable commit to plan.
2. `Act` is external execution with retries and failure classes.

This separation is required for replay, deduplication, and exactly-once-effect illusion.

## 7. Architecture

## 7.1 New Components

1. **Observation Fanout Planner**
- determines which sources to query per wave
- applies source budgets and concurrency limits

2. **Fact Normalization Pipeline**
- canonical schema conversion
- provenance attachment
- deduplication and quality scoring

3. **Orientation Compiler**
- takes scored facts + profile
- produces `orientation_packet` under hard budget

4. **Profile Adaptation Engine**
- accepts/rejects `profile_change_proposals`
- applies changes for next `N` waves if safe

5. **Orientation Feedback Engine**
- computes quality signals from outcomes
- informs future adaptation

## 7.2 Existing Components Reused

1. Durable events/leases/DLQ.
2. Wave run state machine.
3. Outbox + action receipts.
4. Capability model and audit log.

## 8. Data Model

All tables are SQLite and versioned via migrations.

## 8.1 orientation_profiles

```sql
CREATE TABLE IF NOT EXISTS orientation_profiles (
  profile_id          TEXT PRIMARY KEY,
  version             INTEGER NOT NULL,
  total_token_budget  INTEGER NOT NULL,
  horizon_waves       INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  updated_by          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK(status IN ('active','candidate','retired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orientation_profile_version
  ON orientation_profiles(profile_id, version);
```

## 8.2 orientation_budget_bands

```sql
CREATE TABLE IF NOT EXISTS orientation_budget_bands (
  profile_id      TEXT NOT NULL,
  profile_version INTEGER NOT NULL,
  band            TEXT NOT NULL,
  min_tokens      INTEGER NOT NULL,
  target_tokens   INTEGER NOT NULL,
  max_tokens      INTEGER NOT NULL,
  PRIMARY KEY (profile_id, profile_version, band),
  CHECK(band IN ('identity','objectives','capabilities','situational','exploration','reserve')),
  CHECK(min_tokens >= 0),
  CHECK(target_tokens >= min_tokens),
  CHECK(max_tokens >= target_tokens)
);
```

## 8.3 attention_rules

```sql
CREATE TABLE IF NOT EXISTS attention_rules (
  rule_id            TEXT PRIMARY KEY,
  profile_id         TEXT NOT NULL,
  profile_version    INTEGER NOT NULL,
  source_type        TEXT NOT NULL,
  predicate_json     TEXT NOT NULL,
  priority_weight    REAL NOT NULL,
  novelty_weight     REAL NOT NULL,
  risk_weight        REAL NOT NULL,
  recency_half_life  INTEGER NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attention_rules_profile
  ON attention_rules(profile_id, profile_version, enabled);
```

## 8.4 observed_facts

```sql
CREATE TABLE IF NOT EXISTS observed_facts (
  fact_id              TEXT PRIMARY KEY,
  wave_id              TEXT NOT NULL,
  source_type          TEXT NOT NULL,
  source_ref           TEXT,
  provenance_json      TEXT NOT NULL,
  normalized_json      TEXT NOT NULL,
  dedupe_key           TEXT,
  utility_score        REAL NOT NULL,
  estimated_tokens     INTEGER NOT NULL,
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observed_facts_wave
  ON observed_facts(wave_id, utility_score DESC);

CREATE INDEX IF NOT EXISTS idx_observed_facts_dedupe
  ON observed_facts(dedupe_key);
```

## 8.5 orientation_packets

```sql
CREATE TABLE IF NOT EXISTS orientation_packets (
  packet_id             TEXT PRIMARY KEY,
  wave_id               TEXT NOT NULL,
  profile_id            TEXT NOT NULL,
  profile_version       INTEGER NOT NULL,
  token_budget          INTEGER NOT NULL,
  token_used            INTEGER NOT NULL,
  packet_json           TEXT NOT NULL,
  digest_sha256         TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  CHECK(token_used <= token_budget)
);

CREATE INDEX IF NOT EXISTS idx_orientation_packets_wave
  ON orientation_packets(wave_id);
```

## 8.6 profile_change_proposals

```sql
CREATE TABLE IF NOT EXISTS profile_change_proposals (
  proposal_id           TEXT PRIMARY KEY,
  requested_by          TEXT NOT NULL,
  base_profile_id       TEXT NOT NULL,
  base_profile_version  INTEGER NOT NULL,
  effective_waves       INTEGER NOT NULL,
  proposal_json         TEXT NOT NULL,
  status                TEXT NOT NULL,
  rejection_code        TEXT,
  rejection_reason      TEXT,
  approved_by           TEXT,
  created_at            TEXT NOT NULL,
  decided_at            TEXT,
  CHECK(status IN ('pending','approved','rejected','expired'))
);
```

## 8.7 orientation_feedback

```sql
CREATE TABLE IF NOT EXISTS orientation_feedback (
  feedback_id            TEXT PRIMARY KEY,
  wave_id                TEXT NOT NULL,
  packet_id              TEXT NOT NULL,
  decision_quality_score REAL,
  missed_signal_flags    TEXT,
  operator_feedback      TEXT,
  created_at             TEXT NOT NULL
);
```

## 9. Budget Model

## 9.1 Configurable Total Budget

`ORIENTATION_TOKEN_BUDGET` default: `150000`.

## 9.2 Mandatory Bands

Recommended defaults:

1. `identity`: min 12000, target 18000, max 25000
2. `objectives`: min 15000, target 25000, max 40000
3. `capabilities`: min 10000, target 15000, max 25000
4. `situational`: min 45000, target 75000, max 110000
5. `exploration`: min 5000, target 12000, max 25000
6. `reserve`: min 3000, target 5000, max 8000

## 9.3 Enforcement

1. Sum of mins must be <= total budget.
2. Compiler must always satisfy every band minimum.
3. Remaining budget is allocated by utility score with diversity constraints.

## 10. Runtime Algorithms

## 10.1 Observation Fanout

Input: wave context + profile rules.

1. Generate candidate fetch jobs from enabled rules.
2. Apply per-source quotas and global cap.
3. Execute with bounded concurrency and per-job timeout.
4. Normalize and score outputs.
5. Write facts durably.

Hard caps (configurable):

1. `MAX_OBSERVATION_JOBS_PER_WAVE` default 10000
2. `MAX_CONCURRENT_OBSERVERS` default 128
3. `MAX_FACTS_PER_WAVE` default 50000

## 10.2 Orientation Compiler

Input: facts + profile version.

1. Reserve mandatory baseline bands first.
2. Fill each band with highest utility facts satisfying rule predicates.
3. Apply source diversity and novelty constraints.
4. Stop at budget boundary.
5. Persist packet and digest.

Determinism requirements:

1. Stable tie-break ordering (`utility_score desc`, `created_at asc`, `fact_id asc`).
2. Pure scoring for same inputs.
3. Profile version pinned for duration of wave.

## 10.3 Adaptive Attention for Next N Waves

1. Agent emits `profile_change_proposal`.
2. Guard validator checks proposal safety.
3. Approved proposal creates new profile version effective for `N` waves.
4. On horizon end, auto-revert or auto-promote based on policy.

## 10.4 Guard Validator

Reject proposal if any:

1. Mandatory band floor reduced below admin-configured minimum.
2. Total budget exceeded.
3. Critical source families disabled below safety threshold.
4. Capability constraints relaxed.
5. Requested horizon exceeds max allowed.

## 11. Capabilities and Authorization

## 11.1 New Scopes

1. `orientation.read`
2. `orientation.propose`
3. `orientation.approve`
4. `orientation.admin`

## 11.2 Rules

1. Non-main namespaces can only propose within permitted profile envelope.
2. Approval may require elevated principal or policy-automated guard pass.
3. Agent-provided identity is advisory; namespace-derived identity is authoritative.

## 12. APIs

## 12.1 Orientation APIs

1. `GET /api/orientation/profile/current` (`orientation.read`)
2. `POST /api/orientation/proposals` (`orientation.propose`)
3. `POST /api/orientation/proposals/:id/approve` (`orientation.approve`)
4. `POST /api/orientation/proposals/:id/reject` (`orientation.approve`)
5. `GET /api/orientation/packets/:wave_id` (`orientation.read`)
6. `GET /api/orientation/feedback/:wave_id` (`orientation.read`)

## 12.2 Wave Integration

`wave_runs` adds references:

1. `orientation_packet_id`
2. `orientation_profile_version`

## 13. Invariants

Must always hold:

1. `orientation_packets.token_used <= token_budget`
2. Each wave has at most one terminal orientation packet.
3. Profile versions are monotonic per `profile_id`.
4. Proposal decision is terminal (`approved|rejected|expired`) and single.
5. Proposal application never widens runtime capability bounds.
6. Deterministic replay reproduces identical packet digest for same inputs.

## 14. Observability and SLOs

## 14.1 Metrics

1. `orientation_packet_tokens_used`
2. `orientation_budget_overflow_total`
3. `orientation_fact_drop_total{reason}`
4. `observation_jobs_total{source,status}`
5. `observation_job_latency_ms`
6. `profile_proposal_total{status}`
7. `profile_rollback_total`
8. `decision_regret_total`

## 14.2 Structured Logs

Required fields:

1. `trace_id`
2. `wave_id`
3. `packet_id`
4. `profile_id`
5. `profile_version`
6. `actor`
7. `action`
8. `result`
9. `latency_ms`
10. `error_code`

## 14.3 Audit Actions

1. `orientation.profile.proposed`
2. `orientation.profile.approved`
3. `orientation.profile.rejected`
4. `orientation.packet.compiled`
5. `orientation.packet.replay_verified`

## 15. Reliability and Recovery

1. Compiler and fanout stages are restart-safe via durable facts and wave state.
2. If crash before packet write: re-run orientation stage idempotently.
3. If crash after packet write: skip recompilation and continue wave.
4. Proposal processing is idempotent by `proposal_id`.

## 16. Security Model

1. Fail-closed on malformed profile/proposal payloads.
2. No direct agent write access to active profile tables.
3. No unsafe reduction of mandatory security-relevant context.
4. Sensitive provenance can be included as references instead of raw content to stay within budget and reduce leakage.

## 17. Performance Guidance

1. Keep observation jobs small and bounded.
2. Batch inserts for facts.
3. Use prepared statements.
4. Keep packet JSON compact and reference-heavy.
5. Perform periodic pruning/archival of stale facts and packets.

## 18. Rollout Plan

## Phase B1: Foundations

1. Migrations for orientation tables.
2. Read-only profile + packet generation from static rules.
3. Wire packet references into wave runs.

Exit:

1. deterministic packet build for fixed fixture data.
2. budget enforcement passes stress tests.

## Phase B2: Adaptive Proposals

1. Proposal API + guard validator.
2. Profile versioning and `N`-wave effective horizon.
3. Audit and metrics for proposal lifecycle.

Exit:

1. safe weather-priority shift over next `N` waves demonstrated.
2. no invariant regressions.

## Phase B3: Feedback and Auto-Tuning

1. feedback ingestion hooks.
2. optional controlled auto-promotion/rollback policy.

Exit:

1. measurable improvement in decision quality under synthetic workload.

## 19. Testing Strategy

## 19.1 Unit

1. budget allocator correctness
2. guard validator rejection logic
3. deterministic sorting/tie-breaking

## 19.2 Property

1. packet never exceeds budget
2. mandatory floors always satisfied
3. replay determinism for same input set

## 19.3 Integration

1. event -> wave -> observe -> orient -> decide path
2. proposal apply for `N` waves then rollback/persist policy
3. crash recovery mid-orient and mid-proposal decision

## 19.4 Adversarial

1. malicious proposal to suppress critical context
2. namespace spoofing
3. capability mismatch and stale token rejection

## 20. Open Questions

1. Should profile approvals be fully automatic under strict guards, or require owner confirmation for certain classes?
2. What minimum mandatory source families must never be suppressible?
3. Should packet compaction use semantic compression with references by default?
4. What decision-quality metric is authoritative for auto-promotion?

## 21. Acceptance Criteria

This RFC is accepted when:

1. orientation packet generation is deterministic and budget-safe,
2. adaptive profile changes can be safely applied for next `N` waves,
3. all invariants pass including replay validation,
4. observability and audit signals are complete for operator control.

