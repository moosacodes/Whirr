# Hackathon compliance

**Competition:** PayPal AI Hackathon  
**Rules source:** official Devpost rules provided by the entrant, version visible 8 November 2026. Recheck <https://paypalaihackathon.devpost.com/rules> before submission.  
**Deadline referenced by the PRD:** 12 November 2026, 3:00 PM EST / 12:00 PM PST. Confirm the current official deadline and timezone.

This document maps the implemented repository to the rules and marks what is complete versus still open. It is not a claim that the project has been submitted or that any prize is likely.

## 1. Required-platform centrality

| Requirement | How Whirr uses it | Status |
| --- | --- | --- |
| Meaningful PayPal developer platform use (Sandbox) | Real Orders v2 authorize and Payments v2 capture flow, void/refund, provider reconciliation, signature-verified webhooks, idempotency and persistent operation state. Not a decorative checkout. | **Implemented; live Sandbox capture PASS** — USD 0.07, provider status COMPLETED; signed webhook remains OPEN |
| Actual AI model/tool use | A locally trained multinomial logistic regression over 21 acoustic features, deterministic training, leave-one-take-out evaluation, precision-first gate, an acoustic-passport spectral consistency gate, on-device inference and hysteresis, plus a public local-only probe that scores live room audio against the enrolled soundprint. No LLM or cloud inference is used; the AI is the small metering model, not copy generation. | **Implemented and tested on synthetic data**; real-object recording OPEN |
| Both are central to the product | The product is “physical activity → confidence-aware usage → consented cap → provider-settled payment”. Neither side is an add-on. | **PASS**; genuine Sandbox authorization and capture completed, on synthetic metering evidence |

## 2. Rule-by-rule obligations

| Rule area | Obligation | Implementation / evidence | Status |
| --- | --- | --- | --- |
| Dates | Build within window; submit before deadline | Project built 8 Nov 2026; deadline not yet reached at time of writing | **OPEN** (submission action) |
| Eligibility | Entrant must meet age/jurisdiction rules | Entrant responsibility; not verifiable in code | **OPEN** |
| Functionality | Working installed application matching the video, not a static mockup | Full local app, seeded data, real inference and provider client; no video exists yet | **Partially complete** |
| Access | Public build **or** complete reproducible setup for judges | Reproducible repo path: `npm install && npm run setup && npm run dev`; no public deployment | **Local path available; public repo access OPEN** |
| Repository | Public GitHub/GitLab/Bitbucket, full source, license at root | MIT `LICENSE` at root; no remote repository initialized in this checkout | **OPEN** (publish repository) |
| Video | Public YouTube, under 3 minutes preferred, functioning product, no unlicensed media | Script prepared; no video recorded or uploaded | **OPEN** |
| Description | Name, detailed explanation, tools/AI usage, accurate limitations | README, architecture, model card, safety, evaluation, go/no-go | **Complete** |
| New/existing | Built during window or significantly updated; document work | All implementation created for this project; no reused Ravel code | **Complete** |
| IP | Original work; third-party licenses respected; no unauthorized media | MIT license; open-source dependencies; synthetic audio generated in-repo; no third-party datasets or music | **Complete** |
| Stage 1 | Theme and required-platform relevance | Ordinary object → acoustic AI → PayPal metered payment | **PASS by design** |
| Stage 2 criteria | Technical implementation, design, impact, innovation, presentation | Technical depth and UI present; impact validation and presentation artifacts incomplete | **Partially complete** |
| Claims | No guaranteed award, no fabricated results | Receipts label demo; metrics label synthetic; gates exposed; no revenue or customer claims | **Complete** |

## 3. Submission checklist

