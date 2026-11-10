# PayPal physical settlement

## Scope and boundary

Whirr implements the local observation and agreement policy. PayPal supplies the supported order, authorization, capture, and void mechanisms. Whirr does **not** claim that PayPal provides escrow, universal conditional payments, arbitrary fund release, or a programmable payout engine.

Only PayPal Sandbox is permitted. The configuration rejects live mode. Every amount shown in the product is simulated.

## Flow

```text
buyer chooses PayPal Sandbox
  -> server creates Orders v2 order with fixed ceiling
  -> buyer approves in PayPal Sandbox UI
  -> browser returns to /promise/run/:id?paypal=return
  -> server reads order and authorizes
  -> server verifies authorization amount and currency
  -> buyer starts microphone observation
  -> server stores ordered observations
  -> stop triggers deterministic evaluation
  -> capture is available only for QUALIFIED + AUTHORIZED
  -> server re-evaluates immediately before capture
  -> capture request uses stable request id
  -> provider result is recorded
```

A created order is not treated as an authorization. An authorization is not treated as a capture. A local capture request is not treated as provider settlement.

## State mapping

| Local state | Provider meaning |
| --- | --- |
| `PAYMENT_AUTHORIZATION_PENDING` | No order yet |
| `ORDER_CREATED` | PayPal order exists, buyer not yet authorized |
| `AUTHORIZED` | Provider authorization is `CREATED` and amount matches |
| `CAPTURE_REQUESTED` | Capture request is in flight |
| `CAPTURE_CONFIRMED` | Provider returned a completed capture with matching amount |
| `VOID_REQUESTED` / `VOID_CONFIRMED` | The authorization was voided |
| `RECONCILIATION_REQUIRED` | Provider outcome is unknown or inconsistent |

Demo executions use `DEMO_MODE` and cannot create an order, authorize, capture, or void.

## Idempotency and recovery

- One `promise_payment_operations` row per execution and operation type.
- Stable request ids derived from execution, agreement hash, authorization, amount, and operation.
- Reusing a completed operation returns the provider reference rather than creating a new charge.
- A timeout after a possible provider commit becomes an unknown outcome, not a retry.
- Capture eligibility is recomputed from stored evidence immediately before the request.
- Authorization expiry is checked before observation and before capture.
- Webhook ingestion keeps raw bytes for signature verification. Legacy sessions are resolved first; promise executions are resolved next, using only provider ids already stored by this installation.
- A promise webhook is a trigger for authoritative reads, never a command to capture or void. `reconcilePromiseExecution` calls `GET` on the stored capture, authorization or order.
- A `COMPLETED` capture is confirmed only when its amount and currency match the stored qualified evaluation, the amount is within the approved ceiling, the capture operation agrees, and a deterministic replay of the stored observations reproduces the stored evaluation hash. Otherwise the execution stays `RECONCILIATION_REQUIRED` with no captured amount.
- A `VOIDED` authorization becomes `VOID_CONFIRMED`. A provider that reports the authorization captured without a stored capture id remains `RECONCILIATION_REQUIRED`.
- Failed promise reconciliations are queued as `RECONCILE_PROMISE` in the existing outbox with backoff. The webhook result records `PROMISE_RECONCILED` or `PROMISE_RECONCILIATION_REQUIRED`; it never marks a capture settled by itself.

## What has not been done

No genuine Whirr 6.0 Sandbox order, buyer approval, authorization, capture, void, or webhook has been performed in this checkout. The tests use a provider-contract fake; they are real software tests, not provider evidence. Automated cases cover a matching completed capture, an amount mismatch, nonqualifying stored evidence, a duplicate delivery and a voided authorization.

The historical 4.x capture is preserved in the repository and remains separate evidence. It is not presented as a 6.0 capture.

## Human steps to close the payment gate

1. Provide Sandbox client id and secret through the existing private environment configuration. Never paste them into chat or commit them.
2. Run `npm run dev` and open the published promise.
3. Choose PayPal Sandbox settlement, review the fixed price and failure policy, and approve in the actual Sandbox buyer interface.
4. Confirm the authorization is created before starting the observation.
5. Complete a qualifying attempt with a real or clearly labelled replay source, then request capture only when the UI says eligible.
6. Record the provider order id, authorization id, capture id, amount, status, timestamp, and Sandbox account context in `docs/evidence/` without exposing credentials.
7. Performs an interrupted attempt on a fresh execution and confirm no capture.
8. Configure the webhook endpoint and perform a genuine delivery before claiming webhook verification.
