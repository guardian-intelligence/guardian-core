# Signing and Verification

## Scope
Release artifact integrity and origin verification for this assistant.

## Recommended Model
1. Use keyless signing where available (OIDC + short-lived certs).
2. Publish checksums/signatures with each release artifact.
3. Verify artifact identity before deployment.

## Minimum Acceptable Model (Usability-First)
If full keyless signing is not yet in place:
- maintain deterministic build inputs,
- publish SHA-256 checksums,
- verify checksum before deploy,
- keep auditable release notes with commit references.

## Verification Requirements
1. Signature/checksum must match expected artifact.
2. Artifact source must match expected repository/ref.
3. Build provenance should be retained where feasible.

## Failure Modes
- Signature mismatch -> block release.
- Missing provenance in high-assurance mode -> block release.
- Identity mismatch -> treat as potential compromise.

## Usability Tradeoff
Checksum-only flows are allowed temporarily for personal operations, but must be tracked as waiver debt if used for production deployments.
