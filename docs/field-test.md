# Real-World Calibration Lab

**Status: Gate H is OPEN. No physical appliance field test exists in this checkout.**

This lab is the bridge between the synthetic reference demo and a real object. It records an ordinary appliance from the computer's actual microphone, trains a device-specific model from those live takes, and then measures the frozen model on held-out guided trials. It does **not** substitute fixtures for physical validation, and it does not let an operator publish a live-calibrated model until every pre-declared gate passes.

## Why it is separate from Judge Mode

| Path | Data | Purpose | Can it unlock billing? |
| --- | --- | --- | --- |
| Judge Mode / reference fan | Procedurally generated fixtures, `SYNTHETIC_REFERENCE` | Reproducible demonstration of the pipeline | No — field validation does not apply |
| Real-World Calibration Lab | Live microphone takes and guided live trials, `USER_CALIBRATION` | Evidence about one physical object in one room | Only after a `FIELD_PASS` report for the exact model hash |
| Gate A page | Client-reported three ON/OFF trials | Human review pack for the original Gate A | Not by itself; it does not generate a server-evaluated field report |

Synthetic or imported takes are visible in the Capture Lab and are rejected by the field test's live-calibration gate. Replay trials are deliberately included: if the model bills a speaker playback, the replay gate fails and the model stays blocked.

## Protocol

The operator records four separate trials **after** training. None of them is used to fit the model.

| Trial | Duration | Ground truth | Purpose |
| --- | --- | --- | --- |
| Three-cycle ON/OFF | ~31 s | 4 s OFF, 5 s ON, repeated 3 times, then 4 s OFF | Precision, recall, false-billable time, overbilling and total billing error |
| Background noise | 12 s | All OFF | Room noise must not be billed |
| Distance | 12 s | All ON, object ≥2 m away | Detection must survive the stated operating range |
| Replay | 12 s | All non-billable | A speaker playback must not be billed |

The UI prompts the operator through each phase and draws the trace from the frames the browser actually captured. The microphone is opened only after an explicit action and is closed at the end of the capture, on abort, or when the device disconnects. When it is closed the page says `MIC CLOSED` and shows no live trace.

## Pre-declared gates

A model must meet every gate. The thresholds are fixed in `packages/audio/src/field-eval.ts` and are shown before any trial result exists. A failure is stored as a failure; the UI never changes a threshold to obtain a pass.

| Gate | Requirement |
| --- | --- |
| `MODEL_READY` | Active model is `READY` and `USER_CALIBRATION` |
| `LIVE_CALIBRATION` | ≥2 live idle, ≥2 live operating, ≥1 live background take; no imported/synthetic training takes; dataset hash matches the model |
| `THREE_CYCLES` | Exactly three complete guided ON phases |
| `FIELD_PRECISION` | ≥95% |
| `FIELD_RECALL` | ≥90% |
| `FALSE_BILLABLE` | ≤2% of protocol OFF time |
| `OVERBILLING` | ≤2% of expected running time |
| `BILLING_ERROR` | False-billed + missed-running time ≤5% of observed time |
| `NOISE_FALSE_BILLABLE` | ≤2% on the noise trial |
| `DISTANCE_ACTIVE_RATIO` | ≥50% billable on the distance trial |
| `REPLAY_REJECTION` | ≤5% billable on the replay trial |
| `RECORDING_QUALITY` | Adequate frame coverage; not silent or clipped |

If any trial is missing or a gate cannot be evaluated, the report cannot be generated. If all trials exist and a gate fails, the report is generated with `FIELD_FAIL` so the failure is inspectable.

## What the server computes

The browser sends only the frozen 21-feature frames, per-frame quality flags, sample rate, anonymised device reference and the protocol timeline. It never uploads raw audio. The local server:

1. validates the timeline shape for the trial kind (three ON phases, contiguous segments, correct duration);
2. checks frame coverage and quality;
3. re-runs the active model and precision-first hysteresis over the submitted frames;
4. overlaps `ACTIVE_CONFIDENT` intervals with the protocol's ON/OFF ground truth;
5. derives precision, recall, false-billed milliseconds, overbilling and total billing error;
6. evaluates the noise, distance and replay trials separately;
7. stores an evidence hash over the report content.

The report is public at `/field-report/:reportId` and via `GET /api/field-reports/:id`. It includes the model version and hash, dataset hash, anonymised recording metadata, methodology, every gate, the trials, the measured metrics, limitations and an attestation that this is client-reported live-microphone evidence. The report does not include raw audio.

## Publication guard

For a `USER_CALIBRATION` model, both publishing terms and creating a Listening Room session require a `FIELD_PASS` report for that exact model id. A `FIELD_FAIL` or missing report returns `FIELD_TEST_REQUIRED`. The synthetic reference object is unaffected and remains its own clearly labelled demo.

A new training run creates a new model id and starts a new field test. Replacing or discarding a trial invalidates the stored report.

## How to run it

Requirements: a real appliance, a computer microphone, and a quiet room.

1. Start the app: `npm run setup && npm run dev`. Sign in at `/operator/login`.
2. Create an object in Studio. Do not use the seeded reference fan; it is synthetic and the lab will refuse to treat it as real evidence.
3. Open `/studio/objects/<objectId>/calibration-lab`.
4. Record two live idle takes, two live operating takes and one live background take. Keep the microphone where it will sit during rental. Train the model.
5. Record the guided three-cycle trial, following the ON/OFF prompts exactly. Then record the noise, distance and replay trials.
6. Generate the field-test report. Inspect every gate and the public report. If a gate fails, retake only the failed trial or improve the live calibration and retrain. Do not import audio to replace a failure.
7. Only a `FIELD_PASS` report can unlock terms and a Listening Room session.

## What closes Gate H

A named reviewer must confirm that the object, microphone and physical actions were genuine, and the checked-in evidence must name the `FIELD_PASS` report id, model hash and date. `docs/evidence/field-test.json` currently says `OPEN` and contains no measurements.

## Limits that remain true even after a pass

- The report is client-reported live-microphone evidence. The server can validate structure and recompute metrics, but it cannot prove that a physical object was present.
- Audio-only sensing cannot reliably distinguish a speaker replay of the same machine from the machine itself. The replay trial measures this; it is not an anti-spoof guarantee.
- A similar machine, two identical machines running together, or a changed room can confuse the classifier.
- One microphone in one position does not secure an unattended venue or physically lock the object.
- The measured precision and recall describe this object, this room, this microphone and this protocol. They do not transfer automatically to another installation.
- No payment action occurs during the lab. PayPal Sandbox authorization and capture remain a separate, preserved workflow.

## Automated checks are not the physical test

Unit tests cover the metric arithmetic, protocol validation, gate thresholds and publication guard. Browser tests cover the microphone-closed state, auth, synthetic separation and the absence of payment requests. Those checks prove the software behaves as described; they cannot close Gate H or produce a real-object claim.
