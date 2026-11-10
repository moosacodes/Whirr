# Field evaluation 6.0

**Current status: OPEN. No physical field trial has been performed.**

This document separates implemented software checks from a genuine physical experiment. Nothing below converts synthetic fixtures into field evidence.

## Predeclared gates

These thresholds are fixed before a real evaluation. They must not be tuned after seeing the final held-out recordings.

| Gate | Threshold |
| --- | --- |
| Per-class recall, core classes | at least 0.60 each |
| Macro recall | at least 0.65 |
| Incomplete-as-complete errors | 0 on the held-out incomplete set |
| False capture eligibility | 0 on held-out nonqualifying attempts |
| Sensor-loss capture eligibility | 0 |
| Uncertain-interval capture eligibility | 0 |
| Substituted-model capture eligibility | 0 |
| Qualified-cycle capture eligibility on a complete cycle | 1.0 for the demonstrated setup |
| Event order determinism | identical result across replay |
| Capture amount | exactly the fixed price, never above the ceiling |

A small sample cannot establish reliability. Report sample size and confidence limits. Any failure remains visible and blocks a claim of field readiness.

## Protocol to run

Use a safe household fan or similar appliance. Do not open the enclosure, defeat a guard, or use a device that can injure the operator.

1. Place the microphone at a fixed measured distance.
2. Record at least five idle takes, five normal running takes, and five distinct background takes.
3. Capture at least five complete operating cycles as held-out takes, with the microphone position unchanged.
4. Capture at least five interrupted cycles.
5. Capture at least three unknown or similar-appliance attempts.
6. Record one sensor-loss trial by disconnecting the microphone mid-run.
7. Train with all non-held-out takes. Do not include held-out frames in training.
8. Evaluate the fixed gates above using complete recordings as groups.
9. Record precision, recall, unknown refusal, false-qualified rate, missed-qualified rate, incomplete-as-complete errors, latency, and capture-eligibility errors.
10. Export the report and preserve the raw assessment method. Do not claim product-quality verification.

## Synthetic reference results

The current reference model is not a field result. It is a 15-take procedural dataset, 3,183 frames, with leave-one-take-out macro recall of approximately 0.964 and background recall of approximately 0.904. See `docs/model-card-6.0.md`.

These numbers establish that the implemented training and validation pipeline can separate the synthetic classes. They do not establish that a physical fan will be recognised.

## Physical and financial gates

- **Physical field trial:** OPEN_NOT_RUN.
- **Genuine 6.0 PayPal Sandbox authorization and capture:** OPEN_NOT_RUN.
- **Genuine PayPal webhook delivery:** OPEN_NOT_VERIFIED.
- **Public deployment and submission:** OPEN unless separately completed and verified.

## Decision

GO for local review of the synthetic workflow, the agreement compiler, the temporal evaluator, the browser experience, and the proof verifier.

NO-GO for claiming field accuracy, a completed physical experiment, a genuine 6.0 Sandbox payment, or a verified webhook until the corresponding actions occur.
