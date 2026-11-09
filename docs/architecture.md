# Architecture

Whirr is a single-host, local-first application. A browser senses and classifies sound; a Fastify service owns identity, evidence validation, billing, PayPal orchestration and receipts; SQLite is the system of record. There is no cloud ML, no queue service and no paid infrastructure.

## 1. Design constraints

1. **The object is not modified.** Sensing is acoustic and external.
2. **The client is not trusted for money.** The browser may predict states, but the server validates interval shape, order, model version, token, ownership and session clock before accepting evidence.
3. **Ambiguity is free.** Only `ACTIVE_CONFIDENT` intervals are billable. `IDLE`, `UNCERTAIN`, `DISCONNECTED` and malformed intervals contribute zero.
4. **A payment is a provider fact.** A capture is `CAPTURE_COMPLETED` only after PayPal returns a completed capture whose amount and currency reconcile with the reviewed quote.
5. **Demo is a first-class, labelled mode.** Missing credentials never produce a simulated provider success.
6. **Evidence is inspectable.** Every accepted interval gets a hash, the session gets an evidence root, and the receipt can be re-verified against stored state.
7. **The passport is a fairness gate, not identity proof.** A successful spectral match can keep activity billable; a mismatch can only turn it into free uncertainty. It never creates a charge.

## 2. Runtime topology

```text
Browser (React 19 + Vite)
  microphone ──► AudioWorklet (16 kHz) ──► 21 features / 32 ms
                                            │
                            frozen model ──►│ multinomial logistic regression
                                            ▼
                              soundprint ──►│ passport consistency gate
                                            ▼
                                   hysteresis + 4-state meter
                                            │
                          sealed intervals  │  (no raw audio)
                                            ▼
Fastify API (Node 24)  ◄──────────── signed session token, CSRF, cookies
  ├─ auth / ownership / rate limits
  ├─ interval validation + billing engine
  ├─ session lifecycle + disputes + credits
  ├─ receipt builder + audit hash chain
  ├─ PayPal Sandbox client (Orders v2 / Payments v2)
  ├─ webhook signature verification + reconciliation outbox
  └─ SQLite (node:sqlite, WAL, foreign keys)
                                            │
                                            ▼
                              PayPal Sandbox (external, optional)
```

In development Vite proxies `/api` to the API. In production `npm run build` emits static assets and the API can serve `apps/web/dist` itself. Both bind to loopback by default.

## 3. Packages and responsibilities

### `packages/audio`

- `spec.ts` freezes the feature contract: 16 kHz, 2048-sample window, 512-sample hop, 21 features, quality flags and frame duration. Models pin `whirr-features-v1`.
- `features.ts` implements RMS, zero-crossing rate, spectral centroid/spread/rolloff/flatness/flux, crest factor, dominant frequency, harmonic ratio, eight band energies, spectral slope, peak and low/high ratio.
- `classifier.ts` defines the model artifact schema and three-class (`idle`, `active`, `other`) inference. It loads the optional `soundprint` artifact and attaches a match score/mismatch flag to each frame.
- `soundprint.ts` builds an amplitude-invariant band profile from calibration frames, chooses a conservative match threshold, and computes live cosine similarity. `SOUNDPRINT_MISMATCH` is a disqualifying quality flag.
- `hysteresis.ts` is the streaming state machine. It smooths probabilities, requires consecutive strong frames to enter `ACTIVE_CONFIDENT`, requires consecutive idle evidence to leave, and marks weak/clipped/silent/low-level frames `UNCERTAIN`. Uncertainty splits an active run so ambiguous time cannot be billed inside it.
- `training.ts` standardises features, trains balanced multinomial logistic regression with full-batch gradient descent and L2, tunes the active threshold against leave-one-take-out predictions, compares against a tuned log-RMS baseline, and assigns a READY / LIMITED / REJECTED gate.
- `wav.ts`, `resampler.ts`, `fft.ts` support deterministic offline training, replay and tests.

### `packages/meter`

- `intervals.ts` sorts and unions intervals, rejects invalid or overlapping input, and sums exclusive duration by state.
- `currency.ts` validates currencies and converts decimal provider strings to integer minor units without floating-point money arithmetic.
- `pricing.ts` performs the only rounding operation: `floor((rate × billableMs + 30 000) / 60 000)` (half-up), then applies the cap and credits. It also enforces safe integer ranges and PayPal amount limits.

### `packages/contracts`

