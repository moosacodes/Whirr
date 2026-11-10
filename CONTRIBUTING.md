# Contributing to Whirr

Whirr is a financial-technology prototype that must remain honest about what it
has and has not proved. A change is not complete because the UI renders: it must
preserve payment invariants, evidence integrity, authorization boundaries, and
the explicit open-gate record.

## Ground rules

- Never invent physical tests, PayPal activity, webhook deliveries, deployments,
  external reviews, participant studies, or submissions.
- Keep the application Sandbox-only. Never add a live PayPal host, real card data,
  or a real-money test.
- Never commit `.env`, `.env.local`, `.whirr/`, operator keys, cookies, Sandbox
  credentials, raw microphone recordings, or private participant data.
- Preserve historical releases, proof formats, payment evidence, and backward
  compatibility unless an issue explicitly authorizes a migration.
- Treat a synthetic fixture as synthetic. Label demo mode in the UI, API, proof,
  tests, and documentation.

## Setup

```bash
npm ci
npm run setup
npm run dev
```

`npm run setup` is idempotent and writes generated fixtures, model files, and
the SQLite database into ignored directories. The operator key can be printed
with `npm run key`; never include it in a commit, screenshot, issue, or PR.

## Issue-first workflow

1. Open or select an issue with an outcome, priority, dependencies, acceptance
   criteria, and test requirements.
2. Create a branch from current `main`:
   `type/<issue-number>-<short-slug>`, for example
   `fix/5-duplicate-capture-retry`.
3. Implement the smallest complete change. Add tests before or with the fix.
4. Run the focused check, then the full relevant gate.
5. Open a PR that links the issue with `Closes #<number>`, records exact commands
   and results, and states risk and rollback.
6. Wait for CI. Fix the cause of a failure; never bypass or weaken a check.
7. Record an honest author review. This repository has one maintainer, so an
   independent approval is not fabricated. Issues labeled
   `review:independent-required` remain open until a real independent reviewer
   signs off.
8. Merge only after required checks pass. Use a merge commit that retains the
   PR history. Close the issue and update release notes or the gate record when
   behavior or evidence changes.

## Branches and commits

Use an imperative, scoped commit subject, for example:

```text
fix(ambient): reject stale terms at capture
docs(sdlc): record the release review boundary
test(proof): mutate the evidence root
```

Commits must use the repository owner's configured Git identity. Do **not** add
`Co-Authored-By`, co-author credits, generated-with lines, or AI-attribution
trailers to commits, PR descriptions, issues, or release notes. AI-tool use is
disclosed separately and accurately in hackathon submission material.

## Required checks

The `main` branch requires a pull request and the CI quality and browser checks.
The intended local gate is:

```bash
npm ci
npm run lint
npm run typecheck
npm run setup
npm test
npm run build
npm run smoke
npm run test:e2e   # when a browser surface changed
npm audit --audit-level=high
```

A security or payment change also needs the focused tests described in its
issue. Physical and provider evidence has additional human-only requirements;
CI passing does not close those gates.

## Review policy

A single GitHub account cannot provide independent approval. Do not approve your
own PR through a second account, a bot, or a fabricated persona. The maintainer
may record a self-review with specific risks and residual unknowns, but must not
describe it as independent. Security, accessibility, financial certification,
physical evidence, and external proof must be reviewed by a genuinely separate
person before those claims are made.

## Release process

Use [`docs/release-checklist.md`](docs/release-checklist.md). A release requires
a clean lockfile, a green CI run on the exact commit, updated release notes, a
truthful gate table, and preserved evidence. Tagging or publishing is a separate
authorized action; opening a PR does not authorize deployment or submission.

## Reporting security issues

Do not open a public issue. Follow [`SECURITY.md`](SECURITY.md).
