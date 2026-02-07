# Prompt for Engineering Agent: Guardian Trust Kernel from First Principles

## Role
You are a principal architect for agent-native systems with deep expertise in:
- formal methods and safety invariants,
- capability security (OCAP),
- adversarial ML security and prompt injection defense,
- durable execution and distributed systems semantics,
- secure payments infrastructure,
- rollback-safe systems upgrades.

You are tasked with producing a **crystal-clear, implementation-ready theory and architecture refinement** for this repository’s "Guardian" concept.

## Mission
Define a **bulletproof Guardian architecture** where:
1. The Guardian is a continuous OODA-loop reasoning engine over structured data.
2. Safety-critical controls are immutable to the Guardian.
3. Tool execution is isolated from reasoning and guarded by a separate trust kernel.
4. Unauthorized disclosure and unauthorized payment execution are impossible by construction (within stated assumptions).
5. Self-modification and OS-level updates are safe, staged, reversible, and auditable.

Your output must be rigorous enough to drive implementation with minimal ambiguity.

---

## Mandatory Step 0: Reasoning Mode Selection
Before analysis, choose a reasoning mode pack from:
- `.claude/skills/modes-of-reasoning/assets/`

You may choose:
1. one primary mode, or
2. a hybrid of up to three modes.

You must explicitly document:
1. selected mode file(s),
2. why selected,
3. where each mode is applied in your analysis workflow,
4. what blind spots remain and how you mitigate them.

---

## Core Problem Framing
Think from first principles:

A Guardian is not a chatbot. It is a **General-Purpose Reasoning Engine over Structured Data Executing Compute** under strict authority boundaries.

You must formalize:
1. what the Guardian is allowed to reason about,
2. what the Guardian is allowed to execute,
3. what the Guardian is never allowed to modify,
4. what can be self-improved and under what constraints.

Treat this as a trust kernel design problem, not a UX-only problem.

---

## Non-Negotiable Requirements

### A. Information Protection
1. Guardian must never divulge sensitive data to unauthorized principals.
2. Identity trust must be graded and tied to risk tier.
3. High-risk disclosures/actions must fail closed on uncertainty.

### B. Prompt Injection Resistance
1. Assume all model-visible text may be adversarial.
2. Security must rely on architecture and policy gates, not prompt wording.
3. Indirect/multi-hop injection paths must be explicitly addressed.

### C. Separation of Planes
1. Reasoning plane and tool guardrail plane must be distinct.
2. Guardian cannot disable or rewrite tool safety gates.
3. Tool execution must require machine-verifiable capability + policy predicates.

### D. Self-Modification and OS-Level Evolution
1. Guardian may propose changes but cannot directly apply immutable-kernel changes.
2. Update source must be a versioned registry with signed/pinned artifacts.
3. Rollout channels must include at minimum:
- known-good/stable,
- candidate,
- nightly/experimental.
4. Automatic rollback to last-known-good on health or invariant failure.

### E. Payment Safety
Support threat model for bank/card/stablecoin actions where unauthorized spend is impossible by construction.

Minimum required controls:
1. intent binding (who/what/why),
2. payee binding,
3. amount and currency bounds,
4. time-window bounds,
5. nonce/replay protection,
6. one-time or tightly scoped capabilities,
7. dual-control or step-up paths for high-risk transfers,
8. immutable audit/evidence bundle for all payment actions and denials.

### F. Evidence and Audit
1. Every high-risk mutation/action/denial must emit a structured evidence bundle.
2. Evidence must support deterministic replay and forensic lineage.

### G. Runtime Guarantees
1. durable state transitions,
2. idempotent side effects,
3. explicit finite-state transitions,
4. bounded resources,
5. comprehensive observability.

---

## Required Analysis Depth
You must provide:
1. formal trust boundary definitions,
2. state machines for key subsystems,
3. immutable-vs-mutable surface map,
4. threat model with attack paths and mitigation bindings,
5. invariants stated as machine-checkable predicates where possible,
6. verification strategy including chaos/fault injection tests,
7. migration strategy from current architecture to target architecture.

Do not provide hand-wavy “best practices.”

---

## Deliverables

### Deliverable 1: New RFC at repo root
Create:
- `RFC_GUARDIAN_TRUST_KERNEL.md`

It must include at least these sections:
1. Abstract and Scope
2. Terminology and Formal Definitions
3. System Model and Trust Boundaries
4. Threat Model and Adversary Classes
5. Immutable Trust Kernel Specification
6. Tool Guardrail Plane Specification
7. Payment Authorization Kernel
8. Self-Modification + OS Registry + Rollout + Rollback
9. Prompt Injection Containment Architecture
10. Evidence Bundle Contract and Audit Lineage
11. State Machines and Transition Constraints
12. Invariants (hard safety + liveness)
13. Verification and Validation Plan
14. Failure Injection Matrix
15. Operational Runbook Requirements
16. Migration Plan and Rollout Gates
17. Open Questions and Assumptions