Zod schemas validate every mutation body (object creation, take upload, terms, consent, intervals, review, disputes, credits, refunds, operator login). Shared view types are imported by both API and web.

### `apps/api`

Domain modules own one concern each:

| Module | Responsibility |
| --- | --- |
| `domain/objects.ts` | Objects, calibration takes, local training, terms publication, model artifacts, revocation, purge |
| `domain/sessions.ts` | Create/consent/start/pause/resume/stop, interval acceptance, quote hashing, review, disputes, credits |
| `domain/payments.ts` | Order creation, authorization, capture, void, refund, reconciliation, demo completion |
| `domain/receipts.ts` | Receipt assembly, passport mismatch summary and independent verification |
| `domain/webhooks.ts` | Signature-verified ingestion, deduplication, reconciliation, outbox drain |
| `domain/judge.ts` | Live readiness gates derived from database, files and provider config |
| `lib/auth.ts` | Signed operator and renter cookies, ownership helpers, hashed request metadata |
| `lib/audit.ts` | Append-only, hash-chained audit events with verification |
| `db/` | SQLite connection, WAL/foreign keys and schema |

### `apps/web`

- `lib/audio.ts` owns microphone permission, AudioWorklet loading, resampling and WAV parsing.
- `lib/meter-controller.ts` batches sealed intervals, has monotonic sequence numbers, detects pauses/visibility/device loss, and enforces a local cap stop. The server remains authoritative.
- Pages cover the required surfaces: Studio, Capture Lab, Model Review, Acoustic Passport, Pricing, Service Card, Renter Consent, Live Session, Review, Receipt, Operator Console, Judge and Offline Demo. The passport page is public and unauthenticated; the live session shows the current score and mismatch state. Its `PassportProbe` component runs a local-only live comparison: no session token, no API write and no upload.

## 4. Session lifecycle

```text
CREATED → CONSENTED → PAYMENT_PENDING → READY → ACTIVE ↔ PAUSED
   │            │              │            │        │
   │            └── demo ──────┘            │        └──► STOPPED
   └── abandoned                            └──────────► STOPPED
STOPPED → REVIEWED → SETTLEMENT_PENDING → SETTLED
                              │              └──► NO_CHARGE
                              └──► FAILED / UNRESOLVED
```

Key rules:

- A session pins the object, owner, renter, terms row/hash, model row/hash, rate, cap and currency at creation. Publishing new terms or training a new model does not mutate an existing session.
- Consent stores the exact terms and model hashes, a snapshot, timestamp, IP hash and user-agent hash.
- Start requires consent **and** either an authoritative Sandbox authorization for the consented cap or explicit demo mode.
- Pause records a reason and start timestamp; resume adds the paused duration so meter time excludes it. A hidden tab, device loss or fatal sensor error triggers a pause attempt and stops local batching.
- Stop closes the ledger, computes the quote once, hashes the quote and interval segments, and moves to `STOPPED`.
- Review acceptance must present the current quote hash. A changed quote invalidates the prior acceptance.
- LIMITED models publish `billingPolicy: OPERATOR_REVIEW`; capture requires operator approval of the reviewed amount.
- Settlement is idempotent: a completed capture returns the existing view, and duplicate/retried requests reuse a stable provider request ID.

## 5. Evidence and interval validation

The browser sends batches shaped like:

```json
{
  "token": "signed session token",
  "clientSeq": 4,
  "intervals": [
    {
      "startMs": 12032,
      "endMs": 15488,
      "state": "ACTIVE_CONFIDENT",
      "confidence": 0.974,
      "qualityFlags": [],
      "modelVersion": "ref-fan-v1"
    }
  ]
}
```

The server verifies the signed token belongs to the session's renter and pinned hashes, enforces strictly increasing `clientSeq`, rejects replayed batches with different content, rejects gaps/overlaps/invalid times, bounds intervals by the authoritative session clock (with a small bounded grace for in-flight batching), pins the model version, and recomputes all totals. Repeated identical batches return a duplicate acknowledgement rather than appending twice.

Each accepted interval receives a SHA-256 hash over its schema, session, sequence, state, model version, confidence bucket and sorted quality flags. The session evidence root hashes the ordered interval hashes together with terms/model hashes and billable duration. This detects later mutation relative to the stored checkpoint. It is **integrity evidence, not proof that the microphone heard physical truth**.

