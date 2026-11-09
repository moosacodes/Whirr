# PayPal Sandbox integration

Whirr uses the PayPal **Sandbox** REST API for a genuine authorize → capture lifecycle. It never uses live credentials and never charges real money.

> **Current status in this checkout:** Sandbox credentials and a webhook ID are configured. A genuine Sandbox run completed on **8 November 2026** using the official buyer approval UI:
>
> - Order `77T95682L88230118` — `COMPLETED`
> - Authorization `783967879W676894R` — `CAPTURED` (authorized cap USD 5.00)
> - Capture `7YY23328DP2020327` — `COMPLETED`, **USD 0.07**, `final_capture: true`
> - Session: 20.0s billable, 15.0s idle excluded, quote hash `a941465f…`
> - Receipt verification: **8/8 checks pass**, including provider amount, audit chain and the passport-exclusion check added after the capture
>
> This is simulated Sandbox money, not a real charge. The interval evidence was submitted through the authenticated evidence API for this payment test, not captured from a physical microphone; it proves the authorization/capture/receipt path, while real-object sensing remains Gate A. The signed-webhook gate remains **OPEN** because no public HTTPS listener received a verified event. The evidence was produced by this checkout, not copied from a simulator.

## 1. What is implemented

| Capability | Implementation |
| --- | --- |
| OAuth | Client-credentials token, server-side only, cached until expiry |
| Order | Orders v2 with `intent: AUTHORIZE`, cap amount, stable `PayPal-Request-Id`, return/cancel URLs |
| Approval | Official Sandbox approval link; buyer signs in to PayPal, not to Whirr |
| Authorization | Reads order, authorizes if needed, fetches authoritative authorization, checks `CREATED` and exact amount/currency |
| Capture | Payments v2 capture from authorization, final amount ≤ cap, `final_capture: true`, stable request ID, `Prefer: return=representation`, and an authoritative capture `GET` before amount comparison |
| Zero bill | Void authorization, then authoritative `GET` must confirm `VOIDED`; `$0` is never captured |
| Pending | Recorded as `CAPTURE_PENDING`, queued for reconciliation, never shown as settled |
| Denied/failed | Recorded as unpaid; no settlement receipt claims success |
| Reconciliation | Authoritative `GET` of order/authorization/capture; throttled; outbox retry |
| Webhooks | Raw body, transmission headers, PayPal verify-signature endpoint, event ID dedup, payload hash, audit |
| Refund | Operator-only, bounded by captured amount, provider ID recorded |
| Idempotency | Stable request IDs per operation, unique `(session, operation_type)`, early return for completed captures |

Host enforcement: the config loader and client reject any base URL whose hostname is not `api-m.sandbox.paypal.com`. `http://127.0.0.1` / `http://localhost` is allowed only for local contract tests. `PAYPAL_ENV` must be `sandbox`.

## 2. Prerequisites

- A free PayPal Developer account: <https://developer.paypal.com/>
- A Sandbox REST app (same app for payments and webhooks).
- A Sandbox **business/seller** account for the app.
- A Sandbox **personal/buyer** account for approval.
- No paid plan, card charge or live account is required.
- For webhooks, an HTTPS URL reachable by PayPal. A temporary tunnel is acceptable for a test; it is not durable hosting.

## 3. Configure credentials

1. Sign in to the PayPal Developer Dashboard.
2. Open **Apps & Credentials** and select **Sandbox**.
3. Create (or open) an app. Copy its **Client ID** and **Secret**. The secret is shown only when generated.
4. Create or view Sandbox accounts: one business (merchant) and one personal (buyer). Use the buyer's Sandbox login in the approval window; never put its password in this project.
5. In the same app, add a webhook and subscribe to the order/authorization/capture/refund events available to your account. At minimum, subscribe to:
   - `CHECKOUT.ORDER.APPROVED`
   - `PAYMENT.AUTHORIZATION.CREATED`
   - `PAYMENT.AUTHORIZATION.VOIDED`
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.CAPTURE.PENDING`
   - `PAYMENT.CAPTURE.DENIED`
   - `PAYMENT.CAPTURE.REFUNDED`
6. Copy the **Webhook ID** (not the URL) into `PAYPAL_WEBHOOK_ID`.
7. Put values in `.env` (never commit it):

```dotenv
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
WHIRR_PUBLIC_ORIGIN=http://localhost:5173
```

Restart the API after changing `.env`. Confirm the app no longer says “demo metering” and `/judge` shows the PayPal configuration gate as PASS.

> `.env` is read by the API. Do not create `.dev.vars` for this Vite/Node setup; its presence can interfere with local tooling and it is not needed.

## 4. Return URLs and origin

The server builds PayPal return/cancel URLs from the request `Origin` only if it is in the configured allowlist, otherwise from `WHIRR_PUBLIC_ORIGIN`.

- Vite development: `WHIRR_PUBLIC_ORIGIN=http://localhost:5173`
- Built app served by the API: `WHIRR_PUBLIC_ORIGIN=http://localhost:8787`
- A tunnel/domain: set it to that exact HTTPS origin. Never derive it blindly from an untrusted `Host` header.

