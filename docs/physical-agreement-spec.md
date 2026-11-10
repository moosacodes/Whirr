# Physical agreement specification

Schema namespace: `whirr.physical-agreement.v1`
Default revision: `1`

The agreement is a small executable policy, not a general legal contract. It is canonicalised and hashed. The server stores the exact terms snapshot with every execution so a retrained model or edited price cannot silently alter an approved promise.

## Required fields

| Field | Meaning |
| --- | --- |
| `serviceName` | Human-readable name of the offered service |
| `objectId`, `objectName` | Physical object and display name |
| `eventModel` | Model id, version, digest, status, dataset digest, provenance |
| `requiredSequence` | Exactly `IDLE`, `START`, `RUNNING`, `EXPECTED_STOP` in revision 1 |
| `constraints.minRunMs` | Minimum sustained confident active time |
| `constraints.maxRunMs` | Maximum accepted single run |
| `constraints.maxObservationGapMs` | Largest allowed gap in the upload ledger |
| `constraints.confidenceFloor` | Minimum confidence for acceptable evidence |
| `constraints.sensorContinuity` | Disconnection forbids capture |
| `constraints.noUncertainInterval` | Uncertain evidence forbids capture |
| `constraints.singleCycle` | A restart or second run forbids capture |
| `constraints.requireIdleBaseline` | At least one second of idle before the first run |
| `financial.currency` | USD in this release |
| `financial.fixedPriceMinor` | Integer minor units, exact price |
| `financial.maximumChargeMinor` | Hard ceiling; equal to the fixed price in revision 1 |
| `financial.authorizationExpiryMinutes` | Buyer authorization window |
| `policies.failure`, `uncertainty`, `sensorLoss` | `NO_CAPTURE` |
| `policies.humanAcceptance` | `NONE` |
| `evidence` | Reporting states, acoustic-stop distinction flag, plain statement |
| `createdAt`, `expiresAt` | Approval and authorization window |

## Supported language primitives

`OBSERVED_EVENT`, `ORDERED_SEQUENCE`, `MIN_DURATION`, `MAX_DURATION`, `CONFIDENCE_FLOOR`, `SENSOR_CONTINUITY`, `NO_UNCERTAIN_INTERVAL`, `SINGLE_CYCLE`, `REQUIRE_IDLE_BASELINE`, `FIXED_PRICE`, `MAXIMUM_CHARGE`, `FAILURE_POLICY`, `AUTHORIZATION_EXPIRY`, `EXPLICIT_HUMAN_ACCEPTANCE`.

Revision 1 deliberately fixes several primitives rather than exposing a general expression language. That is a safety feature. The implementation does not pretend arbitrary natural-language contracts can safely execute.

## Canonical hash

Terms are serialised with the protocol canonical JSON function and hashed with SHA-256. The same terms produce the same digest in Node and the browser. Any change to price, duration, model digest, policy, or expiry changes the hash.

## Execution state machine

```text
DRAFT
  -> OWNER_APPROVED
  -> PAYMENT_AUTHORIZATION_PENDING
  -> AUTHORIZED
  -> OBSERVING
  -> ELIGIBLE_FOR_CAPTURE | INELIGIBLE | NEEDS_REVIEW
  -> CAPTURE_REQUESTED
  -> CAPTURE_CONFIRMED
```

Alternative terminal states include `VOID_REQUESTED`, `VOID_CONFIRMED`, `EXPIRED`, and `RECONCILIATION_REQUIRED`. Demo executions use `AUTHORIZED` locally with `payment_state = DEMO_MODE`, and capture is refused before PayPal configuration is examined.

## Financial invariants

- No payment is created by the browser.
- A PayPal order is not an authorization.
- A buyer must approve in the PayPal Sandbox interface.
- No capture occurs before server-side re-evaluation of the signed observation ledger.
- No capture exceeds `maximumChargeMinor`.
- No capture from a demo execution.
- No capture after a known authorization expiry.
- No capture when sensor loss, uncertain intervals, extra cycles, or a substituted model is present.
- Payment operations have stable provider request ids. Uncertain provider outcomes become `RECONCILIATION_REQUIRED` rather than a blind retry.

## Versioning

The agreement schema is versioned independently of the portable proof. Revision 1 is intentionally narrow. A new model, price, threshold, or sequence requires a new agreement digest and fresh buyer consent. Historical terms are never rewritten.
