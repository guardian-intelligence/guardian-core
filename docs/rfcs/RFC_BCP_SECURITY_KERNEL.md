# RFC: BCP + Security Kernel (Guardian Core)

Status: Proposed
Date: 2026-02-07
Owner: Security + Runtime Architecture
Scope: Guardian Core (Elixir Runtime, Platform, Agent Runtime Containers, Rumi Web Service)

## 1. Abstract

This RFC defines the minimum security and business continuity kernel for Guardian Core and Rumi services. It is intentionally bar‑raising: high standards are defined so engineering, operations, and agents must meet them to proceed. The document integrates the Agent Runtime Bedrock RFC and the security JSON corpus, and establishes concrete SLO/SLA targets, disaster recovery (DR) processes, incident handling, and implementation sequencing. This RFC is the foundation for companion docs, runbooks, and implementation milestones.

Companion review artifacts:

1. `docs/rfcs/RFC_BCP_SECURITY_KERNEL_COUNCIL_COMPANION.md`
2. `docs/security/continuity_kernel.json`
3. `docs/security/dr_contract.json`
4. `docs/security/authority_surface_map.json`

## 2. Non-Negotiable Principles

These are the minimal kernel invariants. Violations block release or demand immediate containment.

1. No ambient authority. All authority-bearing actions must be capability-gated and policy-approved. Model output is never authoritative.
2. Fail closed under ambiguity. Tier 2+ actions must fail closed if identity, capability, policy, or crypto requirements are unverifiable or stale.
3. Typed envelopes for all mutations. All world mutations flow through typed envelopes (EventEnvelope → OutboxActionEnvelope → ActionReceiptEnvelope).
4. Deterministic data access broker. Sensitive reads are decided by deterministic policy code, not model discretion.
5. Day‑1 PQC + BLAKE3 enforcement. Required PQC and hash suites must be available at startup; high-risk actions are disabled on failure.
6. Evidence preservation. Security incidents must preserve evidence with hashes, receipts, and immutable audit trails.
7. No plaintext secrets. Secrets never appear in repo, logs, or release artifacts.

These align with `docs/security/security_policy.json`, `docs/security/threat_model.json`, and `docs/rfcs/RFC_AGENT_RUNTIME_BEDROCK.md`.

## 3. Architecture Context and Scope

### 3.1 Systems in Scope

1. **Guardian Runtime (Elixir/OTP)**
   Orchestration kernel, envelope validation, policy gates, wave runtime, outbox/receipt handling.
2. **Phoenix Platform (Elixir)**
   Webhooks, authenticated API services, envelope ingress.
3. **Rumi Web Service**
   Public APIs and a separate privileged internal listener.
4. **Agent Runtime Containers**
   Isolation boundary for model execution.
5. **Infrastructure**
   NixOS VPS (rumi‑vps) + Nix dev environment.

### 3.2 Bedrock RFC Integration

The Bedrock RFC is normative for authority and mutation control:

1. All mutations occur only via typed envelopes.
2. CLI actions are never authoritative.
3. Policy/capability checks gate all privileged actions.
4. Data Access Broker mediates sensitive reads.
5. PQC + BLAKE3 baseline enforced at startup.

## 4. Continuity Kernel (Mandatory)

The bedrock layer is a Continuity Kernel. It is a control-plane boundary where every privileged path must pass through before world mutation or Tier2+ enablement.

The ordered controls are normative and defined in machine-readable form at:

1. `docs/security/continuity_kernel.json`
2. `docs/security/authority_actions.json`
3. `docs/security/authority_surface_map.json`
4. `docs/security/dr_contract.json`

Execution order:

1. Authority Gate
2. Recovery State Compiler
3. Restore Gate
4. Epoch Fence
5. Dual Control Plane
6. NixOS Reproducibility Lock
7. Service Blast-Radius Split

These controls are planned release blockers. Final enforcement is accepted only when implemented in a Continuity Kernel service, not shell-script-only checks.

### 4.1 Planning Maturity Model

Each Continuity Kernel control is tracked with one of these statuses:

1. `PLANNED`: control is specified in RFC and machine-readable contracts.
2. `SPECIFIED`: control interface and invariants are defined and peer-reviewed.
3. `IMPLEMENTED`: control path exists in runtime control plane and is test-covered.
4. `ENFORCED`: release and restore workflows hard-block on the implemented control.

### 4.2 Enforcement Constraint

For Security Council acceptance:

1. Shell-script-only gates are insufficient for Continuity Kernel controls.
2. Controls must be enforced by runtime services, typed control-plane APIs, or policy engines.
3. CLI validators are allowed only as secondary diagnostics, not authoritative enforcement.

### 4.3 Control ID Mapping

The RFC CK labels map deterministically to canonical control IDs:

