# Operator workflow 7.0

**Status:** implemented, reviewed at author level only. The real-world evidence gates remain **OPEN** until the physical and PayPal actions are performed and a named reviewer signs the artifacts.

**Purpose:** one guided operator path for issues [#2](https://github.com/moosacodes/Whirr/issues/2), [#3](https://github.com/moosacodes/Whirr/issues/3) and [#11](https://github.com/moosacodes/Whirr/issues/11), without duplicating the existing Calibration Lab, Ambient lifecycle, PayPal client or webhook proxy.

## Current audit

| Capability | Existing implementation | What was missing |
| --- | --- | --- |
| Real appliance enrollment | `/studio` creates a non-synthetic object; `/studio/objects/:id/calibration-lab` records live takes, trains a local model and runs the field protocol | A single path that checks live take counts, model provenance, FIELD_PASS and the required Gate A batches |
| Interrupted / qualifying window | Ambient Wish → Exchange → Window → Accord, deterministic evaluator and signed proof | A check that both outcomes are live, accepted and proof-verifiable |
| PayPal lifecycle | Orders v2 authorize, partial capture, void, webhook verification and provider reconciliation | A check that capture is qualified and exact, and that the void path has no capture |
| Genuine webhook | `POST /api/paypal/webhook`, raw-body verification, dedupe, webhook-only loopback proxy | An operator check for a real verified event, public URL and tunnel-only ingress |
| Judge package | Existing demo/submission docs and proof verifier | A duration/URL/Devpost gate and a redacted evidence export |

The workflow adds orchestration and diagnostics. It does not change sensing, pricing, signing, PayPal or gate thresholds.

## Quick start

```bash
npm install
npm run setup
npm run dev
# in a second terminal, once the API is healthy:
npm run operator:7 -- run --open
```

The interactive run creates `.whirr/operator-7/<runId>/run.json` and copies imported artifacts into that ignored directory. Re-running `run` resumes the latest run. Use `--new` after a completed run if you want a clean session.

The operator key is only for the local browser session:

```bash
npm run key
# paste at http://localhost:5173/operator/login
```

Never record, paste into an issue, or commit the key.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run operator:7 -- run` | Guided five-phase session; pauses for every human action |
| `npm run operator:7 -- run --open` | Same, opening the relevant browser page |
| `npm run operator:7 -- status` | Environment, latest run, real objects and verified webhook summary |
| `npm run operator:7 -- phase 1` | Re-check appliance enrollment |
| `npm run operator:7 -- phase 2` | Re-check interrupted/qualifying windows |
| `npm run operator:7 -- phase 3` | Re-check PayPal capture and void with provider lookup |
| `npm run operator:7 -- phase 4` | Re-check public webhook and verified events |
| `npm run operator:7 -- phase 5` | Re-check video duration and submission URLs |
| `npm run operator:7 -- import-gate-a <file>` | Import a downloaded `whirr.gate-a-trial-log.v1` |
| `npm run operator:7 -- import-field-report <file>` | Import a downloaded field report |
| `npm run operator:7 -- verify` | Run all checks and update the run file |
| `npm run operator:7 -- export` | Write `.whirr/operator-7/<runId>/export/` |

## Phase 1 — real appliance and microphone

**Suggested object:** a safe, supervised household fan or comparable appliance. Do not open an enclosure, defeat a guard, or use a dangerous appliance.

1. Open `http://localhost:5173/studio` and create a non-synthetic object.
2. Open `http://localhost:5173/studio/objects/<objectId>/calibration-lab`.
3. Select the actual microphone. Keep the distance fixed.
4. Record **at least 5 live idle, 5 active and 5 negative takes**. The lab requires 2/2/1 to train; the extra takes are required by issue #2 and can be recorded with “Record another”.
5. Train the model. The workflow requires a **READY `USER_CALIBRATION`** model.
6. Record all four field trials: three-cycle, noise, distance and replay. Generate the report. It must be `FIELD_PASS`.
7. Open `http://localhost:5173/studio/objects/<objectId>/gate-a`. Run the three-trial log **four times** (12 ON/OFF trials total), downloading each client-reported JSON after each run. The page labels the log `OPEN_PENDING_REVIEW`.
8. Publish pricing or an owner-approved Physical Promise so the object appears as a Wish source.

Expected result in the workflow:

- live take counts at least `5/5/5`;
- model `READY` and provenance `USER_CALIBRATION`;
- field report `FIELD_PASS` with a report id and evidence hash;
- four valid Gate A logs covering at least 12 completed trials, all matching the active model hash;
- the source has terms or an approved promise.

Gate A and Gate B remain **OPEN**. The logs are client-reported; a human reviewer must inspect the physical conditions, microphone, failures and hashes.

## Phase 2 — interrupted and qualifying Quiet Window

Use **two separate agreements** so each window is a new, participant-scoped observation.

1. Buyer: `http://localhost:5173/ambient/wish`.
2. Provider: `http://localhost:5173/operator/ambient` (sign in first).
3. For the interrupted trial, establish the active baseline, let the source stop, then restart it before the required continuous inactive window completes. Stop and evaluate. The expected outcome is `INTERRUPTED`, never capture-eligible.
4. For the qualifying trial, establish the baseline, stop the source, and keep it undetected for the full approved duration. Stop, review and explicitly accept the result.
5. Open the Accord and ensure the signed proof is available.

Expected result in the workflow:

- one live session with `outcome=INTERRUPTED` and `eligible_for_capture=0`;
- one live session with `outcome=QUALIFIED`, buyer acceptance recorded and a locally verifying stored proof;
- no capture on the interrupted session.

A demo-labeled live session can be physical evidence, but its public story must say `DEMO_NO_PAYMENT`. The proof establishes integrity and recomputation, not silence, power-off or machine identity.

## Phase 3 — authentic PayPal Sandbox lifecycle

A human buyer must approve in the official PayPal Sandbox UI. The CLI cannot and will not click that approval.

1. Configure `.env` with Sandbox-only credentials and `PAYPAL_WEBHOOK_ID`; restart the API.
2. Create a **non-demo** agreement/session for the real object.
3. Create the order and open the official approval link.
4. The buyer approves the exact cap in the official Sandbox UI.
5. Return to Whirr and confirm the authorization. Complete the qualifying window, accept the result, then capture.
6. Separately run an interrupted/failed window with an authorization, then void it. It must not capture.
7. Run `npm run operator:7 -- phase 3`. The tool performs read-only provider lookups for the capture and void.

Expected result:

- capture provider status `COMPLETED`, `final_capture=true`, exactly the accepted fixed price and currency;
- void provider status `VOIDED`, no capture id;
- explicit operator attestation that a human used the Sandbox approval UI;
- provider lookup results recorded separately from local state.

The historical 4.x capture is not used. The workflow cannot prove buyer identity, and Sandbox funds are not revenue. Gates E, F and G remain **OPEN** until the artifacts and independent review exist.

## Phase 4 — genuine signed webhook

Do not expose the full application. The provided proxy exposes only `POST /api/paypal/webhook`.

Terminal A:

```bash
npm run dev
```

Terminal B:

```bash
npm run proxy:webhook
# 127.0.0.1:8790, webhook-only
```

Terminal C (free temporary tunnel; install `cloudflared` separately if absent):

```bash
cloudflared tunnel --url http://127.0.0.1:8790
```

Then:

1. In the same PayPal Sandbox app, register `https://<tunnel-host>/api/paypal/webhook`.
2. Subscribe to the payment/checkout events used by the flow.
3. Copy the **webhook ID**, not the URL, to `PAYPAL_WEBHOOK_ID`; restart the API.
4. Trigger a new Sandbox event. The tunnel must be live while PayPal delivers it.
5. In the workflow, enter the public webhook URL and wait for a verified event.

Expected result: a `paypal_webhook_events` row with `verified=1`, a payment/checkout event type and a real received timestamp. A loopback replay or hand-crafted payload is not Gate H.

The tunnel is not durable hosting. `WHIRR_PUBLIC_ORIGIN` remains the local browser origin; the tunnel is only for the webhook route.

## Phase 5 — three-minute demo and submission package

1. Record a truthful demonstration. The existing `docs/demo-7.0.md` storyboard is the source of truth.
2. Show the unmodified appliance, enrollment, measurable Wish, exact terms, interrupted and qualifying outcomes, proof verification and explicit limits.
3. Label any synthetic replay. Do not splice in the historical 4.x capture.
4. Keep the video at or below **180 seconds**. `ffprobe` measures the actual file.
5. Upload only after review, then record the public/unlisted YouTube URL.
6. Submit to Devpost and record the confirmation URL. A draft is not a submission.

The workflow writes a redacted review package to:

```text
.whirr/operator-7/<runId>/export/
  operator-report.md
  manifest.json
  run.redacted.json
  README.md
  artifacts/
```

The package is marked `NOT_CERTIFIED`. It does not edit `docs/evidence/ambient-7.0.json`, `docs/evidence/gate-a.json` or any gate record. A named reviewer must inspect the artifacts and update those files.

## What the workflow will not do

- It will not open the microphone or perform physical actions.
- It will not approve PayPal or enter buyer credentials.
- It will not create a webhook event, tunnel automatically, or claim delivery from a dashboard screenshot.
- It will not close a canonical gate.
- It will not present synthetic replay as a physical trial.
- It will not print PayPal secrets, cookies or the operator key.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Preflight says app is blocked | Start `npm run dev`; confirm `http://127.0.0.1:8787/api/health` and `/api/ready` |
| Object missing from Wish | Publish pricing or an owner-approved promise after the field report |
| Field report is `FIELD_FAIL` | Keep the failure; retake the failed trial or improve live takes and retrain. Do not lower thresholds |
| Gate A log rejected | Download a new log from `/studio/objects/:id/gate-a`; ensure three completed ON/OFF trials and `CLIENT_CLAIMED_LIVE_MICROPHONE` |
| PayPal lookup blocked | Check Sandbox credentials/network; do not claim success from the database |
| Webhook not verified | Confirm the tunnel targets port 8790, the webhook ID is from the same app, and the dashboard shows a delivery |
| Video check unavailable | Install ffmpeg/ffprobe, or keep the measured duration in the run notes and leave phase 5 open |
| Devpost not confirmed | Leave the submission phase open; do not call it submitted |

## Evidence boundary

The operator workflow proves only what it can read: local database rows, imported client-reported logs, provider responses, signed proofs and file hashes. It cannot prove physical presence, human identity, silence, power-off, safety or legal authority. The canonical gate status remains in [`go-no-go.md`](go-no-go.md), and the release remains **NO-GO** for the claims listed there until the required independent review and external confirmations exist.
