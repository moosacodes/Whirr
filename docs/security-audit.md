# Security audit

**Audit date:** 9 November 2026  
**Scope:** local Whirr checkout: API configuration, authentication and cookies, session ownership, interval validation, PayPal order/authorization/capture/void/refund paths, webhook ingestion, receipt/audit verification, static serving, browser entry points and installed dependencies.  
**Not a formal penetration test or security certification.** This was a source review plus targeted tests, a dependency audit and runtime probes.

## 1. Findings fixed in this pass

| Area | Finding | Fix |
| --- | --- | --- |
| Webhooks | A payload was persisted before signature verification, and an attacker could reserve an event ID with invalid content, blocking a later legitimate retry. | Verify the signature first. Rejected payloads are truncated and audited. A valid retry can replace an unverified event-id reservation; a verified ID with a different payload remains a conflict. |
| Webhooks | The certificate URL and authentication algorithm were forwarded without local allowlisting. | Only HTTPS PayPal Sandbox certificate hosts and `SHA256withRSA` are accepted before calling PayPal. |
| Cookies | `Secure` defaulted to false, including when the public origin was HTTPS. | Cookies are `Secure` when the primary public origin is HTTPS; `WHIRR_COOKIE_SECURE=1` forces it. HTTPS is required for non-loopback production origins. |
| Origins | Localhost origins were still accepted in production, and malformed public origins were not rejected. | A configured `WHIRR_PUBLIC_ORIGIN` replaces localhost defaults in production; production on a non-loopback host requires it. Credentials, paths, queries and fragments are rejected. |
| Audit metadata | Consent IP and user-agent references used unsalted SHA-256, which is brute-forceable for IPv4. | Replaced with keyed HMAC references using the cookie secret. |
| PayPal links | Returned approval URLs were trusted for browser navigation. | Approval and certificate URLs must be HTTPS `*.sandbox.paypal.com`; the session view and browser navigation re-check the approval URL. |
| Renewal | A renewal request ID used the wall clock, so a timeout/retry could create a second order. | Renewal uses the previous order ID as a deterministic nonce. |
| Reconciliation | A provider capture could settle without a matching reviewed quote. | A completed capture requires the reviewed quote hash to equal the current quote and an in-progress settlement state. |
| Audit verification | Malformed stored metadata could throw and turn receipt verification into a 500. | Malformed metadata now returns `auditChainValid: false` with the broken row. |
| Rate limits / config | Invalid rate-limit values were accepted; several sensitive/public routes lacked focused limits. | Rate limits are validated; webhook, judge, receipt, PayPal status, renter creation and outbox routes have explicit buckets. |
| Static serving | Encoded traversal was blocked by `@fastify/static` but surfaced as a 500. | The error handler maps Fastify 4xx errors to the correct status; traversal attempts now return 403. |
| Browser/import | Local WAV import could read an unbounded file; the proof capture page used `innerHTML` for result rows and an inline module that the strict CSP would block when served by the API. | WAV import is capped at 64 MB; proof results are built with DOM text nodes; the tool is now a Vite multi-page entry with an external same-origin module. |
| Receipt completeness | Refund state was recorded in the database but the receipt exposed no refund identifier or amount. | The payment record now includes the provider refund ID and refund amount; redacted exports mask the ID. |
| Dependencies | Production `@fastify/static` had a high-severity path/route-guard advisory; Vitest had critical dev-worker advisories. | Upgraded to `@fastify/static` 10.1.10 and Vitest 4.1.12; `npm audit` reports 0 vulnerabilities. |
| Configuration | The Judge reference model ignored `config.referenceModelPath`. | Judge uses the configured path. |
| Capture retry | A lost response after a successful capture could leave the client unable to retry without risking a duplicate request. | `SETTLEMENT_PENDING` + `CAPTURE_REQUESTED` can retry with the same stable request ID; a completed capture returns early. |
| Reauthorization | A replacement authorization could reuse the original order nonce. | Reauthorization retains the old order ID and derives a fresh `renew-<order>` idempotency key; it is refused after usage. |
| Payment operations | A conflicting request ID for a different operation shape could be replayed. | Operation request IDs are conflict-checked against the persisted operation row before provider work. |
| Refunds | A refund result was not independently checked against the authoritative provider resource. | Refund lookup verifies the provider refund ID, amount and currency; a mismatch becomes `UNRESOLVED` and never claims success. |
| Proof bundles | Rebuilding a bundle could mint different signed bytes for unchanged evidence. | Bundles reuse stored signed bytes when receipt hash, Merkle root, passport and capture claim are unchanged. |
| Proof verifier | Re-signed bundles could change interval totals or model/terms bindings while keeping a valid outer signature. | The verifier recomputes interval totals and checks model, status and terms-hash bindings; the standalone verifier mirrors the totals check. |
| Responsive receipt | The receipt explorer's table escaped its mobile grid track at 390 px. | Grid tracks and table wrappers are constrained with `minmax(0, 1fr)`/`min-width: 0`; Playwright asserts no page overflow at 390, 834 and 1440 px. |
| Webhook ingress | The audit previously noted no webhook-only proxy. | `npm run proxy:webhook` is shipped and returns 404 for every non-webhook path; it remains loopback-only and does not close Gate E. |

