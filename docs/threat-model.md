# Threat model

Whirr is a supervised acoustic metering prototype. This threat model states what is protected, what is explicitly not, and which controls exist in the code. It is a design analysis, not a penetration-test report or a security certification.

## 1. Assets

- Renter money (Sandbox simulated) and the consented cap.
- Integrity of the bill and interval ledger.
- Operator key, session cookies, PayPal client secret and webhook ID.
- Calibration data and model artifacts.
- Provider evidence (order, authorization, capture, refund IDs and statuses).
- Audit history and receipts.
- Object availability and the privacy of nearby people.

## 2. Actors and trust boundaries

| Actor | Trust |
| --- | --- |
| Browser / renter | Untrusted for amounts, clock, model version and evidence contents; trusted only to run the local classifier and submit sealed batches. |
| Operator | Authenticated administrator of this installation; can review, credit, refund and void. Assumed honest-but-accountable, with all actions audited. |
| API server | Trusted to enforce billing invariants, ownership and provider reconciliation. |
| SQLite | Local trusted store; not encrypted at rest in this prototype. |
| PayPal Sandbox | Authoritative for payment status, subject to network failure and eventual consistency. |
| Webhook sender | Untrusted until signature verification succeeds; event content is never a command to charge. |
| Network attacker | May intercept loopback-adjacent traffic only if the operator exposes it; TLS/proxy hardening is out of scope for local-only mode. |

## 3. Threats and controls

### Acoustic / physical

| Threat | Effect | Control | Residual risk |
| --- | --- | --- | --- |
| Speaker playback of recorded object audio | False active billing | Precision-first thresholds, uncertain exclusion, supervised scope, documented spoof limitation | High. A microphone cannot authenticate the source; playback may be billed if it is indistinguishable. |
| Similar appliance nearby | False active billing | Negative/background training takes, `other` class, precision-first gate, acoustic passport profile consistency, requester can dispute | Medium. One mic cannot attribute sound to a device; a similar profile can pass the passport. |
| Passport profile mismatch | Wrong object or changed acoustics | `SOUNDPRINT_MISMATCH` disqualifies a confident active frame; mismatch becomes free `UNCERTAIN` | The gate reduces questionable billing but is fit on calibration takes, not held-out identity evidence. |
| Unrelated loud noise | False active or uncertain | Quality flags, `other` class, uncertainty bias | Medium. A loud machine with a similar spectrum may be billed. |
| Object switched off but room noisy | False active | Idle and negative examples, smoothing/dwell | Medium. |
| Microphone muted / unplugged | Underbilling or gap | Device-loss detection, pause, `DISCONNECTED` intervals, no accrual | Underbilling is the safe failure; the record is incomplete. |
| Two identical machines | Cannot disambiguate | Supervised one-device scope; no claim otherwise | Accepted limitation. |
| Renter controls sensing device | Can fake or suppress audio | Scoped to venue-controlled sensing; no security claim | Accepted limitation. |

### Evidence / billing

| Threat | Effect | Control | Residual risk |
| --- | --- | --- | --- |
| Client submits fabricated intervals | Overcharge | Server recomputes totals, validates token/ownership/sequence/timestamps, pins model version, ignores client amount | A malicious renter can still mislabel local predictions; this is why sensing is venue-controlled. |
| Replay of an accepted batch | Double billing | Unique `(session_id, seq)`, duplicate detection with hash comparison, monotonic sequence | None for exact duplicates; altered content conflicts. |
| Overlapping intervals | Double billing | Normaliser rejects overlap; server validates against ledger end | Low. |
| Clock tampering | Unbounded duration | Server clock bounds intervals; bounded in-flight grace; stop freezes wall clock | A compromised browser can only claim time up to the server clock. |
| Model or terms changed mid-session | Silent repricing | Session pins model/terms rows and hashes at creation; capture rechecks reviewed quote hash | Low. |
| Client-calculated amount | Over/undercharge | Capture amount derived from stored intervals and pinned terms; client cannot submit an amount | Low. |
| Quote altered after review | Unauthorised charge | Quote hash acceptance; capture requires current `reviewed_quote_hash` | Low. |
| Operator silently increases bill | Abuse | Credits only reduce; audit; operator approval is explicit; no API to raise a reviewed quote | Malicious operator controls the host; not preventable here. |
| Receipt/ledger tampering | False evidence | Per-interval hash, evidence root, stored receipt hash, hash-chained audit | A host administrator can rewrite the database; hashes are a checkpoint, not an external timestamp. |

