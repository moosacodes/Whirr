# Ambient financial policy

## Environment

- PayPal **Sandbox only**.
- No Live endpoint or real-money transaction.
- Integer minor units.
- One fixed price per agreement; `maximumChargeMinor === fixedPriceMinor`.
- One configured Sandbox merchant/operator account.
- No marketplace split, provider payout, card vault, or stored payment method.

## Lifecycle

```text
agreement accepted by both parties
        ↓
buyer creates Sandbox order
        ↓
buyer approves through PayPal
        ↓
server confirms authorization
        ↓
observation may begin
        ↓
deterministic evaluation
        ↓
buyer accepts qualifying result
        ↓
explicit capture request
        ↓
provider capture result
        ↓
reconciliation and Accord
```

A demo session skips every payment step. It uses `DEMO_MODE` and cannot create an order or call capture.

## Mandatory invariants

1. No capture without explicit buyer financial approval.
2. No capture for an unaccepted, rejected, withdrawn, expired, or superseded offer.
3. No capture from an ambiguous observation.
4. No capture when required human acceptance is missing.
5. No capture after the known authorization expiry.
6. No amount greater than the accepted ceiling.
7. No currency mismatch.
8. No duplicate capture after retry.
9. No duplicate capture after a process restart.
10. No repeated capture because a webhook arrives twice.
11. No capture from forged or unverified webhooks.
12. No status promotion from a client-side success animation.
13. No capture because the microphone stopped producing data.
14. No hidden amendment of observation criteria after consent.
15. No automatic charge for a rejected cooperation window.
16. No PayPal Live environment access.
17. No unauthorized recipient substitution.
18. No silent fallback to elapsed-time billing when condition verification fails.

## Idempotency and durable operations

- Every order, authorization, capture, and void has a durable payment operation row.
- Provider request IDs are derived from stable values (session, terms hash, authorization, amount).
- Capture eligibility is rechecked immediately before the provider call.
- The stored evaluation is independently replayed before capture.
- The server does not trust a client-supplied price or capture amount.
- A duplicate request returns the existing provider reference or a non-capturing conflict.
- A demo session is refused before any provider code runs.

## Uncertain provider outcomes

If the provider call returns an unknown or transport error:

- the operation is not blindly retried;
- the session moves to reconciliation/unknown handling;
- the provider is queried for the stored order, authorization, or capture;
- a second capture is not issued until the first outcome is known;
- the Accord records what is actually confirmed.

This is defensive behavior, not a claim that every distributed failure is solved.

## Webhooks

Implemented:

- raw-body signature verification when configured;
- event ID and payload-hash conflict checks;
- read-only reconciliation;
- duplicate detection;
- outbox retry with exponential backoff;
- matching only through stored order/authorization/capture IDs;
- no capture or void initiated by a webhook.

A webhook can confirm a provider state. It cannot create financial authority.

**Genuine webhook status:** OPEN. No authentic 7.0 PayPal-signed event has been delivered to this installation.

## Provider-confirmed capture

A capture is recorded as `CAPTURED` only when:

- the provider reports `COMPLETED`;
- currency matches the accepted terms;
- captured amount equals the fixed price and does not exceed the ceiling;
- the stored evaluation replays;
- the buyer accepted the completed result;
- the capture operation amount/currency agree.

Otherwise, the session is marked `RECONCILIATION_REQUIRED` or a non-settled state. Whirr does not claim settlement from a local success screen.

## Void

A qualifying failure or buyer rejection with an existing authorization should be voided where supported. A void is confirmed only by the provider response. An uncertain void outcome is reconciled and is not converted into a capture.

## Refunds

Ambient 7.0 does not expose a refund workflow. A post-capture dispute would require an out-of-band process or a future implementation. The existing 4.x refund code is preserved but is not Ambient evidence.

## Merchant truth

The configured Sandbox merchant is the operator account. If the person controlling the machine is not that merchant, Whirr does not claim that person received a payout. The Exchange and Accord state “Sandbox merchant / operator.”

## What is not proven by tests

Mocks and provider-contract fakes can establish that the code refuses double capture, amount mismatch, expired authorization, and nonqualifying evidence. They cannot establish that a real Sandbox buyer approved a real authorization or that a real webhook arrived.

**7.0 genuine Sandbox authorization/capture: OPEN.**
**7.0 genuine webhook: OPEN.**
The historical 4.x USD 0.07 capture remains preserved and is not represented as 7.0 evidence.
