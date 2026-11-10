# Ambient reliability and recovery matrix

**Scope:** Whirr 7.0 Wish → Exchange → Window → Accord path
**Review date:** 10 November 2026
**Status:** author verification only; physical and provider failures remain open

This document maps each failure boundary to the explicit state the server keeps
and the test that exercises it. A `200` from a browser is never treated as
payment or physical evidence.

## Idempotency and duplicate requests

| Operation | Retry behavior | Evidence |
| --- | --- | --- |
| Compile | Creates a new compilation; no state is written | `ambient.test.ts` compile cases |
| Create agreement | Rejects a malformed or changed review | `ambient.test.ts` unsupported-claim and stale-hash cases |
| Provider response | Rejects stale terms hash; each revision is immutable | `ambient.test.ts` counteroffer case |
| Buyer decision | Rejects a stale hash; accepted terms remain stored | `ambient.test.ts` counteroffer case |
| Create session | Returns the existing session for the agreement; one row maximum | `returns the existing session when creation is retried` |
| Upload observations | Rejects stale/overlapping batches atomically; no partial rows | `rolls back a partial observation batch and preserves the observing meter` |
| Stop | Terminal sessions return their existing view | `ambient.test.ts` lifecycle cases |
| Accept result | Replaying the same acceptance returns the settled view with the original timestamp and one audit event | `makes acceptance retries idempotent without duplicating the acceptance record` |
| Capture | A `CAPTURED` session returns its existing view; a different provider request conflicts | `payments-contract.test.ts` duplicate-capture cases |
| Void | A `VOID_CONFIRMED` session returns its existing view | `payments-contract.test.ts` void/reconciliation cases |
| Webhook | Deduplicates event id and payload; replay converges through read-only reconciliation | `tests/unit/webhooks.test.ts`, `payments-contract.test.ts` |

## Failure states

| Failure | Durable state | Safe next action |
| --- | --- | --- |
| Stale or superseded terms | Original agreement revision remains; no new session/capture | Reload the current offer; review the exact hash |
| Observation gap, overlap, or stale sequence | Whole batch rejected; session remains `OBSERVING` | Re-send a valid monotonic batch from the last accepted meter position |
| Microphone denied or lost | `SENSOR_LOSS`/`NOT_QUALIFIED`; no capture | Restart the window only through the normal flow |
| Interruption during window | `INTERRUPTED`/`NOT_QUALIFIED`; no capture | Review the failed evidence and void/reconcile |
| Buyer rejects | `BUYER_REJECTED`; authorization void attempted | Reconcile if void outcome is unknown |
| Authorization expired | `EXPIRED`; no provider capture call | Create a new authorization and window |
| Provider capture response lost | `RECONCILIATION_REQUIRED`; stable request id retained | Reconcile with the provider; never start a second capture |
| Provider capture pending/declined | `CAPTURE_PENDING` or unresolved; no settlement claim | Reconcile; do not present success |
| Void outcome unknown | `RECONCILIATION_REQUIRED`; no capture | Reconcile the authorization before any new attempt |
| API restart | SQLite rows, signed proof, and provider identifiers persist | Reopen the session/proof; do not assume success from UI state |
| Browser reload | No automatic capture; state is reloaded from the API | Resume only from the explicit server state |

## Test traceability

- `tests/integration/ambient.test.ts` covers the full negotiated lifecycle,
  duplicate session creation, atomic observation rollback, idempotent
  acceptance, privacy/authorization boundaries, and a second app instance
  reading the persisted signed proof.
- `tests/integration/payments-contract.test.ts` covers authorization mismatch,
  duplicate capture request ids, lost capture responses, pending/declined
  captures, amount mismatch, read-only payment status, reconciliation retries,
  refunds, and webhook signature replay.
- `tests/unit/webhooks.test.ts` covers event-id and payload-hash deduplication.
- The browser workflow covers the public journey and layout; it is not a
  physical microphone or PayPal Sandbox trial.

## Residual risks

- The restart check opens a second application connection in the same test
  process. It proves database and signed-proof persistence, not recovery from a
  power loss or a real multi-process deployment.
- SQLite writes are synchronous in this single-node implementation. No claim is
  made about concurrent writers across hosts.
- No physical appliance, acoustic spoofing, genuine PayPal 7.0 capture, public
  webhook, or independent reviewer has been observed in this workstream.
- The stranger-comprehension and assistive-technology checks belong to #6 and
  remain manual/external.