### Payments

| Threat | Effect | Control | Residual risk |
| --- | --- | --- | --- |
| Forged webhook | False settlement | Raw-body signature verification with configured webhook ID before trust; PayPal Sandbox certificate-host and algorithm allowlist; invalid payloads truncated, rejected and audited | Requires correct webhook ID and PayPal reachability; no real signed delivery has been tested. |
| Webhook event-id poisoning | Storage growth or blocked retry | Rejected payloads truncated; unverified event-id reservations can be replaced by a later valid signed retry; verified ID/payload conflicts rejected | Rate limits still allow bounded rejected rows; no dedicated ingress proxy is shipped. |
| Webhook replay | Duplicate effects | Unique event ID + payload hash; duplicate returns acknowledged; reconciliation is idempotent | Low. |
| Webhook out of order | Stale state | Event is only a trigger; authoritative GET reconciles current provider state | Provider eventual consistency can delay settlement. |
| Duplicate capture | Double charge | Stable `PayPal-Request-Id`, unique operation row, stored capture ID, early return if already captured | Provider timeout still needs reconciliation. |
| Capture above cap | Overcharge | Server-side cap check, `final_capture`, amount/currency reconciliation | Account features must be verified; a provider mismatch blocks settlement. |
| Zero captured | Invalid charge | Zero path requires void/no-charge; capture endpoint rejects `quoteMinor <= 0` | Low. |
| Fake payment success | Fraudulent claim | Only authoritative provider statuses; demo labelled `DEMO_NO_PAYMENT`; no simulated success path | Operator could misrepresent screenshots; docs explicitly forbid it. |
| Live credentials used | Real money movement | Config rejects non-Sandbox host/env; no live endpoint constants | A modified source tree could change this; out of scope. |
| Webhook endpoint exposed to internet | Attack surface | Local bind by default; webhook requires signature; rate limited | No dedicated minimal ingress proxy is shipped; exposing the whole API via a tunnel is unsafe. |

### Web / identity

| Threat | Effect | Control | Residual risk |
| --- | --- | --- | --- |
| CSRF | Unauthorised state change | `x-whirr-csrf`, origin allowlist, `Sec-Fetch-Site`, same-site cookies | Local malware/browser extension is out of scope. |
| Session theft | Account takeover | HTTP-only signed cookies, same-site, no token in URL/localStorage; `Secure` when the public origin is HTTPS | No TLS in local dev; use a trusted proxy with HTTPS if exposed. |
| Consent metadata disclosure | IP/device re-identification | Keyed HMAC references using the cookie secret, not raw IP/user agent or unsalted hashes | A host with the secret and database can still test candidate values. |
| Malicious PayPal approval/certificate URL | Phishing or verifier SSRF | HTTPS `*.sandbox.paypal.com` allowlist for approval links and webhook certificate URLs; unsupported algorithms rejected | A compromised PayPal Sandbox domain remains trusted. |
| Vulnerable dependency | Code execution/data exposure | Locked versions, `npm audit` 0 findings after upgrading `@fastify/static` and Vitest | New advisories can appear after the audit date. |
| IDOR | Read/modify another renter's session | Ownership check returns 404; operator is the only cross-renter role | Operator is global by design. |
| Operator key brute force | Admin takeover | 10 attempts / 5 min, timing-safe comparison, 32-byte random key by default | Key file permissions depend on OS. |
| XSS | Token theft / actions | React escaping, no `dangerouslySetInnerHTML`, strict CSP without inline script | Inline styles are allowed; compromised dependency could still run. |
| SQL injection | Data breach | Parameterised SQL throughout | Low. |
| Oversized payload | DoS | 12 MiB global body limit, 256 KiB webhook, bounded arrays/frames | Local host DoS is not fully mitigated. |
| Secret leakage | Provider abuse | `.env`/`.whirr` ignored, log redaction, no secrets in bundle, client secret server-only | Operator must not screenshot/commit env files. |
| Tunnel exposes admin API | Remote takeover | Loopback bind, documentation warns; operator routes still require auth | Stronger isolation (webhook-only proxy) is not included. |

