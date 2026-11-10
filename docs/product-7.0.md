# Whirr 7.0 — Ambient / The Negotiated World

**Version:** 7.0.0-rc.1
**Branch:** `main`
**Status:** local release candidate and vertical slice, not a field-validated product

## The proposition

Whirr 7.0 reverses the usual commerce sequence. The buyer does not begin by selecting a product. The buyer begins with a condition they need in the physical world:

> “I need 30 seconds without the reference desk fan running while I record a voiceover. I will pay $2.00.”

Whirr narrows that wish to a condition an enrolled acoustic model can actually evaluate. An authorized provider can voluntarily accept, reject, or counter. PayPal Sandbox backs the exact accepted terms. The buyer opens a permitted observation window. A deterministic evaluator decides whether the stored interval evidence satisfied the contract. The buyer must accept a qualifying result. Only then may the system request a supported Sandbox capture.

The defining demonstration is **Quiet Window**: buying a temporary absence of an agreed activity, rather than buying the machine or modifying it.

## The four surfaces

### 1. The Wish

The buyer states the outcome, selects a published source whose object has a current READY event model, names a duration and a fixed offer, and sees exactly what the system will and will not observe. Unpublished, revoked or model-less objects do not appear and cannot be reached by a crafted object id. Unsupported claims such as “make the room completely silent”, “reduce power consumption”, or “guarantee safety” are refused rather than silently reinterpreted.

The result is not a chat transcript. It is a typed agreement with a SHA-256 terms hash, explicit assumptions, an active-baseline requirement, a continuous non-detection interval, a reset policy, and a no-capture rule for uncertain evidence.

### 2. The Exchange

The provider sees the bound object and model digest, the original wish, the measurable interpretation, duration, baseline, confidence floor, price, failure policy, and recipient semantics.

The provider may:

- accept the exact revision;
- reject it;
- send one structured counteroffer with an explicit price and duration.

Every change creates a new immutable revision. The previous offer is marked `SUPERSEDED`. The buyer must accept the exact final hash. A superseded offer cannot be used to open a session or authorize money.

### 3. The Window

The Window visualizes the gradual formation of a qualifying interval. The central ring grows only from stored interval states; it does not loop decorative “AI” animation.

- **ACTIVE** means the bound model detected the enrolled source.
- **INACTIVE** means the bound model did not detect it under the declared conditions.
- **UNKNOWN** means confidence or observability was insufficient.
- **DISCONNECTED** means the sensing stream was lost or failed.
- An active interruption resets the qualifying interval.
- A gap above the approved limit makes the evidence insufficient.
- The microphone is closed unless the user explicitly opens it.
- A demo session is labelled **SYNTHETIC REPLAY** or **DEMO / LIVE** and can never capture money.

The Window deliberately says that a quiet-looking screen is not evidence of physical silence. The evaluator, not the drawing, decides.

### 4. The Accord

The Accord is the cooperation record:

- the original request and approved interpretation;
- the exact immutable revision and terms hash;
- the bound object and model digest;
- the observation interval ledger and evaluation checks;
- what was observed, what was uncertain, and what failed;
- buyer acceptance and consent ordering;
- the Sandbox authorization, capture, or void state;
- an independently recomputed signed proof result;
- a plain-language list of limitations.

The public proof separates installation integrity, sensor provenance, source inference, temporal evaluation, human acceptance, financial outcome, and real-world truth. It does not collapse them into one green “VERIFIED” badge.

## End-to-end flow

1. Buyer compiles a wish against an enrolled object.
2. Buyer reviews the exact measurable interpretation and sends a fixed offer.
3. Provider accepts or counters; every revision is immutable.
4. Buyer accepts the exact final revision.
5. Demo path: a labelled synthetic replay can exercise the evaluator. It creates no order and cannot capture.
6. Live path: the buyer creates a PayPal Sandbox order and approves it; Whirr confirms the Sandbox authorization server-side.
7. The buyer opens the microphone. Interval states are stored; raw audio is not sent to the server.
8. The deterministic evaluator replays the ledger against the accepted terms.
9. If qualified, the buyer must accept the result.
10. If eligible and authorized, the buyer explicitly requests capture. Whirr reconciles the provider response.
11. The Accord records the outcome and the independent verifier recomputes it.

## What changed from 6.0

| 6.0 | 7.0 |
| --- | --- |
| Owner publishes a physical promise; buyer selects it | Buyer initiates a desired condition; provider negotiates whether to supply it |
| Positive physical events (cycles) | Negative space: a known source remains undetected under declared conditions |
| Catalog-first interaction | Wish → Exchange → Window → Accord |
| Price compiled from an owner-defined service | Fixed buyer offer, provider accept/counter, buyer exact-terms approval |
| Existing proof v1 | New signed `whirr.ambient-proof.v1`; prior proof formats remain intact |
| Equipment/event billing | Voluntary cooperation around a temporary environmental change |

The 4.x equipment meter, 4.1 field lab, 5.0 acoustic discovery experiment, 6.0 physical promise engine, historical Sandbox evidence, migrations, and released proof verifiers remain in the tree.

## Supported scope in this release

- One buyer, one provider, one enrolled source.
- One bounded condition: `ENROLLED_SOURCE_INACTIVE`.
- One fixed price in USD minor units, with the same amount as the maximum charge.
- One browser microphone observation stream, or a labelled synthetic replay.
- One Sandbox merchant/operator; no marketplace split or automatic payout to a separate participant.
- Invited, authorized participants. No public nuisance marketplace.

## Explicit non-goals

Whirr 7.0 does **not** claim:

- that a microphone proves silence, power-off, or an empty room;
- that acoustic classification authenticates a machine or a person;
- that the provider caused the machine to stop;
- that a browser or its operator is a trusted witness;
- that the signed proof establishes real-world truth;
- that demo replay is field evidence;
- that a PayPal Sandbox transaction is real money;
- that this installation has completed a physical field trial, a genuine 7.0 Sandbox settlement, a verified webhook delivery, public deployment, user testing, or a Devpost submission.

Those gates remain OPEN in `docs/go-no-go.md`.

## Architecture

- `packages/ambient-engine` — bounded condition types, deterministic compiler, temporal evaluator, hashing.
- `packages/protocol/src/ambient-proof.ts` — signed portable proof payload.
- `packages/verify/src/ambient.ts` — independent recomputation and tamper checks.
- `apps/api/src/domain/ambient.ts` — agreement, negotiation, sessions, observations, payment operations, proof creation, judge data.
- `apps/api/src/domain/webhooks.ts` — provider reconciliation.
- `apps/api/src/routes/index.ts` — public and participant-scoped Ambient routes.
- `apps/web/src/pages/AmbientWish.tsx`, `AmbientExchange.tsx`, `AmbientWindow.tsx`, `AmbientAccord.tsx` — the four surfaces.
- `apps/web/src/pages/AmbientJudge.tsx`, `AmbientProofPage.tsx`, `AmbientOperator.tsx` — judge, public proof, and provider desk.
- SQLite schema version 7 adds Ambient tables without rewriting historical rows.

## Release evidence

The synthetic reference proof is labelled as such. The automated tests establish the contract and verifier behavior. They do not establish physical field accuracy. The only historical PayPal capture in this repository predates 7.0 and is not 7.0 payment evidence.

See `docs/go-no-go.md` for the canonical status of every gate.
