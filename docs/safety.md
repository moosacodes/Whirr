# Safety, privacy and responsible operation

Whirr is a measurement prototype, not a lock, a safety device or a production billing service. This page states the operational boundaries that the implementation and demo rely on.

## 1. Physical safety

- **Do not modify the object.** Whirr uses only a microphone; it never switches, unlocks, throttles or electrically controls equipment.
- **Use safe, ordinary objects.** A desk fan, a small appliance or another object that can run unattended for short periods is appropriate. Do not demonstrate with heaters, exposed blades, fuel-powered tools, or anything that becomes hazardous when left running.
- **Keep recordings short.** Calibration takes are seconds, not minutes. Stop immediately if an object overheats, smells, sparks, vibrates abnormally or makes an unfamiliar noise.
- **Ventilation and supervision.** Hair dryers and similar appliances must run only with adequate ventilation and supervision, per the manufacturer's instructions. Never block intake or exhaust.
- **No electrical work.** Do not open, probe or rewire an appliance. No mains-voltage sensing, current clamps, relays or custom controllers are part of Whirr.
- **Hearing.** Keep the microphone at a safe distance from very loud sources. Do not place a phone or laptop where it can fall, be knocked into the object, or contact water.
- **Children and animals.** Keep the demo area clear. The microphone is not a monitoring device and cannot prevent access.

## 2. Privacy

- **Local audio processing.** The browser captures 16 kHz audio and computes features in an AudioWorklet. Raw audio is not sent to the API. Calibration uploads 21-dimensional feature vectors plus quality flags; live sessions upload sealed state intervals.
- **Explicit activation.** The microphone opens only after a user gesture on a capture or session control. There is no autoplay listening, no background capture after stop, and no hidden recording.
- **Public probe.** The passport's probe opens the microphone only after a click, scores live frames in the tab and keeps no recording. Cancelling, disconnecting or leaving the page stops it; no session, upload or charge is created.
- **Data minimisation.** The server stores object metadata, feature vectors, interval state, hashes and financial records. It does not store raw audio, names of nearby people, speech transcripts or biometric templates.
- **Consent and control.** Operators can delete individual calibration takes or purge all calibration data. Renters can open disputes on specific intervals. Receipts expose a renter reference, not an email or account identity.
- **Derived metadata.** The consent record stores a short hash of IP and user agent for abuse investigation, not the raw values. Provider IDs may identify a Sandbox account and must be redacted before public screenshots.
- **Nearby people.** Continuous acoustic sensing can capture speech features even if not stored. Anyone running a demo should tell people in the room that a microphone is active and stop sensing when not needed.
- **No sensitive inference.** The model classifies only `idle`, `active` and `other`. The acoustic passport is a band-energy similarity check over those same features; it is not a voiceprint, identity document or biometric. It must not be repurposed to infer speech content, identity, health, occupancy or emotion.

## 3. Financial safety

- **Sandbox only.** The configuration layer rejects `PAYPAL_ENV` values other than `sandbox` and any PayPal host other than `api-m.sandbox.paypal.com` (loopback is permitted only for local contract tests). No live credentials are accepted.
- **No real money is intended to move.** Sandbox balances are simulated. Never place live credentials in this project, screenshots or the repository.
- **Consent before sensing.** A session cannot start without accepted terms and either a provider-confirmed authorization for the cap or explicit demo mode.
- **Hard cap.** The server computes the final amount from stored evidence and pinned terms and refuses capture above the consented cap. The cap cannot be increased mid-session.
- **One rounding operation.** Prices are integer minor units and rounded once at the end. Ambiguous time is excluded. Zero never triggers a positive capture.
- **Truthful provider states.** A capture is complete only after PayPal returns a completed status and the amount/currency reconcile. Pending, denied, failed or unknown outcomes are shown as such. Demo receipts say `DEMO_NO_PAYMENT` and must never be described as paid.
- **Disputes and credits.** A renter can contest specific intervals. Credits and waivers only reduce the amount; an additional charge requires fresh consent, which this prototype does not implement.
- **Operator approval for LIMITED models.** A model that fails the READY gate cannot auto-bill. Its bills require an explicit operator approval before capture.
- **Refunds.** Operator-only, bounded by the captured amount, and recorded against the provider refund ID. A refund does not rewrite history.

