# Accessibility and responsive coverage

**Scope:** core Ambient routes, public pages, browser viewports
**Review date:** 10 November 2026
**Status:** automated smoke coverage only; WCAG conformance and comprehension are not claimed

## Automated coverage

`tests/e2e/pages.spec.ts` runs the public page set at desktop 1440, tablet 834,
and mobile 390 widths. It asserts a visible first `h1`, no page-level horizontal
overflow, no browser page errors, and no console errors. The set includes
`/ambient`, `/ambient/wish`, and `/ambient/judge`, along with the landing,
shelf, service card, passport, judge, tamper lab, offline demo, and standalone
verifier surfaces.

`tests/e2e/accessibility.spec.ts` checks each core Ambient route for:

- exactly one `main#main` landmark;
- exactly one visible `h1`;
- a named main navigation landmark;
- a skip link with an accessible name;
- no `<img>` without `alt` or `aria-label`; and
- no page-level horizontal overflow.

It also presses Tab from the top of `/ambient` and expects the skip link to be
the first focused control; Enter must navigate to `#main`.

## What this does not establish

- It is not an axe-core, screen-reader, keyboard-trap, contrast, focus-order, or
  WCAG 2.2 AA audit.
- It does not test microphone permission denial, a closed microphone, sensor
  loss, or expired terms on a physical device.
- It does not include the required five-person comprehension protocol.
- Browser screenshots at 1440/834/390 are not committed evidence for a visual
  review unless a real capture is attached.

Manual screen-reader review, keyboard-only end-to-end review, contrast checks,
and genuine participant comprehension remain OPEN on #6. No WCAG conformance
or stranger-comprehension claim is made.
