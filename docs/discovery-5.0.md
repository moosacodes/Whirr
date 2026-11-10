# Whirr 5.0 — INVISIBLE CHECKOUT

**Status: experimental vertical slice. Not validated. No physical recordings. Gate I remains OPEN.**

Whirr 5.0 asks one question: **can an ordinary, unmodified physical object become discoverable and financially interactive through its observable acoustic behaviour?**

This is not a claim that it can. It is a falsifiable experiment. The code can enroll two genuinely different objects, match a new live recording against them, refuse ambiguous or unknown signals, and hand a human to the existing 4.x checkout. It cannot establish identity, ownership, consent, physical presence or replay resistance.

## 1. What Whirr actually recognises

Whirr 4.1 makes three different claims, and 5.0 adds a fourth hypothesis. They must not be collapsed:

| Claim | 4.x evidence | What it does **not** prove |
| --- | --- | --- |
| **Operational state** | A per-object model classifies `ACTIVE_CONFIDENT`, `IDLE`, `UNCERTAIN` or `DISCONNECTED` from live features. | That the object is the enrolled unit, or that a human is using it. |
| **Object category** | Operator-assigned metadata (`fan`, `hair_dryer`, …). | That the recording belongs to that category. |
| **Individual object identity** | A soundprint can make a confident active frame `UNCERTAIN` if it no longer resembles the enrolled profile. | Identity, ownership, uniqueness, tamper resistance or presence. |
| **5.0 discovery hypothesis** | A new, read-only matcher returns `MATCH`, `AMBIGUOUS` or `UNKNOWN` from a short live recording. | Any of the above. A match is a suggestion for a human. |

The 4.x field guard, terms, session ledger, receipt and PayPal Sandbox path are untouched. Discovery enrollment is separate evidence with its own tables and matcher. It does not alter `model_versions`, `price_terms`, `sessions`, `observed_intervals` or the field-test report.

## 2. Prior art and known limitations

Acoustic machine identification is an established sensing problem, not a new cryptographic primitive. Relevant families include:

- **Machine acoustic fingerprinting** — e.g. US8983677B2, which describes extracting acoustic fingerprints to identify a machine or its operating condition.
- **Appliance state identification from sound** — e.g. Pathak et al., “Acoustic based appliance state identification for activity recognition,” IEEE PerCom 2015. It shows that machine state can be inferred from microphones, while remaining sensitive to placement and environment.
- **Acoustic source identification** — e.g. US20210020018A1, which describes identifying an acoustic source from captured signals.
- **Non-intrusive load monitoring (NILM)** — a large literature, summarised in PMC6720010, uses electrical signatures rather than sound but shares the core limits: confusable loads, installation variation, noise and generalisation.
- **One-class acoustic device authentication** — recent work such as AudioUnlock (2025) explores acoustic fingerprints for device authentication, but also illustrates the replay and environmental sensitivity problem.

This prototype deliberately does **not** claim to advance that literature. It reuses a very small, inspectable representation: an eight-band amplitude-invariant spectral profile plus coarse spectral ratios, deterministic medoids, cosine similarity, a score threshold and a margin threshold. The experiment is designed to be reproduced and to fail visibly.

Known limitations, stated before any result:

- Identical or similar appliances may be indistinguishable; a match is not a unique serial number.
- Distance, orientation, microphone, room reverberation and competing machines change the spectrum.
- A phone or speaker can replay a recording. There is no liveness detector.
- Enrollment provenance is **client-claimed live microphone** input. The server can validate frame structure and quality flags, not physical presence.
- A strong score is a similarity result, not a probability of identity.
- The matcher is intentionally small. It is not a production biometric or security system.

## 3. Measurable protocol (pre-declared, not tuned after results)

The protocol is frozen in `packages/audio/src/discovery.ts` and mirrored by the UI and evidence record.

### Enrollment

- At least **two genuinely different objects**, each with at least **two separate live takes**.
- At least **30 usable frames** per take and **60% usable-frame ratio** per take.
- Duplicate fingerprints within an enrollment are rejected.
- The profile is built from frozen features only; raw audio is never uploaded or stored.
- `READY` requires two takes and at least one deterministic medoid.

### Held-out trials

A trial is a **new recording**, never an enrollment take. The server rejects an exact duplicate of a stored enrollment fingerprint. The required minimum set is:

