# Ambient agreement specification

**Schema:** `whirr.cooperation-agreement.v1`
**Condition schema:** `whirr.ambient-condition.v1`
**Evaluator:** `whirr-ambient-evaluator-v1`
**Source:** `packages/ambient-engine/src/types.ts`, `compiler.ts`, `evaluator.ts`

## Purpose

The agreement is a typed, immutable description of what the buyer wants observed, what the provider is committing to, how the evidence will be judged, and what financial action is permitted. It is not a chat log and it is not a promise that the physical world matched the model.

## Wish source catalog

`GET /api/ambient` separates two things that must not be conflated:

- `items` are existing Ambient agreement histories for the demo reference or the current buyer.
- `sources` are active objects that an operator has deliberately published and that have a current `READY` `event_models` record. Publication is either a published service (an active price-terms row) or an owner-approved Physical Promise.

A Wish can only be compiled against a listed source. The API rechecks the source, model id, model hash and dataset hash when the buyer creates the immutable offer. An unpublished, revoked, model-less or non-READY object returns `SOURCE_NOT_READY`; it cannot become a negotiable agreement through a crafted object id.

## Agreement fields

| Field | Meaning |
| --- | --- |
| `schema` | Exact agreement schema version. |
| `revision` | Monotonic offer revision, starting at 1. |
| `agreementId` | Stable agreement identity across revisions. |
| `serviceName` | Human label derived from duration and object. |
| `parties.buyerRef` | Pseudonymous buyer reference bound to the renter account. |
| `parties.providerRef` | Pseudonymous provider reference bound to the object owner. |
| `target` | Enrolled object id, display name, and glyph. |
| `eventModel` | Model id, version, hash, status, dataset hash, provenance. |
| `condition` | The bounded temporal rule. |
| `financial` | Currency, fixed price, maximum charge, authorization expiry. |
| `policies` | No automatic capture; no capture on failure, uncertainty, or sensor loss; buyer acceptance required; failed agreement voids authorization. |
| `interpretation` | Requested text, desired condition, observable proxy, disclosures, assumptions, limitations, unsupported claims. |
| `evidence` | Explicit statement that interval states and hashes are stored, raw audio is not. |
| `createdAt`, `expiresAt` | Offer/agreement validity window. |

All money is represented in integer minor units. The prototype supports USD and a positive fixed price, with `maximumChargeMinor === fixedPriceMinor`.

## Conditions

The only executable condition is:

```text
ENROLLED_SOURCE_INACTIVE
```

Its fixed semantics are:

- `requiredBaselineActiveMs`: 3,000 ms of confident active detection before the quiet interval.
- `requiredInactiveMs`: 10,000–120,000 ms, normally 30,000 ms.
- `confidenceFloor`: 0.60 by default.
- `maxObservationGapMs`: 2,500 ms.
- `observationMode`: `BROWSER_MICROPHONE`.
- `sensorContinuity`: `REQUIRED`.
- `baselinePolicy`: `REQUIRE_ACTIVE_BASELINE`.
- `interruptionPolicy`: `RESET_QUALIFYING_WINDOW`.
- `uncertaintyPolicy`: `RESET_QUALIFYING_WINDOW`.
- `startWindow`: not before the compiled time; not after the terms expiry.

“Inactive” means the bound model did not detect the enrolled source. It never means the room was silent, the machine was unplugged, or the provider caused a change.

## Offer state machine

```text
DRAFT
  └─ buyer sends offer ──> OFFERED
                            ├─ provider accepts ──> PROVIDER_ACCEPTED
                            │                         └─ buyer accepts ──> ACCEPTED
                            ├─ provider counters ──> COUNTERED
                            │                         ├─ buyer accepts ──> ACCEPTED
                            │                         └─ buyer rejects ──> REJECTED
                            ├─ provider rejects ──> REJECTED
                            ├─ buyer withdraws ──> WITHDRAWN
                            └─ expiry ──> EXPIRED
```

Offer statuses include `OFFERED`, `COUNTERED`, `ACCEPTED`, `REJECTED`, `WITHDRAWN`, `EXPIRED`, and `SUPERSEDED`.

`SUPERSEDED` is mandatory when a new revision is created. The previous revision remains stored and inspectable. No accepted-but-superseded revision can authorize a session or capture.

## Revision invariants

1. A counteroffer carries the original wish text as history, but uses the provider’s explicit negotiated price and duration. It must not silently reparse the old text and undo the counter.
2. The compiler returns a canonical terms hash over the complete terms object.
3. The buyer approves the exact hash currently displayed.
4. The server checks the hash at every subsequent decision and stores a snapshot in the session.
5. A change to price, duration, target, model, observation rule, failure policy, or recipient semantics requires a new revision.
6. The session is bound to both the agreement revision and its hash.
7. The final proof carries the accepted terms and verifies their hash.

