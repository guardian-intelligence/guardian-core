# Security Docs 

Adaptation scope:
- Single personal-assistant agent (not a holonic multi-agent network)
- Agent can spawn constrained subagents
- Voice interaction with people at different trust levels
- Usability-first posture with explicit, documented security tradeoffs

## Design Principles

1. Fail closed for high-risk actions, degrade gracefully for low-risk actions.
2. No ambient authority for subagents. Use explicit capabilities.
3. Treat voice identity as probabilistic unless step-up verification is performed.
4. Prefer small, operable controls over heavyweight security machinery.
5. Document every security-usability waiver with expiry and owner.

## Document Map

- `AGENTS.md`: Security document index and operating philosophy
- `SECURITY_POLICY.md`: Modes, invariants, authority model, and control baselines
- `THREAT_MODEL.md`: Threat classes and required mitigations
- `NETWORK_DEFENSE.md`: Telephony/webhook/API network threats and controls
- `SECRETS_MANAGEMENT.md`: Secret classes, handling, storage, and leak response
- `INCIDENT_RESPONSE.md`: Severity model and incident playbooks
- `RELEASE_PROCEDURE.md`: Release security gates and rollback expectations
- `SIGNING_AND_VERIFICATION.md`: Artifact integrity and verification model
- `SECURITY_CHECKLIST.md`: Operational checklist for changes/releases
- `consensus-runbook.md`: Adapted runbook for orchestration reliability/security
- `waivers/`: Time-boxed exceptions for usability-driven security compromises
