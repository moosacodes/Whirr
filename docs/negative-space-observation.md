# Negative-space observation

## The question

Whirr 4.x–6.x detects something happening. Whirr 7.0 evaluates whether a **specified known activity was not detected under sufficiently valid observation conditions**.

This is not the same as proving the room was silent or the machine was powered off.

The contract is deliberately narrow:

> The validated model must detect the enrolled source active for at least 3 continuous seconds, then must not detect it for the required continuous window while the microphone remains observable. Any interruption resets the window. Any uncertain evidence breaks it. No capture is automatic.

## Source states

| State | Meaning |
| --- | --- |
| `ACTIVE` | The bound model confidently detected the enrolled source. |
| `INACTIVE` | The bound model did not detect the source with confidence at or above the floor. |
| `UNKNOWN` | Evidence was below the confidence floor or carried a blocking quality flag. |
| `DISCONNECTED` | The microphone/sensor stream was lost or observability failed. |

“Inactive” is **negative evidence**, not positive proof of physical absence.

## Temporal rules

- `requiredBaselineActiveMs`: 3,000 ms.
- `requiredInactiveMs`: 10,000–120,000 ms, normally 30,000 ms.
- `confidenceFloor`: 0.60 by default.
- `maxObservationGapMs`: 2,500 ms.
- Intervals must be ordered, non-overlapping, and have a strictly increasing sequence.
- A gap above the limit invalidates capture eligibility.
- An active interval during the quiet run resets the run.
- An `UNKNOWN` or `DISCONNECTED` interval resets the run.
- The qualifying window is complete when a continuous inactive run reaches the required duration.
- The agreement must not be expired at evaluation.

The evaluator accepts a sorted copy but rejects sequences that move backwards or overlap.

## Outcomes

`QUALIFIED`, `NO_BASELINE`, `INTERRUPTED`, `SENSOR_LOSS`, `INSUFFICIENT_EVIDENCE`, `EXPIRED`, `REJECTED`.

Only `QUALIFIED` can be capture-eligible, and only with a valid shape, no oversized gap, current model hash, no expiry, and subsequent buyer acceptance.

## Blocking quality flags

The evaluator treats these as blocking/observability failures:

- `MICROPHONE_DENIED`
- `SENSOR_DISCONNECTED`
- `CLIPPED`
- `FLATLINE`
- `TAB_HIDDEN`
- `LOW_CONFIDENCE`
- `MODEL_UNAVAILABLE`
- `STALE_FRAME`
- `INTERFERENCE`
- `GAIN_UNSTABLE`
- `DEVICE_MOVED`

`MICROPHONE_DENIED`, `SENSOR_DISCONNECTED`, and `DEVICE_LOST` are sensor-loss flags. A disconnected interval is never counted as quiet.

The collector also records `MODEL_REFUSED` and `TRANSITION_UNCERTAIN`; the server policy is the final authority.

## Why an active baseline is required

A missing signal can mean many things:

- the machine is off;
- the microphone is muted;
- the browser is backgrounded;
- the device moved;
- the model no longer recognizes the source;
- the environment changed;
- the source is hidden by another sound.

An active baseline establishes that the sensing chain could detect this source immediately before the quiet interval. It does not prove the later absence was caused by the provider, but it prevents the worst case: treating “never heard it at all” as a successful pause.

## Adversarial case matrix

These are the predeclared contractual expectations. A test may exercise them with a synthetic ledger; that does not make them field evidence.

| # | Case | Expected result |
| --- | --- | --- |
| 1 | Clearly active before window | Baseline can be established |
| 2 | Intentionally stopped for full duration | `QUALIFIED` if continuous and observable |
| 3 | Restarts halfway | `INTERRUPTED`; reset; no capture |
| 4 | Restarts near final second | Reset unless the full required run already completed; no capture |
| 5 | Sensor disconnects | `SENSOR_LOSS`; no capture |
| 6 | Microphone muted/denied | `MICROPHONE_DENIED`; no capture |
| 7 | Browser backgrounded | `TAB_HIDDEN`; run cannot qualify |
| 8 | Device asleep | stale/disconnected; no capture |
| 9 | Suspicious flatline | `FLATLINE`; no capture |
| 10 | Another appliance operates | If model says `BACKGROUND`/`INACTIVE`, the contract may still qualify only for the bound source; the limitation is disclosed |
| 11 | Recorded noise played back | May fool the model; this is a known spoofing limit, not a verified success |
| 12 | Environment changes after calibration | `UNKNOWN`/`INSUFFICIENT_EVIDENCE` or false classification; no claim of robustness |
| 13 | Machine operates at different speed | Model may refuse or misclassify; no guarantee |
| 14 | Object moves farther away | Confidence may fall; `UNKNOWN`; no capture |
| 15 | Unknown audio appears | `UNKNOWN`/`BACKGROUND`; policy decides, and the proof reports it |
| 16 | Ambiguous classification | `UNKNOWN`; reset |
| 17 | Two similar objects operate nearby | Possible source confusion; no identity claim |
| 18 | Evidence arrives out of order | Rejected by sequence/order validation |
| 19 | Evidence duplicated | Rejected as duplicate/overlap |
| 20 | Client submits only successful intervals | Gaps and sequence checks expose the omission; no qualification if continuity fails |

## False qualifying physical agreements

The most important metric is **false qualifying physical agreements** (FQPA): a contract that pays when the agreed physical condition was not actually maintained under the declared observation policy.

This is a financial correctness problem, not just model accuracy.

A system with high classifier accuracy can still produce an unjustified payment if:

- an interrupted interval is accepted;
- a missing sensor is treated as quiet;
- the model is substituted;
- the terms are amended after consent;
- a client skips unsuccessful intervals;
- a UI animation is confused with evidence.

The deterministic evaluator and proof are designed to prevent these specific software failures. They cannot prevent a dishonest sensor or a physically deceptive playback.

## Metrics to report after a field study

- correctly rejected interrupted windows;
- false qualifying windows (FQPA);
- correctly qualified windows;
- unknown-state rejection;
- sensor-failure response;
- detection latency;
- window reset correctness;
- source confusion;
- environmental drift sensitivity;
- spoofing outcomes;
- financial eligibility errors;
- sample size and uncertainty.

No field metrics are reported for 7.0 because no physical study was run.

## Independent oracle

The repository includes an independent small-sequence oracle and temporal tests in `tests/unit/ambient.test.ts`. It checks hand-computed expected outcomes rather than merely reusing the evaluator’s output. The verifier separately recomputes the entire evaluation from the signed ledger.

These tests establish software behavior on synthetic inputs. They do not establish physical accuracy.

## Field status

**OPEN.** No physical machine, held-out recording set, calibration, or field trial exists for 7.0. See `docs/field-study-7.0.md` for the protocol that must be executed.
