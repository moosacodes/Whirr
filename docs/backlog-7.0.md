# Whirr 7.0 product backlog

**Canonical source:** GitHub issues and milestones
**Milestone:** [7.0 — Production Readiness](https://github.com/moosacodes/Whirr/milestone/1)
**Created:** 10 November 2026

GitHub is the system of record for acceptance criteria, discussion, and status.
This document is the reader's index and execution order.

## Prioritized workstreams

| # | Workstream | Priority | Milestone | Depends on | Execution posture |
| --- | --- | --- | --- | --- | --- |
| [#1](https://github.com/moosacodes/Whirr/issues/1) | GitHub SDLC and governance | P0 | 7.0 | — | Deliver first; required CI and branch protection |
| [#2](https://github.com/moosacodes/Whirr/issues/2) | Real-world sensing validation | P0 | 7.0 | #1, #4 | Human physical protocol; external blocker |
| [#3](https://github.com/moosacodes/Whirr/issues/3) | Authentic PayPal Sandbox certification | P0 | 7.0 | #1, #2, #9 | Human Sandbox and public HTTPS actions; external blocker |
| [#4](https://github.com/moosacodes/Whirr/issues/4) | Security and privacy hardening | P0 | 7.0 | #1 | Implement authorization tests and fixes; independent review remains open |
| [#5](https://github.com/moosacodes/Whirr/issues/5) | End-to-end reliability | P0 | 7.0 | #1, #4 | Implement failure-state and idempotency coverage |
| [#6](https://github.com/moosacodes/Whirr/issues/6) | Product experience and accessibility | P1 | 7.0 | #1, #5 | Implement automated/manual checks; external study remains open |
| [#7](https://github.com/moosacodes/Whirr/issues/7) | Economic and market validation | P1 | 7.0 | #2, #6 | Human interviews; external blocker |
| [#8](https://github.com/moosacodes/Whirr/issues/8) | Independent proof certification | P1 | 7.0 | #1, #5 | Implement adversarial tests; independent reproduction remains open |
| [#9](https://github.com/moosacodes/Whirr/issues/9) | Observability and operations | P1 | 7.0 | #1, #5 | Implement redaction, health, and recovery checks |
| [#10](https://github.com/moosacodes/Whirr/issues/10) | Performance and scalability | P1 | 7.0 | #1, #5 | Measure and index; no unmeasured scale claim |
| [#11](https://github.com/moosacodes/Whirr/issues/11) | Judge-ready release and submission | P0 | 7.0 | #1, #2, #3, #6, #8 | Software/docs can advance; public actions external |
| [#12](https://github.com/moosacodes/Whirr/issues/12) | Future PayPal product integration | P2 | 7.1 | #3, #7 | Deferred exploration |

## Execution order

1. **Governance (#1):** lockfile, lint, CI, templates, CODEOWNERS, required
   checks, release checklist, and evidence policy.
2. **Security (#4) and reliability (#5):** authorization matrix, adversarial
   access tests, idempotency and failure-state coverage.
3. **Proof (#8), observability (#9), performance (#10):** tamper coverage, safe
   operations, measured query and load behavior.
4. **Accessibility (#6):** automated and keyboard/mobile checks; the external
   comprehension study remains open.
5. **Release documentation (#11):** update judge-facing evidence and submission
   status without claiming the external actions.
6. **Physical (#2), PayPal (#3), commercial (#7), future platform (#12):** remain
   open until the named human, provider, and independent-review actions exist.

## External gates that software work cannot close

- Genuine appliance enrollment, held-out measurements, spoofing trials, and a
  physical interrupted/qualifying pair.
- Genuine PayPal Sandbox buyer approval, capture/void, and a PayPal-signed
  webhook over public HTTPS.
- Independent security, accessibility, physical-evidence, and proof review.
- Real buyer/provider interviews and willingness-to-pay evidence.
- Public deployment authorization, video recording, comprehension participants,
  and a Devpost submission confirmation.

These gates are represented in [`go-no-go.md`](go-no-go.md). A green CI run or a
merged PR does not flip them.
