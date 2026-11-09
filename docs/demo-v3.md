# Whirr 3.0.1 demo — proof-of-use economy

**Length:** about three minutes. **Claim boundary:** this script never presents synthetic replay, demo metering or Sandbox money as a physical paid session.

## Before recording

1. Run `npm run setup && npm run dev`.
2. Open the app at `http://localhost:5173` and `/judge` in one window.
3. Have a real object and microphone ready if Gate A evidence is being recorded. Otherwise use the synthetic fallback and say so at the start.
4. Open the browser console once and confirm no errors. Keep the operator key out of frame.
5. For the real-object segment, use the guided **Gate A trials** page from Model Review. Do not use imported audio or fixture replay for that segment.

## 0:00–0:25 — Premise

> “Whirr turns an ordinary object into a metered service without making the object smart. A microphone hears it work, the browser classifies confident use, and the renter pays only for that time. The receipt is portable and can be checked offline.”

Show the landing page and the Listening Room’s object stage. Point out that raw audio never leaves the browser.

## 0:25–0:55 — Identity and uncertainty

Open the seeded service card and start a session in demo mode if PayPal approval is not part of the recording.

> “Before billing, the installation runs a four-second room check. The acoustic passport is a calibration-fit gate, not an identity proof. Unknown, low-confidence and mismatched sound becomes free uncertainty.”

If a real object is available, run an ON/OFF cycle. Show the confidence, passport score and uncertainty chips. Do **not** call one cycle Gate A; Gate A needs three genuine live ON/OFF trials and remains OPEN without them.

The guided Gate A page runs three 6-second ON/OFF trials, reports the actual active ratio, free idle/uncertain time, mean confidence, passport score and failure codes, and exports a client-reported `whirr.gate-a-trial-log.v1`. A failed phase can be retried without deleting the earlier attempt. The exported log is not the gate-closing evidence file.

## 0:55–1:30 — Listening Room and payment state

Start sensing. Point to the object stage, spectral field, interval ribbon, running quote, free-time counter and sensor diagnostics drawer.

> “Intervals are sealed on-device and uploaded in batches. Network failure keeps the batch queued and retries it in order. Hiding the tab pauses sensing. The server never sees raw audio.”

If Sandbox is configured and a human buyer is present, show the authorization status and expiry. Otherwise show `DEMO_NO_PAYMENT` clearly:

> “This is demo metering. No PayPal order, authorization or charge exists.”

## 1:30–2:05 — Stop, review and bundle

Stop the session, accept the reviewed quote, then open the receipt.

Show:

- the interval ledger and free uncertain/idle time;
- the payment timeline states (`PENDING`, `DENIED`, `UNKNOWN`, `RECONCILED`) if present;
- the v3 bundle trust matrix: **integrity**, **sensing**, **payment**;
- the capture provenance label and its “client-reported” disclaimer.

> “Integrity is independently checkable. Sensing is a signed client claim, not proof the object was physically running. Payment is installation-recorded and cannot be verified offline.”

## 2:05–2:35 — Verify away from the server

Download the public bundle and open `/proof/:id`, or open `apps/web/public/verify-offline.html` directly.

Show the checks passing. Then use the Tamper Lab (or edit the standalone copy) to change the amount, an interval state, a Merkle proof, the nested passport key and the outer key. Each edit must fail.

> “A changed amount, timestamp, state, model pin, evidence leaf or signature breaks verification. Without a pinned key fingerprint this is still a self-attested installation key.”

Do not claim that a pin proves real-world identity.

## 2:35–3:00 — Honest close

> “Gate A is open unless this recording includes three genuine live ON/OFF trials and a reviewer has closed it in docs/evidence/gate-a.json. Gate E is open: no public HTTPS ingress has received a genuine signed PayPal webhook. Gate D is the historical Sandbox capture, preserved as simulated money, not a new charge. Everything local is reproducible; the external claims are not made.”

Show `/judge` and `npm run gate:v3` with PASS, OPEN and FAIL kept distinct.

## Synthetic fallback (label it first)

If the microphone, real object or Sandbox buyer is unavailable:

1. Say: “This is a synthetic fixture replay and demo metering, not a physical measurement or payment.”
2. Open `/demo/offline` and show the replay timeline.
3. Open the verified demo receipt and public bundle.
4. Run the tamper demonstration.
5. Keep Gate A and Gate E OPEN on screen.

Never substitute a mock PayPal screen, fabricated capture ID or edited receipt for a provider result.
