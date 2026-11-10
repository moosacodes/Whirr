# Model card - Whirr 6.0 event model

**Schema:** `whirr.event-model.v1`
**Algorithm:** standardised cosine nearest-prototype classifier with open-set refusal
**Feature contract:** `whirr-features-v1`, 21 features, 32 ms frames
**Reference artifact id:** `evm_promise_reference`
**Reference version:** `promise-ref-v1`
**Reference status:** READY on the local synthetic validation gate
**Provenance:** `SYNTHETIC_REFERENCE`

> The reference model is trained on procedurally synthesised audio in this repository, not on a physical fan. Its metrics are real measurements of the synthetic dataset. They are not field accuracy and must not be presented as evidence that the system works reliably on a real appliance.

## Intended use

- Recognise one taught object's idle and running sound in a supervised observation.
- Reject unrelated background sounds that were demonstrated.
- Supply conservative reporting states to a deterministic agreement evaluator.
- Demonstrate the complete teach, compile, observe, decide, and prove workflow.

## Out of scope

- Universal appliance identification.
- Proving physical presence, ownership, or successful manufacturing.
- Anti-replay or anti-spoof guarantees.
- Unsupervised operation across rooms, microphones, or object variants.
- Safety, fault diagnosis, or predictive maintenance.

## Training data

| Item | Value |
| --- | --- |
| Demonstrations | 15 |
| Classes | IDLE 5, RUNNING 5, BACKGROUND 5 |
| Session groups | 6 |
| Usable frames | 3,183 |
| Source | Procedural synthetic reference |
| Raw audio uploaded | No |
| Validation | Leave-one-take-out by complete take |

The implementation supports optional INTERRUPTED demonstrations, but the reference set has none. No acoustic completion class is claimed. A stop is inferred from the return to confident idle.

## Reference metrics

Leave-one-take-out results:

| Class | Precision | Recall | Support |
| --- | --- | --- | --- |
| IDLE | 0.950 | 0.987 | 1,030 |
| RUNNING | 1.000 | 1.000 | 1,108 |
| BACKGROUND | 0.987 | 0.904 | 1,045 |

Macro recall across the three core classes is approximately 0.964. The UI reports an unknown-refusal rate of approximately 1.5% for this artifact. The confusion matrix is:

```text
             IDLE  RUNNING  BACKGROUND  INTERRUPTED
IDLE         1017      0         12          0
RUNNING         0   1108          0          0
BACKGROUND     53      0        945          0
INTERRUPTED     0      0          0          0
```

These values come from a synthetic, small, single-object dataset. They are not a guarantee of real-world performance.

## Policy

- Minimum top similarity: 0.55.
- Minimum margin: 0.04.
- A quality-flagged frame is refused.
- A refused frame becomes uncertain, not payable.
- Agreement confidence floor: 0.60.
- Start and stop are temporal contract inferences from reporting states.

## Limitations

- One microphone placement and room do not generalise.
- Background prototypes help only with demonstrated distractors.
- A newly encountered but similar appliance may be accepted.
- The browser can fabricate or replay features.
- A READY status means this local synthetic gate passed. It does not mean a field gate passed.
- No physical appliance has been enrolled or tested in this checkout.

## Reproduction

```bash
npm run seed:promise
```

The seed writes the reference demonstrations, model, agreement, two labelled replay executions, and signed demo proofs. The UI marks the provenance as SYNTHETIC. `npm test` includes compiler, evaluator, event-model, API, proof, and tamper checks.