| Condition | Minimum |
| --- | ---: |
| Target trials (baseline, distance and noise conditions) | 12 total, 6 per object |
| Unknown-object trials | 6 |
| Replay trials | 3 |
| Distance trials (1 m and 2 m) | 3 |
| Noise trials (room and another appliance) | 3 |

A target trial counts as correct only when the result is `MATCH` and the top object is the truth object. `AMBIGUOUS` and `UNKNOWN` are not silently counted as correct target discoveries. Unknown rejection counts both `UNKNOWN` and `AMBIGUOUS` as rejection; any `MATCH` on an unknown is a false match.

### Gates

| Gate | Threshold |
| --- | --- |
| Target discovery accuracy | ≥ 90% |
| Unknown-object rejection | ≥ 90% |
| False-match rate on unknowns | ≤ 5% |
| Replay cross-object match rate | ≤ 5% |
| Distance accuracy | ≥ 80% over at least 3 trials |
| Noise accuracy | ≥ 80% over at least 3 trials |
| Median server match latency | ≤ 250 ms |
| Mean usable-frame ratio | ≥ 60% |

The report status is `NOT_RUN`, `INCOMPLETE`, `PASS` or `FAIL`. An incomplete protocol cannot become a PASS. Replay matching its own object is reported separately as a known limitation, not treated as authentication.

## 4. Architecture

```
browser capture
  → frozen 21-feature frames (no raw audio)
  → POST /api/discovery/match (read-only)
  → medoid band-profile similarity
  → MATCH / AMBIGUOUS / UNKNOWN
  → human sees object hypothesis + existing published terms
  → existing /s/:objectId consent + field guard
  → existing 4.x session / PayPal authorization / receipt
```

New tables (schema v5):

- `discovery_enrollments` — one profile per object, profile JSON, hash, status.
- `discovery_trials` — truth object, condition, frozen result, score, margin, latency, quality, capture metadata and evidence hash. **No raw audio.**
- `discovery_reports` — the server-recomputed report and its evidence hash.

New API:

- `GET /api/discovery` and `GET /api/discovery/report` — public read-only evidence.
- `POST /api/discovery/match` — public read-only hypothesis; never creates a session or payment operation.
- `GET /api/operator/discovery` — operator lab.
- `POST /api/operator/objects/:id/discovery/enrollment` — enrollment.
- `POST /api/operator/discovery/trials` — held-out trial.
- `DELETE /api/operator/discovery/trials/:trialId` — discard a trial and invalidate the old report.
- `POST /api/operator/discovery/report` — regenerate the report.

The match endpoint has no session creation, no PayPal call and no write to `sessions` or `payment_operations`. When a match is `MATCH` and the object is eligible, the response contains the existing terms and a link to `/s/:objectId`; the human must still pass the existing 4.x terms, field validation and PayPal authorization.

## 5. Product experience

`/invisible-checkout` presents **Listen → Discover → Confirm → Use → Settle**:

1. **Listen** — one explicit live six-second capture. `MIC CLOSED` is shown before and after.
2. **Discover** — `MATCH`, `AMBIGUOUS` or `UNKNOWN` with the actual score, margin, latency and candidate list.
3. **Confirm** — for a passing match only, the object name, rate, cap, uncertain-time policy and a checkout link. No session is created by the match.
4. **Use** — the existing Listening Room and 4.x operational-state meter.
5. **Settle** — the existing review, PayPal Sandbox authorization/capture, receipt and proof path.

The operator route `/studio/discovery` provides enrollment, held-out trials, report, confusion matrix and a narrow natural-language pricing preview.

### Natural-language pricing prototype

`packages/meter/src/pricing-rule.ts` deterministically compiles only:

- an explicit per-minute rate, or an hourly rate that converts to an exact integer minor-unit per-minute rate;
- a hard cap;
- an explicit uncertain/ambiguous exclusion.

It rejects time-of-day, peak, weekend, surge, discounts and other unsupported clauses. It returns a preview with `ownerApprovalRequired: true` and **does not save or publish**. Publication still uses the existing owner-approved pricing endpoint and its field-validation guard.

## 6. Evidence status

`docs/evidence/discovery.json` is deliberately **NOT_RUN**:

- no physical objects enrolled;
- no live target, unknown, distance, noise or replay trials;
- no confusion matrix, false-match count, latency or accuracy;
- no report id or evidence hash.

