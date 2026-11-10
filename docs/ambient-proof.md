# Ambient proof

## Schema

`whirr.ambient-proof.v1`, signed inside the existing `whirr.signed.v2` ECDSA P-256 envelope.

Implementation:

- `packages/protocol/src/ambient-proof.ts`
- `packages/verify/src/ambient.ts`
- `packages/ambient-engine/src/evaluator.ts`
- `apps/api/src/domain/ambient.ts` (`ambientProof`)
- Public route: `GET /api/ambient/proofs/:proofId`

## Payload

- Proof and session IDs.
- Buyer and provider pseudonymous references.
- Target object.
- Agreement id, revision, exact terms, and terms hash.
- Bound model identity and digest.
- Session timestamps, demo flag, observation mode.
- Interval observations and their hash.
- Full deterministic evaluation.
- Evidence root.
- Buyer/provider consent timestamps and hashes.
- Human acceptance.
- Payment mode, state, order/authorization/capture/void IDs, provider status, captured amount, currency, and provider-lookup status.
- Seven trust-domain statements.
- Limitations and attestation.

The proof does not contain raw audio.

## Trust domains

| Domain | What can be checked |
| --- | --- |
| `INTEGRITY` | Signature and payload hash. |
| `SENSOR_PROVENANCE` | The browser/device description and the absence of independent attestation. |
| `SOURCE_INFERENCE` | Bound model identity and evaluation; not machine identity. |
| `TEMPORAL_EVALUATION` | Replayed baseline, continuity, interval, and outcome. |
| `HUMAN_ACCEPTANCE` | Buyer acceptance record and ordering. |
| `FINANCIAL_OUTCOME` | Internal consistency with the provider reference; current PayPal state is not queried by the offline verifier. |
| `REAL_WORLD_TRUTH` | Explicitly not claimed. |

## Independent verifier checks

1. Installation signature and embedded key identifier.
2. Ambient proof schema.
3. Executable agreement shape.
4. Recomputed agreement terms hash.
5. Model identity, version, revision, and evaluation hash agreement.
6. Recomputed observation-ledger hash.
7. Independent temporal replay against the same terms and stop time.
8. Evidence-root recomputation.
9. Capture eligibility follows the replayed outcome.
10. Buyer/provider consent hashes, timestamps, and observation ordering.
11. Human acceptance required for a capture-eligible result.
12. Payment mode, currency, ceiling, capture, and state consistency.
13. All seven trust domains present.
14. No raw audio in the proof.

The standalone `npm run proof:verify` wrapper also supplies the generic signed-envelope check. A successful run therefore prints **15 PASS lines**: the 14 Ambient checks above plus envelope validation. The public API's `verification.checks` array contains the 14 Ambient checks.

The verifier does not trust a stored `success: true` field or a UI badge. A failed condition can still be a valid proof of the failed outcome: the signature and contract checks can pass while `QUALIFIED` did not.

## Tamper behavior

Tests mutate signed payloads and expect failure, including:

- changing an observation state;
- changing the amount;
- changing the agreement;
- substituting the model;
- removing evidence;
- altering the final hash.

Any mutation invalidates the signature; some consistency mutations can also fail independent replay even if a new signature were somehow produced by a compromised key.

## Public redaction

The public proof page shows:

- interval states and confidence;
- exact terms and hashes;
- evaluation checks and outcome;
- consent ordering;
- payment references/status where present;
- limitations.

It does not show raw audio or the buyer’s real identity. The buyer’s requested text is shown because it is part of the agreement and may contain sensitive context; public sharing should be a deliberate action.

## What the proof does not establish

- That the microphone was honest.
- That the room was silent.
- That the enrolled source was physically powered off.
- That the provider had authority or caused the change.
- That the buyer and provider are legally identified.
- That PayPal currently holds the stated state, unless a fresh provider lookup is performed.
- That a past capture is refundable or dispute-free.
- That the product is safe or legally compliant.

## Demo proof status

The seeded reference proof uses a synthetic model and synthetic interval ledger. It is labelled `SYNTHETIC_REFERENCE` and `DEMO_NO_PAYMENT`. It demonstrates signing and independent recomputation, not a physical trial or a genuine Sandbox settlement.

**Physical proof: OPEN.**
**Genuine 7.0 Sandbox settlement proof: OPEN.**
**Genuine signed webhook evidence: OPEN.**
