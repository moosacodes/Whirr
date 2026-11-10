# Go / no-go gates

**Assessment date:** 9 November 2026  
**Environment:** local checkout on Windows, Node 24, PayPal Sandbox credentials configured, one genuine Sandbox capture completed, the 4.1 Real-World Calibration Lab implemented, no physical appliance enrolled, no field report, no public deployment.

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
| **H — Real-world calibration** | A live-calibrated model passes the pre-declared field protocol on a physical object and remains blocked otherwise | **OPEN** | The lab, server recomputation, public report, publication/session guards and browser checks are implemented. No physical appliance has been enrolled; `docs/evidence/field-test.json` is OPEN with no measurements. The seeded `SYNTHETIC_REFERENCE` fan remains a separate demo. |
| **I — Discovery experiment** | Two genuinely different physical objects are enrolled from live microphone takes and a held-out report meets every pre-declared discovery gate without weakening any 4.x field gate | **OPEN** | The isolated 5.0 slice, schema v5 tables, read-only matcher, two-object guided enrollment, held-out target/unknown/distance/noise/replay protocol, confusion matrix and public Listen → Discover → Confirm handoff are implemented. No physical recordings have been made; `docs/evidence/discovery.json` is NOT_RUN with no metrics. A match is not identity or authentication. |

**Overall:** the core software and payment rail are built and locally verified, including one genuine Sandbox capture and the 4.1 field-lab pipeline. The submission is **not** go for a claim of a real paid physical demo or a completed hackathon entry. It is go for local judging of the implemented loop and the clearly labelled synthetic demo, with Gates A, E, F, G and H disclosed as OPEN.

## 2. Technical verification snapshot

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass (0 errors at the 4.1 RC run) |
| Unit + integration tests | **82/82 pass** across 17 files at the 4.1 RC run (73/73 at 4.0), including 5 field-evaluation and 4 publication-guard tests, the 11-case PayPal provider-contract harness, v3 Merkle/tamper, open-set, v3 bundle, migration, provider timeout and webhook ordering/replay assertions |
| `npm run setup` | Pass; generates 16 synthetic takes, 55 s fixture, READY model, seeded service |
| `npm run smoke` | Pass at last run (health, judge, service card, auth, CORS/CSRF) |
| Dependency audit | `npm audit` reports 0 vulnerabilities (production and full tree) |
| Hot-path benchmark | Classifier 0.00217 ms/frame, inference+hysteresis 0.00213 ms/frame, v3 proof verification 2.79 ms / 21 checks (local i5-10400F; see `docs/performance.md`) |
| Production bundle | Main JS 293.10 kB (93.43 kB gzip) after route splitting, down from 592.20 kB (172.61 kB gzip); no large-chunk warning |
| Security review | Source review, dependency audit, focused regression tests and static traversal probe completed; not an independent penetration test |
| `npm run build` | Pass at the 4.1 RC run; no large-chunk warning |
| `npm run gate:v3` | **8 PASS · 5 OPEN · 0 FAIL** at the 4.1 RC run; Gate H is present and OPEN |
| Reference model gate | READY: precision 96.30%, recall 97.16%, FBT 1.804% |
| Acoustic passport | ENROLLED at 91.48%; active median 97.50%, active P10 93.48%, non-active P95 91.26%; 3.97% active blocked, 4.37% non-active passed (calibration fit, not held-out); public local-only probe implemented |
| Signed protocol v2 | ECDSA P-256 passport and receipt-proof envelopes, canonical JSON, offline verifier, Tamper Lab, v1 legacy labelling and key-rotation tests implemented |
| Shelf and holds | Public catalogue, 10-minute local holds, poster, operator listing and drift surfaces implemented; hold race tested |
| Fixture replay | 33.47 s billable, 133 intervals, $0.11 simulated at $0.20/min, $5 cap |
| Browser E2E suite | Committed Playwright suite: **48/48 pass** across 1440×900, 834×1112 and 390×844 at the 4.1 RC run. It adds 9 calibration-lab checks (microphone-closed state, synthetic exclusion and operator auth at every viewport) to the public-proof, Tamper Lab, operator/evidence and Gate A coverage. |
| Real microphone ON/OFF cycles | Not performed here |
| Physical field trial and report | **Not performed.** No live enrollment, no held-out field trial and no `FIELD_PASS` report exist; `docs/evidence/field-test.json` is OPEN with no measurements. |
| Real PayPal order/authorization/capture | **PASS** — order/capture `COMPLETED`, authorization `CAPTURED`, USD 0.07, receipt 8/8; API-submitted interval evidence, not a live microphone |
| Verified signed webhook | Not delivered; webhook ID configured but no public HTTPS ingress |
| Public deployment/video/repo | Not performed/authorized |

