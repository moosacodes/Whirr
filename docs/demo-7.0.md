# Demo 7.0 — Quiet Window

## The honest three-minute sequence

### 0:00–0:20 — The ordinary machine

Show an unmodified fan or workshop machine running.

> “What if you could buy thirty seconds of quiet without buying or modifying the machine?”

Do not show a prepared transaction as if it were live.

### 0:20–0:45 — The Wish

Open `/ambient/wish`.

1. Select the enrolled reference source.
2. Enter: “I need 30 seconds without the reference desk fan running while I record a voiceover. I will pay $2.00.”
3. Show the measurable interpretation.
4. Show a refused claim such as complete room silence or power savings.
5. Return to the executable wish.

Say plainly: the model evaluates the enrolled source, not the room.

### 0:45–1:10 — The Exchange

Open the Exchange as the buyer. Provider sees the exact source, terms, duration, price, reset rule, and no-capture policy.

- Provider accepts, or sends one explicit counteroffer.
- Buyer accepts the exact final hash.
- Point out that a superseded revision cannot be captured.

### 1:10–1:30 — The commitment

If a genuine Sandbox authorization exists, show:

- order creation;
- the actual PayPal Sandbox approval;
- the server-confirmed authorization.

If it does not exist, show the honest state and say: “This is the workflow; the genuine 7.0 Sandbox authorization has not been completed.” Do not splice in an older transaction or a mock.

### 1:30–1:50 — Failure

Open the seeded interrupted replay from Judge Mode.

The source restarts. The qualifying ring breaks. The evaluator returns `INTERRUPTED`. No buyer acceptance, no capture. Explain the reset rule.

### 1:50–2:25 — Success

Open the seeded qualified replay.

The baseline is active, then the source remains undetected for the full interval. The replay ends. Evaluate the stored ladder. The evaluator returns `QUALIFIED`. The buyer accepts the result. If this is the synthetic seed, say the buyer acceptance is a labelled demo record and no PayPal transaction occurred.

### 2:25–2:50 — The Accord

Show:

- original request;
- exact terms hash;
- observation ledger;
- trust domains;
- independent verification;
- what is explicitly not proven.

### 2:50–2:55 — The thesis

> “Commerce shouldn’t only be about buying things. It can help us cooperate.”

## Judge Mode

Open `/ambient/judge` without credentials.

- Case A: interrupted replay.
- Case B: qualified replay.
- `SYNTHETIC REPLAY` labels.
- `DEMO_NO_PAYMENT`.
- No physical field trial or genuine 7.0 capture claimed.

Open the public Accord/proof and verify it.

## Local setup

```bash
npm install
npm run setup
npm run dev
```

Open:

- `http://localhost:5173/ambient`
- `http://localhost:5173/ambient/wish`
- `http://localhost:5173/ambient/judge`
- `http://localhost:5173/ambient/accord/ase_reference_qualified`
- `http://localhost:5173/ambient/proof/apr_f83736365f6d462297858f16f8cf5578` (or the proof ID shown by the current Accord; a re-seed changes it)

The reference proof ID may change if the seed is regenerated. Always use the link displayed by the current Accord.

## Provider access

The provider is the local operator account. Use `/operator/login` with the key printed by `npm run key`. Never show the key on camera or commit it.

## What must not be staged

- Do not label a synthetic replay as a physical machine test.
- Do not show a PayPal mock as a genuine Sandbox transaction.
- Do not claim a webhook was delivered if it was not.
- Do not claim a participant study or customer quote that does not exist.
- Do not splice an old capture into a 7.0 flow.

If a genuine step is missing, the demonstration should state that plainly. The product is more credible when the boundary is visible.

## Current demo status

- Local synthetic judge path: available.
- Buyer Wish → Exchange: browser-verified locally.
- Provider decision: browser-verified locally.
- New demo replay ladder: generated and evaluated in the integration suite; not physically observed.
- Live microphone path: implemented; not exercised as a physical field trial in this release.
- Genuine 7.0 Sandbox authorization/capture: OPEN.
- Genuine webhook: OPEN.
- Local browser footage: CAPTURED — seven raw clips, see [`demo-7.0-recording.md`](demo-7.0-recording.md).
- PayPal 7.0 footage: NOT RECORDED — requires a human buyer to authorize a genuine Sandbox checkout.
- Public video: NOT EDITED OR UPLOADED.
- Devpost submission: NOT MADE.
- Final local checks: 133/133 domain/integration tests and 57/57 browser tests pass; see `docs/go-no-go.md`.