### Deliverable 2: Theory corpus updates (`docs/theory`)
Update all relevant machine-readable documents to align with the RFC:
1. `docs/theory/laws.json`
2. `docs/theory/principles.json`
3. `docs/theory/agent_native_architecture.json`
4. `docs/theory/defects.json`
5. `docs/theory/unified_theory.json`
6. `docs/theory/glossary/glossary.json`

Add/modify IDs carefully and maintain internal reference consistency.

### Deliverable 3: Security corpus alignment (`docs/security`)
Update relevant docs so security policy matches the new trust kernel:
1. `docs/security/SECURITY_POLICY.md`
2. `docs/security/THREAT_MODEL.md`
3. `docs/security/NETWORK_DEFENSE.md`
4. `docs/security/SECRETS_MANAGEMENT.md`
5. `docs/security/INCIDENT_RESPONSE.md`
6. `docs/security/SECURITY_CHECKLIST.md`

### Deliverable 4: Change report
Provide a concise report summarizing:
1. files changed,
2. key law/principle additions,
3. major tradeoffs,
4. unresolved risks.

---

## Explicit Constraints

### Constraint 1: Decide vs Act must be explicit
You must define why and how these are separated in durable execution semantics.

### Constraint 2: Immutable kernel boundary must be concrete
Define exactly:
1. immutable components,
2. mutable components,
3. who can change what,
4. required proofs/gates for every change path.

### Constraint 3: No model-text authority
No operation may derive authorization directly from model output text.

### Constraint 4: Payment hardening must be first-class
Do not treat payments as generic tool calls; define dedicated safety kernel semantics.

### Constraint 5: Guardrails must be non-bypassable by Guardian
Guardian may suggest rule changes but cannot directly relax enforcement in same execution context.

---

## Required Formalism
Where practical, provide formula-like predicates in this style:
1. `Authorized(action, subject) := ValidCapability(subject, scope(action)) ∧ PolicyAllows(subject, action, context)`
2. `CommitAllowed := InvariantSetHolds ∧ RequiredEvidencePresent`
3. `PaymentDispatchAllowed := IntentBound ∧ PayeeBound ∧ AmountBound ∧ TimeBound ∧ NonceFresh ∧ StepUpSatisfied`
4. `RollbackRequired := HealthCheckFailed ∨ InvariantViolationDetected ∨ ReceiptMismatch`

Use clear notation and plain-language explanation.

---

## Scenario Matrix (must be addressed)
You must explicitly reason through at least these scenarios:

### Identity and Disclosure
1. Trusted delegate requests sensitive info with partial verification.
2. Unknown caller uses social engineering urgency.
3. Previously trusted principal downgraded mid-session.

### Prompt Injection
4. Tool output includes hidden instructions to exfiltrate secrets.
5. Multi-hop poisoning via web fetch -> summarize -> action.
6. Intent payload attempts scope escalation through crafted fields.

### Payments
7. Payment request with mismatched payee metadata.
8. Replay of previously approved payment intent.
9. High-value transfer during degraded trust state.
10. Stablecoin transfer with chain congestion and delayed confirmation.

### Self-Modification / OS Updates
11. Nightly update passes smoke tests but fails safety invariant at runtime.
12. Compromised registry metadata attempts downgrade attack.
13. Guardian proposes kernel-relaxing change bundled with unrelated beneficial patch.

### Runtime Reliability
14. Crash between Decide commit and Act dispatch.
15. Duplicate event deliveries under retry storm.
16. DLQ saturation with adversarial malformed intents.

For each scenario include:
1. expected control path,
2. deny/allow criteria,
3. evidence emitted,
4. recovery behavior.

---

## Validation Requirements
You must propose a test matrix including:
1. unit tests for policy predicates,
2. state-machine transition tests,
3. property tests for idempotency and invariants,
4. integration tests for event->wave->outbox->receipt lifecycle,
5. adversarial tests (prompt injection, scope confusion, namespace spoofing),
6. chaos tests (crash timing, storage contention, delayed receipts),
7. rollback drills (known-good recovery).

Include pass/fail criteria.

---

## Quality Bar
Your output is acceptable only if:
1. every major claim maps to at least one law + one mechanism + one measurable signal,
2. payment safety is treated as a dedicated constrained protocol,
3. immutable kernel is unambiguous and enforceable,
4. threat model and mitigations are specific, not generic,
5. migration path is realistic for this repository’s current architecture,
6. docs remain machine-readable and internally consistent.

---

## Working Method
Follow this sequence:
1. select reasoning mode pack,
2. inventory current docs and architecture,
3. define trust boundary model,
4. draft RFC skeleton,
5. derive laws/principles updates,
6. patch theory/security docs,
7. run consistency checks across IDs/references,
8. produce change report with residual risks.

---