### Availability / integrity

| Threat | Effect | Control | Residual risk |
| --- | --- | --- | --- |
| Tab hidden / laptop sleep | Billing gap | Visibility listener pauses; explicit `TAB_HIDDEN`/gap flags; no retroactive billing | Session may remain open; no billable time accrues without intervals. |
| API restart | Lost in-memory work | SQLite persistence, operation rows, outbox | In-flight client batches may need resend; duplicate detection handles retries. |
| Provider outage | Unsettled session | Distinct pending/unknown states, reconciliation, outbox backoff | Manual reconciliation may be required. |
| Clock skew | Interval rejection or gap | 5 s grace, monotonic ledger checks | Severe clock skew blocks evidence rather than overbilling. |

## 4. Privacy threats

- **Speech/occupancy leakage.** Features include spectral information from any nearby speech. The system does not transcribe or identify speakers, but a compromised host could capture raw audio outside Whirr's code. Operators must use trusted devices and disclose sensing.
- **Re-identification via provider IDs.** Sandbox order/capture IDs can link to a test account. Receipts are redacted for public sharing; screenshots must be reviewed.
- **Calibration data.** Feature vectors are less revealing than raw audio but still describe an environment. They can be deleted individually or purged.
- **Passport probe.** The public probe processes live frames in the browser and discards them; it creates no session and sends no audio or features. Its score describes spectral similarity, not identity.
- **Local database.** Not encrypted at rest. Protect the machine and exclude `data/` from backups shared publicly.

## 5. Explicit non-claims

Whirr does **not** claim:

- tamper-proof or fraud-proof metering;
- unattended rental security or physical access control;
- detection of all playback, muting or device substitution;
- that the acoustic passport proves object identity or prevents a similar machine from matching;
- cryptographic proof that a sensor reading represented physical truth;
- formal security certification, pen-test clearance or regulatory compliance;
- suitability for safety-critical, medical, financial-advice or surveillance use.

## 5a. Whirr 2.0 signature and shelf threats

| Threat | Effect | Control | Residual risk |
| --- | --- | --- | --- |
| Forged or altered passport/proof | False trust artifact | ECDSA P-256 over canonical JSON; embedded public key must hash to `keyId`; verifier checks every semantic field; tamper tests cover field edits | A compromised signing key can sign false statements. The key is local and unencrypted at rest by this prototype. |
| Signature presented as identity or trusted time | Overclaim | Every artifact carries explicit `attestation` and `limitations`; UI says installation attestation; docs repeat the boundary | A screenshot or third-party page can strip the context; verify the bytes. |
| Public proof leaks renter/payment data | Privacy breach | Proof payload omits renterRef and full PayPal IDs; no audio; integration test asserts the omissions | Object name, price and session ID remain linkable; that is intentional public evidence. |
| Public passport leaks calibration feature vectors | Environmental inference | Only soundprint aggregate bands and fit metrics are published, not raw feature vectors or takes | Spectral shape still describes the object/environment; operators must choose what to publish. |
| Hold race | Two renters collide | Server-side unique active hold per object, renter-bound, 10-minute expiry; active-session check also blocks | A hold is not a payment or reservation and can expire; it is a collision guard, not inventory. |
| Stale calibration or drift | Misclassification | Passport exposes calibration age and aggregate drift; operator shelf shows due queue; renter sees passport status | Drift is heuristic and can miss changes; it does not retroactively reprice. |
| Preflight client lies about readiness | Session starts in a bad room | Server recomputes status from measured fields; `NO_SIGNAL`/`UNSTABLE` block start | A malicious client can submit plausible fake measurements; preflight is usability, not sensor authentication. |
| Fairness reserve abuse | Repeated free credit | One application per session, only before review, capped at 10% of consented cap, audited, reduces quote only | The operator chose the reserve; a malicious operator can publish an uneconomic rate card. |
| Validation leakage | Inflated model metrics | Takes marked `VALIDATION` are excluded from fitting; report is labelled `NOT_RUN` when absent | A user can mislabel validation takes; provenance remains user calibration, not external audit. |
| Tamper Lab mistaken for real mutation | False claim of attack resilience | Lab is explicitly local and in-memory; no API call; docs state host can rewrite database | A demo viewer may still overgeneralise; the honest boundary is printed in the UI. |

