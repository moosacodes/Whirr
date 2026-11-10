# Whirr 6.0 - The Physical Promise Engine

Whirr 6.0 asks a different question from a rental timer: **can an ordinary person teach software what a completed physical job sounds like, and make that definition payable without modifying the object?**

The answer implemented here is a vertical slice, not a universal contract platform. It has five linked parts:

1. A browser demonstration studio that records acoustic examples.
2. A small local event model that learns per-demonstration prototypes and refuses unknown or ambiguous sound.
3. A deterministic compiler that turns a narrow English proposal into exact, typed terms.
4. A server-side temporal evaluator that decides whether the observation ledger satisfies those terms.
5. A PayPal Sandbox authorization and capture path that runs only after a qualified evaluation.

The defining interaction is **demonstration to agreement to evidence**. A judge can see the model and terms. The owner can see why a model is READY or LIMITED. The buyer sees the fixed price, duration, failure policy, and the fact that an authorization may hold Sandbox funds. The final proof separates what was observed, inferred, contractually accepted, and financially confirmed.

## Product surfaces

- `/promise` - public catalog, thesis, and trust boundary.
- `/studio/promises` - operator Teaching Room: capture, train, review, compose, compile, approve.
- `/promise/:agreementId` - buyer consent and mode selection.
- `/promise/run/:executionId` - live state-machine observation, microphone-closed state, resolution, capture or void.
- `/promise/proof/:proofId` - independently rechecked portable proof.
- `/promise/:agreementId/model` - public model card and metrics.

The existing Bench, 5.0 discovery experiment, receipts, calibration lab, PayPal Sandbox implementation, historical evidence, and offline verifiers remain in place.

## Who it is for

The clearest early user is not a factory. It is a small equipment owner who wants to sell a **completed observable service**, not a block of clock time: a shared workshop charging for a qualified fan cycle, a kiln owner charging for a witnessed firing cycle, or a repair bench charging for a completed test run. The present build proves the workflow with a synthetic fan reference because no physical field trial has been performed in this checkout.

## Prior art and the actual novelty

Established technology in this build:

- acoustic machine monitoring and sound classification;
- browser audio feature extraction;
- pay-per-use equipment billing;
- outcome-based service contracts;
- PayPal Orders and Payments APIs;
- conditional payment orchestration and idempotency.

Not claimed as inventions: acoustic recognition, machine-to-machine commerce, escrow, conditional payments, or fraud prevention.

The narrower claim is the **user-teachable, no-hardware-modification physical agreement workflow** that joins a locally trained event model, an inspectable temporal contract, a buyer-approved fixed-price authorization, and a portable proof. The model is intentionally small. The contract language is intentionally narrow. The trust boundary is stated rather than hidden.

## Definition of success for this slice

A user can inspect a taught model, read exact terms, consent in the browser, open a real microphone, see stages advance only from evidence, stop early, receive no capture eligibility, and inspect a proof that replays the same rules. A separate execution can qualify and become eligible for a PayPal Sandbox capture. Demo executions never capture.

## Explicit non-goals

- Proving that a physical product was manufactured correctly.
- Proving microphone honesty or preventing replay attacks.
- Universal appliance recognition or identity.
- Escrow, payouts, recurring billing, variable pricing, or refunds inside the agreement language.
- Claiming that synthetic validation is field accuracy.
- Claiming a genuine 6.0 Sandbox capture or webhook when no human has performed one.

## Honest release position

Automated software behavior is checked by unit, integration, browser, build, and audit commands. Physical field validation and genuine 6.0 PayPal Sandbox settlement remain OPEN. See `docs/go-no-go.md`, `docs/field-evaluation-6.0.md`, and `docs/submission-6.0.md`.
