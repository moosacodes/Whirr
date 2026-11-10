# Ambient trust model

## Principle

Whirr does not have one “trusted” state. It separates:

1. observation integrity;
2. sensor provenance;
3. source inference;
4. temporal evaluation;
5. human acceptance;
6. financial outcome;
7. real-world truth.

A valid signature proves that the payload was signed by the installation key and not changed afterward. It does not prove any of the other domains.

## Trust boundaries

| Boundary | What Whirr controls | What it does not control |
| --- | --- | --- |
| Buyer browser | The app can require explicit consent and scope API access. | The user, browser extensions, microphone, clock, or device integrity. |
| Provider browser | The operator can accept/counter with an authenticated session. | The provider’s honesty, authority, or physical actions. |
| Venue object | Enrollment, model binding, object status. | Actual physical presence or power state. |
| Local model | Training data, digest, readiness gate. | Distribution shift, playback spoofing, or source confusion. |
| Server | Evaluation, idempotency, consent ordering, proof signing. | A compromised host or stolen signing key. |
| PayPal | Authoritative Sandbox transaction state. | Real-world fulfillment; Sandbox is not real money. |
| Public verifier | Recomputes the signed document. | Current PayPal state unless a provider lookup is performed. |

## Threats and mitigations

### Coerced agreements

- Both parties see the exact terms.
- Provider decision is voluntary and separately authenticated.
- No capture until buyer acceptance of the result.
- No public bounty or anonymous solicitation.
- Initial scope is invited participants.

Residual risk: a person can still be pressured outside the software.

### Invented nuisance

- No open marketplace.
- No anonymous payment to create and stop a disturbance.
- Provider is bound to the enrolled venue object.
- The product documents the incentive problem instead of claiming to solve it.

Residual risk: a venue could still operate a bad-faith scheme.

### Unauthorized third-party requests

- Buyer and provider are bound pseudonymous references.
- Only the renter who created the offer and the object-owning operator can act.
- Foreign buyers receive not-found scoping.
- Provider acceptance cannot be forged by the buyer.
- Payment recipient is the configured operator merchant, not a client-supplied address.

### Background surveillance

- Microphone opens only through an explicit user action.
- Live state is visible.
- Raw audio is not uploaded.
- No continuous background listening.
- The browser's microphone indicator remains part of the practical control.

Residual risk: a modified client could capture audio outside Whirr. Whirr cannot control the operating system.

### Stale consent

- Offer expiry is stored.
- Terms hash must match at every decision.
- Session stores a terms snapshot.
- A new revision supersedes the old offer.
- The verifier checks consent timestamps and ordering.

### Falsified observations

- Sequence and overlap validation.
- Gap limit.
- Confidence floor.
- Blocking quality flags.
- Model digest check.
- Deterministic evaluator.
- Signed proof with independent replay.

Residual risk: the client can fabricate intervals or replay a recording. The proof makes fabrication *detectable at the ledger boundary only if the ledger changes*; it does not establish sensor honesty.

### Client-side pricing or terms manipulation

- Compiler and terms hash are server-verifiable.
- Session price is snapshotted from accepted terms.
- Capture amount is derived from the session, not from a client amount.
- The server checks the ceiling and currency.
- A superseded revision cannot open a session.

### Provider or buyer impersonation

- Operator login uses a local operator key and an httpOnly session.
- Renter sessions are scoped.
- Actions check actor identity.
- Public judge replays are read-only and labelled.
- The proof uses pseudonymous references, not claimed legal identity.

### Evidence replay

- Session and proof IDs are bound.
- Observation hashes and evidence roots are recomputed.
- A proof cannot be silently reused for a different session.
- The signed payload contains agreement, session, model, and payment identity.

Residual risk: an old valid ledger can be presented as if it were a current physical event if a verifier ignores session time. The verifier checks the stored stop time against the agreement; it cannot know whether the live browser played an old recording.

### Duplicate capture

- Durable payment operation records.
- Provider request IDs derived from session, terms, authorization, and amount.
- Capture is refused unless the stored state is ready.
- Reconciliation resolves uncertain outcomes before retry.
- Duplicate webhooks are detected by event ID and payload hash.

### Webhook abuse

- Raw-body signature verification.
- Event ID deduplication.
- Payload-hash conflict detection.
- Read-only reconciliation; webhooks never initiate capture or void.
- Outbox retry for transient reconciliation.
- Only stored provider IDs are matched.

A genuine signed Sandbox webhook has not been observed in this installation.

### Unauthorized agreement modification

- Canonical terms hash.
- Immutable stored offers.
- Session terms snapshot.
- The verifier checks the agreement hash and revision.

### Persistent monitoring after session end

- Session stop calls the evaluator and closes the live path.
- Collector disconnects on unmount and microphone end.
- The UI does not start capture automatically on reload.
- No background service keeps the microphone open.

## Privacy

- No raw Ambient audio is uploaded or stored.
- No feature summaries are placed in the proof.
- Public proof pages expose interval states, confidence, model identity, hashes, and pseudonymous references.
- The agreement text is buyer-provided and may contain sensitive context; public proof display should be treated accordingly.
- Personal names are not required in the proof.
- Session and proof routes are scoped; only explicitly public judge replay and proof verification are unauthenticated.

## What would require a stronger design

- independent hardware attestation;
- a trusted timestamp authority;
- independent device identities and corroboration;
- a privacy-preserving way to prove a device did not store audio;
- provider identity and payout verification;
- dispute and refund arbitration;
- venue policy and legal authority checks;
- a security audit beyond local dependency and source review.

None of these is claimed as complete.
