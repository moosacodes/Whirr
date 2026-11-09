# Whirr 4.0.0 release notes

**Release candidate:** `v4.0.0-rc.1`  
**Date:** 9 November 2026  
**Branch:** `feat/whirr-4-bench`  
**Baseline:** verified 3.0.1 commit `69783d9`, tag `v3.0.1-rc.1` preserved.

This is a product release candidate, not a claim that external gates are complete. Whirr remains a supervised, Sandbox-only prototype.

## What changed

### Product

- Repositioned the product as **Whirr Bench**, a shared-workshop tool library rather than a generic object shelf.
- Added the promise **“Borrow the tool. Pay for the work.”**
- Rewrote discovery around one commercial use case: cost recovery for community-owned equipment.
- Added a real product object in the hero: a bench ticket populated from the seeded shelf item, including the rate, cap, status and enrolled sound tag.
- Added a bench comparison between time-based rental and acoustic use-based billing.
- Added a three-beat interaction: **Find. Run. Keep the proof.**
- Added a PayPal handshake section explaining authorization, metering and capture as the permission boundary.
- Added a trust section that pairs what the proof establishes with what it explicitly refuses to claim.

### Bench and object identity

- Rebuilt `/shelf` as a workshop bench with bay numbers, ready-now / rate / signed-passport status, bench rules and a sound-tag identity.
- Added the `SoundTag` component: eight actual enrolled bands, a gate indicator, frequency range and threshold.
- Added a wide single-object bench card with rate, ceiling, free-time policy, calibration state, holds and terms examples.
- Rebuilt the service card language around **“Authorize the cap. Then use the tool.”**
- Preserved all consent, cap, privacy, model and limitation data.

### Listening Room

- Added the `ListeningField` component: eight radial bars driven by the live band values, a level-driven glow, live-only rings, and an explicit `MIC CLOSED` state.
- Made the session stage a dark acoustic instrument instead of a light dashboard card.
- Added a large plain-language state word, a sound-tag match readout, the provisional bill, billable time, rate and cap in one hierarchy.
- Kept idle, uncertain, mismatched and disconnected time visibly free.
- Added the sound tag to the session’s passport summary.
- No sensor activity is fabricated when the microphone is closed.

### Verification and assets

- Added a 4.0 browser test covering the landing story, bench sound tag and service ticket at all three viewports.
- Added `npm run screenshots` and a repeatable Playwright capture script.
- Captured desktop and mobile screenshots in `docs/v4/`.
- Added the product brief, design language, three-minute demo, submission explanation and the unrun five-person comprehension protocol.
- Updated README and package metadata to 4.0.0-rc.1.

### Preserved

- v1/v2 receipt proofs, historical passports, schema 3 and the v3 proof bundle format.
- Historical Sandbox capture `77T95682L88230118`, authorization `783967879W676894R`, capture `7YY23328DP2020327` (USD 0.07).
- Payment retry, reauthorization, refund authority, request-ID conflict and read-only GET reconciliation fixes.
- Gate A, E, F and G evidence placeholders and OPEN status.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run typecheck` | **0 errors** |
| `npm test` | **73/73 pass**, 15 files |
| `npm run build` | **Pass**; no large-chunk warning |
| `npm run test:e2e` | **39/39 pass** at 1440×900, 834×1112 and 390×844 |
| `npm run smoke` | **Pass** |
| `npm run gate:v3` | **8 PASS · 4 OPEN · 0 FAIL** |
| `npm audit` | **0 vulnerabilities**, 277 dependencies (113 prod, 165 dev, 53 optional) |
| `npm run screenshots` | **9 PNGs captured** in `docs/v4/` |

The production main bundle is **292.62 kB / 93.31 kB gzip**, a small increase over 3.0.1’s 290.23 kB / 92.69 kB gzip from the new bench UI. It remains below the former 500 kB chunk warning threshold.

## Gate status

| Gate | Status | Evidence / remaining work |
| --- | --- | --- |
| A — real-object trials | **OPEN** | No genuine real-object pack with three live ON/OFF trials. The 4.0 screenshots are the microphone-closed consent state, not sensing evidence. |
| B — accuracy | **PASS (synthetic scope)** | Synthetic held-out precision 96.30%, recall 97.16%, false-billable 1.804%; field accuracy remains open. |
| C — pricing | **PASS** | Deterministic integer pricing, cap and credit invariants preserved. |
| D — Sandbox payment | **PASS (historical)** | USD 0.07 provider-reconciled capture preserved; no new provider call was made. |
| E — verified webhook | **OPEN** | No genuine PayPal-signed webhook over public HTTPS. |
| F — judges | **OPEN** | No public remote, video or Devpost artifact. |
| G — presentation | **OPEN** | No comprehension tests or recorded presentation. |

## Known limits

- The physical interaction has not been recorded with a real object and live microphone.
- The screenshots are visual QA artifacts, not Gate A evidence.
- No five-person comprehension results exist. `docs/usability-4.0.md` is a protocol only.
- No manual external designer review or exhaustive keyboard/screen-reader audit.
- No public deployment, video, Devpost submission or remote push.
- The micro-payment economics of sub-$0.50 sessions are not solved; aggregation and membership settlement remain future designs.
- The reference fan and its metrics are synthetic and are never presented as field accuracy.

## Human steps still required

1. **Gate A:** run three genuine ON/OFF trials with a physical tool and microphone; review and write the evidence into `docs/evidence/gate-a.json`.
2. **Gate E:** expose only the webhook route over public HTTPS and receive a genuine PayPal-signed event.
3. **Gate F:** publish the repository, record a truthful demo and submit Devpost.
4. **Gate G:** run the five-person comprehension protocol and record a presentation.
5. Run a manual visual review of the captured screenshots and the live Listening Room on a real device.

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
npm audit
npm run screenshots
```

No deployment, push or tag publication is part of this release candidate.