No synthetic fixture or 4.x metric is substituted for a 5.0 physical result. If physical recordings are unavailable, the guided capture workflow is implemented and the real-world outcome remains unverified.

## 7. Security and truthfulness limits

- **Never authentication.** The matcher cannot prove identity, ownership, presence or consent.
- **Never an automatic charge.** A match only produces a hypothesis and, conditionally, a link. The existing human consent and payment flow remains mandatory.
- **Replay is unresolved.** A speaker can reproduce the spectrum. The experiment reports replay cross-matches; it does not claim liveness.
- **Client-claimed provenance.** The server validates structure and quality, not that a microphone was physically present.
- **Field gates unchanged.** A live-trained 4.x model still needs its exact `FIELD_PASS` report before terms or sessions.
- **No public claim.** Nothing in this slice is deployed, published or promoted; the branch is experimental.

## 8. Judge-facing demonstration

1. Open `/judge` and verify the preserved 4.x gates and historical Sandbox evidence.
2. Open `/studio/discovery` as operator. Show the two-object requirement and the `MIC CLOSED` capture panels.
3. Enroll two genuinely different objects with two separate live takes each. Do not present synthetic takes as physical evidence.
4. Record held-out target, unknown, distance, noise and replay trials. Show that the server stores a frozen result, not raw audio.
5. Generate the report. Read the actual confusion matrix and failures. If the report is `INCOMPLETE` or `FAIL`, say so.
6. Open `/invisible-checkout`. Listen to one object. Show a `MATCH` leading only to the existing terms/checkout link, and show `UNKNOWN` for an unenrolled source.
7. Follow the existing consent, authorization and receipt flow. Point out that discovery never captured money.
8. State the limit plainly: this experiment tests whether sound can be a **discovery** interface; it does not establish secure identity.

## 9. Reproduction

```bash
npm install
npm run setup          # synthetic 4.x reference; does not create 5.0 evidence
npm run dev            # API 127.0.0.1:8787, web 5173
npm run typecheck
npm test
npm run build
```

For the physical experiment, use `/studio/discovery` with two real objects and follow the protocol. Preserve the generated report and update `docs/evidence/discovery.json` only with measured values. A failed gate stays failed; do not lower thresholds after seeing results.

## 10. Local verification (code, not physical evidence)

Verified on 9 November 2026 on the experimental branch:

- `npm run typecheck` — **0 errors**.
- `npm test` — **96/96 pass across 19 files**. New coverage includes target matching, ambiguous two-object rejection, unknown rejection, duplicate-fingerprint rejection, confusion/false-match arithmetic, replay cross-match failure, the pricing compiler, the two-object enrollment/report path and an integration test that a match creates no session or payment operation.
- `npm run build` — pass; main JS **293.75 kB / 93.60 kB gzip**. The new routes are separate lazy chunks (`InvisibleCheckout` 10.97 kB / 3.72 kB gzip; `DiscoveryStudio` 21.59 kB / 6.90 kB gzip).
- `npm run test:e2e` — **54/54 pass** across 1440×900, 834×1112 and 390×844. Six new checks cover the public microphone-closed/read-only state and operator authentication; no session or PayPal request is made by the public page.
- **Not performed:** any physical microphone enrollment, any real held-out trial, any PayPal call from discovery. `docs/evidence/discovery.json` remains `NOT_RUN`.
- **Not performed:** deployment, publication or a public claim. The branch is local only.

The test suite proves the implemented protocol and guards. It does not turn synthetic or automated frames into physical evidence, and it does not establish a discovery accuracy result.

## 11. References consulted

- US8983677B2, *Machine acoustic fingerprinting* — <https://patents.google.com/patent/US8983677B2/en>
- Pathak et al., “Acoustic based appliance state identification for activity recognition,” IEEE PerCom 2015.
- *Non-intrusive load monitoring: a review* — <https://pmc.ncbi.nlm.nih.gov/articles/PMC6720010/>
- US20210020018A1, *Acoustic source identification* — <https://patents.google.com/patent/US20210020018A1/en>
- AudioUnlock (2025), one-class acoustic device authentication; cited as related work, not as a validated result in this checkout.

These sources establish that acoustic machine/state identification is an active sensing problem with known environmental and replay limits. They do not validate this prototype.