## 3. What must not be claimed

- That the bundled model is accurate on a physical fan, hair dryer or any real object.
- That Sandbox money is real money, or that a demo-mode session produced a PayPal transaction.
- That the reference metrics are field measurements rather than synthetic held-out results.
- That any physical appliance has passed Whirr's field gates, or that a `USER_CALIBRATION` model is publishable without a matching `FIELD_PASS` report.
- That the field report proves a physical object was present; it is client-reported live-microphone evidence recomputed by the server.
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
| H | Create a non-synthetic object, record live idle/operating/background takes, train a `USER_CALIBRATION` model, run the three-cycle, noise, distance and replay trials with the physical appliance, generate a `FIELD_PASS` report, and have a named reviewer record the report id, model hash and date in `docs/evidence/field-test.json`. A failing gate must stay failed; do not lower thresholds. |

## 5. Decision

- **Local demo / code review:** GO, with synthetic provenance and demo mode clearly labelled.
- **Claim of a real PayPal-settled physical demo:** NO-GO until Gate A produces real-object evidence; the payment rail itself is now provider-verified.
- **Claim of a validated real-object model:** NO-GO until Gate H has a physical `FIELD_PASS` report and named reviewer confirmation.
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

## 9. Whirr 4.1 release-candidate verification

Whirr 4.1 preserves the verified 4.0 product, proof formats and PayPal Sandbox behavior, and adds the guided Real-World Calibration Lab. The lab records live takes, trains a device-specific model locally, evaluates it on held-out guided trials, writes an inspectable report and blocks publication or sessions unless that exact model has a `FIELD_PASS`.

- **Automated tests:** `npm test` — **82/82 pass** across 17 files. The new field suite covers protocol timeline validation, held-out metric arithmetic, all gate thresholds, recording quality and the publication/session guard.
- **Browser QA:** `npm run test:e2e` — **48/48 pass** across 1440×900, 834×1112 and 390×844. The 9 new calibration-lab checks cover microphone-closed rendering, synthetic-reference exclusion, operator authentication and the absence of a payment request.
- **Build and smoke:** `npm run typecheck` 0 errors; `npm run build` passes with main JS **293.10 kB / 93.43 kB gzip**; `npm run smoke` passes.
- **Gate report:** **8 PASS · 5 OPEN · 0 FAIL**. Gate H was added as OPEN; Gates A, E, F and G remain OPEN for the same external reasons as 4.0.
- **Schema:** version 4 adds `field_test_recordings` and `field_test_reports`. The migration test passes; historical proofs, passports and the Sandbox capture row are unchanged.
- **Screenshots:** 11 captures in `docs/v4/`, including the calibration lab at desktop and mobile. Both lab captures show the synthetic reference exclusion and `MIC CLOSED` with no signal trace; they are visual QA, not physical evidence.
- **Field evidence:** `docs/evidence/field-test.json` is **OPEN**, `physicalObjectTested: false`, and contains no report id, model hash or measurements. No synthetic fixture was substituted.
- **Payment:** no PayPal call was made during the lab, screenshots or field tests. The historical USD 0.07 Sandbox capture remains the only payment evidence.