The model artifact also carries an optional `whirr.soundprint.v1` profile. The live browser compares each confident active frame with the enrolled active band shape; below the stored threshold, `predictFrame` adds `SOUNDPRINT_MISMATCH`, which hysteresis treats like any other disqualifying flag. The server never recomputes audio and never turns the passport into an amount. The public passport endpoint exposes only object metadata, model status, terms, the profile and its calibration-fit statistics.

The public passport page can also run a probe without a session: it opens the microphone on a click, keeps an 18-frame rolling median of `soundprintScore` in React state and stops on cancel, timeout, disconnect or unmount. No interval, token or feature vector is sent to the API. Receipt generation independently summarises `SOUNDPRINT_MISMATCH` intervals and their free duration; independent verification recomputes that summary from the stored interval rows.

## 6. Billing policy

For rate `r` minor units per minute and billable duration `d` ms:

```text
numerator = r × d
rounded   = floor((numerator + 30 000) / 60 000)   // half-up, once
capped    = min(rounded, consentedCapMinor)
final     = max(0, capped − creditMinor)
```

- Duration is the union of `ACTIVE_CONFIDENT` intervals; overlapping or duplicate intervals are rejected before summation.
- Credits (dispute resolutions or goodwill) can only reduce the bill.
- A zero final amount cannot be captured. With a live authorization it is voided; in demo mode it is completed as a no-charge demo.
- Capture amount is recalculated server-side from stored intervals and pinned terms, then compared to the reviewed quote hash. The client never supplies the final amount.
- Provider capture amount and currency must match the final quote before `SETTLED`.

## 7. PayPal orchestration

1. `POST /api/sessions/:id/paypal/order` creates an Orders v2 order with `intent: AUTHORIZE` for the consented cap, stable `PayPal-Request-Id`, and return/cancel URLs validated against configured public origins.
2. The buyer approves in the official Sandbox UI.
3. `POST /api/sessions/:id/paypal/authorize` reads the order, authorizes it if needed, fetches the **authoritative authorization**, checks status `CREATED` and exact amount/currency, and stores the authorization ID.
4. After stop/review, `POST /api/sessions/:id/capture` performs a Payments v2 capture with `final_capture: true`, the final reviewed amount and a stable request ID.
5. `COMPLETED` captures are reconciled by amount and currency. `PENDING` captures queue an outbox reconciliation. Denied/failed captures remain unpaid and never become `SETTLED`.
6. Zero bills use `POST /api/sessions/:id/void`, followed by an authoritative `GET` confirming `VOIDED`.
7. Refunds are operator-only, bounded by the captured amount, and recorded as provider resources.
8. `GET /api/sessions/:id/paypal/status` is read-only and returns the recorded provider-backed identifiers/status. An explicit `POST /api/sessions/:id/paypal/reconcile` performs authoritative provider reads; live pages call it only after a user action or payment return, so a GET cannot trigger settlement or provider traffic.

A provider timeout after a request may leave an unknown outcome. The operation row is marked `UNKNOWN`; reconciliation by stored provider IDs resolves it. A retry reuses the stable request ID and never creates a second intentional capture.

## 8. Webhooks and outbox

- `POST /api/paypal/webhook` reads the raw JSON body, validates the PayPal Sandbox certificate host and `SHA256withRSA`, then calls PayPal's `verify-webhook-signature` endpoint with the configured webhook ID and transmission headers before treating the event as authoritative.
- Invalid signatures return 400 and are audited with a truncated payload. A valid retry may replace an unverified event-id reservation; a verified ID with a different payload is a conflict. Duplicate verified events with the same payload return a duplicate acknowledgement.
- Provider webhooks only trigger authoritative reconciliation; they never directly command a charge.
- A verified event is never treated as a command to charge. It is used to find the session and call `reconcileSession`, which reads authoritative provider state.
- Events that cannot yet be reconciled are queued in the SQLite outbox with exponential backoff. `POST /api/operator/outbox/drain` drains pending work; the operator console exposes the same action.
- Webhook ingress requires `PAYPAL_WEBHOOK_ID`. Without it the receiver returns 503; polling remains available.

## 9. Identity and access control

| Actor | Credential | Scope |
| --- | --- | --- |
| Operator | Local key exchanged for a signed, HTTP-only, same-site cookie | All objects/sessions in this installation; approve reviews, credits, refunds, outbox |
| Renter | Random server-created identity in a signed, HTTP-only cookie | Only sessions created by that renter; cannot read another renter's session (404) |
| PayPal | OAuth client credentials, server only | Sandbox REST API |
| Webhook | PayPal transmission headers + configured webhook ID | Ingest only; cannot mutate arbitrary sessions |

