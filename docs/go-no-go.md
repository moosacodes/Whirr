# Go / no-go gates

**Assessment date:** 9 November 2026  
**Environment:** local checkout on Windows, Node 24, PayPal Sandbox credentials configured, one genuine Sandbox capture completed, no real-object recordings, no public deployment.  
**Status legend:** **PASS** = verified in this checkout; **OPEN** = not verified or external action required; **FAIL** = verified failure.

This is the canonical gate list. A green indicator in Judge Mode does not override an open external deliverable here. The project is **not** self-certified as submission-complete.

## 1. PRD release gates

| Gate | Requirement | Status | Evidence / what remains |
| --- | --- | --- | --- |
| **A — Core** | Three separate live ON/OFF cycles classified from actual sensor input | **OPEN** | The browser pipeline, AudioWorklet, model loading, soundprint gate, hysteresis and fixture replay are implemented. No physical-object recording or live three-cycle session has been performed in this checkout. Automated/synthetic replay is not Gate A. |
| **B — Truth** | Measured false-billable time and limitations reported | **PASS (synthetic scope)** | `docs/evaluation.md` reports held-out precision 96.30%, recall 97.16%, FBT 1.804%, the passport fit statistics (ENROLLED at 91.48%, 3.97% active blocked, 4.37% non-active passed), method and hashes, explicitly labelled synthetic. Limitations are in the model card, safety, threat model and UI. Field false-billable measurement remains OPEN. |
| **C — Pricing** | Deterministic quote and cap invariant proven | **PASS** | Integer minor-unit pricing, one rounding, cap, credits-only-reduce, zero-never-captured; unit/property and integration tests pass. |
| **D — Payment** | One human-approved Sandbox transaction captured and provider-reconciled, or clearly qualified | **PASS** | Human-approved Sandbox order `77T95682L88230118` and capture `7YY23328DP2020327` reached `COMPLETED`; authorization `783967879W676894R` is `CAPTURED`. Captured **USD 0.07**; the receipt now recomputes **8/8** checks, including passport exclusions added after the capture. The interval evidence was submitted through the authenticated API for this payment test, not recorded from a physical microphone. See `docs/paypal-sandbox.md`. |
| **E — Security** | Safe webhook ingress and verified real signed event; no exposed admin actions | **OPEN** | Raw-body signature verification, dedup, audit, CSRF/origin checks, auth and loopback binding are implemented and unit-tested. No real signed webhook or HTTPS ingress exists. A dedicated webhook-only public proxy is not shipped. |
| **F — Judges** | Clean install, public repo and license, accurate demo video and docs | **OPEN** | Clean local install/setup is reproducible and MIT license is present. Public repository, video and final Devpost submission do not exist yet. |
| **G — Presentation** | A stranger understands the premise before the architecture | **OPEN** | Landing, Judge Mode, service flow and demo script are built. No five informal comprehension tests or recorded presentation were performed. |

**Overall:** the core software and payment rail are built and locally verified, including one genuine Sandbox capture. The submission is **not** go for a claim of a real paid physical demo or a completed hackathon entry. It is go for local judging of the implemented loop, with the remaining gaps above disclosed.

## 2. Technical verification snapshot

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pass (0 errors at last run) |
| Unit + integration tests | 51/51 pass at last run (41 original + 6 protocol + 1 migration + 3 protocol-v2 integration) |
| `npm run setup` | Pass; generates 16 synthetic takes, 55 s fixture, READY model, seeded service |
| `npm run smoke` | Pass at last run (health, judge, service card, auth, CORS/CSRF) |
| Dependency audit | `npm audit` reports 0 vulnerabilities (production and full tree) |
| Security review | Source review, dependency audit, focused regression tests and static traversal probe completed; not an independent penetration test |
| `npm run build` | Pass at last run |
| Reference model gate | READY: precision 96.30%, recall 97.16%, FBT 1.804% |
| Acoustic passport | ENROLLED at 91.48%; active median 97.50%, active P10 93.48%, non-active P95 91.26%; 3.97% active blocked, 4.37% non-active passed (calibration fit, not held-out); public local-only probe implemented |
| Signed protocol v2 | ECDSA P-256 passport and receipt-proof envelopes, canonical JSON, offline verifier, Tamper Lab, v1 legacy labelling and key-rotation tests implemented |
| Shelf and holds | Public catalogue, 10-minute local holds, poster, operator listing and drift surfaces implemented; hold race tested |
| Fixture replay | 33.47 s billable, 133 intervals, $0.11 simulated at $0.20/min, $5 cap |
| Browser E2E suite | Not implemented; manual Chromium passes checked the passport page, service card, receipt and probe permission/cancel states |
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
