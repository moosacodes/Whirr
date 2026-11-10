# Whirr 6.0 release notes - The Physical Promise Engine

**Version:** 6.0.0-rc.1
**Branch:** `experiment/whirr-6-physical-promise`
**Release status:** local release candidate, not a validated field product

## Added

- `packages/promise`: versioned agreement types, deterministic compiler, temporal evaluator, evidence roots, canonical agreement hash.
- `packages/audio/src/event-model.ts`: teachable event model with per-demonstration prototypes, open-set refusal, leave-one-take-out metrics, and a visible READY/LIMITED/REJECTED gate.
- Schema version 6 additive tables for demonstrations, event models, agreements, executions, observations, payment operations, and physical proofs.
- API domain and routes for the catalog, Teaching Room, training, compilation, publication, consent, authorization, observation, stop, capture, void, and proof verification, plus operator-scoped event-model review at `GET /api/operator/promises/model/:modelId`.
- Public `/promise` landing, `/studio/promises` Teaching Room, `/promise/:agreementId`, `/promise/run/:executionId`, `/promise/proof/:proofId`, and `/promise/:agreementId/model`.
- Live execution surfaces driven by real microphone classifiers. A closed microphone shows MIC CLOSED and no signal animation.
- `whirr.physical-proof.v1` signing and independent verification.
- Synthetic reference seed with two demo executions and signed proofs. Re-seeding refreshes the fixed executions' terms snapshots and re-signs their proofs under the documented proof ids.
- Read-only promise webhook reconciliation. A verified PayPal event resolves a promise only through stored provider ids. A capture is confirmed only when PayPal reports `COMPLETED`, the amount matches the stored qualified evaluation and approved ceiling, and a fresh deterministic replay of the stored observations agrees with the stored evaluation hash. Amount or evidence disagreement stays `RECONCILIATION_REQUIRED`; a voided authorization becomes `VOID_CONFIRMED`; nothing is captured or voided from a webhook.
- Promise unit and integration tests, plus browser journeys at 1440x900, 834x1112, and 390x844.
- Documentation set for the product, agreement grammar, temporal model, evidence, PayPal settlement, threat model, model card, field protocol, demo, submission, and release.

## Preserved

- Existing 4.x Bench, calibration lab, field gates, payment implementation, receipts, proof v3 verifier, discovery experiment, and historical evidence.
- The 4.x database tables and migration path. Version 6 adds tables; it does not rewrite historical rows.
- PayPal Sandbox-only configuration and the webhook-only public ingress design.

## Verification at this revision

- `npm run typecheck`: exit 0.
- `npm test`: 115/115 pass across 21 files.
- `npm run test:e2e`: 57/57 pass across three viewports.
- `npm run build`: success. Main JS 295.18 kB, 93.91 kB gzip.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Promise integration: qualifying demo proof verifies; tampered observation fails signature verification; interrupted demo remains ineligible; stale observations are rejected; demo capture is refused; the operator model detail is operator-only.
- Promise provider-contract tests: a completed capture with matching amount and qualified evidence confirms settlement; a mismatched amount, nonqualifying evidence, and a voided authorization are handled without claiming an unintended capture.
- Screenshots: `docs/v6/promise-1440.png`, `docs/v6/promise-834.png`, `docs/v6/promise-390.png`, `docs/v6/promise-detail-1440.png`.

## Model result

The synthetic reference event model is READY on the local gate: 15 takes, 3,183 frames, 6 groups, macro recall approximately 0.964, background recall approximately 0.904. This is synthetic validation, not field accuracy. No physical appliance has been recorded.

## Open gates

- No physical field trial.
- No genuine 6.0 PayPal Sandbox order, authorization, capture, void, or webhook.
- No public deployment or submission.
- No third-party certification or security audit beyond the local dependency audit.
- No claim that a microphone or browser is a trusted physical witness.

## Upgrade notes

Run `npm run setup` or `npm run seed:promise` to create the promise tables and the synthetic reference. Existing databases are opened with additive schema v6 tables. Do not treat seeded proofs as provider settlement.

## Rollback

The 6.0 code is isolated on its experiment branch. `main` remains at the pre-6.0 baseline. Existing 4.x routes and proof verifiers are still available.