| Artifact / requirement | Location | Status |
| --- | --- | --- |
| Open-source license at repository root | `LICENSE` (MIT) | **Present** |
| README with setup/run instructions | `README.md` | **Present** |
| Architecture documentation | `docs/architecture.md` | **Present** |
| Model card | `docs/model-card.md` | **Present** |
| Safety documentation | `docs/safety.md` | **Present** |
| Evaluation with real measured metrics and caveats | `docs/evaluation.md` | **Present (synthetic provenance)** |
| PayPal Sandbox documentation | `docs/paypal-sandbox.md` | **Present** |
| Compliance mapping | `docs/hackathon-compliance.md` | **Present** |
| Honest go/no-go gates | `docs/go-no-go.md` | **Present** |
| Environment template | `.env.example` | **Present** |
| Setup/seed commands | `npm run setup`, `npm run seed`, `npm run key` | **Present and runnable** |
| Automated tests | 34 unit/integration tests + smoke script | **Present and passing at last run** |
| Real Sandbox order/authorization/capture evidence | `docs/paypal-sandbox.md`; order `77T95682L88230118`, authorization `783967879W676894R`, capture `7YY23328DP2020327`, USD 0.07, COMPLETED | **PASS** (simulated Sandbox funds) |
| Verified signed webhook evidence | Webhook ID configured; no public HTTPS ingress or delivered event | **OPEN** |
| Real-object recording and field evaluation | — | **OPEN** (synthetic only) |
| Public repository URL | — | **OPEN** |
| Public YouTube video under 3 minutes | — | **OPEN** |
| Devpost narrative and screenshots | Draft in `docs/demo-script.md`; final copy/screenshots | **OPEN** |
| Publicly accessible working build | — | **OPEN** (local reproducible path only) |

## 4. Honest description text (for Devpost)

> Whirr turns an ordinary object into a consent-based, usage-metered service using the microphone already in the room. An operator teaches idle and active sounds; a locally trained classifier predicts operation on-device; an acoustic passport asks whether the active sound still resembles the enrolled object; precision-first hysteresis refuses to bill ambiguous time; the renter approves a hard cap in PayPal Sandbox; only confident, passport-matching active seconds are billed, and a hash-linked receipt exposes the evidence. No new hardware and no object firmware.
>
> **Implemented and demonstrated locally:** the full teach → price → consent → meter → review → settle loop, real local inference, deterministic billing, demo-mode fallback without credentials, and a genuine PayPal Sandbox authorization → partial capture → verified receipt. Void, refund, reconciliation and raw-body webhook signature verification are implemented; no signed webhook was delivered in this checkout.
>
> **Limitations:** the bundled model and passport are fitted on synthetic audio and are not evidence of real-object accuracy. A real PayPal Sandbox authorization and capture was completed and provider-reconciled, but it metered a synthetic session; no real-object recording or verified signed webhook exists. A microphone cannot detect playback or disambiguate identical machines; the passport is a calibration-fit consistency check, not identity proof. Whirr is scoped to supervised venues, is not a lock, and does not claim tamper-proof or unattended security. Public deployment, video and final field recordings remain open.

## 5. Presentation guidance

- Lead with the physical object and the problem, not the architecture.
- Show a real microphone if recording your own object; otherwise label the synthetic replay prominently.
- Show the Sandbox checkout and provider status if credentials are configured; otherwise show demo mode and say no payment was processed. Never imply a demo completion is a capture.
- Show uncertainty and excluded time; the fairness mechanism is the interesting part.
- Disclose spoofing and identical-device limits in the video and Devpost text.
- Keep the video under three minutes; do not use copyrighted music or trademarks you do not own.
- Keep the repository accessible through judging. A temporary tunnel is not durable hosting.

## 6. Recheck before submission

1. Official deadline, eligibility, judging criteria and prize language.
2. That the public repository is visible in a logged-out browser.
3. That the license appears at the root and in the repository About section.
4. That the video is public, under three minutes and contains no unlicensed media.
5. That all screenshots and receipts redact secrets, cookies, full provider IDs and personal data.
6. That the PayPal evidence (if any) is genuine, Sandbox-only and reproducible.
7. That the Devpost text matches what the app actually does and does not overstate accuracy, security or payment success.