## Consent ordering

The verifier checks:

- agreement `createdAt` exists;
- session `acceptedAt` is not earlier than the agreement creation;
- buyer and provider accepted the same exact hash;
- provider consent timestamp exists;
- buyer consent timestamp exists;
- observation started after both consents and after authorization, when an authorization exists;
- observation stopped after it started;
- if the evaluation is capture-eligible, human acceptance exists and is at or after observation stop.

A qualifying synthetic replay may be inspected without a payment, but a live capture cannot proceed without the ordering above.

## Financial terms and invariants

- No order is created before buyer acceptance of the exact final terms.
- No capture without an explicit buyer-approved Sandbox authorization.
- No capture without a qualified deterministic evaluation and buyer acceptance.
- No capture for a demo session.
- No capture above the approved ceiling.
- No capture on currency mismatch.
- No capture for a superseded revision.
- No duplicate capture on retry or restart.
- The provider result, not the UI, determines the recorded financial state.
- A failed or uncertain condition cannot silently fall back to elapsed-time billing.

## Session states

`PAYMENT_PENDING`, `AUTHORIZED`, `OBSERVING`, `QUALIFIED_AWAITING_ACCEPTANCE`, `READY_FOR_CAPTURE`, `CAPTURE_REQUESTED`, `CAPTURED`, `VOID_REQUESTED`, `VOID_CONFIRMED`, `NOT_QUALIFIED`, `BUYER_REJECTED`, `EXPIRED`, `RECONCILIATION_REQUIRED`, `DEMO_COMPLETE`.

Demo sessions are explicitly labelled and use `DEMO_MODE`; they never create an order or call PayPal.

## Failure mapping

| Situation | Contractual result | Financial result |
| --- | --- | --- |
| No active baseline | `NO_BASELINE` | No capture |
| Source resumes during window | `INTERRUPTED`; run resets | No capture |
| Microphone denied or lost | `SENSOR_LOSS` | No capture |
| Confidence below floor / blocking flags | `INSUFFICIENT_EVIDENCE` | No capture |
| Evidence gap too large | `REJECTED` or insufficient | No capture |
| Model hash changed | `REJECTED` | No capture |
| Terms expired before completion | `EXPIRED` | No capture |
| Qualifying but buyer rejects | `BUYER_REJECTED` | Void if authorized |
| Qualifying and buyer accepts | `QUALIFIED` → `READY_FOR_CAPTURE` | Explicit capture may be requested |
| Demo qualifies and is accepted | `DEMO_COMPLETE` | No money |
| Provider outcome uncertain | `RECONCILIATION_REQUIRED` | Reconcile; never blindly retry capture |

## API mapping

| Route | Actor | Purpose |
| --- | --- | --- |
| `POST /api/ambient/compile` | Buyer | Compile a wish into measurable terms or a refusal. |
| `POST /api/ambient/agreements` | Buyer | Create an immutable offer after reviewing the exact hash. |
| `POST /api/ambient/agreements/:id/withdraw` | Buyer | Withdraw an open offer. |
| `GET /api/ambient/agreements/:id` | Participant/inspector | Read scoped terms and role flags. |
| `POST /api/operator/ambient/agreements/:id/respond` | Provider | Accept, reject, or counter. |
| `POST /api/ambient/agreements/:id/decision` | Buyer | Accept/reject the final revision. |
| `POST /api/ambient/agreements/:id/sessions` | Buyer | Open a demo or live session. |
| `POST /api/ambient/sessions/:id/start` | Buyer | Begin observation after authorization. |
| `POST /api/ambient/sessions/:id/observations` | Buyer | Upload interval states, not raw audio. |
| `POST /api/ambient/sessions/:id/stop` | Buyer | Evaluate the stored ledger. |
| `POST /api/ambient/sessions/:id/order` | Buyer | Create a Sandbox order. |
| `POST /api/ambient/sessions/:id/authorize` | Buyer | Confirm the provider authorization server-side. |
| `POST /api/ambient/sessions/:id/acceptance` | Buyer | Record human acceptance/rejection. |
| `POST /api/ambient/sessions/:id/capture` | Buyer | Request capture if every gate is satisfied. |
| `POST /api/ambient/sessions/:id/void` | Buyer | Void an authorization. |
| `GET /api/ambient/sessions/:id/proof` | Buyer | Create/refresh signed proof. |
| `GET /api/ambient/proofs/:proofId` | Public | Verify a redacted proof. |
| `GET /api/ambient/judge` | Public | Judge replay index. |
| `GET /api/ambient/judge/sessions/:id` | Public | Read-only labelled replay. |

## What the agreement does not establish

It does not establish who was physically present, whether the machine was powered off, whether the room was silent, whether the provider had legal authority, or whether money was actually captured without a provider-confirmed transaction.
