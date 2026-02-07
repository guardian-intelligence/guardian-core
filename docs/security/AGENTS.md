# Guardian Security Documentation

Status: ACTIVE
Date: 2026-02-07

## Purpose

Security guidelines and operational procedures for Guardian, a single-operator personal assistant built on Elixir/OTP with Dolt persistence.

## Security Philosophy

| Principle | Statement |
|-----------|-----------|
| Fail-closed | When in doubt, deny access or abort operations. |
| Defense in depth | Enforce multiple independent protection layers. |
| Minimal secrets | Use keyless signing to eliminate long-lived signing key custody. |
| Transparent verification | Release verification is publicly auditable. |
| PQC from day 1 | Post-quantum cryptography is active, not deferred. See `CRYPTOGRAPHY_POSTURE.md`. |
| Byte-level discipline | All trust boundaries enforce strict binary parsing and bounded decode. |

## Document Index

| Doc ID | Path | Purpose |
|--------|------|---------|
| SEC-DOC-01 | `SECURITY_POLICY.md` | Security modes, invariants, and enforcement posture. |
| SEC-DOC-02 | `THREAT_MODEL.md` | Threat classes, adversary assumptions, and required controls. |
| SEC-DOC-03 | `NETWORK_DEFENSE.md` | Network-focused threat matrix and control bindings. |
| SEC-DOC-04 | `SECRETS_MANAGEMENT.md` | Credential custody, distribution, redaction, and leak response controls. |
| SEC-DOC-05 | `INCIDENT_RESPONSE.md` | Incident severity model, playbooks, and closure criteria. |
| SEC-DOC-06 | `RELEASE_PROCEDURE.md` | High-assurance release workflow and required gates. |
| SEC-DOC-07 | `SIGNING_AND_VERIFICATION.md` | Keyless release signing and verification procedures. |
| SEC-DOC-08 | `SECURITY_CHECKLIST.md` | Operational pre-merge and release security verification checklist. |
| SEC-DOC-09 | `CRYPTOGRAPHY_POSTURE.md` | Blake3 + ML-DSA-65 cryptographic posture and algorithm choices. |
| SEC-DOC-10 | `ELIXIR_SECURITY_EVALUATION.md` | Elixir/OTP security properties and BEAM trust model evaluation. |
| SEC-DOC-11 | `orchestration-runbook.md` | Orchestration layer incident, diagnostics, and recovery runbook. |
| SEC-DOC-12 | `waivers/` | Active and expired security waivers. |

## Keyless Signing Insight

Cosign keyless signing removes long-lived signing-key storage from release operations.

**Traditional flow:**

1. Generate signing keys.
2. Store private key securely.
3. Rotate keys periodically.
4. Accept long-lived key compromise risk.

**Keyless flow:**

1. GitHub Actions obtains OIDC identity token.
2. Sigstore Fulcio issues short-lived certificate.
3. Artifact is signed with ephemeral key.
4. Signing event is logged in Rekor transparency log.

**Outcome:** No long-lived signing keys to store, rotate, or protect.

Keyless signing secures release artifacts only; runtime identity and receipt authentication use Guardian's own cryptographic posture as defined in `CRYPTOGRAPHY_POSTURE.md`.

## Document Ownership

- **Owner:** Root human operator.
- **Review cadence:** Monthly, and after any security incident.
- **Waivers:** Require owner approval and expiry date.
