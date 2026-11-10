# Submission 7.0 — Whirr Ambient

## Status

This is a local release candidate. No public submission has been made or verified.

| Item | Status |
| --- | --- |
| Functional local application | BUILT |
| Four Ambient surfaces | BUILT |
| Deterministic agreement/evaluator | BUILT |
| Signed Ambient proof and independent verifier | BUILT |
| Automated domain/integration tests | **PASS — 133/133 across 23 files**, including Ambient 18/18 |
| Ambient focused tests | **PASS — 18/18** (11 unit, 7 integration) |
| Browser suite | **PASS — 57/57** at 1440×900, 834×1112 and 390×844 |
| Production build | **PASS — main JS 297.25 kB / 94.42 kB gzip** |
| Smoke check | **PASS** |
| Browser/responsive review | 57/57 E2E; all six screenshots visually inspected; no independent accessibility audit |
| Public repository push | NOT DONE |
| Public deployment | NOT DONE |
| Genuine physical field trial | OPEN — human action |
| Genuine 7.0 Sandbox authorization/capture | OPEN — human action |
| Genuine signed webhook | OPEN — human action |
| External participant comprehension | OPEN — human action |
| Public YouTube demo under three minutes | OPEN — human action |
| Devpost submission | OPEN — human action |
| License | MIT, already present |

Deadline: **12 November 2026, 3:00 PM Eastern**. Do not claim submission before a Devpost confirmation exists.

## What a judge can inspect locally

- `/ambient` — product overview.
- `/ambient/wish` — buyer wish and refusal behavior.
- `/ambient/exchange/:id` — negotiation record.
- `/ambient/window/:id` — replay/live observation surface.
- `/ambient/accord/:id` — cooperation record and proof.
- `/ambient/judge` — credential-free interrupted/qualified replays.
- `/ambient/proof/:proofId` — public proof verification.
- `/ambient/operator` or `/studio` — provider/operator views.
- `/verify` — preserved earlier proof verifier.

## Setup

```bash
npm install
npm run setup
npm run dev
```

For an isolated Ambient reference refresh:

```bash
npm run seed:ambient
```

The seed is synthetic. It does not close physical or payment gates.

Operator sign-in:

```bash
npm run key
```

Use `/operator/login`. Never put the key in the repository, screenshots, video, or submission.

## Demo video checklist

- Show an ordinary unmodified object.
- Show a measurable wish and a refused unmeasurable wish.
- Show provider and buyer exact-terms approval.
- Show a genuine Sandbox flow only if it exists; otherwise state that it is pending.
- Show a labelled failed replay and a labelled qualifying replay.
- Show the Accord and independent verification.
- State the physical and financial limits.
- Keep it under three minutes.
- Upload publicly only after reviewing the final cut.

## Repository checklist

- `.env` / `.env.local` not tracked.
- No operator keys, cookies, PayPal secrets, or personal recordings.
- MIT license present.
- Setup and test instructions work from a clean checkout.
- Synthetic labels visible.
- Historical 4.x evidence preserved and not reused as 7.0 proof.
- Public routes reviewed; operator and participant routes scoped.
- Webhook ingress not exposed as the full app.
- Record the final branch and commit SHA.
- Do not push/publish without authorization.

## AI tool disclosure

This implementation was produced with an AI coding assistant (Codebuff/Freebuff). The assistant inspected and edited the repository, wrote code, tests, and documentation, and ran local commands.

Runtime intelligence is a deterministic local compiler and local acoustic event model. No paid AI API is used at runtime. The 7.0 compiler is not an LLM. The submission must accurately disclose the assistant under the hackathon rules.

## Product description

Whirr Ambient is a buyer-initiated cooperation exchange for observable changes in a physical environment. A buyer states a condition, Whirr compiles a measurable rule, a provider voluntarily accepts or counters, PayPal Sandbox backs the exact terms, a local witness records interval states, a deterministic evaluator decides eligibility, the buyer accepts the result, and a signed portable proof records what happened and what remains unproven.

The defining demo is Quiet Window: paying for a temporary absence of a known machine’s activity without buying or modifying the machine.

## Honest limitations for the submission

- The bundled reference model is synthetic.
- No physical Quiet Window field trial has been run.
- No genuine 7.0 Sandbox authorization, capture, void, or webhook exists.
- Demo replay cannot capture money.
- A microphone cannot prove silence, power-off, identity, or safety.
- The proof does not establish real-world truth.
- No external customer study or market validation was performed.
- The product is an invited-participant prototype, not an open marketplace.
