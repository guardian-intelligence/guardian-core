# RFC_BCP_SECURITY_KERNEL Companion Review Diffs (Round 2)

Status: Draft for Security Council  
Date: 2026-02-07  
Primary Target: `docs/rfcs/RFC_BCP_SECURITY_KERNEL.md`

## Purpose

This companion captures additional high-impact refinements after the first amendment round. The focus is reducing ambiguity, removing drift vectors, and ensuring controls are machine-enforceable rather than document-enforceable.

## Patch 01: Replace Named Human Paging with Role-Based On-Call

```diff
--- a/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
+++ b/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
@@
-1. All Critical and High severity events must page the human operator (Shovon Hasan / @anveio).
+1. All Critical and High severity events must page the active on-call principal(s) defined in `docs/security/incident_response.json`.
+2. Hard-coded personal identities are non-normative examples only and must not be the sole routing key.
```

Rationale:

Hard-coding an individual in normative text creates operational drift and hidden single-operator coupling. Role-based routing keeps the RFC valid across personnel and delegation changes.

## Patch 02: Add CK Label-to-ID Mapping Table

```diff
--- a/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
+++ b/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
@@
 ### 4.2 Enforcement Constraint
@@
 3. CLI validators are allowed only as secondary diagnostics, not authoritative enforcement.
+
+### 4.3 Control ID Mapping
+
+The RFC CK labels must map deterministically to machine-readable control IDs:
+
+| RFC label | canonical id | artifact | gate_id |
+|---|---|---|---|
+| CK-01 | CK-01-AUTHORITY-GATE | docs/security/continuity_kernel.json | SP-GATE-AUTHORITY-SURFACE |
+| CK-02 | CK-02-RECOVERY-STATE-COMPILER | docs/security/continuity_kernel.json | SP-GATE-RECOVERY-POINT-COMPILER |
+| CK-03 | CK-03-RESTORE-GATE | docs/security/continuity_kernel.json | SP-GATE-DR-CONTRACT |
+| CK-04 | CK-04-EPOCH-FENCE | docs/security/continuity_kernel.json | SP-GATE-EPOCH-FENCE |
+| CK-05 | CK-05-DUAL-CONTROL-PLANE | docs/security/continuity_kernel.json | SP-GATE-DUAL-CONTROL-PLANE |
+| CK-06 | CK-06-NIXOS-REPRO-LOCK | docs/security/continuity_kernel.json | SP-GATE-CONTINUITY-KERNEL |
+| CK-07 | CK-07-SERVICE-BLAST-RADIUS-SPLIT | docs/security/continuity_kernel.json | SP-GATE-SERVICE-PRINCIPAL-SPLIT |
```

Rationale:

The RFC currently references CK-01..CK-07 without local canonical mapping. This patch prevents naming drift between prose, gates, and artifacts.

## Patch 03: Add `recovery_epoch` to Identity/Capability Controls

```diff
--- a/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
+++ b/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
@@
 ### 7.1 Identity and Capability Controls
 
 1. All authority-bearing actions require valid capability tokens.
 2. Tokens must include crypto policy version and freshness requirements.
 3. Replay and stale tokens must be rejected with alert emission.
+4. Tier2+ tokens must include and validate `recovery_epoch`.
```

Rationale:

`recovery_epoch` is defined in DR sections but not in core identity controls. This creates a policy split that can silently disable epoch fencing in some validators.

## Patch 04: Make Time Gate Threshold Source Explicit

```diff
--- a/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
+++ b/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
@@
 ### 6.5 Time Integrity Gate
@@
-2. `root_distance < threshold`
+2. `root_distance < dr_contract.time_integrity_gate.root_distance_threshold_s`
```

Rationale:

An unspecified threshold is non-enforceable and invites environment-specific defaults. This patch ties the RFC to a concrete machine-readable source.

## Patch 05: Strengthen Post-Restore Gate Parity with Release Gates

```diff
--- a/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
+++ b/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
@@
 Post-restore gate checks:
 
 1. Crypto probe tests pass.
 2. Policy version and crypto policy version are consistent.
 3. Recovery Point Tuple validated.
 4. Revocation caches reconciled.
 5. Remote log anchor chain verified.
+6. All release gates listed in `docs/security/dr_contract.json.post_restore_security_gate.required_release_gates` pass.
```

Rationale:

"At least as strict as release gates" remains interpretive without explicit source linkage. This patch removes interpretation room.

## Patch 06: Define Drill Recency Windows (Not Just Frequency Labels)

```diff
--- a/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
+++ b/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
@@
 ## 16. Restore Drill Matrix
@@
 5. Monthly NIF-crash + integrity-reconcile drill.
+
+### 16.1 Recency Windows
+
+Recency verification windows:
+
+1. Weekly drills: last successful run <= 9 days.
+2. Monthly drills: last successful run <= 40 days.
+3. Exceeding recency window blocks Tier2+ enablement after restore.
```

Rationale:

Acceptance criteria require recency verification, but no numeric windows are currently defined. This patch makes recency auditable.

## Patch 07: Add Expiry and Reconciliation Rules for `authorized_divergence`

```diff
--- a/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
+++ b/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
@@
 Restore acceptance supports:
 
 1. `exact_match`
 2. `authorized_divergence` with incident ticket, operator signature, divergence reason code, and successful post-restore gate.
+3. `authorized_divergence` must include `expires_at` and a mandatory return-to-`exact_match` plan.
+4. Expired divergence state blocks Tier2+ until reconciled.
```

Rationale:

Without expiry/reconciliation semantics, emergency divergence can become permanent drift.

## Patch 08: Remove Phase Duplication for Service Principal Separation

```diff
--- a/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
+++ b/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
@@
 ### Phase 4: Service Separation and Reconciliation
 
-1. Per-service Unix principals and secret segregation.
-2. Adapter reconciliation contracts and replay gating.
+1. Verify and harden principal split implementation (drift audit + gate evidence refresh).
+2. Adapter reconciliation contracts and replay gating.
```

Rationale:

Service principal split is already required in Phase 0. Keeping it as a Phase 4 deliverable introduces sequencing ambiguity.

## Patch 09: Add Artifact Sync Invariant to Change Control

```diff
--- a/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
+++ b/docs/rfcs/RFC_BCP_SECURITY_KERNEL.md
@@
 ## 18. Review and Change Control
@@
 4. Council review outcomes must classify each CK control as `PLANNED`, `SPECIFIED`, `IMPLEMENTED`, or `ENFORCED`.
 5. Any `PLANNED` control requires an owner, deadline, and blocking dependency list.
+6. RFC text, `continuity_kernel.json`, `dr_contract.json`, and `authority_surface_map.json` must remain schema-synced; drift blocks release.
```

Rationale:

Your control model is multi-artifact. Without an explicit sync invariant, drift between docs and machine contracts becomes a recurring failure mode.

## Summary for Council

The first amendment round materially improved the RFC. Remaining improvements are mostly about removing interpretation gaps and preventing governance drift between prose and machine-enforced artifacts.
