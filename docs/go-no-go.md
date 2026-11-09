# Go / no-go gates

**Assessment date:** 9 November 2026  
**Environment:** local checkout on Windows, Node 24, PayPal Sandbox credentials configured, one genuine Sandbox capture completed, no real-object recordings, no public deployment.  
**Status legend:** **PASS** = verified in this checkout; **OPEN** = not verified or external action required; **FAIL** = verified failure.

This is the canonical gate list. A green indicator in Judge Mode does not override an open external deliverable here. The project is **not** self-certified as submission-complete.

## 1. PRD release gates

| Gate | Requirement | Status | Evidence / what remains |
| --- | --- | --- | --- |
| **A — Core** | Three separate live ON/OFF cycles classified from actual sensor input | **OPEN** | The browser pipeline, AudioWorklet, model loading, soundprint gate, hysteresis, guided three-trial Gate A page and export are implemented. No physical-object recording or live three-cycle session has been performed in this checkout. Automated/synthetic replay and imported WAVs are not Gate A. |
| **B — Truth** | Measured false-billable time and limitations reported | **PASS (synthetic scope)** | `docs/evaluation.md` reports held-out precision 96.30%, recall 97.16%, FBT 1.804%, the passport fit statistics (ENROLLED at 91.48%, 3.97% active blocked, 4.37% non-active passed), method and hashes, explicitly labelled synthetic. Limitations are in the model card, safety, threat model and UI. Field false-billable measurement remains OPEN. |
| **C — Pricing** | Deterministic quote and cap invariant proven | **PASS** | Integer minor-unit pricing, one rounding, cap, credits-only-reduce, zero-never-captured; unit/property and integration tests pass. |
| **D — Payment** | One human-approved Sandbox transaction captured and provider-reconciled, or clearly qualified | **PASS** | Human-approved Sandbox order `77T95682L88230118` and capture `7YY23328DP2020327` reached `COMPLETED`; authorization `783967879W676894R` is `CAPTURED`. Captured **USD 0.07**; the receipt now recomputes **8/8** checks, including passport exclusions added after the capture. The interval evidence was submitted through the authenticated API for this payment test, not recorded from a physical microphone. See `docs/paypal-sandbox.md`. |
| **E — Security** | Safe webhook ingress and verified real signed event; no exposed admin actions | **OPEN** | Raw-body signature verification, dedup, audit, CSRF/origin checks, auth and loopback binding are implemented and unit-tested. A webhook-only loopback proxy is now shipped (`npm run proxy:webhook`) and returns 404 for every non-webhook path, but no public HTTPS ingress exists and no genuine signed PayPal event has been received. The proxy does not close this gate. |
| **F — Judges** | Clean install, public repo and license, accurate demo video and docs | **OPEN** | Clean local install/setup is reproducible and MIT license is present. Public repository, video and final Devpost submission do not exist yet. |
| **G — Presentation** | A stranger understands the premise before the architecture | **OPEN** | Landing, Judge Mode, service flow and demo script are built. No five informal comprehension tests or recorded presentation were performed. |

**Overall:** the core software and payment rail are built and locally verified, including one genuine Sandbox capture. The submission is **not** go for a claim of a real paid physical demo or a completed hackathon entry. It is go for local judging of the implemented loop, with the remaining gaps above disclosed.

## 2. Technical verification snapshot

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass (0 errors at last run) |
| Unit + integration tests | **73/73 pass** at the 3.0.1 RC run, including the 11-case PayPal provider-contract harness, v3 Merkle/tamper, open-set, v3 bundle, migration, provider timeout and webhook ordering/replay assertions |
| `npm run setup` | Pass; generates 16 synthetic takes, 55 s fixture, READY model, seeded service |
| `npm run smoke` | Pass at last run (health, judge, service card, auth, CORS/CSRF) |
| Dependency audit | `npm audit` reports 0 vulnerabilities (production and full tree) |
| Hot-path benchmark | Classifier 0.00217 ms/frame, inference+hysteresis 0.00213 ms/frame, v3 proof verification 2.79 ms / 21 checks (local i5-10400F; see `docs/performance.md`) |
| Production bundle | Main JS 290.23 kB (92.69 kB gzip) after route splitting, down from 592.20 kB (172.61 kB gzip); no large-chunk warning |
| Security review | Source review, dependency audit, focused regression tests and static traversal probe completed; not an independent penetration test |
| `npm run build` | Pass at last run |
| Reference model gate | READY: precision 96.30%, recall 97.16%, FBT 1.804% |
| Acoustic passport | ENROLLED at 91.48%; active median 97.50%, active P10 93.48%, non-active P95 91.26%; 3.97% active blocked, 4.37% non-active passed (calibration fit, not held-out); public local-only probe implemented |
| Signed protocol v2 | ECDSA P-256 passport and receipt-proof envelopes, canonical JSON, offline verifier, Tamper Lab, v1 legacy labelling and key-rotation tests implemented |
| Shelf and holds | Public catalogue, 10-minute local holds, poster, operator listing and drift surfaces implemented; hold race tested |
| Fixture replay | 33.47 s billable, 133 intervals, $0.11 simulated at $0.20/min, $5 cap |
| Browser E2E suite | Committed Playwright suite: **36/36 pass** across 1440×900, 834×1112 and 390×844. It covers the public proof page, 18-check offline bundle verification, interval Tamper Lab rejection, all public/operator pages plus receipt/review/replay, Gate A controls, no page-level overflow and no console errors. |
| Real microphone ON/OFF cycles | Not performed here |
| Real PayPal order/authorization/capture | **PASS** — order/capture `COMPLETED`, authorization `CAPTURED`, USD 0.07, receipt 8/8; API-submitted interval evidence, not a live microphone |
| Verified signed webhook | Not delivered; webhook ID configured but no public HTTPS ingress |
| Public deployment/video/repo | Not performed/authorized |

