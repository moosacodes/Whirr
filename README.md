# Whirr Bench

**Borrow the tool. Pay for the work.**

Whirr 4.0 turns an ordinary shared-workshop tool into a pay-per-use service **by listening to it**. No lock, dongle or firmware. A member opens the tool’s bench card, authorizes a hard cap in PayPal Sandbox, and uses the machine normally. The browser hears it run, bills only confident running minutes, and gives both sides a signed receipt that can be verified offline.

The product bet is a category, not a dashboard: **acoustic pay-per-use for physical equipment that already exists**. The object stays ordinary; the payment boundary and the evidence become programmable.

> **Release candidate 4.0.0-rc.1 (9 November 2026):** the Whirr Bench product surface, workshop-first discovery, sound-tag identity, Listening Room, responsive renter flow, browser evidence and demo assets are implemented. The 3.0.1 hardening, proof protocol and historical Sandbox capture are preserved. No physical-object Gate A evidence, genuine public webhook, public submission or five-person usability study exists in this checkout. See [`docs/go-no-go.md`](docs/go-no-go.md) and the [4.0 release notes](docs/release-notes-4.0.0-rc.1.md).

---

## What is genuinely built

| Area | Implementation |
| --- | --- |
| Sensing | Browser microphone → 16 kHz AudioWorklet → 21 frozen acoustic features per 32 ms frame |
| AI | Multinomial logistic regression trained locally; deterministic seed; no cloud API and no API key |
| Acoustic passport | Public, per-object spectral profile plus a conservative identity gate; a confident active frame that does not resemble the enrolled object becomes `UNCERTAIN` and free |
| Passport probe | Public, local-only microphone comparison against the enrolled soundprint; no session, no upload, no charge |
| Decision policy | EMA smoothing + precision-first hysteresis; `ACTIVE_CONFIDENT`, `IDLE`, `UNCERTAIN`, `DISCONNECTED` |
| Privacy | Raw audio never leaves the browser. Calibration uploads feature vectors; sessions upload sealed state intervals only |
| Billing | Integer minor units, one half-up rounding at the end, hard consented cap, credits only reduce, zero is never captured |
| PayPal | Orders v2 `AUTHORIZE`, Payments v2 partial capture, void, refund, reconciliation, idempotency keys, raw-body webhook signature verification |
| Evidence | Hash-chained audit log, per-interval evidence hashes, session evidence root, stored receipt, independent verification endpoint |
| Portable proof v3 | Signed `whirr.proof-bundle.v3`: Merkle interval proofs, separate integrity/sensing/payment trust domains, capture provenance, redacted public bundle, QR, `/proof/:id`, CLI pinning and a single-file offline verifier |
| Live intelligence | Open-set `UNKNOWN_OBJECT` / `LOW_CONFIDENCE` rejection, aggregated interval explanations, sensor diagnostics, bounded retry queue and interval-only replay |
| Payment recovery | Authorization expiry, guarded reauthorization before usage, four-state payment timeline, webhook-only loopback proxy and no live PayPal calls |
| 4.0 bench experience | Workshop-first landing, sound-tag bench cards, rate/cap/calibration discovery, consent ticket and a dark Listening Room driven by the real eight-band signal |
| Product surfaces | Landing, Bench, Judge Mode, Object Studio, Capture Lab, Model Review, guided Gate A trials, Acoustic Passport, Pricing Composer, Service Card/QR, Renter Consent, Live Session, Review & Settlement, Receipt, Operator Console, Offline Demo |
| Safety | Operator key authentication, signed cookies, CSRF/origin checks, rate limits, CSP, ownership checks, body limits, no live PayPal host permitted |

The bundled reference model is trained on procedurally synthesised fan audio. Its measured metrics demonstrate the pipeline; they are **not** evidence of accuracy on a physical fan.

The local AI is deliberately small: a 21-feature logistic regression that runs in the browser. No LLM, cloud call or API key is part of metering. An LLM cannot hear a fan or produce a billable interval, so adding one would be a cosmetic AI label rather than a better meter.