**Decision:** GO for local review of the implemented lab and the labelled synthetic Judge Mode demo. **NO-GO** for any claim that a physical appliance has been validated, that Gate H or Gate A is closed, or that a field-tested model is already integrated into a paid session.

## 10. Whirr 5.0 INVISIBLE CHECKOUT (experimental)

Whirr 5.0 is an isolated question, not a release: can an ordinary unmodified object become discoverable and financially interactive through its acoustic behaviour? The code path is deliberately separate from the 4.x operational-state model, field gates, terms, session ledger and PayPal Sandbox evidence.

- **Implemented:** live two-object enrollment, deterministic medoid/band-profile matching with `MATCH`/`AMBIGUOUS`/`UNKNOWN`, held-out target and unknown trials, separate distance/noise/replay conditions, server-side confusion matrix and gates, public `/invisible-checkout`, operator `/studio/discovery`, and a deterministic narrow natural-language pricing preview that cannot publish.
- **4.x preservation:** schema v5 adds only `discovery_enrollments`, `discovery_trials` and `discovery_reports`; the existing 4.1 tables, routes, field guard, PayPal payment operations, receipts and historical proof are unchanged.
- **No financial action from a match:** the match endpoint is read-only. It returns a hypothesis, terms and a link to the existing service card. The human must still consent through the existing flow; PayPal is never called from discovery.
- **Automated checks:** `npm run typecheck` 0 errors; `npm test` **96/96 pass across 19 files**; `npm run test:e2e` **54/54 pass** across the three viewports; `npm run build` passes (main JS 293.75 kB / 93.60 kB gzip). This adds matching, ambiguity, unknown rejection, duplicate-fingerprint, confusion/replay and pricing-compiler tests, an integration test that a match creates no session or payment operation, and public/operator discovery browser checks. See `docs/discovery-5.0.md`.
- **Gate I remains OPEN:** no physical objects have been enrolled, no real microphone trial set exists, and `docs/evidence/discovery.json` contains no measurements. Do not report a confusion matrix, accuracy, latency or false-match count until the protocol has actually been run.

**Decision:** GO for local code review and the implemented guided workflow. **NO-GO** for claiming that sound establishes object identity, ownership, authentication, tamper-proof usage, or a validated discovery/false-match result. The 4.x Gate H remains OPEN for the same physical-evidence reason.

## 11. Whirr 6.0 physical promise engine release candidate

Whirr 6.0 adds teachable physical agreements without altering the released 4.x evidence, payment state machine, discovery experiment or proof formats. The new path is isolated in `packages/promise`, the 6.0 domain module, additive schema-6 tables, the promise routes, and the `/promise` and Teaching Room surfaces.

