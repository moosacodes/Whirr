# Whirr SDLC

**Status:** adopted for Whirr 7.0 release-candidate work
**Repository:** <https://github.com/moosacodes/Whirr>
**Canonical backlog:** GitHub issues #1–#12 and [`backlog-7.0.md`](backlog-7.0.md)

Whirr is treated as a financial-technology product under review. The process is
designed to make changes inspectable and to keep unverified claims out of the
release record.

## Flow

```text
issue -> branch -> implementation -> tests -> linked PR -> CI
      -> author review / genuine independent review when available
      -> merge -> close issue -> release document / gate update
```

Each workstream has an issue with an outcome, priority, dependencies, acceptance
criteria, test requirements, and evidence boundary. Issues describe the work;
PRs deliver it; CI and committed evidence provide repeatable verification.

## Issues

- Use the Workstream or Bug report form.
- Link affected release gates from [`go-no-go.md`](go-no-go.md).
- Mark external dependencies with `blocked:external`.
- Mark work that cannot be self-certified with `review:independent-required`.
- Keep acceptance criteria observable. "Demo looks good" is not acceptance.
- Do not mix unrelated workstreams in one issue or PR.

## Branches and pull requests

Branch format: `type/<issue>-<slug>`, where `type` is `feat`, `fix`, `test`,
`docs`, `chore`, `security`, or `release`.

Every PR:

- links its issue with `Closes #<number>`;
- describes the behavior change and the evidence boundary;
- records exact verification commands and results;
- states risk and rollback;
- updates tests when behavior changes;
- updates release notes or gate records when claims or evidence change;
- preserves historical commits, tags, proof formats, and payment evidence.

Use a merge commit. Do not squash away the issue-linked history unless the owner
explicitly chooses that policy later.

## CI

The `CI` workflow runs on every PR and on `main`:

| Check | Purpose |
| --- | --- |
| Quality gate | `npm ci`, lint, typecheck, setup, unit/integration tests, build, smoke, high-severity audit |
| Browser journey | Playwright at desktop, tablet, and mobile viewports |
| Dependency review | Fails a PR that introduces a high or critical vulnerable dependency |
| Secret scan | Gitleaks over full Git history; GitHub secret scanning and push protection are also enabled |
| CodeQL | JavaScript/TypeScript static analysis for security and quality |

A check may be fixed or replaced with a stronger check. It must not be skipped,
silenced, or made non-blocking to get a merge.

## Review and the single-owner limitation

This repository currently has one GitHub maintainer. The maintainer can review
their own change and record concrete risks, but that is **author review**, not
independent approval. Required CI can be enforced without inventing a second
person. Do not create a second account, bot, or persona to satisfy a review box.

- `review:independent-required` means exactly that: a genuinely separate person
  must inspect the work before the relevant claim is made.
- Security certification, accessibility conformance, financial certification,
  physical field evidence, and external proof reproduction remain blocked until
  that review exists.
- Branch protection requires pull requests and status checks. It does not require
  an approval that the current account cannot honestly provide.

## Evidence rules

1. Synthetic fixtures are labeled synthetic everywhere they appear.
2. A passing test proves the tested behavior, not a physical or external fact.
3. Demo sessions cannot create an order or capture.
4. A PayPal Sandbox transaction is simulated money, not revenue.
5. No historical 4.x/5.0/6.0 evidence is relabeled as 7.0 evidence.
6. Raw microphone audio stays in the browser; evidence uses interval features.
7. Proof signatures establish integrity and consistency, not physical truth,
   provider state, or a trusted timestamp.
8. External gates stay OPEN until the required human action and named review are
   recorded with identifiers, dates, and artifacts.

## Secrets and supply chain

- Secrets live only in ignored `.env` / `.whirr/` files or the operator's local
  environment. Never in issues, PRs, logs, screenshots, fixtures, or proofs.
- The lockfile is committed; CI uses `npm ci`, not an unpinned install.
- Dependabot proposes npm and GitHub Actions updates. Major updates are deliberate.
- GitHub secret scanning and push protection are enabled. Gitleaks is the
  workflow-level backstop.
- Actions use least-privilege `GITHUB_TOKEN` permissions at workflow or job level.

## Release

Use the [release checklist](release-checklist.md). A release is a commit that has
passed the full applicable gate, has truthful notes and a rollback plan, and has
not been described as deployed or submitted until that action is verified.

## Definition of done

A workstream is complete only when:

- the issue acceptance criteria are met;
- tests and CI pass on the merged commit;
- security/privacy and evidence boundaries are recorded;
- documentation and gate status are accurate;
- required independent or external verification exists, or the issue remains
  open with the exact blocker;
- the issue is closed (or explicitly left open as blocked) and linked from the
  release record.