## Quick start

Requirements: **Node.js 24 or newer**, npm, and a Chromium-based browser with microphone access. No paid service, API key or hardware purchase is required.

```bash
npm install
npm run setup       # generate synthetic fixtures, train + seed the reference service
npm run dev         # API on 127.0.0.1:8787, web on localhost:5173
```

Open:

- Whirr Bench: <http://localhost:5173> and <http://localhost:5173/shelf>
- Judge evidence: <http://localhost:5173/judge>
- Offline verifier and Tamper Lab: <http://localhost:5173/verify>
- Standalone verifier (no application imports): <http://localhost:5173/verify-offline.html>
- Seeded service card: <http://localhost:5173/s/obj_reference_fan>
- Seeded acoustic passport: <http://localhost:5173/passport/obj_reference_fan>
- Guided Gate A trials (operator): <http://localhost:5173/studio/objects/obj_reference_fan/gate-a>
- Offline replay: <http://localhost:5173/demo/offline>

Read the generated operator key only when you need to sign in:

```bash
npm run key
```

Paste it at <http://localhost:5173/operator/login>. The key is stored in `.whirr/operator-key` and must never be committed or shared.

`npm run setup` is idempotent. It writes the fixture, model, evaluation report and SQLite database under ignored directories.

## Demo path

1. Open **Judge Mode** and inspect the readiness gates. Open gates are shown as OPEN, never painted green.
2. Sign in as operator and open **Studio**. The seeded reference fan already has a READY model and terms.
3. Open the **Acoustic Passport** to inspect the enrolled spectral profile, the 91.48% match gate, its calibration retention/rejection rates and the explicit limits. Press **Start local probe** and let it listen to the room: the live similarity is computed in the tab, with no session, upload or charge. Then open the service card and the renter link in the same browser or a second profile.
4. Accept the terms. With no PayPal credentials you may choose **demo metering**; with Sandbox credentials configured you are sent to the official PayPal Sandbox checkout for the cap.
5. Start the session. The live meter shows confident activity, idle time, uncertainty, disconnects and live passport match. Uncertain, mismatched or disconnected time is free.
6. Stop, review the interval ledger, accept the quote, then capture (with PayPal) or complete the clearly-labelled demo (without credentials).
7. Open the receipt and run verification. A demo receipt explicitly says `DEMO_NO_PAYMENT`; it is never presented as a PayPal transaction.

The offline demo replays the labelled synthetic fixture using the same frozen feature extractor, classifier and hysteresis code as the live path. It is labelled as a replay and proves the pipeline, not field accuracy.

## Gate A: real-object trials

Gate A is deliberately separate from the automated suite. The automated tests prove the pipeline, signing, arithmetic and payment contract; they cannot prove that a physical object was present. Use the guided page at `/studio/objects/:objectId/gate-a` with a live microphone and the actual object.

1. Put the object where it normally runs and select the microphone that will meter it.
2. Run three trials. Each trial is a 6-second ON capture followed by a 6-second OFF capture. The page records the actual active ratio, idle/uncertain time, mean confidence, passport score, clipping and failure codes. Failed phases can be retried; every attempt remains in the trial log.
3. Download the `whirr.gate-a-trial-log.v1` JSON. It is client-reported evidence, not a signed proof of physical presence.
4. A named reviewer must inspect the log and, only if the trials are genuine, create `docs/evidence/gate-a.json` with `realObject: true`, the three trials and the reviewer/date. `npm run gate:v3` will then and only then report Gate A PASS.

Synthetic fixtures, imported WAVs and replay sessions never count. The checked-in `docs/evidence/gate-a.json` is intentionally marked OPEN. `npm run gate:a:export -- <sessionId>` packages a session for review but also keeps Gate A OPEN.

## PayPal Sandbox

Whirr is **Sandbox only**. The config parser and PayPal client reject any host other than `api-m.sandbox.paypal.com` (loopback is allowed for local contract tests). No live client credentials are accepted.