| RFC label | canonical id | artifact | gate_id |
|---|---|---|---|
| CK-01 | CK-01-AUTHORITY-GATE | `docs/security/continuity_kernel.json` | SP-GATE-AUTHORITY-SURFACE |
| CK-02 | CK-02-RECOVERY-STATE-COMPILER | `docs/security/continuity_kernel.json` | SP-GATE-RECOVERY-POINT-COMPILER |
| CK-03 | CK-03-RESTORE-GATE | `docs/security/continuity_kernel.json` | SP-GATE-DR-CONTRACT |
| CK-04 | CK-04-EPOCH-FENCE | `docs/security/continuity_kernel.json` | SP-GATE-EPOCH-FENCE |
| CK-05 | CK-05-DUAL-CONTROL-PLANE | `docs/security/continuity_kernel.json` | SP-GATE-DUAL-CONTROL-PLANE |
| CK-06 | CK-06-NIXOS-REPRO-LOCK | `docs/security/continuity_kernel.json` | SP-GATE-CONTINUITY-KERNEL |
| CK-07 | CK-07-SERVICE-BLAST-RADIUS-SPLIT | `docs/security/continuity_kernel.json` | SP-GATE-SERVICE-PRINCIPAL-SPLIT |

## 5. Availability and Reliability Standards

### 5.1 Topology-Coupled SLO Classes

SLOs must be consistent with topology. Single-node systems cannot claim 99.99% continuity. We define two classes:

1. **Class S (Single-Node Recoverability)**
   Uses restore and recovery processes but no multi-node continuity. Suitable for current topology.
2. **Class M (Multi-Node Continuity)**
   Requires active multi-node failover or equivalent continuity design.

Advertising 99.99% is forbidden for Class S services.

### 5.2 Current SLO/SLA Targets (Class S)

1. **Rumi Web Service (public API)**
   - SLO: 99.9% monthly availability
   - SLA: 99.5% monthly availability
2. **Guardian Runtime**
   - SLO: 99.5% monthly availability
   - SLA: 99.0% monthly availability
3. **Agent Runtime Containers**
   - SLO: 99.0% monthly availability
   - SLA: 98.5% monthly availability

These will be raised only after a Class M topology exists.

### 5.3 Error Budget Policy

1. Error budget is enforced monthly for each service.
2. Alerts are emitted at 10% and 50% budget burn.
3. Sustained burn triggers a freeze on new features.

### 5.4 Recovery Objectives

1. **RPO** and **RTO** are defined by the backup contract in Section 6.2 and `docs/security/dr_contract.json`.
2. Targets are not declared until the backup contract is implemented and verified.

## 6. Disaster Recovery Program

### 6.1 Notification and Paging

1. All Critical and High severity events must page active on-call principal(s) defined in `docs/security/incident_response.json`.
2. Hard-coded personal identities are non-normative examples only and must not be the sole routing key.
3. Current paging channel: headscale control plane box.
4. Mandatory out-of-band channel must exist and must not transit the tailnet trust plane.
5. Notification payloads must include: severity, impact, containment status, and next actions.

### 6.2 Backup and Restore Contract (Mandatory)

Backups are defined with explicit cadence, consistency, and verification. No RPO is declared without these values.

Contract fields:

1. `max_backup_interval_s`
2. `max_replication_lag_s`
3. `max_restore_data_loss_s`
4. `consistency_point` (dolt_commit or snapshot boundary)
5. `retention_days`
6. `verification_method` (restore drill, hash check, integrity scan)

Until the contract is implemented, RPO/RTO remain “undefined”.

### 6.3 Recovery Point Tuple (Mandatory)

All recovery bundles must capture a crash-consistent Recovery Point Tuple atomically:

1. `dolt_commit`
2. `outbox_hwm`
3. `intent_ledger_hash`
4. `receipt_set_hash`
5. `jti_store_hash`
6. `policy_version`
7. `crypto_policy_version`
8. `recovery_epoch`
9. `flake_lock_hash`
10. `nix_toplevel_hash`
11. `unit_hashes`
12. `private_config_hash`

A restore is invalid if any element is missing or inconsistent.

RecoveryPoint validation MUST include anti-replay continuity:

1. `jti_store_hash` continuity check against restore baseline.
2. `recovery_epoch` monotonicity check.
3. Tier2+ token issuer key rotation on rollback.

### 6.4 Epoch Fencing for Replay Defense

Restores must enforce epoch fencing:

1. All Tier2+ tokens include a monotonic `recovery_epoch` claim.
2. Any restore rollback increments `recovery_epoch` and rotates token issuer keys.
3. Tokens with older epochs are rejected.

### 6.5 Time Integrity Gate

Tier2+ startup is gated by a time integrity check:

