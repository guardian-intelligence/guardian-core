# Secrets Management

## Objective
Prevent secret disclosure while preserving smooth local operation.

## Secret Classes
- `S0 Critical`: signing keys, auth master secrets, provider API keys with broad scope.
- `S1 Sensitive`: scoped API tokens, database credentials, session secrets.
- `S2 Operational`: low-impact tokens and service metadata.

## Storage and Access Rules
1. Store S0/S1 outside agent-writeable directories.
2. Expose only minimum required secrets to each process.
3. Subagents receive no direct S0 access.
4. Prefer ephemeral scoped tokens over long-lived broad tokens.

## Runtime Controls
1. Redact secrets in logs, traces, and error payloads.
2. Disable debug modes in production paths by default.
3. Scan outbound payloads for high-confidence credential patterns.
4. Block writes of secret-like content to user-facing transcripts.

## Rotation Policy
- S0: immediate rotation on suspicion, scheduled quarterly minimum.
- S1: rotate at least every 90 days.
- S2: rotate when practical or on scope changes.

## Leak Response Sequence
1. Revoke exposed credentials immediately.
2. Rotate dependent credentials.
3. Audit recent usage and side effects.
4. Tighten policy mode to `MODE_GUARDED` or `MODE_LOCKDOWN` as needed.
5. Record incident and remediation evidence.

## Usability Tradeoff
Allow local developer ergonomics for non-production environments, but never bypass S0 protections.
