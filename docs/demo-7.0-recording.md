# Demo 7.0 — raw recording package

Recorded from the local Whirr 7.0 application on 10 November 2026 (local), using a real Chrome browser and the actual app state. This is raw scene footage, not a finished submission video.

## Capture conditions

- Page-only Chrome capture through the DevTools screencast protocol.
- 1920 × 1080, 100% scale, 30 FPS, H.264 MP4, CRF 16.
- No browser chrome, desktop, terminal or editor is in frame.
- No audio stream: no narration, music, sound effects or embedded subtitles.
- A presentation-only cursor overlay follows real Playwright mouse events. Every click was made against the actual control; no product interaction was simulated.
- Scrollbars were hidden for the recording; the page still scrolled normally.
- All recordings are direct scene captures. They were not trimmed, cut together, colour-graded or overlaid.

The recordings live under:

`D:\Coding Projects\Whirr\recordings\whirr-7.0\clips\`

The machine-readable manifest is:

`D:\Coding Projects\Whirr\recordings\whirr-7.0\scene-manifest.json`

A tracked copy is available at [`demo-7.0-scene-manifest.json`](demo-7.0-scene-manifest.json).

The media directory is ignored by Git, so the recordings are not uploaded.

## Available clips

| Scene | File | Raw duration | Recorded (UTC) | URL | Truthful demonstration |
| --- | --- | ---: | --- | --- | --- |
| 01 | `01-product-introduction.mp4` | 14.47s | 2026-11-11T00:12:22Z | `/ambient` | The current 7.0 overview, fixed witness field and four-movement thesis. |
| 02 | `02-wish.mp4` | 34.00s | 2026-11-11T00:12:47Z | `/ambient/wish` | A buyer types the actual request character by character and compiles it into a source-specific observable condition. The source is the synthetic reference model. |
| 03 | `03-exchange.mp4` | 23.97s | 2026-11-11T00:13:40Z | `/ambient/exchange/amb_9743916bdaf142b7896bdba5e67e1c4e` | The local operator accepts the exact revision; the buyer-only view then accepts the final terms. No PayPal order is created. |
| 04 | `04-window-interrupted.mp4` | 23.40s | 2026-11-11T00:14:19Z | `/ambient/window/ase_reference_interrupted?replay=1` | The labelled synthetic interrupted replay evaluates to `INTERRUPTED`, with no capture eligible. |
| 05 | `05-window-qualified.mp4` | 24.17s | 2026-11-11T00:14:57Z | `/ambient/window/ase_reference_qualified?replay=1` | The labelled synthetic qualified replay evaluates to `QUALIFIED` and eligible. It is not live microphone evidence. |
| 06 | **not recorded** | — | — | — | No human buyer authorized a genuine 7.0 PayPal Sandbox checkout, so no PayPal clip exists and no checkout was fabricated. |
| 07 | `07-accord.mp4` | 35.70s | 2026-11-11T00:15:37Z | `/ambient/accord/ase_reference_qualified?replay=1` | The Accord shows `DEMO_NO_PAYMENT`, the interval ledger, exact terms hash, buyer acceptance, trust domains and the signed proof verification. |
| 08 | `08-closing.mp4` | 11.77s | 2026-11-11T00:16:34Z | `/ambient` | A return to the product thesis and the thirty-second Quiet Window instrument. |

## Provenance and honesty notes

- Clips 04, 05 and 07 use **synthetic replay** histories. The screen itself labels them `SYNTHETIC REPLAY`, `DEMO_NO_PAYMENT`, and no microphone is open.
- The proof in clip 07 verifies installation integrity and contract replay. It does **not** prove that a physical fan was off, that a room was silent, or that the microphone was honest.
- The Exchange provider is the local operator account, not a separate workshop participant. After provider acceptance, the local operator cookie is cleared and the page reloads to the buyer-only view, matching what a separate buyer browser would see. The agreement, provider decision and buyer consent are real local state; no consent was fabricated.
- The Wish and Exchange use the same request text. The exchange agreement was created through the real local API from that compiled request.
- There is no PayPal footage. No older 6.0 or 4.1 transaction is reused.
- No testimonial, user metric, physical field trial or independent review is implied.

## Suggested edit points

These are clean in/out points inside the raw clips. They preserve the deliberate pauses around each state change.

| Scene | In | Out | Suggested duration |
| --- | ---: | ---: | ---: |
| 01 Product introduction | 00:00.5 | 00:13.5 | 13.0s |
| 02 Wish | 00:03.0 | 00:28.0 | 25.0s |
| 03 Exchange | 00:02.0 | 00:22.0 | 20.0s |
| 04 Interrupted Window | 00:06.0 | 00:22.0 | 16.0s |
| 05 Qualified Window | 00:07.0 | 00:24.0 | 17.0s |
| 07 Accord and proof | 00:02.0 | 00:34.0 | 32.0s |
| 08 Closing | 00:00.5 | 00:11.5 | 11.0s |

## Preliminary three-minute storyboard

| Final time | Scene | Edit intent |
| --- | --- | --- |
| 00:00–00:13 | Product introduction | Open on “Don’t buy what exists. Buy what could change.” Reveal the four movements and the Quiet Window instrument. No narration is present in the raw footage. |
| 00:13–00:38 | Wish | The buyer names the request; the compiler answers with a bounded, source-specific observable condition. Keep the synthetic-reference disclosure visible. |
| 00:38–00:58 | Exchange | Provider accepts the exact revision; buyer accepts the exact final terms. Hold on the terms hash and the explicit no-capture policy. |
| 00:58–01:14 | Interrupted Window | Show the reset rule and `INTERRUPTED / NO CAPTURE`. This is replay, not a field trial. |
| 01:14–01:31 | Qualified Window | Show `QUALIFIED / ELIGIBLE` and the 100% continuous-window ring. Keep the synthetic banner in frame. |
| 01:31–01:49 | PayPal | **Reserved, currently unavailable.** Insert only a genuine human-authorized Sandbox approval and confirmation. If it remains unavailable, replace with an 8-second honest boundary card; do not use historical footage. |
| 01:49–02:21 | Accord and proof | Exact terms, interval ledger, buyer acceptance, `DEMO_NO_PAYMENT`, trust domains, and the independently replayed proof. |
| 02:21–02:32 | Closing | Return to the thesis and the thirty-second instrument. |

**Runtime:** 2:32 with a genuine 18-second PayPal scene; 2:22 with the honest 8-second boundary card instead. Both are below 180 seconds. The current raw set can also be cut to 2:14 while omitting the PayPal segment entirely.

## Required additional camera evidence

The browser cannot honestly capture these:

1. **Physical machine shot** — the actual fan or workshop machine running before the pause, and the physical stop/restart. This is required to show that a physical event occurred.
2. **Live microphone and room shot** — the physical quiet window and microphone placement. The current Window clips are labelled synthetic replay.
3. **Human buyer Sandbox approval** — a real buyer completing the official PayPal Sandbox flow, plus the server-confirmed authorization and capture. This cannot be staged from the local operator account.
4. **PayPal transaction confirmation** — a fresh 7.0 provider reference, not an older transaction.
5. **Webhook delivery** — a genuine signed Sandbox webhook if that claim is made.
6. **Optional field/participant evidence** — an actual physical field trial or comprehension study if those claims are made.

## Status

- Raw browser footage: **captured**.
- PayPal 7.0 scene: **not recorded / requires human buyer**.
- Physical machine and live microphone: **not recorded / requires separate camera**.
- Public video: **not edited or uploaded**.
- Hackathon submission: **not made**.