1. `clock_synced == true`
2. `root_distance < dr_contract.time_integrity_gate.root_distance_threshold_s`
3. Any sustained skew triggers a Critical alert.

### 6.6 Key Custody for sops-nix Root of Trust

The sops age key is a root-of-trust. DR requires a formal custody protocol:

1. Multi-share escrow with documented custodians.
2. Quarterly restore test of escrow.
3. Compromise rotation SLA with evidence.
4. Escrow integrity attestations stored in Recovery Bundle.

### 6.7 Private Config Recovery

Any non-repo private config required for NixOS builds must be:

1. Encrypted and versioned.
2. Backed up with hash pinning in the Recovery Bundle.
3. Verified at restore time.

### 6.8 Headscale Dependency Isolation

Headscale is a critical dependency for control and alerting. DR requires:

1. An independent OOB alerting channel.
2. An emergency control path that does not transit tailnet trust.
3. A documented failure drill proving both channels can operate when headscale is unavailable.

### 6.9 Operator Continuity

Single-operator is a SPOF. DR requires:

1. Delegated emergency principals with constrained capabilities.
2. Sealed credentials with revocation playbook.
3. Explicit escalation chain.

## 7. Security Kernel Controls

### 7.1 Identity and Capability Controls

1. All authority-bearing actions require valid capability tokens.
2. Tokens must include crypto policy version and freshness requirements.
3. Replay and stale tokens must be rejected with alert emission.
4. Tier2+ tokens must include and validate `recovery_epoch`.

### 7.2 Crypto Enforcement

1. Required PQC suites must be available for Tier 2+.
2. BLAKE3 required for integrity; SHA‑256 only for compatibility.
3. Downgrade attempts are blocked and logged.

### 7.3 Secrets Management

1. No plaintext secrets in repo or logs.
2. sops‑nix used for runtime injection on NixOS.
3. Mandatory redaction on all outbound text channels.

### 7.4 Container Isolation

1. Non-root containers only.
2. Explicit mount allowlist; deny sensitive patterns.
3. No host secrets mounted into containers.

### 7.5 Audit and Evidence

1. All authority actions record audit events with receipts.
2. Evidence bundles must be hashed (BLAKE3) and signed where required.
3. Continuous off-host append-only hash anchoring is mandatory.
4. Restore verification must validate the anchor chain.

## 8. Rumi Web Service Architecture

### 8.1 Public API Listener

1. Public APIs only, no privileged actions.
2. Rate‑limit and input‑cap policies enforced.

### 8.2 Privileged Internal Listener

1. Runs on a separate internal-only listener bound to headscale.
2. Requires capability token and explicit audit trail.
3. No exposure to public internet.
4. Emergency OOB path must exist for headscale loss.

## 9. Observability and Alerting

### 9.1 Mandatory Metrics

1. Queue depths and backlog age.
2. Outbox latency and confirmation delays.
3. Adapter error classes.
4. Policy deny rates by tier.
5. DLQ size and age.

### 9.2 Alerting Policy

1. Critical: no events processed, DB unavailable, NIF crash, time sync failure.
2. High: backlog growth, repeated adapter failures.
3. Medium: DLQ growth, latency drift.

### 9.3 Remote Logging and Integrity

1. Local logs are not authoritative.
2. Signed remote log forwarding is mandatory.
3. Restore-time gap detection is required.

## 10. Recovery Modes

Containment is not binary. The runtime must support explicit operational modes:

1. `FULL` (all tiers allowed)
2. `DEGRADED_TIER01_ONLY` (Tier2+ blocked)
3. `READ_ONLY` (no mutations)
4. `RECOVERY` (no external side effects, replay disabled)

Mode transitions require policy approval and are audited.

## 11. Restore and Reconciliation

### 11.1 Post-Restore Security Gate

After any restore, runtime MUST transition to `RECOVERY` mode. Tier2+ MUST remain disabled until a post-restore gate passes. The gate must be at least as strict as release gates:

Required transition sequence:

1. `FULL|DEGRADED_TIER01_ONLY|READ_ONLY -> RECOVERY`
2. Post-restore gate execution.
3. `RECOVERY -> DEGRADED_TIER01_ONLY|FULL` only after successful checks.

Post-restore gate checks:

1. Crypto probe tests pass.
2. Policy version and crypto policy version are consistent.
3. Recovery Point Tuple validated.
4. Revocation caches reconciled.
5. Remote log anchor chain verified.
6. All release gates listed in `docs/security/dr_contract.json` at `dr_contract.post_restore_security_gate.required_release_gates` pass.

### 11.2 External Side-Effect Reconciliation

Adapter-specific reconciliation is mandatory before replay:

1. Provider receipt fetch.
2. Idempotency map rebuild.
3. Confirmed actions marked in intent ledger before any replay.

