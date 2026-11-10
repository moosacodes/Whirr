# Whirr 7.0 operations runbook

**Scope:** local single-node Whirr 7.0 API, SQLite database, signed evidence, PayPal Sandbox
**Review date:** 10 November 2026
**Status:** author-verified procedures; no production deployment or independent review

## Identity and diagnostics

Every response carries a server-generated `X-Request-Id`. The same id is attached
to Fastify request logs and is returned as `requestId` by `/api/health` and
`/api/ready`. Use it to correlate a user report with a log line; never ask a user
to send cookies or authorization headers.

Logs redact:

- `req.headers.authorization`
- `req.headers.cookie`
- `req.headers["paypal-transmission-sig"]`
- `req.headers["paypal-cert-url"]`
- `res.headers["set-cookie"]`

The redaction configuration is in `apps/api/src/app.ts`. It is a safety net, not
permission to log private evidence. Do not add raw audio, feature arrays, full
provider payloads, or secrets to application logs.

## Health and readiness

| Endpoint | Meaning | Failure interpretation |
| --- | --- | --- |
| `GET /api/health` | Process is serving HTTP; includes uptime, PayPal configuration flags and demo mode | A non-200 means the HTTP process is not serving |
| `GET /api/ready` | Database responds, the active signer key is present, PayPal flags are reported, and pending outbox count/oldest schedule are reported | A `503` means the database or signer is unavailable; inspect the `checks` object |
| `GET /api/operator/outbox` | Operator view of queued webhook reconciliation work | Inspect pending/attempt/last error; do not blindly retry an unknown provider outcome |

`/api/ready` never returns credentials, cookies, signing private keys, raw audio,
or private evidence. `paypal.status = "not_configured"` is a valid local demo
state, not a failed readiness check.

## Startup and shutdown

1. Run `npm run setup` once to create the SQLite database and local material.
2. Start with `npm run dev` or `npm start`; the API defaults to `127.0.0.1:8787`.
3. Confirm `/api/health` and `/api/ready` respond before opening the browser.
4. Stop with `Ctrl+C`/`SIGTERM`. The server clears its outbox timer and closes
   Fastify, which closes the SQLite store. Allow the process to exit; do not
   kill it during a provider request if an alternative exists.

The outbox drain runs every 15 seconds while the server is up. A restart is safe:
operations and provider identifiers are durable, and capture reconciliation is
read-only. Never start a second capture because a request timed out; reconcile
first.

## Recovery procedures

### API restart or lost browser

1. Restart the API and check `/api/ready`.
2. Reload the session. The server is authoritative; do not infer success from a
   spinner, a URL, or a previous toast.
3. If the state is `RECONCILIATION_REQUIRED`, use the explicit reconcile action
   and record the request id. Do not call capture again.

### Expiring authorization

An expired authorization cannot be captured. The session becomes `EXPIRED`; no
provider capture is attempted. Start a new negotiated session with a new
authorization. Do not edit timestamps or database state to bypass expiry.

### Unknown capture or void outcome

1. Treat the provider outcome as unknown; do not retry the mutation.
2. Use the read-only reconciliation endpoint or operator outbox drain.
3. Match the stored provider id, amount, currency, terms hash, acceptance and
   replayed evidence before claiming success.
4. If the provider still cannot be reached, keep `RECONCILIATION_REQUIRED` and
   escalate with the request id, session id and provider operation id. Never
   claim a capture or void without a provider-confirmed result.

### Duplicate webhook

Webhook ingress verifies the raw body/signature, records the event id and payload
hash, and deduplicates repeats before enqueueing reconciliation. A repeated
webhook must not create a second capture or void. Inspect the webhook event row
and outbox item rather than replaying a mutation manually.

### Database backup and restore

1. Stop the API or otherwise quiesce writes.
2. Copy `data/whirr.db` with any `-wal` and `-shm` sidecars to a separate
   disposable location.
3. Restore to a disposable copy first, never over the only copy.
4. Start the API against the copy, run `/api/ready`, and verify a known signed
   proof with `npm run proof:verify` before replacing production data.
5. Record the backup time, schema version, proof id and verification result.

The local database is the system of record for this installation. It is not a
managed backup service; no off-site durability is claimed.

## Secret handling

- The operator key and cookie secret come from the environment/key file and are
  never sent to the browser.
- PayPal credentials remain server-side. A missing configuration disables live
  payments and should be visible as `not_configured`, not silently treated as
  success.
- Rotate credentials outside the repository. Never paste them into an issue,
  PR, log, browser storage, or screenshot.
- Secret scanning and dependency review run in CI; see `.github/workflows/ci.yml`.

## Escalation checklist

Include only:

- `X-Request-Id`
- agreement id and session id (not participant secrets)
- current state and payment state
- provider operation type and provider reference, if safe
- whether the result was provider-confirmed or still unknown
- the relevant signed proof id/hash, not raw microphone data

Do not include cookies, authorization headers, client secrets, full PayPal
payloads, raw audio, or private participant identifiers.

## Tested evidence

`tests/integration/api.test.ts` asserts the request-id header, `/api/ready`
shape, and absence of the test cookie secret, client-secret field, and operator
key in the response. `docs/reliability-matrix.md` maps retry and recovery states
to integration tests. A real remote deployment, multi-host failover, and an
independent operations review remain OPEN.
