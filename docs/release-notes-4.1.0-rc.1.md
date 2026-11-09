# Whirr 4.1.0 release notes

**Release candidate:** `v4.1.0-rc.1`

**Date:** 9 November 2026

**Branch:** `feat/whirr-4-bench`

**Baseline:** verified 4.0.0-rc.1 commit `37407f77`, tag `v4.0.0-rc.1` preserved.

This release adds the evidence path for the core invention. It is not a claim that a physical appliance has been validated, and it does not close Gate H or Gate A.

## What changed

### Real-World Calibration Lab

- Added a guided operator lab at `/studio/objects/:objectId/calibration-lab`.
- Live idle, operating and background enrollment from the computer microphone; imported and synthetic takes remain visible in the Capture Lab but are rejected by the field gate.
- Local, deterministic training from the live takes. No cloud model, API key or hidden synthetic fallback is used.
- A three-cycle ON/OFF trial plus separate noise, distance and replay-attack trials.
- Actual held-out precision, recall, false-billable duration, overbilling and total billing error, recomputed by the server from the uploaded frozen features.
- Fixed, pre-declared acceptance gates. A failed gate stays failed; the UI does not lower a threshold to produce a pass.
- An inspectable public field report at `/field-report/:reportId` with model version, model and dataset hashes, anonymised recording metadata, methodology, every gate, metrics and limitations.
- Publication and session guards: a `USER_CALIBRATION` model needs a `FIELD_PASS` report for its exact model id. The synthetic reference demo remains separate and unaffected.
- A microphone-closed state throughout the lab. The signal trace only exists while the microphone is genuinely open; no visual activity is fabricated.

### Preserved behavior

- v1/v2 receipt proofs, historical passports and the v3 proof bundle format.
- Historical Sandbox capture `77T95682L88230118`, authorization `783967879W676894R`, capture `7YY23328DP2020327` (USD 0.07).
- Pricing, cap, capture, refund, retry, reauthorization, webhook and reconciliation behavior.
- Judge Mode as a reproducible synthetic demonstration.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run typecheck` | **0 errors** |
| `npm test` | **82/82 pass**, 17 files |
| `npm run build` | **Pass**; main JS 293.10 kB / 93.43 kB gzip; no large-chunk warning |
| `npm run test:e2e` | **48/48 pass** at 1440×900, 834×1112 and 390×844 |
| `npm run smoke` | **Pass** |
| `npm run gate:v3` | **8 PASS · 5 OPEN · 0 FAIL**; Gate H added and OPEN |
| `npm run screenshots` | **11 PNGs** in `docs/v4/`, including desktop and mobile lab captures |

## Gate status

| Gate | Status | Evidence / remaining work |
| --- | --- | --- |
| A — real-object trials | **OPEN** | No genuine real-object pack with three live ON/OFF trials. The lab's three-cycle protocol is separate and does not silently close Gate A. |
| B — accuracy | **PASS (synthetic scope)** | Synthetic held-out precision 96.30%, recall 97.16%, false-billable 1.804%; no field accuracy is claimed. |
| C — pricing | **PASS** | Deterministic integer pricing, cap and credit invariants preserved. |
| D — Sandbox payment | **PASS (historical)** | USD 0.07 provider-reconciled capture preserved; no new provider call was made. |
| E — verified webhook | **OPEN** | No genuine PayPal-signed webhook over public HTTPS. |
| F — judges | **OPEN** | No public remote, video or Devpost artifact. |
| G — presentation | **OPEN** | No comprehension tests or recorded presentation. |
| H — real-world calibration | **OPEN** | No physical appliance enrolled, no live trial set, no `FIELD_PASS` report. `docs/evidence/field-test.json` contains no measurements. |

## Known limits

- The field report is client-reported live-microphone evidence. The server validates structure and recomputes every metric, but it cannot prove that a physical object was present.
- Audio-only sensing cannot guarantee replay rejection or object identity. The replay trial measures the failure mode; it is not an anti-spoof guarantee.
- The metrics describe one object, room, microphone and protocol. They do not transfer automatically.
- No physical appliance has been enrolled in this checkout, so there is no real-world model to integrate into the Listening Room yet.
- The screenshots are visual QA artifacts, not Gate A or Gate H evidence.
- No public deployment, video, Devpost submission, remote push or tag publication is part of this release candidate.

## Human steps still required

1. Create or choose a non-synthetic object and open its Real-World Calibration Lab.
2. Record at least two live idle, two live operating and one live background take from the actual microphone; train a READY `USER_CALIBRATION` model.
3. Run the guided three-cycle ON/OFF, noise, distance and replay trials with the physical appliance.
4. Generate the server-evaluated report. If it passes, preserve the report id, model hash, evidence hash and public JSON in `docs/evidence/field-test.json`; if it fails, keep the failure and improve the calibration without weakening a threshold.
5. Have a named reviewer confirm the physical object, microphone, date and actions, then close Gate H only if the evidence supports it.
6. Run Gate A separately, and complete Gates E, F and G through their external actions.

## Reproduce

```bash
npm ci
npm run setup
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run smoke
npm run gate:v3
npm run screenshots
```

The seeded reference fan is synthetic. The lab will refuse to treat it as real-world evidence.