## 4. Operational trust boundary

Whirr is scoped to **supervised** settings: a venue-controlled laptop or phone near the object, with an attendant present. It is **not** suitable for:

- unattended rentals where the renter controls the sensing device;
- security, access control or theft prevention;
- proving that a specific physical object was used;
- distinguishing two identical machines running at once;
- detecting playback, muting, microphone substitution or a determined adversary.

The honest security claim is narrow: the server validates the shape, order and provenance of evidence and refuses ambiguous time; it does not prove physical truth. The receipt's hashes detect later mutation relative to a stored checkpoint; they are not a cryptographic proof of acoustic reality. The acoustic passport is a calibration-fit consistency guard: a mismatch makes a confident active frame free, but a match does not prove the object is present, unique or unreplayed. The public probe is a demonstration of that same guard, not an identity check or a security control.

## 5. Session handling

- Starting sensing requires consent, authorization/demo mode and a healthy microphone.
- Hiding the tab, losing the microphone, or a fatal sensor error attempts to pause the session; local batching stops. No time is billed while disconnected, and the gap is visible in the ledger.
- A browser crash or laptop sleep can leave the server session open. The renter/operator must stop it; unobserved wall-clock time is not converted into billable time because only validated intervals count.
- Before closing or reloading during sensing, the app warns about unsaved evidence.
- The operator can pause/resume, review, credit, refund or void with an audit trail. Operator actions cannot silently increase a renter's charge.

## 6. Security controls and non-claims

Implemented: signed HTTP-only cookies with `Secure` on HTTPS, timing-safe operator key comparison, ownership checks on every session read/mutation, CSRF header plus origin/`Sec-Fetch-Site` validation, per-route and global rate limits, strict CSP and framing denial, payload limits, Zod validation, raw webhook-body signature verification before trust, PayPal certificate-host allowlisting, event deduplication with truncation of rejected payloads, idempotent provider operations, reviewed-quote checks before capture, hash-chained audit log, keyed HMAC request metadata, secret redaction in logs, Sandbox-host enforcement and a locked dependency tree with zero known `npm audit` findings.

Not claimed: formal verification, independent penetration-test certification, tamper-proof hardware, resistance to a compromised browser or operating system, protection against a malicious operator who controls the server, or guaranteed availability. A local single-user installation is not multi-tenant SaaS security. Local development has no TLS; any exposed deployment must terminate HTTPS at a trusted proxy and set `WHIRR_PUBLIC_ORIGIN` accordingly.

## 7. Incident and dispute handling

1. Stop the session and preserve the interval ledger/receipt.
2. Check microphone state, tab visibility and device connection for gaps.
3. Review `UNCERTAIN`/`DISCONNECTED` intervals; they are already unbilled.
4. For a contested bill, open a dispute on the affected interval IDs. The operator can resolve it with a credit up to the bill.
5. If provider state is ambiguous, use reconciliation; never “fix” it by editing a captured amount.
6. Record the resolution in the audit log. Do not delete evidence to make a dispute disappear.

## 8. Accessibility and presentation

The UI aims for WCAG 2.2 AA: keyboard-focusable controls, visible focus rings, non-colour state labels, reduced-motion support, adequate target sizes, labelled controls and a skip link. Live announcements are throttled rather than firing on every 32 ms frame. The product is responsive from 320 px upward. These are implementation goals, not a completed third-party accessibility audit.

## 9. Responsible claims

Do not say Whirr is tamper-proof, unattended-secure, universally accurate, production-ready, or that a demo receipt proves a real payment. Do not present synthetic metrics as field accuracy. Do not claim the acoustic passport proves object identity, detects playback, or is a security control; it is a billing-fairness heuristic. Do not claim competitor novelty without a dated, exhaustive search. When the system is fooled, report it; credible limitation disclosure is part of the product.
