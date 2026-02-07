# Incident Response

## Severity Model
- `Critical`: active compromise or high-impact unauthorized action.
- `High`: serious weakness with near-term exploit risk.
- `Medium`: bounded security issue with mitigations available.
- `Low`: hardening gap with low immediate impact.

## Universal Rules
1. Contain first, investigate second.
2. Move to stricter mode when trust is uncertain.
3. Preserve evidence without mutation.
4. Record timeline, decisions, and owner.

## Playbooks

### IR-01 Secret Leak
- Revoke and rotate credentials.
- Audit usage and suspicious actions.
- Patch leak source and add prevention checks.

### IR-02 Voice Impersonation / Social Engineering
- Freeze Tier 2-3 voice actions.
- Require callback or secondary verification.
- Review transcripts and policy decisions.

### IR-03 Capability Abuse
- Revoke affected capabilities.
- Audit scope usage and blast radius.
- Patch issuance policy and add regression tests.

### IR-04 Replay/Idempotency Failure
- Pause impacted integrations.
- Reconcile duplicate side effects.
- Enforce dedupe and lease semantics before re-enable.

### IR-05 Subagent Runaway
- Kill active subagent fan-out.
- Tighten spawn budgets and recursion depth.
- Add guardrails for triggering conditions.

## Closure Criteria
1. Containment verified.
2. Root cause documented.
3. Preventive control implemented.
4. Follow-up actions scheduled with owner and due date.