## 6. Verification performed

- Unit/property tests cover interval overlap, invalid timestamps, rounding boundaries, cap invariants, zero charges, model gating, soundprint enrollment/weakness, mismatch disqualification, provider error handling, PayPal URL/certificate allowlists, webhook event-id poisoning, secure-cookie/origin configuration and audit-chain parsing.
- Integration tests cover CSRF/origin rejection, unauthenticated access, renter isolation, public passport retrieval, demo session lifecycle, duplicate interval batches, overlap rejection, review hash enforcement, zero-payment demo receipt, audit verification, signed-passport stability, severe-preflight blocking, v2 explanations, fairness arithmetic, redacted proof verification and a hold race. Protocol tests cover canonical bytes, tampering, key rotation and v1 legacy labelling.
- Smoke checks cover CSP/cache headers, operator login, bad key rejection, foreign-origin rejection and missing-credential behavior. A static runtime probe confirmed encoded traversal is rejected without file exposure, and `npm audit` reports 0 vulnerabilities.
- No independent penetration test, real signed webhook delivery or physical anti-spoof experiment has been performed in this checkout. A genuine Sandbox capture was completed and provider-reconciled; the webhook and physical gates remain OPEN in [`go-no-go.md`](go-no-go.md).

## 7. Whirr 3.0 boundaries

- **Open-set rejection is fallible.** `UNKNOWN_OBJECT` is emitted when the `other` class dominates and `LOW_CONFIDENCE` when no class is strong. A similar machine may still look active; these flags only reduce billing, never justify a stronger identity claim.
- **Capture provenance is client testimony.** `CLIENT_CLAIMED_LIVE_MICROPHONE` is signed as a claim, not a hardware attestation. `IMPORTED_EVIDENCE_REPLAY`, `SYNTHETIC_FIXTURE_REPLAY` and `DEMO_NO_PAYMENT` are labelled distinctly. A malicious browser can lie about its device label and permission state.
- **The Merkle ledger detects edits, not omissions.** A producer could sign a shorter genuine ledger. The receipt, session evidence root and review process are the cross-checks; the bundle cannot prove that no physical event was ignored.
- **Redaction is signed metadata.** The public bundle removes renter/provider identifiers before signing. It cannot prove that the redacted value was correct, only that the displayed redacted document and its nested receipt hash are internally consistent.
- **Offline payment claims are limited.** Installation-recorded capture references do not prove PayPal settlement. Only online provider reconciliation can do that. A forged database can show a capture reference; it cannot forge PayPal's authoritative response.
- **Reauthorization is bounded.** Replacement is refused after any interval, billable time or reviewed bill, preventing silent substitution. Operator recovery cannot turn an expired authorization into a capture.
- **Webhook-only proxy is a path restriction, not public trust.** `npm run proxy:webhook` binds loopback and returns 404 for every non-webhook path. It adds no HTTPS, no tunnel authentication and no gate closure.
- **Standalone verifier trusts WebCrypto and the loaded file.** A compromised browser, malicious extension, modified HTML file or unpinned key can mislead the viewer. Pin the installation fingerprint out of band when the signer is known.
