# Security Policy

## 1. Posture
This assistant is a personal system, not a multi-tenant platform. Security controls are optimized for:
- protecting high-impact assets,
- preserving daily usability,
- and keeping operations simple enough for one operator.

## 2. Authority Model

### Principals
- `root_human`: full authority.
- `delegate_admin`: broad authority delegated by root human.
- `delegate_standard`: limited authority for routine tasks.
- `delegate_restricted`: narrow, task-specific authority.
- `unknown`: untrusted caller/sender.

### Core Rules
1. No principal inherits authority implicitly.
2. Delegated authority must be explicitly scoped and revocable.
3. Subagents never receive broader authority than the parent execution.
4. High-risk operations require step-up verification unless explicitly waived.

## 3. Risk Tier Model
- `Tier 0` low risk: informational, no side effects.
- `Tier 1` moderate risk: routine external messaging, low-sensitivity retrieval.
- `Tier 2` high risk: account changes, financial actions, sensitive data access.
- `Tier 3` critical risk: irreversible or safety-impacting actions.

Policy:
- `Tier 0-1`: optimize for smooth interaction.
- `Tier 2`: require stronger trust evidence or pre-authorization.
- `Tier 3`: require explicit root-human approval unless emergency policy permits.

## 4. Voice Trust Policy
Voice identity confidence is probabilistic.

### Default Trust Signals
- caller number history and allowlist match,
- call context consistency (recent shared context),
- behavioral consistency (expected cadence/content),
- optional passphrase or callback challenge.

### Enforcement
- Unknown or low-confidence voice identity cannot trigger Tier 2+ actions.
- Sensitive details are redacted for low-confidence callers.
- Any privilege escalation over voice requires explicit confirmation path.

## 5. Capability (OCAP) Requirements
1. Every privileged API/tool invocation must carry a scoped capability.
2. Capabilities must include: subject, scope, constraints, expiry.
3. Capabilities are revocable and auditable.
4. Global shared bearer secrets are prohibited for privileged operations.

## 6. Subagent Policy
1. Subagents run with reduced default capabilities.
2. Subagent spawn rate and concurrency are budget-limited.
3. Subagents cannot access root secrets directly.
4. Subagent outputs are treated as untrusted until policy checks pass.

## 7. Secrets and Data Handling
1. Secrets stored outside agent-writeable paths.
2. Logs and transcripts must redact credential material.
3. Sensitive memory writes require confidence and tier checks.
4. Failures in redaction on sensitive channels are treated as security incidents.

## 8. Usability-First Tradeoffs (Explicitly Accepted)
1. Tier 0-1 interactions may proceed with weak identity checks for fluency.
2. Some low-risk automation may continue during degraded verification states.
3. Voice challenge frequency is minimized to reduce user friction.

These tradeoffs are acceptable only while:
- Tier 2-3 controls remain strict,
- waivers are documented,
- and incident response can quickly tighten posture.
