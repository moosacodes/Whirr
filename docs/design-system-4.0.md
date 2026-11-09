# Whirr 4.0 design language — the instrument and the ledger

## Idea

Whirr should feel like a **well-kept workshop instrument**, not an AI SaaS dashboard.

The visual language combines two physical references:

1. **The paper bench ticket** — labels, perforations, rates, numbers, ownership, rules.
2. **The acoustic instrument** — a dark listening field, radial energy, a live trace, a state word that behaves like a readout.

The contrast is intentional: warm paper for the commercial agreement; near-black for the act of listening. The interface should be attractive before a session starts, and should never simulate a signal when the microphone is closed.

## Identity

- **Product name:** Whirr Bench.
- **Wordmark:** Whirr with a small `BENCH` edition tag, like a model number on a machine.
- **Voice:** direct, specific, mechanically calm. No “unlock the power of AI.” No anthropomorphic microphone.
- **Primary promise:** *Borrow the tool. Pay for the work.*
- **Proof promise:** *The receipt states what it proves and what it does not.*

## Palette

| Token | Value | Role |
| --- | --- | --- |
| Ink | `#171310` | Primary type and the listening surface |
| Paper | `#f4eee4` | Body canvas with a faint dot grid |
| Surface | `#fffdf8` | Cards and forms |
| Accent | `#c25b2a` | Running/billable state, sound-tag energy |
| Accent deep | `#9b3f16` | Links and emphasis on paper |
| Ok | `#2f6b4f` | Verified, identity gate, ready |
| Warn | `#8a5c10` | Uncertainty, drift, a soft failure |
| Danger | `#9c2f2a` | Failed verification and blocked states |

Warm paper vs. dark instrument is the core contrast. Gradients are limited to physical depth (the sound field, a paper wash); they do not decorate status.

## Type

- **Fraunces Variable** — object names, headlines, meter state. A tool label can be elegant; it does not need to look like a startup.
- **Inter Variable** — body and controls.
- **JetBrains Mono** — rates, hashes, timestamps, sensor metadata, bench numbers.

Numbers use tabular figures. A price should read like a stamped amount, not a dashboard metric.

## Signature components

### Bench ticket

A light, slightly rotated card on the dark hero. It contains a model number, object glyph, sound tag, rate, cap and a `LISTEN → CLASSIFY → BILL` footer. It is a product object, not a feature illustration.

### Sound tag

An eight-band profile derived from the enrolled soundprint. It is deliberately described as a **calibration fingerprint**, not a face or a fingerprint identity. The tag appears on shelf cards, service cards and the object identity area.

### Listening field

A radial field around the object glyph:

- eight bars are driven by the actual live band values;
- the glow uses the actual level;
- rings animate only while `live` is true;
- the field says `MIC CLOSED` whenever sensing is off.

The field does not contain fake particles, waveform noise or a looping “AI” graphic.

### Live readout

A large state word (`Running`, `Idle`, `Uncertain`, `Sensing stopped`) with one explanatory sentence, the provisional quote, billable duration, rate and hard cap. The cap bar is a permission boundary, not a progress gamification.

### Bench rules

A dark sidebar with four numbered rules. It explains the business model in physical-world terms: object stays ordinary, only confident running counts, cap first, receipt shared.

## Motion

- Ring expansion: only while sensing is live.
- Live dot: a slow breathing pulse, disabled under `prefers-reduced-motion`.
- Bar heights: 100 ms linear transitions tied to incoming bands.
- Card lift: 180 ms for links, no looping decorative motion.
- No fake activity when the microphone is closed. No animation can imply measurement.

## Responsive behavior

- **Desktop (1440):** bench ticket in the hero; two-column Listening Room; sticky bench rules beside the tool.
- **Tablet (834):** one-column bench board; rules above the listing; Listening Room field above the readout.
- **Phone (390):** stacked hero, full-width ticket, one-column tool card, two-column fee facts, no horizontal overflow.

The 4.0 browser suite exercises 1440×900, 834×1112 and 390×844.

## Accessibility rules

- Every interactive control is a real button or link.
- Live state is not conveyed by colour alone: the state word and explanatory sentence are always present.
- The sound field has an accessible image label that explicitly says microphone open or closed.
- `prefers-reduced-motion` stops breathing rings and transitions.
- Headings follow the page hierarchy; status copy is text, not an aria-hidden animation.
- The current automated sweep checks overflow and page/console errors, not exhaustive screen-reader or keyboard traversal.

## Screenshot evidence

Captured with `npm run screenshots` against the local dev server:

- [`docs/v4/landing-desktop.png`](v4/landing-desktop.png)
- [`docs/v4/bench-desktop.png`](v4/bench-desktop.png)
- [`docs/v4/bench-card-desktop.png`](v4/bench-card-desktop.png)
- [`docs/v4/listening-room-desktop.png`](v4/listening-room-desktop.png)
- [`docs/v4/landing-mobile.png`](v4/landing-mobile.png)
- [`docs/v4/bench-mobile.png`](v4/bench-mobile.png)
- [`docs/v4/bench-card-mobile.png`](v4/bench-card-mobile.png)

The Listening Room screenshot is the microphone-closed consent state. It is not a live sensing capture, and it must not be used as Gate A evidence.

## Known visual gaps

- No manual screenshot-by-screenshot review by an external designer.
- No real-object live Listening Room screenshot with microphone permission.
- No five-person comprehension results; the protocol is separate and explicitly not run.
- Keyboard/focus traversal is implemented in the components but not exhaustively tested.
