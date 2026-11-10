# Ambient authorization matrix

**Scope:** Whirr 7.0 Ambient API
**Review date:** 10 November 2026
**Status:** author review only; independent security review remains OPEN

The server is authoritative for actor identity. Browser-supplied buyer, provider,
amount, model, or ownership fields are not trusted. Private resources return
`404` to a foreign participant so the resource cannot be enumerated.

## Actors

| Actor | Credential | Scope |
| --- | --- | --- |
| Anonymous | None | Published catalog, judge replay, public proof, and the seeded public reference agreement/model |
| Renter / buyer | Signed `whirr_renter` cookie | Agreements and sessions they created |
| Operator / provider | Signed `whirr_op` cookie | Provider-side agreement list and response for the configured operator |
| Participant | Renter or operator matching the stored buyer/provider id | Void, reconcile, and proof access for their session |

A single request cannot act as both buyer and provider. Operator authentication
does not satisfy a renter endpoint, and a renter cookie does not satisfy an
operator endpoint.

## Endpoint matrix

| Endpoint | Anonymous | Renter | Operator | Ownership rule |
| --- | --- | --- | --- | --- |
| `GET /api/ambient` | Yes | Yes | Yes | Published sources only |
| `GET /api/ambient/judge` | Yes | Yes | Yes | Seeded synthetic reference only |
| `GET /api/ambient/judge/sessions/:id` | Yes | Yes | Yes | Must belong to `amb_reference_window` |
| `GET /api/ambient/proofs/:proofId` | Yes | Yes | Yes | Public signed proof document |
| `GET /api/ambient/agreements` | No | Yes | Yes | Buyer id or provider id matches actor |
| `GET /api/ambient/agreements/:id` | Public demo only | Own only | Provider only | Participant role or seeded public demo |
| `GET /api/ambient/agreements/:id/model` | Public demo only | Own only | Provider only | Same agreement scope before returning the artifact |
| `POST /api/ambient/compile` | No | Yes | No | Creates a renter identity if needed |
| `POST /api/ambient/agreements` | No | Yes | No | Buyer is the authenticated renter |
| `POST /api/ambient/agreements/:id/withdraw` | No | Own only | No | Buyer id match |
| `POST /api/ambient/agreements/:id/decision` | No | Own only | No | Buyer id match and exact terms hash |
| `POST /api/ambient/agreements/:id/sessions` | No | Own only | No | Buyer id match and accepted terms |
| `GET /api/ambient/sessions/:id` | Public demo only | Own only | Provider only | Participant role or seeded public demo |
| `POST /api/ambient/sessions/:id/order` | No | Own only | No | Buyer/session owner and Sandbox mode |
| `POST /api/ambient/sessions/:id/authorize` | No | Own only | No | Buyer/session owner and stored order |
| `POST /api/ambient/sessions/:id/start` | No | Own only | No | Buyer/session owner and authorized state |
| `POST /api/ambient/sessions/:id/observations` | No | Own only | No | Buyer/session owner, monotonic sequence, model-bound evidence |
| `POST /api/ambient/sessions/:id/stop` | No | Own only | No | Buyer/session owner and observing state |
| `POST /api/ambient/sessions/:id/acceptance` | No | Own only | No | Buyer/session owner and exact terms hash |
| `POST /api/ambient/sessions/:id/capture` | No | Own only | No | Buyer/session owner, eligible state, authorization, amount ceiling |
| `POST /api/ambient/sessions/:id/void` | No | Participant | Participant | Participant role, no capture, provider operation |
| `POST /api/ambient/sessions/:id/reconcile` | No | Participant | Participant | Participant role; read-only provider reconciliation |
| `GET /api/ambient/sessions/:id/proof` | No | Participant | Participant | Participant role before returning the signed record |
| `GET /api/operator/ambient/agreements` | No | No | Yes | Provider id match |
| `GET /api/operator/ambient/agreements/:id` | No | No | Provider only | Provider id match |
| `POST /api/operator/ambient/agreements/:id/respond` | No | No | Provider only | Open offer, exact terms hash, provider id match |

## Defense in depth

- Global and focused IP rate limits cover compile, negotiation, order,
  authorization, observation, stop, acceptance, capture, void, and proof reads.
- Every state-changing API call requires the same-origin CSRF header and passes
  origin and `Sec-Fetch-Site` checks.
- Cookies are HTTP-only and signed. `Secure` is set when the public origin is
  HTTPS.
- API responses are `no-store`; security headers are set centrally.
- Payment success is never derived from client-supplied state. Provider status
  and stored authorization/capture identifiers are required.
- Public proof output is checked by the independent verifier and must not contain
  raw audio, features, or secrets.

## Test coverage

`tests/integration/ambient.test.ts` verifies:

- anonymous and foreign-renter agreement reads are not found;
- private model artifacts are not returned to foreign callers;
- the seeded public reference remains readable;
- buyer/provider role substitutions are rejected;
- cross-renter session reads and mutations are rejected;
- public proof output excludes raw microphone keys; and
- CSRF, origin, cache-control, and security headers remain enforced.

This matrix records author-level verification. It is not an independent
penetration test or security certification.