- **Implemented behavior:** feature-only demonstration upload; local event training with per-demonstration prototypes; open-set refusal; READY/LIMITED/REJECTED gate; typed fixed-price agreement compiler; owner approval; buyer consent; live microphone observation; deterministic temporal eligibility; incomplete, uncertain, sensor-loss and extra-cycle outcomes; PayPal Sandbox order, authorization, capture and void integration; re-evaluation immediately before capture; signed `whirr.physical-proof.v1`; independent proof recomputation; demo executions that cannot capture.
- **Preservation:** schema v6 adds tables only. Existing 4.x routes, tables, receipts, historical Sandbox evidence and proof verifiers remain. `main` remains at `982b0ba`; 6.0 is on `experiment/whirr-6-physical-promise`.
- **Automated checks:** `npm run typecheck` exit 0; `npm test` **115/115 pass across 21 files**; `npm run test:e2e` **57/57 pass** at 1440x900, 834x1112 and 390x844; `npm run build` passes (main JS 295.18 kB / 93.91 kB gzip); `npm audit --omit=dev` reports 0 vulnerabilities.
- **Promise reconciliation:** the operator event-model review endpoint is scoped to the owning operator. A verified webhook resolves a promise only through stored provider ids and performs a read-only provider lookup. A capture is confirmed only when the provider reports `COMPLETED`, the amount matches the stored qualified evaluation and ceiling, and the stored evidence replays to the same evaluation hash. Amount mismatch, nonqualifying evidence and a voided authorization are covered by fake-provider tests. No genuine PayPal webhook has been delivered.
- **Proof checks:** the reconstructed integration proof verifies all domains. Mutating a signed observation causes signature failure. The sealed reference proof `ppr_91f4d444ed224ff98761e1e35fc59841` returns valid for signature, agreement, model, observations, evidence root, evaluation and payment consistency. It is a **demo proof**, not provider settlement.
- **Visual QA:** `docs/v6/promise-1440.png`, `docs/v6/promise-834.png`, `docs/v6/promise-390.png` and `docs/v6/promise-detail-1440.png` show the catalog and agreement at the three required sizes. No page-level horizontal overflow was observed.
- **Physical field gate OPEN:** no physical appliance was recorded, no held-out real cycles exist, and no field report exists. `docs/evidence/physical-promise-6.0.json` is `OPEN_NOT_RUN`.
- **6.0 PayPal gate OPEN:** no genuine 6.0 Sandbox buyer approval, authorization, capture, void or webhook delivery occurred. Tests use a provider-contract fake. The historical 4.x capture is not presented as 6.0 evidence.
- **Release/submission gates OPEN:** no public push, deployment, YouTube video or Devpost submission is claimed.

**Decision:** GO for local review of the implemented physical promise workflow and the labelled synthetic judge path. **NO-GO** for claiming physical field accuracy, a completed physical trial, a genuine 6.0 PayPal settlement, verified webhook delivery, public deployment, or hackathon submission until those external actions are performed and recorded.

## 12. Whirr 7.0 AMBIENT release candidate

Whirr 7.0 adds buyer-initiated physical cooperation without changing the released 4.x, 5.0 or 6.0 evidence and without closing their external gates. The new path is isolated in `packages/ambient-engine`, the schema-7 Ambient domain and routes, the four Ambient surfaces, the signed `whirr.ambient-proof.v1`, and the independent Ambient verifier.

- **Release identity:** package version `7.0.0-rc.1`; branch `main`; base 6.0 `main` at `45e92e8a92c3b83117f9fcbc7807e21a102a2bfd`.
- **Automated tests:** `npm test` — **133/133 pass across 23 files**. This includes the Ambient-focused **18/18** (`11` unit and `7` integration), the published-source catalog test, the demo replay ladder, exact-terms/role tests, evaluator interruption/continuity cases, payment invariants, and the preserved 4.x/5.0/6.0 suites.
- **Browser QA:** `npm run test:e2e` — **57/57 pass** at 1440×900, 834×1112 and 390×844. The suite covers the public surfaces, the four Ambient surfaces, Judge Mode, the public proof, and authenticated operator/evidence pages, with page-level horizontal-overflow and runtime-error checks.
- **Build and smoke:** `npm run typecheck` exits 0; `npm run build` passes with main JS **297.25 kB / 94.43 kB gzip**; `npm run smoke` passes.
- **Wish source binding:** `GET /api/ambient` now returns published `sources` separately from agreement histories. A source requires an active object, a current READY event model, and either published service terms or an owner-approved Physical Promise. Compile and agreement creation reject `SOURCE_NOT_READY` and recheck model id, hash and dataset hash. This closes the software binding gap; it does not enroll or test a physical object.
- **Reference proof:** agreement `ase_reference_qualified`, terms hash `0f8d41e02b0c70a80f705e5b666e7b440d99ec8100f072c523c3b2c8726a43fd`, proof `apr_f83736365f6d462297858f16f8cf5578`. The independent verifier reports **14/14 Ambient checks** passing; the standalone CLI prints **15 PASS** lines including signed-envelope validation. Provenance is **SYNTHETIC_REFERENCE**, not a physical field trial.
- **Browser negotiation flow:** a buyer created a wish, the local provider accepted the exact terms, the buyer accepted the final terms, and the resulting demo window opened. The provider was a local test identity, not an independent external operator.
- **Replay behavior:** a new demo session generates a labelled two-interval replay ladder; it remains `OBSERVING` until the user evaluates it. Demo sessions cannot create an order, authorization or capture.
- **Schema:** version 7 is additive. Existing tables, historical Sandbox rows, 4.x receipts, 5.0 discovery rows and 6.0 promise rows are not rewritten.
- **Screenshots:** eight true-viewport captures in `docs/v7/` at 1440 and 390 widths. All eight were visually inspected; a Judge summary-card identifier overflow at 1440 was fixed with wrapping and recaptured, and the Wish/overview captures were refreshed for the published-source catalog. No page-level horizontal overflow was observed. This is visual QA, not physical evidence.