Add to `.env`:

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=your-sandbox-app-client-id
PAYPAL_CLIENT_SECRET=your-sandbox-app-secret
PAYPAL_WEBHOOK_ID=your-registered-webhook-id
WHIRR_PUBLIC_ORIGIN=http://localhost:5173
```

Use your own Sandbox seller and buyer accounts. The buyer approves in the official Sandbox UI; the buyer's password never touches this application. Full setup, webhook and troubleshooting instructions: [`docs/paypal-sandbox.md`](docs/paypal-sandbox.md).

**Verified local Sandbox run (8 November 2026):** order `77T95682L88230118`, authorization `783967879W676894R`, capture `7YY23328DP2020327`; status `COMPLETED`; amount `USD 0.07`; `final_capture: true`; receipt verification **8/8** (the passport check was added after the capture and recomputes from the stored intervals). This is simulated Sandbox money, not a live charge. The payment test used authenticated API-submitted interval evidence, not a physical microphone; it validates the payment/receipt path, while real-object sensing remains Gate A. A signed webhook was not delivered because no public HTTPS ingress was configured, so that gate remains OPEN.

Without credentials, everything still runs except payment: sessions are marked `DEMO_MODE`, the PayPal order endpoint returns a clear 503, and receipts say that no payment was processed, authorized, captured or refunded.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run API and Vite together |
| `npm run build` | Production web build into `apps/web/dist` |
| `npm start` | Run the API and serve an existing build on port 8787 |
| `npm run setup` | Fixtures + reference model + evaluation + seed (hands-off) |
| `npm run fixtures` | Regenerate the synthetic WAV and 16 training takes |
| `npm run train:reference` | Train and evaluate the synthetic reference model |
| `npm run eval:reference` | Re-run evaluation and rewrite `docs/evaluation.md` |
| `npm run seed` | Seed the reference object, model and terms |
| `npm run key` | Print the local operator key |
| `npm run demo:offline` | Replay the fixture in Node and print a quote |
| `npm run proof:verify -- file.json` | Verify a signed passport or receipt proof locally |
| `npm run proof:verify -- bundle.json [key-id]` | Verify a v3 bundle, optionally pinned to an installation fingerprint |
| `npm run bench` | Measure local classifier, meter and proof-verification hot paths |
| `npm run gate:v3` | Honest PASS/OPEN/FAIL report from this database, files and provider configuration |
| `npm run gate:a:export` | Export a Gate A review pack without closing Gate A |
| `npm run proxy:webhook` | Loopback proxy exposing only `POST /api/paypal/webhook` (not public HTTPS) |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit + integration tests (requires `npm run setup` first) |
| `npm run test:e2e` | Playwright proof, Tamper Lab, standalone verifier, 4.0 bench and full page sweep at 1440×900, 834×1112 and 390×844 |
| `npm run screenshots` | Capture the 4.0 bench, ticket and microphone-closed Listening Room into `docs/v4/` |
| `npm run smoke` | Runtime, auth and CSRF smoke checks via Fastify injection |
| `npm run verify` | Typecheck + tests |

## Repository layout

```text
apps/web/                  React 19 + Vite UI, AudioWorklet, meter controller
apps/api/                  Fastify API, SQLite store, domain services
packages/audio/            frozen feature spec, FFT, classifier, soundprint, hysteresis, training
packages/meter/            interval union, currency, deterministic pricing
packages/contracts/        Zod request schemas + shared TypeScript views
packages/protocol/         Canonical JSON, ECDSA P-256 signing/verification, shared schemas
packages/verify/           Browser/Node semantic document verifier
packages/paypal/           Sandbox REST client and webhook verification
models/                    exported reference model (generated)
fixtures/                  tiny labelled reference fixture + generated takes
scripts/                   fixtures, training, evaluation, seed, setup, smoke
tests/unit/                pricing, metering, audio, model, PayPal, webhook tests
tests/integration/         demo session → review → settlement → verified receipt
docs/                      architecture, model card, safety, threat model, PayPal, gates
```

## Honest limits

- **The reference model is synthetic.** Real-object accuracy requires recording your own object; the UI and docs never present the bundled metrics as field evidence.
- **A microphone is not a lock.** Speaker playback, a similar machine, or an unattended renter-controlled device can defeat acoustic sensing. Whirr refuses to bill uncertain time and is scoped to supervised venues, not unattended security.
- **The acoustic passport is a calibration-fit consistency check, not identity proof.** A similar machine can share the spectral profile, playback can imitate it, and the gate is fit on the same calibration takes rather than a held-out identity dataset. It can only reduce billing by turning a questionable active frame into free uncertainty. The public probe is the same comparison in miniature: a low score is evidence about the room, not proof of who or what is present.
- **Tab suspension / sleep / microphone loss** create evidence gaps. Accrual stops and those gaps are free, but they also mean the meter is not a continuous physical log.
- **No public deployment or video exists in this checkout.** The repository is the reproducible access path allowed by the rules; those submission artifacts remain OPEN.
- **PayPal behavior must be confirmed with your merchant account.** Authorization windows and partial-capture support are account features. Whirr records only authoritative provider statuses and never fabricates success; if authorization is unavailable, the documented fallback is demo metering, not a fake capture.

## Security and privacy

- Raw audio is processed in the browser and discarded; only feature vectors and sealed intervals are sent.
- Operator authentication uses a local key with a signed, HTTP-only, same-site cookie. Renter identity uses a separate signed cookie and session ownership checks. Cookies are `Secure` when the configured public origin uses HTTPS.
- Every state-changing API call requires a same-origin CSRF header; foreign origins are rejected. Rate limits apply globally and to sensitive payment, evidence, webhook and review operations. Consent IP/user-agent references are keyed HMACs, not raw values.
- Strict CSP, frame denial, MIME sniffing protection, permissions policy and body-size limits are set centrally.
- Webhooks verify the raw body, certificate host and signature before trusting an event; invalid payloads are truncated and audited, and a valid retry can replace an unverified event-id reservation. Verified events only trigger authoritative reconciliation, never a direct charge.
- PayPal approval and webhook-certificate URLs are restricted to HTTPS PayPal Sandbox hosts. The approved cap and final amount are checked server-side.
- Secrets live in `.env` and `.whirr/` only. Both are ignored by Git. No secret is bundled into the web build or written to logs. `npm audit` reports zero known vulnerabilities on the locked dependency tree.
- A source and dependency audit was completed on 9 November 2026; it is a review, not a formal penetration test. See [Security audit](docs/security-audit.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Model card](docs/model-card.md)
- [Safety](docs/safety.md)
- [Threat model](docs/threat-model.md)
- [Security audit](docs/security-audit.md)
- [Evaluation](docs/evaluation.md)
- [PayPal Sandbox](docs/paypal-sandbox.md)
- [Hackathon compliance](docs/hackathon-compliance.md)
- [Go / no-go gates](docs/go-no-go.md)
- [Demo script](docs/demo-script.md)
- [Acoustic protocol](docs/acoustic-protocol.md)
- [Proof verification](docs/proof-verification.md)
- [Whirr 3.0 demo script](docs/demo-v3.md)
- [3.0.1 release notes](docs/release-notes-3.0.1.md)
- [Whirr 4.0 product brief](docs/product-4.0.md)
- [Whirr 4.0 design language](docs/design-system-4.0.md)
- [Whirr 4.0 demo script](docs/demo-4.0.md)
- [Whirr 4.0 submission explanation](docs/submission-4.0.md)
- [Five-person comprehension protocol — not run](docs/usability-4.0.md)
- [4.0.0-rc.1 release notes](docs/release-notes-4.0.0-rc.1.md)
- [Performance measurements](docs/performance.md)

## License

MIT. See [LICENSE](LICENSE).
