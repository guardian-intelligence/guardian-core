# Orchestration Security Runbook (Adapted)

## Purpose
Operational runbook for reliability and security of a single assistant runtime with subagent orchestration.

## Core Components
- Ingress handlers (voice/webhook/message)
- Durable event queue/inbox
- Policy engine
- Primary agent executor
- Subagent executor
- Outbox/side-effect dispatcher

## Security Invariants
1. No privileged action without valid capability + policy pass.
2. No duplicate high-impact side effects without idempotency checks.
3. No unbounded subagent spawning.

## Key Operational Indicators
- Queue depth and oldest event age
- In-flight lease count and retry count
- Dead-letter queue count
- Spawn rate and max depth
- Auth failure rate by endpoint

## Alert Playbooks

### RB-01 Queue Stuck
- Symptoms: oldest event age increasing, low ack rate
- Actions: inspect workers, release stale leases, scale workers, check downstream failures

### RB-02 Auth Failure Spike
- Symptoms: sudden rise in unauthorized requests
- Actions: rotate impacted tokens, tighten rate limits, switch to guarded mode

### RB-03 Subagent Storm
- Symptoms: rapid spawn increase, degraded latency
- Actions: enforce hard spawn cap, disable optional subagent paths, investigate trigger source

### RB-04 Replay/Duplicate Effects
- Symptoms: duplicate external actions or notifications
- Actions: pause dispatcher, reconcile state, enforce idempotency keys, replay safely from durable log

## Recovery Priorities
1. Restore safe operation (contain risk).
2. Preserve data integrity.
3. Restore user-facing continuity at reduced privilege if required.
4. Fully restore automation only after root cause is addressed.
