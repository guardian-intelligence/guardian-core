# RFC: BCP + Security Kernel (Guardian Core)

Status: Proposed
Date: 2026-02-07
Owner: Security + Runtime Architecture
Scope: Guardian Core (Kernel, Platform, Agent Runtime, Rumi Web Service)

## 1. Abstract

This RFC defines the minimum security and business continuity kernel for Guardian Core and Rumi services. It is intentionally bar‑raising: high standards are defined so engineering, operations, and agents must meet them to proceed. The document integrates the Agent Runtime Bedrock RFC and the security JSON corpus, and establishes concrete SLO/SLA targets, disaster recovery (DR) processes, incident handling, and implementation sequencing. This RFC is the foundation for future companion docs, runbooks, and implementation milestones.

## 2. Non-Negotiable Principles

These are the minimal kernel invariants. Violations block release or demand immediate containment.

1. **No ambient authority**
   All authority-bearing actions must be capability-gated and policy-approved. Model output is never authoritative.
2. **Fail closed under ambiguity**
   Tier 2+ actions must fail closed if identity, capability, policy, or crypto requirements are unverifiable or stale.
3. **Typed envelopes for all mutations**
   All world mutations flow through typed envelopes (EventEnvelope → OutboxActionEnvelope → ActionReceiptEnvelope).
4. **Deterministic data access broker**
   Sensitive reads are decided by deterministic policy code, not model discretion.
5. **Day‑1 PQC + BLAKE3 enforcement**
   Required PQC and hash suites must be available at startup; high-risk actions are disabled on failure.
6. **Evidence preservation**
   Security incidents must preserve evidence with hashes, receipts, and immutable audit trails.
7. **No plaintext secrets**
   Secrets never appear in repo, logs, or release artifacts.

These align with `docs/security/security_policy.json`, `docs/security/threat_model.json`, and `docs/rfcs/RFC_AGENT_RUNTIME_BEDROCK.md`.

## 3. Architecture Context and Scope

### 3.1 Systems in Scope

1. **Guardian Kernel (TypeScript)**
   Message routing, scheduling, agent container coordination.
2. **Phoenix Platform (Elixir)**
   Webhooks, authenticated API services, envelope ingress.
3. **Rumi Web Service**
   Public APIs and (separately) privileged internal endpoints.
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

## 4. Reliability and Availability Standards (Bar‑Raising)

### 4.1 SLO / SLA Targets

These are intentionally high and may be adjusted during formal security review.

1. **Rumi Web Service (public API)**
   - SLO: 99.99% monthly availability
   - SLA: 99.95% monthly availability
2. **Guardian Kernel**
   - SLO: 99.95% monthly availability
   - SLA: 99.9% monthly availability
3. **Agent Runtime Containers**
   - SLO: 99.9% monthly availability
   - SLA: 99.5% monthly availability

### 4.2 Error Budget Policy

1. Error budget is enforced monthly for each service.
2. Alerts are emitted at 10% and 50% budget burn.
3. Sustained burn triggers a freeze on new features.

### 4.3 Recovery Objectives

1. **RPO**: 5 minutes for core services.
2. **RTO**: 30 minutes for core services.

## 5. Disaster Recovery Program

### 5.1 Notification and Paging

1. All Critical and High severity events must page the human operator (Shovon Hasan / @anveio).
2. Current paging channel: headscale control plane box (no third‑party provider yet).
3. Notification payloads must include: severity, impact, containment status, and next actions.

### 5.2 Backup and Restore

1. **Primary backups**: OVH enabled backups.
2. **Secondary backups**: encrypted offsite export to be added (Phase 2).
3. **Restore testing**: quarterly, with documented evidence.

### 5.3 Recovery Runbooks

Runbooks are mandatory for: service restart, Dolt rollback, secret recovery, NIF crash, and WhatsApp auth recovery.

## 6. Security Kernel Controls

### 6.1 Identity and Capability Controls

1. All authority-bearing actions require valid capability tokens.
2. Tokens must include crypto policy version and freshness requirements.
3. Replay and stale tokens must be rejected with alert emission.

### 6.2 Crypto Enforcement

1. Required PQC suites must be available for Tier 2+.
2. BLAKE3 required for integrity; SHA‑256 only for compatibility.
3. Downgrade attempts are blocked and logged.

### 6.3 Secrets Management

1. No plaintext secrets in repo or logs.
2. sops‑nix used for runtime injection on NixOS.
3. Mandatory redaction on all outbound text channels.

### 6.4 Container Isolation

1. Non-root containers only.
2. Explicit mount allowlist; deny sensitive patterns.
3. No host secrets mounted into containers.

### 6.5 Audit and Evidence

1. All authority actions record audit events with receipts.
2. Evidence bundles must be hashed (BLAKE3) and signed where required.

## 7. Rumi Web Service Architecture

### 7.1 Public API Listener

1. Public APIs only, no privileged actions.
2. Rate‑limit and input‑cap policies enforced.

### 7.2 Privileged Internal Listener

1. Runs on a separate internal-only listener bound to headscale.
2. Requires capability token and explicit audit trail.
3. No exposure to public internet.

## 8. Observability and Alerting

### 8.1 Mandatory Metrics

1. Queue depths and backlog age.
2. Outbox latency and confirmation delays.
3. Adapter error classes.
4. Policy deny rates by tier.
5. DLQ size and age.

### 8.2 Alerting Policy

1. Critical: no events processed, DB unavailable, NIF crash.
2. High: backlog growth, repeated adapter failures.
3. Medium: DLQ growth, latency drift.

## 9. Incident Response and Containment

### 9.1 Response Model

1. Contain first, investigate second.
2. Fail closed under ambiguity.
3. Preserve evidence, record timeline.

### 9.2 Automated Containment Actions

1. Stop affected services.
2. Revoke capability tokens.
3. Rotate secrets if compromise suspected.
4. Export logs and hash evidence.

## 10. Implementation Plan

### Phase 0: Baseline Kernel Enforcement

1. Map Bedrock RFC invariants into security checklist gating.
2. Define SLO/SLA and SLI metrics with alert thresholds.
3. Enforce PQC availability probes at startup.

### Phase 1: Observability + Alerting

1. Implement metrics and alerts in runtime.
2. Pager integration through headscale control plane.

### Phase 2: Backup + DR Hardening

1. Add encrypted offsite backups.
2. Automate restore testing.

### Phase 3: Continuous Verification

1. Automated checks for NixOS hardening invariants.
2. CI enforcement for security checklist artifacts.

## 11. Review and Change Control

1. This RFC is reviewed monthly.
2. Changes to SLO/SLA or crypto policy must go through security review.
3. No waivers permitted on non‑waivable controls.

## 12. Acceptance Criteria

This RFC is active when:

1. SLO/SLA and RPO/RTO targets are tracked.
2. Typed envelope authority flow is enforced across all services.
3. Privileged endpoints are internal-only on headscale.
4. Incident response runbooks are automated and tested.
5. Secrets handling and crypto enforcement pass all security checks.