After approval, PayPal returns to `/session/:id?paypal=return`. The page calls the authorize endpoint. If the buyer cancels, it returns with `?paypal=cancel` and the session stays unpaid.

## 5. End-to-end test recipe

Use two browser profiles or one profile plus a private window. One can be the operator, the other the renter. Sandbox buyer approval must be a human action.

1. Start from `npm run setup && npm run dev`.
2. Sign in as operator, open the seeded service card or create an object, train a READY model, publish terms (e.g. $0.20/min, $5.00 cap).
3. Open `/s/obj_reference_fan` as the renter. Confirm the page shows **Sandbox — no real money**, the exact rate, cap, rounding, uncertainty policy and limitations.
4. Create the session, accept the exact terms hash, and choose **Approve in PayPal Sandbox**.
5. In the official PayPal window, sign in with the **Sandbox personal** account and approve the cap.
6. Return to Whirr. The authorize endpoint must fetch an authorization with status `CREATED` and amount equal to the cap. Confirm the read-only `GET /api/sessions/:id/paypal/status` returns `paymentState: AUTHORIZED` and the authorization ID. If reconciliation was interrupted, call `POST /api/sessions/:id/paypal/reconcile`; a GET never triggers provider reads.
7. Start sensing with the object and microphone. Run at least one ON/OFF/ON cycle. Verify uncertain/idle time is excluded, not billed.
8. Stop. Review the ledger and accept the quote. If the model is LIMITED, an operator must approve the reviewed amount first.
9. Capture. Confirm the UI and provider status show `COMPLETED`, the captured amount equals the reviewed quote, and the receipt says `PAYPAL_SANDBOX` with the capture ID and provider status.
10. Open the receipt verification panel. Confirm quote, cap, evidence, receipt hash, interval consistency, passport exclusions, provider amount and audit chain all verify (8/8 after capture; provider amount is not applicable before capture).
11. Test zero charge separately: run a session with no confident activity, stop, review, then void. Confirm provider status `VOIDED` and a no-charge receipt. Never capture $0.
12. Test failure paths: cancel approval; refuse authorization; use a Sandbox account without sufficient funds; force a pending capture if your account supports it; verify states remain pending/denied/unpaid rather than success.

Record only redacted evidence: merchant/app name, order/authorization/capture IDs (last 4–6 characters if public), timestamps, statuses, amounts/currency, and the verification panel. Never show the client secret, buyer password, full account details or cookies.

## 6. Webhooks

Register the HTTPS URL:

```text
https://YOUR-TUNNEL-HOST/api/paypal/webhook
```

Requirements:

- The public endpoint must be HTTPS and serve only the webhook route. Whirr binds loopback by default and ships **no tunnel**. If you expose it, put a minimal reverse proxy in front that forwards only `POST /api/paypal/webhook`; do not expose the operator console or the rest of the API.
- Set `PAYPAL_WEBHOOK_ID` to the ID from the same Sandbox app. Without it the endpoint returns 503 and polling remains the only reconciliation path.
- PayPal sends `paypal-transmission-*` headers. Whirr preserves the raw body, validates that the certificate URL is an HTTPS PayPal Sandbox host and the algorithm is `SHA256withRSA`, then calls `/v1/notifications/verify-webhook-signature`; anything not `SUCCESS` is rejected. Signature verification happens before the event is treated as authoritative.
- Event IDs are unique. A duplicate with the same body returns a duplicate acknowledgement; a duplicate ID with a different body is rejected as a conflict. Rejected payloads are truncated and audited, and a valid retry may replace an unverified event-id reservation.
- Events are triggers to reconcile authoritative state, never commands to charge. The outbox retries failed reconciliations with backoff.

For local development, the simplest honest path is an explicit **`POST /api/sessions/:id/paypal/reconcile`** after the buyer returns or a payment action times out. `GET /api/sessions/:id/paypal/status` is read-only. A temporary tunnel is useful only while it is online; it is not durable judge hosting. Do not present simulator events as genuine webhook delivery.

### Webhook-only loopback proxy

Run `npm run proxy:webhook`. It binds `127.0.0.1:8790` by default and forwards **only** `POST /api/paypal/webhook` with the raw body and `paypal-*` headers to the loopback API. Every other method or path returns 404. It enforces a 256 KiB body limit and 60 requests/minute per peer. Point a tunnel at the proxy, not at the API.

The proxy is loopback HTTP. It is not public HTTPS, does not terminate TLS, and does not close Gate E. Gate E requires a genuine signed PayPal event delivered over public HTTPS. The proxy also does not authenticate the tunnel; use a provider that terminates TLS and forwards only this path.

## 7. Status mapping