## 3. What must not be claimed

- That the bundled model is accurate on a physical fan, hair dryer or any real object.
- That Sandbox money is real money, or that a demo-mode session produced a PayPal transaction.
- That the reference metrics are field measurements rather than synthetic held-out results.
- That Whirr is tamper-proof, unattended-secure, production-ready, or a lock/access-control system.
- That the acoustic passport proves object identity, detects playback or makes the meter tamper-proof.
- That a signature is a trusted timestamp, third-party identity or proof of physical truth.
- That a public deployment, judge access, video or Devpost submission exists.
- That the hackathon has been entered or that any award is likely.

## 4. Actions that would flip each open gate

| Gate | Minimum action |
| --- | --- |
| A | Record idle/active/negative takes from a real object and microphone; inspect the enrolled passport; run three ON/OFF cycles in a live session; preserve the sealed interval ledger and report actual classification and any passport mismatches. |
| B (field) | Repeat held-out evaluation on real sessions, report precision/recall/FBT with confidence intervals, and narrow billing conditions if targets are missed. |
| D (closed) | Evidence is recorded in `docs/paypal-sandbox.md`; preserve it and re-run if credentials rotate. |
| E | Register an HTTPS webhook with the same app; produce a verified signed event; expose only the webhook via a minimal proxy and verify admin routes are unreachable. |
| F | Publish the repository with license, record a truthful sub-3-minute video, verify logged-out access, submit Devpost entry before the deadline. |
| G | Run five comprehension tests, record actual reactions, refine the first 15 seconds, and state limitations in the presentation. |

## 5. Decision

- **Local demo / code review:** GO, with synthetic provenance and demo mode clearly labelled.
- **Claim of a real PayPal-settled physical demo:** NO-GO until Gate A produces real-object evidence; the payment rail itself is now provider-verified.
- **Hackathon submission:** NO-GO until Gate F artifacts (public repo, video, Devpost) and the required real evidence are complete.
- **Production or unattended rental:** NO-GO by design; out of scope and unsafe with this sensing model.

## 6. Whirr 3.0 local verification

Whirr 3.0.1 preserves the v1/v2 read and verification paths, the historical Sandbox capture and the receipt verification endpoint. It adds the portable v3 proof bundle, Merkle interval proofs, public redaction, `/proof/:id`, QR, key pinning, standalone browser verification, open-set rejection, capture provenance, sensor diagnostics, exponential retry retention, interval-only replay, authorization expiry/reauthorization, payment timeline, the webhook-only proxy and a guided three-trial Gate A workflow.

`npm run gate:v3` reads the actual SQLite database, model artifact and provider configuration. It does not close Gate A from synthetic replay or Gate E from a loopback proxy. External status remains:

- **Gate A OPEN:** no genuine real-object recordings and three live ON/OFF trials. `npm run gate:a:export` packages evidence but explicitly keeps the gate open.
- **Gate D PASS (historical):** the 8 November 2026 Sandbox capture is preserved unchanged; no new provider call or capture is claimed.
- **Gate E OPEN:** no public HTTPS ingress and no genuine signed webhook. Loopback proxy only.
- **Gate F/G OPEN:** no public repository remote, video, Devpost submission, comprehension tests or recorded presentation.

## 7. Whirr 3.0.1 release-candidate verification

- **Automated tests:** `npm test` — 73/73 pass across 15 files, including the 11-case PayPal provider-contract harness and the re-signed adversarial protocol cases.
- **Typecheck and build:** `npm run typecheck` exits 0; `npm run build` succeeds without the former 500 kB chunk warning after route-level lazy loading.
- **Browser QA:** Playwright suite covers 36 checks at 1440×900, 834×1112 and 390×844, including all public pages, operator pages, receipt/review/replay, Gate A controls, horizontal overflow and console/page errors.
- **Gate A remains OPEN:** the guided page and export exist, but no genuine three-trial real-object log is checked in. Synthetic fixtures do not close it.
- **Gate E remains OPEN:** no public HTTPS ingress has received a genuine PayPal-signed webhook.
- **Release identity:** package version `3.0.1`; the verified commit and local tag are recorded in the release notes after the final consolidated run.

## 8. Whirr 4.0 release-candidate verification

Whirr 4.0 is a product/experience release built on the verified 3.0.1 baseline. It does not change the payment, pricing, protocol or evidence rules, and it does not close any external gate.

- **Product surface:** workshop-first landing, bench discovery with sound tags, consent ticket, and a Listening Room whose field is driven by the real eight-band signal. The field states `MIC CLOSED` when sensing is off.
- **Automated tests:** `npm test` — **73/73 pass** across 15 files. `npm run test:e2e` — **39/39 pass** across 1440×900, 834×1112 and 390×844.
- **Build and smoke:** `npm run typecheck` 0 errors; `npm run build` passes; `npm run smoke` passes.
- **Gate report:** **8 PASS · 4 OPEN · 0 FAIL**. Gate A, E, F and G remain OPEN for the same reasons as 3.0.1. No screenshot or UI state is treated as external evidence.
- **Dependency audit:** 0 vulnerabilities across 277 dependencies.
- **Screenshots:** `docs/v4/` contains nine captures. The Listening Room images are explicitly microphone-closed, not live physical evidence.
- **Usability:** protocol exists at `docs/usability-4.0.md`; **0 participants, not run**. No comprehension claim is made.
- **Release notes:** `docs/release-notes-4.0.0-rc.1.md`.

**Decision:** GO for local product review and a labelled synthetic demonstration. **NO-GO** for any claim of a physical paid demo, public webhook completion, usability validation, or hackathon submission.