## 2. Verification performed

- `npm run typecheck` — pass.
- `npm test` — **73/73 pass** at the 3.0.1 audit date, including the 11-case PayPal provider-contract harness, webhook ordering/replay, signed proof tampering, protocol migration and payment idempotency.
- `npm run build` — pass.
- `npm run smoke` — pass (health, judge, service card, operator auth).
- `npm audit` — 0 vulnerabilities across the full tree.
- Static runtime probe — app root, passport tooling, CSS and health route served; encoded traversal blocked without file exposure.
- Existing integration checks — CSRF/origin rejection, renter isolation, receipt verification, interval overlap/replay handling and audit-chain verification.

## 3. Residual risks and open gates

- No public HTTPS ingress or verified real PayPal signed webhook has been delivered; Gate E remains **OPEN**.
- Local development has no TLS. Use a trusted HTTPS proxy and set `WHIRR_PUBLIC_ORIGIN` for any exposure.
- `WHIRR_TRUST_PROXY=1` must only be used behind a trusted proxy; otherwise forwarded client IPs can be spoofed.
- The webhook-only loopback proxy is a path restriction, not public HTTPS or tunnel authentication. Do not expose the operator API; Gate E remains OPEN until a genuine signed event arrives over public HTTPS.
- No independent penetration test, formal threat-model review or physical anti-spoof test has been performed.
- SQLite is not encrypted at rest, and a host administrator can rewrite the database; hash chains are a checkpoint, not an external timestamp.
- The app is a single-host, supervised-venue prototype. It is not claimed to be tamper-proof, unattended-secure, production-ready or multi-tenant SaaS.

See [`threat-model.md`](threat-model.md), [`safety.md`](safety.md) and [`go-no-go.md`](go-no-go.md) for the standing limitations.

## 4. Whirr 5.0 discovery-specific limits

The 5.0 discovery experiment adds a public read-only matcher. Its threat model is intentionally narrower than identity or access control:

- **No authentication or ownership claim.** A similarity match cannot prove which physical unit produced a sound, who owns it or whether a person is present. It must never unlock, authorize or bill by itself.
- **Replay is not solved.** A phone or speaker can reproduce the spectrum. Replay trials are measured and reported; they are not used to claim liveness.
- **Client-claimed provenance.** The server validates frame shape, quality and protocol metadata, not that the browser's microphone actually recorded a physical object. This is the same honesty boundary as the 4.x live-capture claims.
- **Read-only match endpoint.** `POST /api/discovery/match` does not insert a session, terms, payment operation, PayPal resource or field report. Integration tests assert the session and payment-operation counts do not change.
- **No new payment path.** A confirmed discovery uses the existing `/s/:objectId` consent/field-guard/PayPal Sandbox flow. Discovery never calls PayPal.
- **Evidence invalidation.** Re-enrolling an object or adding/discarding a trial deletes generated reports so stale held-out results cannot be presented as current.
- **No public deployment or physical evidence.** `docs/evidence/discovery.json` is `NOT_RUN`; the branch is not published or promoted.

The full protocol and limitations are in [`discovery-5.0.md`](discovery-5.0.md).