## 12. Retention Policy

A retention schedule is mandatory for forensic continuity and risk minimization:

1. Evidence bundles: 365 days default.
2. Audit logs: 365 days default.
3. Receipts and idempotency ledgers: 365 days default.
4. Legal hold override for incident investigations.
5. Cryptographic deletion required when retention expires.

## 13. NixOS DR Invariants

Recovery bundles must include:

1. `flake.lock` hash
2. NixOS generation ID
3. Toplevel derivation hash
4. Systemd unit file hashes
5. sops recipient fingerprint
6. Authority Surface Map hash

Restore acceptance supports:

1. `exact_match`
2. `authorized_divergence` with incident ticket, operator signature, divergence reason code, and successful post-restore gate.
3. `authorized_divergence` must include `expires_at` and a mandatory return-to-`exact_match` plan.
4. Expired divergence state blocks Tier2+ until reconciled.

## 14. Service Account Separation

Each service must run under a dedicated Unix principal with segregated secrets. This is a non-waivable control.

## 15. Backup Scope Inventory (Mandatory)

A complete state inventory is required:

| state_class | path_or_source | rebuildable | backup_target | RPO_class | integrity_check |
|---|---|---|---|---|---|
| Dolt data | /var/lib/guardian/dolt | No | primary + offsite | A | dolt fsck + hash |
| Outbox receipts | DB | No | primary + offsite | A | receipt hash |
| JTI store | DB | No | primary + offsite | A | hash |
| WhatsApp auth | /var/lib/guardian/whatsapp-auth | No | primary + offsite | A | checksum |
| sops age key | /var/lib/sops-nix/key.txt | No | escrow + encrypted backup | A | checksum + attest |
| private-config | /etc/guardian-private | No | encrypted backup | B | hash |

RPO classes:

1. **Class A**: <= 5 minutes
2. **Class B**: <= 60 minutes
3. **Class C**: <= 24 hours

## 16. Restore Drill Matrix

Restore testing must be frequent and scenario-based:

1. Monthly full bare-metal restore.
2. Weekly token-epoch replay drill.
3. Weekly headscale-loss drill.
4. Monthly sops key-loss drill.
5. Monthly NIF-crash + integrity-reconcile drill.

### 16.1 Recency Windows

Recency verification windows:

1. Weekly drills: last successful run <= 9 days.
2. Monthly drills: last successful run <= 40 days.
3. Exceeding recency windows blocks Tier2+ enablement after restore.

## 17. Implementation Plan

### Phase 0: Baseline Kernel Enforcement

1. Implement Continuity Kernel controls CK-01 through CK-07 in strict order.
2. Implement per-service Unix principals and per-secret ACL separation before continuity gate activation.
3. Define Continuity Kernel service interfaces and typed control-plane APIs for each control.
4. Map controls to release gates and security checklist coverage.
5. Define SLO classes and update SLO targets to Class S.

### Phase 1: DR Contract + Integrity

1. Implement Backup Contract fields.
2. Implement Recovery Point Tuple capture.
3. Implement epoch fencing and token rotation on restore.
4. Implement time integrity gate.

### Phase 2: Observability + Logging

1. Signed remote log forwarding and hash anchoring.
2. Restore-time log gap detection.

### Phase 3: Operator Continuity

1. Delegated emergency principals and sealed credentials.
2. OOB alerting and emergency control path.

### Phase 4: Service Separation and Reconciliation

1. Verify and harden principal split implementation (drift audit plus gate evidence refresh).
2. Adapter reconciliation contracts and replay gating.

## 18. Review and Change Control

1. This RFC is reviewed monthly.
2. Changes to SLO/SLA or crypto policy must go through security review.
3. No waivers permitted on non-waivable controls.
4. Council review outcomes must classify each CK control as `PLANNED`, `SPECIFIED`, `IMPLEMENTED`, or `ENFORCED`.
5. Any `PLANNED` control requires an owner, deadline, and blocking dependency list.
6. RFC text, `continuity_kernel.json`, `dr_contract.json`, and `authority_surface_map.json` must remain schema-synced; drift blocks release.

## 19. Acceptance Criteria

This RFC is active when:

1. Continuity Kernel controls CK-01 through CK-07 are implemented in runtime control-plane services.
2. SLOs are topology-coupled and Class S is enforced.
3. Backup Contract and Recovery Point Tuple are implemented.
4. Post-restore security gate is enforced before Tier2+ enablement.
5. OOB alerting and emergency control path exist.
6. Per-service principals are implemented and verified.
7. Drill matrix execution is current and verifiable.
8. No Continuity Kernel control depends on shell-script-only enforcement.
9. Security Council can verify recency windows for each mandatory drill scenario.
