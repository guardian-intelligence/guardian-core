# Release Procedure (Security)

## Preconditions
If any mandatory gate fails: stop release, remediate, rerun full gate set.

## Required Steps
1. Confirm release scope and rollback plan.
2. Ensure tests and type checks pass.
3. Execute security checklist (`SECURITY_CHECKLIST.md`).
4. Confirm dependency and vulnerability scan status.
5. Verify security-sensitive config changes were reviewed.
6. Tag release with changelog notes for security-impacting changes.

## Post-Release Verification
1. Validate health endpoints and critical flows.
2. Verify voice ingress policy behavior on known test scenarios.
3. Confirm no unexpected auth/deny spikes in logs.

## Emergency Rollback
1. Revert deployment.
2. Rotate any newly exposed credentials.
3. Switch to `MODE_LOCKDOWN` if compromise suspected.
4. Open incident record and run incident playbook.

## Usability Tradeoff
For personal deployments, release tooling may remain lightweight, but security checklist and rollback readiness are mandatory.