Application payment states: `NONE`, `ORDER_CREATED`, `BUYER_APPROVED`, `AUTHORIZED`, `CAPTURE_REQUESTED`, `CAPTURE_PENDING`, `CAPTURE_COMPLETED`, `CAPTURE_DENIED`, `VOID_REQUESTED`, `VOIDED`, `REFUND_REQUESTED`, `REFUNDED`, `DEMO_MODE`, `UNRESOLVED`.

Rules:

- `CAPTURE_COMPLETED` **only** when PayPal returns `COMPLETED` and amount/currency match the reviewed quote.
- `PENDING` stays `CAPTURE_PENDING`/`SETTLEMENT_PENDING`, never settled.
- A capture failure is `CAPTURE_DENIED`/`FAILED`; no receipt claims payment.
- An unknown network outcome is not guessed; reconciliation resolves it.
- An authorization amount that does not equal the consented cap is `UNRESOLVED` and blocks capture.

## 8. Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `PayPal Sandbox is not configured` (503) | Missing client ID/secret | Add both to `.env`, restart |
| Order creation fails 401/403 | Wrong app credentials or disabled app | Regenerate Sandbox app credentials; confirm Sandbox mode |
| Buyer window says the app is invalid | Using live credentials / wrong environment | Recheck `PAYPAL_ENV=sandbox` and the Sandbox app |
| `BUYER_NOT_APPROVED` | Approval window not completed | Finish approval; return to Whirr |
| `AUTHORIZATION_NOT_CAPTURABLE` | Authorization expired/voided/captured | Create a new session; reconcile old state |
| `AUTHORIZED_AMOUNT_MISMATCH` | Cap/currency changed or provider returned a different amount | Do not capture; inspect and use a new session |
| Capture `INSTRUMENT_DECLINED` / denied | Sandbox buyer funding or account issue | Use another Sandbox buyer; do not fake success |
| Webhook 503 | `PAYPAL_WEBHOOK_ID` missing | Register the webhook in the same app and set the ID |
| Webhook signature invalid | Wrong ID, modified body, stale tunnel | Verify ID, raw-body preservation, tunnel URL |
| Capture stays pending | Provider review / account behavior | Observe, POST reconcile, do not mark settled manually |
| No verified webhook appears | Tunnel offline or subscription missing | Check deliveries in the dashboard; POST reconcile still reads authoritative state |

## 9. Security rules

- Client secret and webhook ID are server-side only. Never put them in web assets, screenshots, chat or Git.
- Never use live PayPal credentials. The app refuses non-Sandbox hosts, but also do not attempt to bypass that guard.
- Approval links and webhook certificate URLs are restricted to HTTPS `*.sandbox.paypal.com`; unsupported signature algorithms are rejected.
- Buyer credentials stay with the buyer. Whirr never asks for a PayPal password.
- Use disposable dedicated Sandbox accounts. Revoke/rotate if exposed.
- Redact IDs and personal data in public receipts; use the redacted export.
- Do not expose the operator API through a tunnel. Local install remains the supported judge path.
- A Sandbox approval is not a completed charge; describe it accurately in the demo.

## 10. Payment gate status

The payment gate is **closed** for this checkout. The run above produced all of the following:

1. an approved order and authorization for the USD 5.00 cap,
2. a captured amount equal to the reviewed USD 0.07 bill,
3. a `COMPLETED` capture verified by `GET /v2/payments/captures/:id`,
4. a receipt whose verification panel shows **8/8** checks true; the passport check was added after the capture and is recomputed from the stored intervals.

This is a Sandbox transaction with simulated funds, not a live charge. The separate webhook gate (Gate E) remains **OPEN**: the webhook ID is configured, but no public HTTPS listener has received a signed event. Zero-charge void, denied, pending and reconciliation paths remain implemented and covered by automated tests; this document does not claim a live failure-path run.

## 11. Authorization expiry, reauthorization and timeline

The authorization expiry returned by PayPal is stored as `authorization_expires_at` and displayed on the session, READY panel and receipt bundle. Once it has passed, interval uploads and capture are blocked with `AUTHORIZATION_EXPIRED`; the UI does not offer a false success path.

`POST /api/sessions/:id/paypal/reauthorize` is allowed only when all of these hold: the session is `READY`, payment is `AUTHORIZED`, the stored authorization has actually expired, and there is no interval, billable time or reviewed bill. A replacement order is recorded with an audit event and the old authorization ID is retained in the provider-status note. The endpoint refuses with `AUTHORIZATION_IN_USE` after usage, so an authorization cannot be silently swapped after a reviewed bill.

The payment timeline projects `payment_operations` into four distinct states: `PENDING` (requested/authorized but not provider-reconciled), `DENIED` (failed), `UNKNOWN` (outcome not known), and `RECONCILED` (authoritative provider completion). A pending or unknown event is never styled as settled. The same timeline is embedded in v3 bundles.
