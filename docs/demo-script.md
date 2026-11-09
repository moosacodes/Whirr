# Demo script and recording plan

## Whirr 2.0 route (preferred)

Use the six-station Judge Gauntlet on `/judge` as the recording spine: **calibrate → preflight → consent → live meter → dispute → offline verify**. Each station names what it proves and what it does not. The shelf is the public front door at `/shelf`; the passport at `/passport/obj_reference_fan` exports a signed envelope; `/verify` checks it without the server. Keep the three-minute cap and the original truthful constraints below.

The strongest 2.0 sequence is: open the shelf, calibrate or inspect the passport, run the room check, show the eight-band waterfall and one “why this second” explanation, stop and apply the pre-committed fairness reserve, share the redacted proof card, then drag the signed JSON into `/verify` and edit one field in the Tamper Lab. State plainly that the seal is installation attestation, not a trusted timestamp or physical truth.

Target: **under three minutes**, one continuous story: ordinary object → taught sound → bounded consent → live meter → review → settlement → honest limits. Use real footage and real sound. Label any replay. Never fake a PayPal result.

## Preflight

- [ ] `npm install && npm run setup && npm run dev`
- [ ] Operator key available via `npm run key`; signed in in one window.
- [ ] Renter window ready at `/s/obj_reference_fan` or a freshly taught object.
- [ ] Public passport ready at `/passport/obj_reference_fan`, or the freshly taught object's passport.
- [ ] Passport probe opened once and microphone permission granted; it runs locally with no session.
- [ ] Microphone works; browser permission granted before recording or the permission moment is included.
- [ ] Object is safe, stable, ventilated and supervised; no hazardous appliance.
- [ ] PayPal Sandbox configured **or** demo mode accepted and clearly stated on camera.
- [ ] Screen recorder captures browser + object camera; notifications off; secrets and full provider IDs hidden.
- [ ] Synthetic fixture is labelled if used: “synthetic replay — not live evidence”.

## Timeline

| Time | Picture / action | Narration | Proof |
| --- | --- | --- | --- |
| 0:00–0:12 | Hold up the plain object next to the laptop. | “This fan has no app, no meter and no payment hardware. Whirr makes it a metered service using the microphone already here.” | Premise in ten seconds |
| 0:12–0:34 | Operator Studio → Capture Lab. Record a short idle take and an active take. Show the waveform and quality indicators. | “The operator teaches idle, running and background sound. Audio is processed in the browser; only features leave this tab.” | Real teach loop, privacy |
| 0:34–0:52 | Model Review. Show READY/LIMITED/REJECTED, precision, false-billable time, and the explicit synthetic/live provenance banner. | “A local logistic regression is trained and held out by take. If it cannot meet the precision gate, it cannot auto-bill.” | Genuine ML and refusal policy |
| 0:52–1:06 | Acoustic Passport. Open the public passport; press **Start local probe** for a few seconds and show the live similarity against the 91.48% threshold. Point at the spectral bars and the honest boundary. | “The object now has a public soundprint. This probe compares the room in your browser — no session, no upload. In a real session, a confident active frame that no longer resembles it becomes uncertain and free.” | Creative identity layer, privacy |
| 1:04–1:16 | Pricing Composer. Set $0.20/min and $5 cap. Show the sample calculation and rounding. | “The renter approves a hard maximum before anything is sensed. Ambiguous time is free.” | Deterministic pricing, consent |
| 1:16–1:34 | Renter Consent. Show Sandbox/no-real-money notice, terms hash, cap. Click PayPal; show the official Sandbox login/approval briefly. If demo mode: state clearly that no payment is configured and this is demo metering. | “The buyer approves the cap in PayPal’s own Sandbox UI. Whirr never sees the password.” | Genuine PayPal flow or honest demo |
| 1:34–2:00 | Live Session. Fan OFF → ON → OFF → ON. Show state changes, billable meter, passport match, excluded uncertainty. Add a short unrelated noise if safe. | “Only confident active intervals that match the passport bill. Idle, uncertain, mismatched and disconnected time are excluded. The cap is a hard ceiling.” | Core sensing + fairness |
| 2:00–2:20 | Stop. Review ledger with interval colors and excluded time. Accept the quote. Show PayPal capture status if real; otherwise show demo completion labelled “no payment processed”. | “The bill is computed once from the saved evidence, not the client’s number.” | Review, settlement truthfulness |
| 2:20–2:38 | Receipt + verification panel. Point at quote, cap, evidence hash, provider amount (or demo label), audit chain, passport exclusions and all eight checks. | “This receipt can be re-verified. It proves integrity relative to the stored checkpoint, not that a microphone is a lock.” | Inspectable evidence, honest scope |
| 2:38–2:52 | One adversarial example: play a recording or show a similar appliance, state the result. | “A speaker can fool any microphone, and a similar machine can share a soundprint. We refuse ambiguous time and scope this to supervised venues.” | Credible limitation |
| 2:52–3:00 | End on the object and the service card. | “Everyday tools become measurable services without retrofits.” | Big vision, bounded claim |

## What to show, not tell

- The **actual state timeline** and excluded intervals, not a hand-waved confidence number.
- The **quote formula** and cap, not just the total.
- The **provider status** or the explicit `DEMO_NO_PAYMENT` label, never a generic “paid” badge.
- The **model gate** and its synthetic/live provenance.
- The **acoustic passport** with its threshold, calibration statistics and explicit non-identity limits.
- At least one failure/refusal: uncertain time, a passport mismatch, a rejected model, or a declined authorization.

## Do not

- Do not use a prerecorded classification while claiming it is live.
- Do not show a demo completion as a PayPal capture.
- Do not fabricate timestamps, IDs, metrics or provider responses.
- Do not use copyrighted music, trademarks or borrowed footage.
- Do not expose `.env`, client secret, buyer password, cookies or full personal data.
- Do not claim tamper-proof, unattended security, universal accuracy or production readiness.
- Do not claim the passport proves the physical object is present, unique or unreplayed.
- Do not exceed three minutes with setup/credits; judges need not watch beyond three.

## Backup plan

If the microphone or PayPal is unavailable on recording day:

1. Record the honest setup failure and use **Judge Mode** to show the gates, then the **offline replay** labelled synthetic.
2. Show the verified demo-mode receipt and state plainly: “No PayPal transaction was created in this recording.”
3. Do not substitute a mock payment screen. A shorter honest video is better than a fabricated one.
