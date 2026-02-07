# Security Checklist

## Quick Merge Gate
1. No new broad secrets exposed to agent/subagent runtime.
2. No capability widening without explicit policy update.
3. No Tier 2-3 bypass introduced without waiver.
4. Logging paths reviewed for sensitive data leakage.

## Pre-Release Gate
1. Typecheck and test suite pass.
2. Vulnerability/dependency checks reviewed.
3. Webhook/auth/replay protections validated.
4. Subagent budget and recursion controls validated.
5. Incident rollback path confirmed.

## Voice Security Gate
1. Caller trust levels reviewed.
2. Step-up verification path works for Tier 2+ actions.
3. Low-confidence callers cannot trigger privileged actions.
4. Transcript redaction policy verified.

## Operational Readiness
1. Security mode defaults are correct.
2. Capability revocation path tested.
3. Alerting for auth failures and queue buildup active.
4. Active waivers reviewed for expiry.
