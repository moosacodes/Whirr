# Whirr 4.0 — submission explanation

## Short description

**Whirr Bench turns an ordinary shared workshop tool into a pay-per-use service by listening to it.** No lock, dongle or firmware. A browser hears the tool run, bills only confident running minutes against a PayPal-authorized cap, and issues a signed receipt that can be checked offline.

## The problem

Shared workshops have useful equipment but weak cost recovery. Hourly bookings charge for setup and conversation. Clipboards rely on memory. Locks and smart plugs require hardware and turn a community tool into an access-control product. A small tool library often cannot justify any of those systems for a $5 use.

## The interaction

1. The steward publishes a **bench card** with a rate, hard cap, calibration age, sound tag and public passport.
2. A member opens the card, reads the terms and authorizes the cap in **PayPal Sandbox**.
3. The browser opens the microphone only after explicit consent. It runs a local 21-feature acoustic classifier and an object-specific sound-tag gate.
4. The **Listening Room** shows a radial field driven by the real eight-band signal, a plain state word, the growing provisional quote and why each interval is billable or free.
5. The member stops and reviews the interval ledger. The quote recomputes from evidence; the cap cannot be exceeded.
6. PayPal captures the reviewed amount, or the session remains explicitly `DEMO_NO_PAYMENT`.
7. The receipt and v3 proof bundle bind terms, intervals, quote, passport and payment state. Integrity verifies offline; sensing and settlement are separate trust domains.

## Why the sound tag is not security theatre

The sound tag is an eight-band profile learned from the object’s calibration takes. It is used conservatively: a confident active frame that falls outside the enrolled profile becomes `UNCERTAIN` and free. It cannot turn idle or ambiguous time into a bill.

It is **not** an identity guarantee. A similar machine can share the profile; playback can fool any microphone. The UI and the proof say this directly. The point is not to claim a microphone is a lock. The point is to make a useful, bounded usage claim that a shared, supervised venue can act on.

## Why PayPal is essential

PayPal supplies the commercial boundary the acoustic system cannot:

- the renter authorizes a ceiling before sensing begins;
- the app cannot capture more than the reviewed quote and consented cap;
- the capture is a separate, authoritative provider state;
- failure, expiry, denial, void and refund are visible states rather than a local success flag.

A screenshot of a fake payment would add nothing. The Sandbox flow and the receipt’s payment domain are what make the physical claim payable.

## Technical credibility

- **On-device sensing:** 16 kHz AudioWorklet, 21 frozen features per 32 ms frame; raw audio is never uploaded.
- **Local model:** deterministic multinomial logistic regression trained in this repository; no cloud AI call.
- **State policy:** precision-first EMA and hysteresis; four states; free uncertainty.
- **Pricing:** integer minor units, one half-up rounding at the end, hard cap, credits only reduce.
- **PayPal:** Orders v2 authorization, partial capture, void, refund, reconciliation, idempotency and webhook signature verification. Sandbox host allowlist.
- **Evidence:** interval evidence hashes, session evidence root, hash-chained audit log, signed v1/v2 receipts, v3 Merkle proof bundles, redacted public bundles.
- **Verification:** in-app semantic verifier, CLI pinning and a standalone single-file offline verifier.
- **Backward compatibility:** v1/v2 evidence remains readable; v3 bundle format is additive; schema 3 is additive.

## What is demonstrated

- The full local product loop with the **synthetic reference fan**, clearly labelled as synthetic.
- A genuine historical **PayPal Sandbox** authorization/capture, preserved with provider IDs and amount.
- Offline proof verification and tamper rejection.
- Responsive bench and Listening Room surfaces at desktop, tablet and phone widths.
- Explicit open gates for real-object trials, public webhook ingress, public submission and comprehension testing.

## What is not demonstrated

- Field accuracy on a physical object. The bundled metrics are synthetic.
- Gate A: three genuine live ON/OFF trials reviewed on a real object.
- Gate E: a genuine PayPal-signed webhook delivered over public HTTPS.
- Five-person comprehension results.
- A production payment model for sub-$0.50 sessions.
- A public repository, video or Devpost submission from this checkout.

## Commercial hypothesis

Start with supervised community workshops that already lend a small set of motorised tools. Charge the steward a platform fee per settled session or a monthly bench fee. The member benefits from access without a half-day booking minimum; the steward gets cost recovery and interval evidence.

This is a hypothesis. No customer traction, savings or willingness-to-pay figures are claimed. Tiny per-use captures may be economically irrational after provider fixed costs; the current release is better suited to sessions with a meaningful expected charge. Aggregation and membership settlement are future work.

## Closing

Whirr’s category bet is that **physical use can become a portable, payable fact without modifying the object**. The acoustic evidence is bounded, the money is capped, and the proof says what it cannot know. That combination is the product.
