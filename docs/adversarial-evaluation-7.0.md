# Adversarial evaluation 7.0

## Principle

The most important failure is a **false qualifying physical agreement**: paying because the software treated weak, interrupted, or fabricated evidence as a completed cooperation window.

Tests therefore attack the contract before they celebrate the happy path.

## Test layers

### Engine and oracle

`tests/unit/ambient.test.ts` covers:

- exact continuous qualification;
- interrupted run reset;
- near-final interruption;
- no active baseline;
- sensor loss;
- unknown/low-confidence evidence;
- duplicate/out-of-order/overlapping intervals;
- model digest substitution;
- oversized gaps;
- tamper to a signed proof observation.

A small hand-computed oracle checks expected durations and outcomes instead of asserting the evaluator against itself.

### Lifecycle and scoping

`tests/integration/ambient.test.ts` covers:

- unsupported physical claims are refused before an offer;
- the exact uncompiled claim never reaches a session or payment;
- a provider counteroffer creates a new revision;
- the old revision cannot be accepted;
- buyer acceptance binds to the final hash;
- a new demo replay is populated and qualifies through the stored evaluator;
- a synthetic qualifying ledger records acceptance and produces a verifiable signed proof;
- an interrupted ledger is not qualified and cannot capture;
- demo sessions cannot call capture;
- public judge replays are read-only;
- foreign renters cannot read participant sessions.

### Existing financial and webhook suites

The previous PayPal contract, webhook, promise, and proof suites remain in the same test run. 7.0 does not remove them. They cover provider timeouts, duplicate capture guards, webhook replay/order, amount mismatch, expiry, void, and proof tampering in the earlier flows.

### Browser checks

The browser review covers the four Ambient surfaces, the seeded judge replays, the public Accord/proof page, the buyer flow, and the provider role. A demo replay is labelled; a live page must not animate while the microphone is closed.

## Adversarial cases and expected contract

| Attack/failure | Expected defense |
| --- | --- |
| Altered capture amount | Reject; no provider call or reconciliation-required state |
| Altered terms after acceptance | Hash mismatch; no session/capture |
| Superseded offer reused | Conflict; no authorization |
| Provider impersonation | Operator auth required |
| Buyer impersonation | Renter scope required |
| Duplicate capture request | Idempotent operation or conflict; no second charge |
| Duplicate webhook | Event-id deduplication |
| Reordered webhook | Stored IDs + read-only reconciliation |
| Unknown capture outcome | Reconcile before retry |
| Expired authorization | Refuse; no capture |
| Microphone denied | `SENSOR_LOSS`; no capture |
| Flatline | Blocking quality flag; no capture |
| Source restarts near end | Reset; no qualification unless full run already completed |
| Client omits failed intervals | Gap/sequence validation |
| Client submits duplicate intervals | Overlap/sequence rejection |
| Model changed after consent | `REJECTED`; no capture |
| Buyer rejects result | No capture; void path |
| Demo session capture attempt | Explicit `DEMO_SESSION` conflict |
| Tampered signed proof | Signature failure |
| Tampered observation with re-signed key | Independent replay hashes/outcomes disagree |

## What is not covered

- Real microphone distribution shift and playback spoofing.
- A compromised browser or dishonest operator.
- Real PayPal Sandbox settlement and signed webhook delivery.
- Legal authority, coercion, or interpersonal pressure.
- Multi-device collusion.
- Refund disputes.
- Penetration testing or an independent security audit.

## Current verdict

- **Software contract:** tested and passing in the final release run.
- **Synthetic proof:** signed and independently verifiable; references are clearly labelled.
- **Physical false-qualification rate:** NOT MEASURED. This is the central open research metric.
- **Genuine 7.0 financial safety/success:** NOT OBSERVED. Provider-contract tests do not substitute for a real Sandbox transaction.

A passing local suite is not a claim of field readiness.