All non-GET requests except the webhook require `x-whirr-csrf: 1`, a same-origin `Origin` when present, and `Sec-Fetch-Site` of `same-origin`/`none`. The API sets a restrictive CSP, denies framing, limits body size, sets `no-store` on API responses, rate-limits globally and per sensitive operation, and returns Fastify 4xx statuses without leaking internal errors. Cookies are `Secure` when the primary public origin is HTTPS; production refuses plaintext non-loopback origins and requires an explicit public origin on a non-loopback host.

## 10. Database

SQLite in WAL mode with foreign keys. Tables:

`app_meta`, `users`, `objects`, `calibration_takes`, `model_versions`, `price_terms`, `sessions`, `session_consents`, `observed_intervals`, `session_pauses`, `payment_operations`, `paypal_resources`, `paypal_webhook_events`, `settlement_receipts`, `disputes`, `audit_events`, `outbox`.

Notable constraints and invariants:

- Unique `(object_id, version)` and `(object_id, terms_hash)` for terms; unique model version/hash per object.
- Unique `(session_id, seq)` on intervals; unique `(session_id, operation_type)` on payment operations; unique event ID on webhooks.
- Minor units and interval bounds are `CHECK`-constrained non-negative/positive.
- Audit events are append-only and hash-chained; verification reports the first broken link.
- Receipts are stored as canonical JSON plus SHA-256.

## 11. API surface

Public/read:

`GET /api/health`, `GET /api/auth/session`, `GET /api/service/:objectId`, `GET /api/passport/:objectId`, `GET /api/judge/status`, `GET /api/judge/checks`, `GET /api/sessions/:id/model`.

Operator:

`POST /api/auth/operator`, `POST /api/auth/operator/logout`, `GET/POST /api/operator/objects`, `GET /api/operator/objects/:id`, `GET /api/operator/objects/:id/model-artifact`, `POST /api/operator/objects/:id/revoke`, `POST/DELETE /api/operator/objects/:id/takes[/:takeId]`, `POST /api/operator/objects/:id/purge-calibration`, `POST /api/operator/objects/:id/train`, `PUT /api/operator/objects/:id/terms`, `GET /api/operator/overview`, `POST /api/operator/sessions/:id/approve-review`, `POST /api/operator/sessions/:id/credit`, `POST /api/operator/sessions/:id/refund`, `POST /api/operator/disputes/:id/resolve`, `POST /api/operator/outbox/drain`.

Renter/session:

`POST /api/auth/renter`, `POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/consent`, `POST /api/sessions/:id/demo-mode`, `POST /api/sessions/:id/paypal/order`, `POST /api/sessions/:id/paypal/authorize`, `GET /api/sessions/:id/paypal/status`, `POST /api/sessions/:id/paypal/reconcile`, `POST /api/sessions/:id/start|pause|resume|stop`, `POST /api/sessions/:id/intervals`, `POST /api/sessions/:id/review/accept`, `POST /api/sessions/:id/capture`, `POST /api/sessions/:id/void`, `POST /api/sessions/:id/demo-complete`, `POST /api/sessions/:id/disputes`, `GET /api/sessions/:id/receipt[/verify|/export]`.

Webhook: `POST /api/paypal/webhook` (raw body, no CSRF header, signature verified).

## 12. Operational limits

- Designed for a single host, one operator namespace and modest concurrency. SQLite WAL is appropriate for a local demo; it is not a horizontally scaled SaaS design.
- Billing assumes one active session per object; the application enforces the object service lifecycle but does not implement a distributed lock across multiple API processes.
- The browser must stay open and visible. Background sensing is not claimed. Sleep, tab suspension and device loss stop accrual and leave explicit gaps.
- No camera fusion is implemented. The PRD treats it as a stretch; audio-only behaviour is the tested path.
- No public deployment or tunnel is provisioned. If one is added, only the webhook path should be exposed publicly; operator routes must stay private.
- No email, SMS, background job runner or external database. The outbox is drained by the operator or webhook reconciliation request.

## 13. Scaling path (not implemented)

A production design would separate the API from a durable job runner, use PostgreSQL with row-level ownership and transactional locks per object, put webhook ingestion behind a dedicated minimal receiver, store raw evidence in an append-only object store with retention policy, and add independent telemetry. None of that is claimed here, and none is required for the local reproducible demo.
