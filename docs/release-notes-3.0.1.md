# Whirr 3.0.1 release notes

**Release candidate:** `v3.0.1-rc.1`  
**Date:** 9 November 2026  
**Scope:** hardening, payment reliability, proof verification, real-object Gate A workflow, responsive QA and release documentation.

This is a release candidate, not a claim that external gates are complete. Whirr remains a supervised, Sandbox-only prototype.

## What changed

### Payments

- Capture retry after a lost response now reuses the same request ID. A completed capture returns early instead of creating a second intentional capture.
- Reauthorization keeps the prior order ID and derives a fresh `renew-<order>` request ID, so the original primary-order operation cannot be replayed.
- Payment operations reject a request ID reused for a conflicting operation.
- Refunds are checked against the authoritative provider refund, including amount and currency. A mismatch is `UNRESOLVED`, never reported as success.
- `GET /api/sessions/:id/paypal/status` is read-only. `POST /api/sessions/:id/paypal/reconcile` performs authoritative provider reconciliation and is the only path that can trigger settlement reads.
- The Review UI exposes a safe retry when a capture is retryable.
- Added an 11-case PayPal provider-contract harness covering amount/currency mismatch, duplicate capture, lost responses, expired/failed/pending authorization, duplicate/delayed/out-of-order webhooks, invalid signatures, timeouts, invalid transitions and interrupted reconciliation.

### Proof and verification

- v3 bundles reuse stored signed bytes when receipt hash, Merkle root, passport and capture claim are unchanged.
- The verifier recomputes interval totals from interval states and checks model/status/terms bindings.
- The standalone HTML verifier mirrors the totals check.
- Adversarial tests now re-sign tampered payloads with an internally consistent key and prove semantic rejection of changes to totals, boundaries, rates, credits, model metadata, capture provenance, passport editions, Merkle paths, signing keys, payment references and public redaction.

### Gate A and acoustic workflow

- Added the guided Gate A page at `/studio/objects/:objectId/gate-a`.
- Three 6-second ON/OFF trials record actual active ratio, idle/uncertain time, mean confidence, passport score, clipping, device/sample rate and failure codes.
- Failed ON and OFF phases can be retried without discarding earlier attempts.
- The export is `whirr.gate-a-trial-log.v1`, explicitly client-reported.
- `docs/evidence/gate-a.json` is checked in as **OPEN** with no trials. Synthetic fixtures and imported WAVs cannot close Gate A.
- Capture metadata is captured before the microphone engine is stopped, so the exported device label and sample rate are not lost.

### Web, responsive and performance

- Routes are lazy-loaded with `React.lazy` and `Suspense`.
- Main JS fell from 592.20 kB (172.61 kB gzip) to 290.23 kB (92.69 kB gzip); the Vite 500 kB warning is gone.
- Fixed receipt explorer overflow at 390 px by constraining grid tracks and table wrappers.
- Added a Playwright sweep for public pages, operator pages, receipt/review/replay and Gate A at 1440×900, 834×1112 and 390×844, including overflow and console/page errors.
- Added reproducible classifier, meter and proof-verification benchmarks in `scripts/benchmark.ts`.
- Measured locally: 0.00217 ms/frame classifier inference, 0.00213 ms/frame inference+hysteresis, 2.79 ms per 21-check v3 proof verification. See `docs/performance.md`.

### Documentation

- README, architecture, PayPal integration, proof verification, model card, threat model, security audit, go/no-go gates, demo instructions and Gate A evidence instructions now describe 3.0.1 behavior.
- Added open evidence placeholders for Gate A and Gate E.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm test` | **73/73 pass** across 15 files |
| `npm run build` | Pass; no large-chunk warning |
| `npm run test:e2e` | **36/36 pass** across three viewports |
| `npm run smoke` | Pass |
| `npm run gate:v3` | **8 PASS · 4 OPEN · 0 FAIL** |
| `npm audit` | **0 vulnerabilities** across 277 dependencies |
| `npm run bench` | Pass; numbers in `docs/performance.json` |

## Gate status

| Gate | Status | Evidence / remaining work |
| --- | --- | --- |
| A — real-object trials | **OPEN** | Guided page and open evidence file exist; no genuine three-trial real-object log is checked in. |
| B — measured accuracy | **PASS (synthetic scope)** | Synthetic held-out precision 96.30%, recall 97.16%, FBT 1.804%; field measurement remains open. |
| C — pricing | **PASS** | Deterministic integer pricing, cap and credit invariants covered by tests. |
| D — Sandbox payment | **PASS (historical)** | USD 0.07 Sandbox capture, provider-reconciled; no new provider call in this RC run. |
| E — verified webhook | **OPEN** | No genuine PayPal-signed webhook over public HTTPS. |
| F — judges | **OPEN** | No public repo remote, video or Devpost artifact in this checkout. |
| G — presentation | **OPEN** | No comprehension tests or recorded presentation. |

## Exact human steps for open gates

### Gate A

1. Run `npm run setup && npm run dev`, sign in as operator and open the physical object's model, then Gate A trials.
2. Use the microphone that will actually meter the object. Run three trials, each 6s ON followed by 6s OFF, with the real object. Retry failures if appropriate; all attempts remain in the export.
3. Download the trial log. Have a named reviewer inspect the actual measurements and failure codes.
4. Only if the evidence is genuine, replace `docs/evidence/gate-a.json` with `realObject: true`, three reviewed trials, reviewer and date. Run `npm run gate:v3` to confirm Gate A flips to PASS.

### Gate E

1. Expose only `POST /api/paypal/webhook` through a public HTTPS endpoint; keep the operator API private.
2. Set `PAYPAL_WEBHOOK_ID` from the same PayPal Sandbox app, subscribe to capture/refund events and trigger a genuine Sandbox payment event.
3. Preserve the accepted event ID, verification response, timestamp and redacted delivery evidence.
4. Set `publicHttps`, `verifiedSignedEvent`, `provider: "PAYPAL"` and `verifiedAt` in `docs/evidence/gate-e.json` only after genuine delivery. A loopback proxy, mock or manually posted event does not count.

## Known limitations

- Gate A has no real-object evidence in this checkout; all model metrics are synthetic.
- Gate E has no public HTTPS signed-webhook delivery.
- Offline verification proves byte integrity and internal semantics, not physical presence, classifier correctness or PayPal settlement.
- The capture provenance is signed client testimony, not hardware attestation.
- A microphone cannot detect playback or disambiguate identical machines.
- SQLite is not encrypted at rest; a host administrator can rewrite the database.
- No LCP, mobile-device battery, network-latency or long-duration soak measurement was performed.
- No independent penetration test or formal certification has been performed.

## Release identity and reproducibility

The annotated local tag is `v3.0.1-rc.1`. Inspect the exact commit with:

```bash
git rev-parse v3.0.1-rc.1^{commit}
```

Reproduce the local checks with:

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
npm run bench
```

No push or deployment is part of this release candidate.
