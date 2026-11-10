# Security policy

## Supported version

| Version | Supported |
| --- | --- |
| `7.0.0-rc.1` | Release-candidate review only; no production support |
| Older 4.x, 5.0, 6.0 slices | Preserved historical evidence; no active security support |

Whirr is a supervised-venue prototype. It is not certified for unattended
operation, production payments, access control, or real-money settlement.

## Report a vulnerability privately

**Do not open a public issue, discussion, or PR for a vulnerability.**

Use GitHub's private vulnerability reporting:

<https://github.com/moosacodes/Whirr/security/advisories/new>

If that route is unavailable, contact the repository owner through the GitHub
profile linked from the repository and ask for a private channel. Do not send
secrets, raw audio, personal data, or production credentials in the first
message.

Include, where possible:

- affected commit and endpoint/page;
- impact and required attacker position;
- minimal reproduction using local or Sandbox data;
- whether a secret, payment authorization, proof, or participant record is at
  risk;
- suggested fix, if known.

Never test against real users, real money, or a third party. Use your own local
checkout and PayPal Sandbox accounts. Do not exfiltrate data, persist access, or
run destructive or availability attacks.

## In scope

- Authentication, authorization, ownership, CSRF, origin, and session handling.
- PayPal order, authorization, capture, void, refund, webhook verification,
  idempotency, and reconciliation behavior.
- Payment amount, ceiling, currency, and eligibility invariant bypasses.
- Ambient agreement, observation, acceptance, evaluation, and proof forgery.
- Raw-audio leakage, proof redaction, log redaction, and secret exposure.
- XSS, CSP, path traversal, unsafe file handling, and dependency vulnerabilities.
- Privacy defects involving participant identifiers or microphone data.

## Known limitations and out of scope

- Acoustic spoofing, replay, a similar appliance, or an unsupported claim about
  silence, power-off, identity, or safety are documented product limits, not a
  new vulnerability by themselves. A bypass that causes an unauthorized capture
  or false proof claim is in scope.
- Denial of service against the local development server, social engineering,
  and vulnerabilities in PayPal's own infrastructure are out of scope.
- The historical 4.x Sandbox capture is preserved evidence, not a live payment
  system.
- No bug bounty or payment is offered. Reports are handled on a best-effort basis.

## Disclosure

Please allow time for triage and a fix before public disclosure. The maintainer
will document confirmed issues without exposing reporter identity or secrets.
An AI-assisted or self-review is not described as an independent security audit.

## Security design

- [Threat model](docs/threat-model.md)
- [Security audit](docs/security-audit.md)
- [Ambient trust model](docs/ambient-trust-model.md)
- [Safety](docs/safety.md)
