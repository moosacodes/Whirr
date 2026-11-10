# Release checklist

Use this checklist for Whirr 7.0 and every later release. A checked box is a
record of verification, not an intention. If a check cannot run, leave it
unchecked and record the blocker.

## 1. Scope and issue state

- [ ] The release scope is linked to GitHub issues and PRs.
- [ ] Every included PR has a linked issue and passed required CI.
- [ ] Unfinished or externally blocked work is linked, not silently omitted.
- [ ] Version and release identity are consistent in `package.json`,
      `package-lock.json`, release notes, and the built artifact.
- [ ] No historical commit, tag, proof, or payment record was rewritten.

## 2. Clean install and automated gate

- [ ] `npm ci` succeeds from a clean checkout with the committed lockfile.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npm run setup` completes without manual steps.
- [ ] `npm test` passes; record the total and file count.
- [ ] `npm run build` passes; record bundle size.
- [ ] `npm run smoke` passes.
- [ ] `npm run test:e2e` passes when browser surfaces changed; record viewports.
- [ ] `npm audit --audit-level=high` passes; review moderate advisories.
- [ ] CodeQL, dependency review, and secret scan are green for the release PR.
- [ ] The exact release commit has a green CI run; a local run is not a substitute.

## 3. Product and evidence

- [ ] Synthetic reference data is labeled synthetic in API, UI, proof, and docs.
- [ ] Demo mode cannot create a PayPal order or capture.
- [ ] Historical 4.x Sandbox evidence is not presented as 7.0 evidence.
- [ ] The 7.0 gate table in [`go-no-go.md`](go-no-go.md) is current.
- [ ] Physical field evidence has raw artifacts, model/dataset hashes, measured
      metrics, failures, and a named independent review, or Gate A/B/C stays OPEN.
- [ ] A genuine 7.0 Sandbox authorization/capture/void/webhook has provider
      identifiers and a public-HTTPS delivery record, or Gates E–H stay OPEN.
- [ ] The proof verifier was run standalone from the release artifact.
- [ ] The public proof contains no raw audio, secrets, or private identifiers.

## 4. Security and privacy

- [ ] No `.env`, `.whirr/`, operator key, cookie, Sandbox secret, or raw audio is
      tracked or in the release artifact.
- [ ] Authorization and cross-participant tests pass for changed endpoints.
- [ ] Logs and error responses do not expose cookies, signatures, or secrets.
- [ ] CSRF/origin, webhook raw-body verification, and CSP behavior are unchanged
      or deliberately tested.
- [ ] A security review exists at the author level; an independent review is
      recorded only when a separate person performed it.

## 5. Accessibility and UX

- [ ] Automated accessibility checks pass for changed core surfaces.
- [ ] Keyboard-only navigation has no traps.
- [ ] Mobile screenshots show no page-level horizontal overflow.
- [ ] Error, empty, loading, microphone-denied, and expired-terms states are
      understandable and truthful.
- [ ] No WCAG conformance claim is made without manual/assistive verification.

## 6. Release artifacts

- [ ] Release notes describe added, changed, preserved, and rollback behavior.
- [ ] README quick start reproduces on a clean machine.
- [ ] Screenshots and video are current and labeled.
- [ ] Known limitations and open gates are visible to a judge without reading code.
- [ ] The tag is created only after the release commit is green.
- [ ] The release record links the merged PRs, CI run, commit SHA, and blockers.

## 7. Publication and submission (separate authorization)

- [ ] Deployment or public exposure is explicitly authorized and uses $0 hosting.
- [ ] Logged-out access to the public route is verified.
- [ ] The webhook ingress exposes only the webhook if it is public.
- [ ] Video is under three minutes, accurate, and does not reveal secrets.
- [ ] Devpost fields and AI-tool disclosure are complete.
- [ ] A Devpost confirmation exists before submission is claimed.
- [ ] No physical, payment, external-review, or submission claim exceeds evidence.

## 8. Rollback

- [ ] The previous release remains installable and documented.
- [ ] Additive schema changes do not require destructive rollback.
- [ ] Payment/evidence operations have a no-blind-retry recovery path.
- [ ] The owner knows how to revert the release commit and restore a database
      backup without deleting historical evidence.

## Sign-off

| Role | Name | Date | Scope |
| --- | --- | --- | --- |
| Release author |  |  | Implementation and automated evidence |
| Independent reviewer |  |  | Only if genuinely independent |
| Security reviewer |  |  | Only if genuinely independent |
| Accessibility reviewer |  |  | Only if genuinely independent |

An empty independent-review row is an open blocker, not a formality.
