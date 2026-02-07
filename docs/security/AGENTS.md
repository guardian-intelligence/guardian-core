# Security Documentation Index

## Purpose
This folder defines security posture and operations for a single personal assistant that:
- handles inbound/outbound voice calls,
- serves a root human owner,
- supports delegated trust levels,
- and can spawn subagents under constrained capabilities.

## Security Philosophy

1. Fail closed on high-risk operations.
2. Keep controls understandable and operable by one person.
3. Use least privilege with explicit capabilities, not broad shared secrets.
4. Separate trust in identity from trust in intent.
5. Accept pragmatic tradeoffs, but require written waivers and expiry.

## Runtime Boundary

In scope:
- phone/webhook ingress,
- event processing,
- policy evaluation,
- subagent spawning,
- data and secret handling,
- privileged tool usage.

Out of scope:
- distributed consensus,
- cross-org federation semantics,
- byzantine quorum protocols.

## Security Modes
- `MODE_ASSISTIVE` (default): usability first, extra prompts for sensitive actions.
- `MODE_GUARDED`: stricter verification for privileged actions.
- `MODE_LOCKDOWN`: only owner-approved or pre-authorized minimum operations.

## Document Ownership
- Owner: root human operator.
- Review cadence: monthly, and after any security incident.
- Waivers require owner approval and expiry date.