### 7.0 release gates

| Gate | Requirement | Status | Scope / what remains |
| --- | --- | --- | --- |
| **A — Real source enrollment** | A real appliance is recorded, calibrated and bound as a published source | **OPEN** | The published-source binding path is implemented. No physical appliance was recorded in this checkout; the reference model and observations are synthetic. |
| **B — Source observability** | Target operating state is distinguished from declared negative conditions | **OPEN** | Deterministic unit/integration cases pass; no genuine appliance, microphone or environmental drift trial was performed. |
| **C — Physical window evaluation** | One genuine interrupted and one genuine qualifying observation are evaluated | **OPEN** | Replay and adversarial software cases pass. No physical pair exists. |
| **D — Agreement consent** | Both authorized parties approve the correct immutable terms | **PASS** | Local buyer/provider roles approved the same exact terms through participant-scoped browser flows; superseded revisions are not capture-eligible. This is local software consent, not an external provider study. |
| **E — Correct PayPal authorization** | The buyer approves the correct Sandbox authorization | **OPEN** | The 7.0 order/authorization path is implemented. No genuine 7.0 buyer approval exists. The historical 4.x USD 0.07 capture is separate and is not reused as 7.0 evidence. |
| **F — Financial failure safety** | A failed agreement causes no unintended capture | **OPEN** | Fake-provider, duplicate, timeout, mismatch, expiry and interrupted-window tests pass. No genuine provider failure sequence was executed. |
| **G — Financial success** | A qualifying, accepted agreement produces an authoritative Sandbox capture | **OPEN** | No genuine 7.0 authorization, capture, void or provider reconciliation occurred. |
| **H — Genuine webhook** | An authentic PayPal-signed event is ingested and verified | **OPEN** | Signature verification, deduplication and reconciliation are implemented and tested; no public ingress and no genuine signed delivery exist. |
| **I — Independent proof** | The released verifier validates an agreement and rejects defined tampering | **PASS** | The verifier recomputes the signed synthetic reference agreement and rejects altered terms, observations, acceptance and payment fields. It cannot establish physical truth or current provider state offline. |
| **J — Product comprehension** | Genuine users understand request, compensation, failure and outcome | **OPEN** | No external comprehension test was run. |
| **K — Public submission** | Public source, license, setup, demo video and Devpost entry are complete | **OPEN** | No push, deployment, public video or Devpost submission was performed. |

**Decision:** GO for local review of the implemented Ambient workflow, the signed synthetic proof, and the clearly labelled replay demonstration. **NO-GO** for claiming a genuine physical Quiet Window, 7.0 PayPal settlement, verified webhook delivery, participant validation, public deployment, or hackathon submission. Gates A, B, C, E, F, G, H, J and K remain OPEN; Gate D and Gate I are closed only in the local/synthetic scope stated above.
