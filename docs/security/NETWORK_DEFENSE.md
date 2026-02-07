# Network Defense

## Domain
Single-node personal assistant network plane:
- telephony webhooks,
- control APIs,
- outbound integrations,
- local service exposure.

## Threat Matrix

### ND-01: Webhook Signature Bypass
- Vector: forged inbound requests
- Control: strict signature verification, timestamp windows, replay cache

### ND-02: Replay Attack
- Vector: repeated valid webhook payloads
- Control: idempotency keys, nonce/call SID dedupe, bounded acceptance windows

### ND-03: API Token Abuse
- Vector: leaked bearer token
- Control: scoped capability tokens, short TTL, revocation list, audit logs

### ND-04: Confused Deputy via Internal APIs
- Vector: low-trust caller triggers privileged endpoint indirectly
- Control: end-to-end principal propagation and policy checks at final actuator

### ND-05: Data Exfiltration via Outbound Calls
- Vector: subagent/model sends sensitive data to third-party API
- Control: egress allowlist, payload redaction, high-risk request review

### ND-06: Resource Exhaustion
- Vector: call floods or API floods
- Control: rate limits per source, queue backpressure, worker caps, overload shedding

## Baseline Controls
1. HTTPS only for external ingress.
2. Reject unsigned or stale webhook requests.
3. Apply per-endpoint rate limits and request size bounds.
4. Segment privileged endpoints behind capability checks.
5. Emit structured security events for all denies and auth failures.

## Usability Tradeoff
Low-risk paths may keep wider rate limits to avoid user friction, but privileged endpoints must stay strict.
