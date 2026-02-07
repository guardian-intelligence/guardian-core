Phase A: OODA Wave Runtime Substrate

 Context

 Re-architecture of the server into a continuous OODA-loop wave
 engine. Every external fact and side effect is durably
 represented, auditable, and recoverable. MCP-free. Single-node
 SQLite. Fail-closed.

 Deliverables:
 1. Full DB schema (events, wave_runs, outbox_actions,
 action_receipts, intent_executions, audit_log, capability_tokens,
  call_policy)
 2. Event lifecycle service (enqueue, claim, ack, nack, DLQ)
 3. Wave orchestrator skeleton (observe/orient/decide/act/learn
 state machine)
 4. Outbox dispatcher skeleton (plan, queue, dispatch, confirm)
 5. Capability service (issue, verify, revoke — SHA-256 hashed
 secrets)
 6. Call policy store (versioned, fail-closed default)
 7. Capability middleware for HTTP routes
 8. API routes for events, config, admin
 9. Secure bootstrap (file-based, 0600 perms)
 10. Tests for all lifecycle invariants

 Exit criteria:
 - event → wave → action → receipt → ack path works in local
 simulation
 - Deterministic replay of one wave from stored state
 - All invariant tests pass

 ---
 Design Axioms

 1. Durability before acknowledgment
 2. At-least-once ingest, exactly-once-effect illusion (dedupe +
 idempotency + outbox)
 3. Capabilities over ambient authority
 4. Deterministic state transitions (explicit FSMs)
 5. Fail-closed on uncertainty
 6. Observe everything (logs, metrics, audit)
 7. Bounded resources (hard limits on queues, claims, fanout)

 ---
 State Machines

 Event Lifecycle

 ingested → claimable → leased → acked (terminal)
                          ↓
                        nacked → claimable (retry)
                          ↓
                     dead_lettered (terminal, if attempts >= max)

 - acked and dead_lettered are terminal
 - Lease ownership is exclusive
 - Expired leases return to claimable

 Wave Run Lifecycle

 created → orienting → deciding → acting → learning → completed
 (terminal)
                                                    ↘
 failed_retryable
                                                    ↘
 failed_terminal

 - failed_retryable: returns triggering event to queue or
 schedules follow-up
 - failed_terminal: dead-letter + audit marker

 Action Lifecycle

 planned → queued → dispatched → confirmed (terminal)
                                ↘ failed_retryable
                                ↘ failed_terminal

 ---
 DB Schema (server/src/lib/db.ts)

 Runtime: bun:sqlite. File: data/inbox.db. WAL mode.

 import { Database } from "bun:sqlite";

 let db: Database;

 export function getDb(): Database {
   if (!db) {
     db = new Database("data/inbox.db", { create: true });
     db.exec("PRAGMA journal_mode = WAL");
     db.exec("PRAGMA busy_timeout = 5000");
     db.exec("PRAGMA foreign_keys = ON");
     initSchema(db);
     ensureFailClosedPolicy(db);
     ensureBootstrapToken(db);
   }
   return db;
 }

 Table: events

 CREATE TABLE IF NOT EXISTS events (
   event_id         TEXT PRIMARY KEY,
   source           TEXT NOT NULL,
   source_event_id  TEXT NOT NULL,
   event_type       TEXT NOT NULL,
   tier             INTEGER NOT NULL DEFAULT 1,
   payload_json     TEXT NOT NULL,
   created_at       TEXT NOT NULL,
   available_at     TEXT NOT NULL,
   attempts         INTEGER NOT NULL DEFAULT 0,
   max_attempts     INTEGER NOT NULL DEFAULT 5,
   lease_owner      TEXT,
   lease_token      TEXT,
   lease_expires_at TEXT,
   acked_at         TEXT,
   nacked_at        TEXT,
   dead_letter_at   TEXT,
   last_error       TEXT,
   trace_id         TEXT,
   UNIQUE(source, source_event_id)
 );

 CREATE INDEX IF NOT EXISTS idx_events_state
   ON events(acked_at, dead_letter_at, available_at,
 lease_expires_at);
 CREATE INDEX IF NOT EXISTS idx_events_source
   ON events(source, source_event_id);
 CREATE INDEX IF NOT EXISTS idx_events_type
   ON events(event_type);

 No CURRENT_TIMESTAMP in partial index predicates. All time
 comparisons at query time.

 Table: wave_runs

 CREATE TABLE IF NOT EXISTS wave_runs (
   wave_id       TEXT PRIMARY KEY,
   event_id      TEXT NOT NULL REFERENCES events(event_id),
   phase         TEXT NOT NULL DEFAULT 'created',
   trace_id      TEXT,
   started_at    TEXT NOT NULL,
   oriented_at   TEXT,
   decided_at    TEXT,
   acted_at      TEXT,
   learned_at    TEXT,
   completed_at  TEXT,
   error_class   TEXT,
   error_detail  TEXT,
   CHECK(phase IN ('created','orienting','deciding','acting','lear
 ning','completed','failed_retryable','failed_terminal'))
 );

 CREATE INDEX IF NOT EXISTS idx_wave_runs_event ON
 wave_runs(event_id);
 CREATE INDEX IF NOT EXISTS idx_wave_runs_phase ON
 wave_runs(phase);

 Table: outbox_actions

 CREATE TABLE IF NOT EXISTS outbox_actions (
   action_id        TEXT PRIMARY KEY,
   wave_id          TEXT NOT NULL REFERENCES wave_runs(wave_id),
   idempotency_key  TEXT NOT NULL UNIQUE,
   action_type      TEXT NOT NULL,
   target_adapter   TEXT NOT NULL,
   payload_json     TEXT NOT NULL,
   phase            TEXT NOT NULL DEFAULT 'planned',
   attempts         INTEGER NOT NULL DEFAULT 0,
   max_attempts     INTEGER NOT NULL DEFAULT 3,
   next_retry_at    TEXT,
   created_at       TEXT NOT NULL,
   dispatched_at    TEXT,
   completed_at     TEXT,
   error_class      TEXT,
   error_detail     TEXT,
   CHECK(phase IN ('planned','queued','dispatched','confirmed','fa
 iled_retryable','failed_terminal'))
 );

 CREATE INDEX IF NOT EXISTS idx_outbox_phase ON
 outbox_actions(phase, next_retry_at);
 CREATE INDEX IF NOT EXISTS idx_outbox_wave ON
 outbox_actions(wave_id);

 Table: action_receipts

 CREATE TABLE IF NOT EXISTS action_receipts (
   receipt_id    TEXT PRIMARY KEY,
   action_id     TEXT NOT NULL REFERENCES
 outbox_actions(action_id),
   status        TEXT NOT NULL,
   response_json TEXT,
   received_at   TEXT NOT NULL,
   CHECK(status IN ('success','failure','timeout'))
 );

 CREATE INDEX IF NOT EXISTS idx_receipts_action ON
 action_receipts(action_id);

 Table: intent_executions

 CREATE TABLE IF NOT EXISTS intent_executions (
   idempotency_key TEXT PRIMARY KEY,
   intent_type     TEXT NOT NULL,
   namespace       TEXT NOT NULL,
   status          TEXT NOT NULL,
   receipt_json    TEXT NOT NULL,
   executed_at     TEXT NOT NULL,
   CHECK(status IN ('success','rejected','error'))
 );

 Table: capability_tokens

 CREATE TABLE IF NOT EXISTS capability_tokens (
   cap_id      TEXT PRIMARY KEY,
   subject     TEXT NOT NULL,
   scopes      TEXT NOT NULL,
   secret_hash TEXT NOT NULL,
   expires_at  TEXT NOT NULL,
   revoked_at  TEXT,
   issued_by   TEXT NOT NULL,
   created_at  TEXT NOT NULL
 );

 CREATE INDEX IF NOT EXISTS idx_cap_subject ON
 capability_tokens(subject);
 CREATE INDEX IF NOT EXISTS idx_cap_hash ON
 capability_tokens(secret_hash);

 Table: audit_log

 CREATE TABLE IF NOT EXISTS audit_log (
   id         INTEGER PRIMARY KEY AUTOINCREMENT,
   timestamp  TEXT NOT NULL,
   trace_id   TEXT,
   wave_id    TEXT,
   actor      TEXT NOT NULL,
   action     TEXT NOT NULL,
   target     TEXT,
   detail     TEXT,
   cap_id     TEXT,
   latency_ms INTEGER
 );

 CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON
 audit_log(timestamp);
 CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);
 CREATE INDEX IF NOT EXISTS idx_audit_trace ON
 audit_log(trace_id);

 Table: call_policy

 CREATE TABLE IF NOT EXISTS call_policy (
   version          INTEGER PRIMARY KEY AUTOINCREMENT,
   available        INTEGER NOT NULL DEFAULT 0,
   default_action   TEXT NOT NULL DEFAULT 'voicemail',
   allowlist_json   TEXT NOT NULL DEFAULT '[]',
   blocklist_json   TEXT NOT NULL DEFAULT '[]',
   voicemail_greeting TEXT,
   updated_at       TEXT NOT NULL,
   updated_by       TEXT NOT NULL
 );

 Startup: INSERT fail-closed default row if empty (available=0,
 default_action='voicemail').

 ---
 Service Implementations

 Event Lifecycle (server/src/lib/inbox.ts)

 All synchronous. Take Database instance. Every mutation
 audit-logged.

 interface EnqueueInput {
   source: string;
   source_event_id: string;
   event_type: string;
   tier: 0 | 1 | 2 | 3;
   payload: unknown;
   trace_id?: string;
 }

 interface ClaimedEvent {
   event_id: string;
   lease_token: string;
   source: string;
   source_event_id: string;
   event_type: string;
   tier: number;
   payload_json: string;
   attempts: number;
   trace_id: string | null;
 }

 interface InboxStats {
   total: number;
   pending: number;
   in_flight: number;
   acked: number;
   dead_lettered: number;
   oldest_pending_age_ms: number | null;
 }

 export function enqueue(db: Database, input: EnqueueInput, actor:
  string): { event_id: string; deduplicated: boolean }
 export function claim(db: Database, consumer: string, limit:
 number, lease_ttl_ms: number): ClaimedEvent[]
 export function ack(db: Database, event_id: string, lease_token:
 string, consumer: string): boolean
 export function nack(db: Database, event_id: string, lease_token:
  string, consumer: string, delay_ms: number, error?: string):
 boolean
 export function deadLetter(db: Database, event_id: string,
 lease_token: string, consumer: string, reason: string): boolean
 export function stats(db: Database): InboxStats
 export function prune(db: Database, older_than_ms: number):
 number

 Claim query (deterministic, no partial index time predicates):

 SELECT * FROM events
 WHERE acked_at IS NULL
   AND dead_letter_at IS NULL
   AND available_at <= ?  -- bind param: now
   AND (lease_expires_at IS NULL OR lease_expires_at < ?)  -- bind
  param: now
   AND attempts < max_attempts
 ORDER BY created_at
 LIMIT ?

 Run in explicit transaction. For each row: generate lease_token
 (crypto.randomUUID), update lease fields, increment attempts.

 Wave Orchestrator (server/src/lib/wave.ts)

 Skeleton in Phase A — full decision/planning logic in later
 phases.

 interface WaveContext {
   wave_id: string;
   event: ClaimedEvent;
   trace_id: string;
   policy_version: number;
 }

 export function createWave(db: Database, event: ClaimedEvent):
 WaveContext
 export function advancePhase(db: Database, wave_id: string,
 to_phase: string): void
 export function failWave(db: Database, wave_id: string,
 retryable: boolean, error_class: string, detail: string): void
 export function completeWave(db: Database, wave_id: string): void

 Phase A implementation of the OODA cycle is a pass-through:
 1. Observe: event already claimed
 2. Orient: fetch current policy version (skeleton — returns
 policy snapshot)
 3. Decide: no-op in Phase A (no model, no planning — just log
 "decided")
 4. Act: no-op in Phase A (no adapters wired yet)
 5. Learn: no-op in Phase A

 The skeleton validates state transitions and records timestamps
 for each phase.

 Outbox Dispatcher (server/src/lib/outbox.ts)

 Skeleton for transactional side-effect execution.

 interface ActionPlan {
   action_type: string;
   target_adapter: string;
   payload: unknown;
   idempotency_key: string;
 }

 export function planActions(db: Database, wave_id: string,
 actions: ActionPlan[]): string[]  // returns action_ids
 export function claimDispatchable(db: Database, limit: number):
 OutboxAction[]
 export function markDispatched(db: Database, action_id: string):
 void
 export function recordReceipt(db: Database, action_id: string,
 status: string, response?: unknown): void
 export function failAction(db: Database, action_id: string,
 retryable: boolean, error: string): void

 Phase A: planActions persists to DB, claimDispatchable returns
 queued actions, recordReceipt writes receipt. No actual
 dispatching (no adapters yet).

 Capability Service (server/src/lib/capabilities.ts)

 interface CapabilityInfo {
   cap_id: string;
   subject: string;
   scopes: string[];
 }

 export function issueToken(db: Database, subject: string, scopes:
  string[], ttl_ms: number, issued_by: string): { cap_id: string;
 token: string }
 export function verifyToken(db: Database, token: string,
 required_scope: string): CapabilityInfo | null
 export function revokeToken(db: Database, cap_id: string,
 revoked_by: string): boolean

 - Hash: SHA-256 via crypto.subtle.digest (Bun native)
 - Since crypto.subtle.digest is async, pre-compute at
 verification time using sync Bun.hash or node:crypto.createHash
 - Verify: hash → lookup by secret_hash → check expiry → check
 revocation → check scope in JSON array
 - Fail closed on any failure

 Scopes (Phase A):
 ┌─────────────────┬────────────────────────────────┐
 │      Scope      │          Description           │
 ├─────────────────┼────────────────────────────────┤
 │ events.enqueue  │ Write events                   │
 ├─────────────────┼────────────────────────────────┤
 │ events.claim    │ Claim + ack/nack/DLQ           │
 ├─────────────────┼────────────────────────────────┤
 │ events.read     │ Read event by ID               │
 ├─────────────────┼────────────────────────────────┤
 │ events.stats    │ Read metrics                   │
 ├─────────────────┼────────────────────────────────┤
 │ policy.read     │ Read call policy               │
 ├─────────────────┼────────────────────────────────┤
 │ policy.write    │ Update call policy             │
 ├─────────────────┼────────────────────────────────┤
 │ cap.issue       │ Issue tokens                   │
 ├─────────────────┼────────────────────────────────┤
 │ cap.revoke      │ Revoke tokens                  │
 ├─────────────────┼────────────────────────────────┤
 │ audit.read      │ Read audit log                 │
 ├─────────────────┼────────────────────────────────┤
 │ intent.execute  │ Internal delegation accounting │
 ├─────────────────┼────────────────────────────────┤
 │ outbox.dispatch │ Execute side effects           │
 ├─────────────────┼────────────────────────────────┤
 │ wave.read       │ Read wave state                │
 ├─────────────────┼────────────────────────────────┤
 │ wave.admin      │ Diagnostic overrides           │
 └─────────────────┴────────────────────────────────┘
 Call Policy (server/src/lib/call-policy.ts)

 interface PolicySnapshot {
   version: number;
   available: boolean;
   default_action: "accept" | "reject" | "voicemail";
   allowlist: string[];
   blocklist: string[];
   voicemail_greeting: string | null;
   updated_at: string;
 }

 export function getCurrentPolicy(db: Database): PolicySnapshot
 export function updatePolicy(db: Database, policy:
 Omit<PolicySnapshot, "version">, updated_by: string): number  //
 returns new version
 export function evaluate(policy: PolicySnapshot, fromNumber:
 string): "accept" | "reject" | "voicemail"

 evaluate order: blocklist > allowlist > default_action. Pure
 function.

 ---
 Secure Bootstrap (server/src/lib/bootstrap.ts)

 On first run (empty capability_tokens table):

 1. Generate root token
 2. Write to data/.bootstrap-token with 0600 permissions
 3. Log: "Root capability token written to data/.bootstrap-token —
  read it, mint scoped tokens, then revoke root."
 4. Do not print token to stdout

 export function ensureBootstrapToken(db: Database): void {
   const count = db.prepare("SELECT COUNT(*) as n FROM
 capability_tokens").get();
   if (count.n > 0) return;

   const { cap_id, token } = issueToken(db, "root", ["*"], 365 *
 24 * 60 * 60 * 1000, "system");
   const bootstrapPath = "data/.bootstrap-token";
   Bun.write(bootstrapPath, JSON.stringify({ cap_id, token,
 scopes: ["*"], subject: "root" }, null, 2));
   // Set file permissions to owner-only
   const { chmodSync } = require("node:fs");
   chmodSync(bootstrapPath, 0o600);
   console.log(`[bootstrap] Root token written to
 ${bootstrapPath}`);
 }

 Rotation workflow (documented, not automated in Phase A)

 1. Read data/.bootstrap-token
 2. Use root token to POST /api/admin/tokens — mint scoped tokens
 for brain, ingress
 3. DELETE /api/admin/tokens/{root_cap_id} — revoke root
 4. Delete data/.bootstrap-token
 5. Audit log records all steps

 ---
 Capability Middleware (server/src/middleware/capability.ts)

 import type { Context, Next } from "hono";
 import { verifyToken } from "../lib/capabilities.ts";
 import { getDb } from "../lib/db.ts";

 export function requireScope(scope: string) {
   return async (c: Context, next: Next) => {
     const auth = c.req.header("Authorization");
     if (!auth?.startsWith("Bearer "))
       return c.json({ error: "Unauthorized" }, 401);

     const cap = verifyToken(getDb(), auth.slice(7), scope);
     if (!cap) return c.json({ error: "Forbidden" }, 403);

     c.set("cap", cap);
     return next();
   };
 }

 ---
 HTTP Routes

 Events (server/src/routes/events.ts)
 Method: POST
 Path: /api/events
 Scope: events.enqueue
 Handler: Enqueue event, return { event_id, deduplicated }
 ────────────────────────────────────────
 Method: POST
 Path: /api/events/claim
 Scope: events.claim
 Handler: Body: { consumer, limit, lease_ttl_ms }. Return
   ClaimedEvent[]
 ────────────────────────────────────────
 Method: POST
 Path: /api/events/:id/ack
 Scope: events.claim
 Handler: Body: { lease_token, consumer }. Return { success }
 ────────────────────────────────────────
 Method: POST
 Path: /api/events/:id/nack
 Scope: events.claim
 Handler: Body: { lease_token, consumer, delay_ms, error? }.
 Return
    { success }
 ────────────────────────────────────────
 Method: POST
 Path: /api/events/:id/dead-letter
 Scope: events.claim
 Handler: Body: { lease_token, consumer, reason }. Return {
 success
    }
 ────────────────────────────────────────
 Method: GET
 Path: /api/events/stats
 Scope: events.stats
 Handler: Return InboxStats
 Config (server/src/routes/config.ts)
 Method: GET
 Path: /api/config/call-policy
 Scope: policy.read
 Handler: Return latest PolicySnapshot
 ────────────────────────────────────────
 Method: POST
 Path: /api/config/call-policy
 Scope: policy.write
 Handler: Body: policy fields. Return { version }
 Admin (server/src/routes/admin.ts)
 Method: POST
 Path: /api/admin/tokens
 Scope: cap.issue
 Handler: Body: { subject, scopes, ttl_ms }. Return { cap_id,
 token
    }
 ────────────────────────────────────────
 Method: DELETE
 Path: /api/admin/tokens/:id
 Scope: cap.revoke
 Handler: Return { success }
 ────────────────────────────────────────
 Method: GET
 Path: /api/admin/audit
 Scope: audit.read
 Handler: Query: ?since=&limit=. Return audit entries
 ────────────────────────────────────────
 Method: POST
 Path: /api/admin/prune
 Scope: events.claim
 Handler: Body: { older_than_ms }. Return { pruned }
 server/src/index.ts (modified)

 import { getDb } from "./lib/db.ts";
 import { requireScope } from "./middleware/capability.ts";
 // ... route handlers

 const app = new Hono();

 // Existing
 app.get("/health", (c) => c.json({ status: "ok" }));
 app.use("/tools/*", verifyElevenLabsSignature);
 app.post("/tools/github-status", handleGithubStatus);
 app.post("/tools/github-issue", handleCreateIssue);

 // New: capability-scoped API
 app.post("/api/events", requireScope("events.enqueue"),
 handleEnqueueEvent);
 app.post("/api/events/claim", requireScope("events.claim"),
 handleClaimEvents);
 app.post("/api/events/:id/ack", requireScope("events.claim"),
 handleAckEvent);
 app.post("/api/events/:id/nack", requireScope("events.claim"),
 handleNackEvent);
 app.post("/api/events/:id/dead-letter",
 requireScope("events.claim"), handleDeadLetterEvent);
 app.get("/api/events/stats", requireScope("events.stats"),
 handleEventStats);
 app.get("/api/config/call-policy", requireScope("policy.read"),
 handleGetPolicy);
 app.post("/api/config/call-policy", requireScope("policy.write"),
  handleSetPolicy);
 app.post("/api/admin/tokens", requireScope("cap.issue"),
 handleIssueToken);
 app.delete("/api/admin/tokens/:id", requireScope("cap.revoke"),
 handleRevokeToken);
 app.get("/api/admin/audit", requireScope("audit.read"),
 handleGetAudit);
 app.post("/api/admin/prune", requireScope("events.claim"),
 handlePruneEvents);

 // Init DB on startup (creates schema + fail-closed policy +
 bootstrap token)
 getDb();

 ---
 Files Summary
 File: server/src/lib/db.ts
 Action: Create
 Purpose: SQLite init, schema, WAL, bootstrap
 ────────────────────────────────────────
 File: server/src/lib/inbox.ts
 Action: Create
 Purpose: Durable event lifecycle
 ────────────────────────────────────────
 File: server/src/lib/wave.ts
 Action: Create
 Purpose: Wave orchestrator skeleton (OODA FSM)
 ────────────────────────────────────────
 File: server/src/lib/outbox.ts
 Action: Create
 Purpose: Transactional outbox skeleton
 ────────────────────────────────────────
 File: server/src/lib/capabilities.ts
 Action: Create
 Purpose: Token issue/verify/revoke
 ────────────────────────────────────────
 File: server/src/lib/call-policy.ts
 Action: Create
 Purpose: Versioned policy, fail-closed eval
 ────────────────────────────────────────
 File: server/src/lib/bootstrap.ts
 Action: Create
 Purpose: Secure root token generation
 ────────────────────────────────────────
 File: server/src/middleware/capability.ts
 Action: Create
 Purpose: requireScope() middleware
 ────────────────────────────────────────
 File: server/src/routes/events.ts
 Action: Create
 Purpose: Events API
 ────────────────────────────────────────
 File: server/src/routes/config.ts
 Action: Create
 Purpose: Policy API
 ────────────────────────────────────────
 File: server/src/routes/admin.ts
 Action: Create
 Purpose: Token + audit API
 ────────────────────────────────────────
 File: server/src/index.ts
 Action: Modify
 Purpose: Register routes, init DB
 ────────────────────────────────────────
 File: server/src/__tests__/inbox.test.ts
 Action: Create
 Purpose: Event lifecycle tests
 ────────────────────────────────────────
 File: server/src/__tests__/wave.test.ts
 Action: Create
 Purpose: Wave state machine tests
 ────────────────────────────────────────
 File: server/src/__tests__/outbox.test.ts
 Action: Create
 Purpose: Outbox lifecycle tests
 ────────────────────────────────────────
 File: server/src/__tests__/capabilities.test.ts
 Action: Create
 Purpose: Token auth tests
 ────────────────────────────────────────
 File: server/src/__tests__/call-policy.test.ts
 Action: Create
 Purpose: Policy eval tests
 ---
 Tests (bun test)

 Inbox (server/src/__tests__/inbox.test.ts)

 1. Idempotent enqueue: same (source, source_event_id) →
 deduplicated: true
 2. Claim returns only available events
 3. Concurrent claims: two claims for same event → only one gets
 lease
 4. Ack with correct token succeeds
 5. Ack with wrong token fails
 6. Ack with expired lease fails
 7. Nack releases lease and delays available_at
 8. Nack auto-dead-letters at max_attempts
 9. Expired leases become claimable
 10. Dead-lettered events never returned by claim
 11. Stats reflect queue state
 12. Prune deletes old acked + DLQ events
 13. Prune preserves pending events

 Wave (server/src/__tests__/wave.test.ts)

 1. Create wave from claimed event
 2. Phase transitions follow valid FSM order
 3. Invalid phase transition rejected
 4. Failed-retryable records error but allows retry
 5. Failed-terminal is terminal
 6. Complete requires all phases visited
 7. trace_id propagated from event to wave

 Outbox (server/src/__tests__/outbox.test.ts)

 1. Plan actions persists to DB with idempotency keys
 2. Duplicate idempotency key rejects second action
 3. Claim dispatchable returns queued actions ordered by creation
 4. Receipt records immutable outcome
 5. Failed-retryable increments attempts
 6. Failed-terminal after max_attempts

 Capabilities (server/src/__tests__/capabilities.test.ts)

 1. Issue + verify round-trip
 2. Wrong scope rejected
 3. Expired token rejected
 4. Revoked token rejected
 5. Invalid token rejected
 6. Raw token never in DB (SHA-256 only)

 Call Policy (server/src/__tests__/call-policy.test.ts)

 1. Default is fail-closed: available=false,
 default_action="voicemail"
 2. Allowlist overrides default
 3. Blocklist overrides allowlist
 4. Policy is versioned
 5. Read returns latest version

 ---
 Invariants (must always hold)

 1. No event in both acked and dead_lettered states
 2. One active lease owner max per event at any time
 3. Each intent_executions.idempotency_key has at most one
 terminal receipt
 4. Each outbox_actions.idempotency_key executed at most once
 externally
 5. call_policy.version monotonically increases
 6. capability_tokens.secret_hash never contains raw token

 ---
 Verification

 1. cd server && bun run typecheck — compiles
 2. cd server && bun test — all tests pass
 3. curl localhost:3000/health — existing endpoint still works
 4. Read data/.bootstrap-token, use token to hit /api/events/stats
 5. Manual: enqueue → claim → ack via curl
 6. Manual: enqueue → claim → nack×5 → verify dead-lettered
 7. Manual: create wave from claimed event, advance through phases
 8. Verify audit log records all operations
 9. npm run deploy:server — deploys to rumi-vps
 10. Repeat verification on production

 ---
 What Comes Next (NOT in Phase A)

 - Phase B: Intent bridge (brain-side intent processor, receipts,
 quarantine, namespace identity)
 - Phase C: Capability + policy hardening (principal registry,
 bootstrap rotation, adversarial tests)
 - Phase D: Twilio ingress adapters, call session projection,
 action adapters
 - Phase E: Operational excellence (SLO dashboards, DLQ replay,
 chaos drills)