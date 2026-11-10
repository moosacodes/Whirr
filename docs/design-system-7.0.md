# Design system 7.0 — the instrument and the agreement

## Idea

Whirr 7.0 should feel like a **negotiated instrument**, not a SaaS dashboard.

The visual language keeps Whirr’s warm paper, charcoal, and orange identity, then adds a darker, signal-driven Window. Paper carries the agreement; the dark instrument carries the observation.

The product should be understandable before the engineering is explained:

1. someone wants a change;
2. someone agrees;
3. the change is observed;
4. the record says what happened.

## Experience direction (November 2026)

This is a directed product experience, not a theme. The four movements are staged as one agreement instrument:

- a fixed **witness field** (warm halo, faint measurement grid, grain) sits behind the app; the story and controls remain in front;
- a persistent **four-movement rail** makes Wish → Exchange → Window → Accord legible before a word is read;
- the overview uses one dominant proposition and one live-looking instrument, then a short catalogue of the four surfaces;
- the Wish reads as an intention and a bounded condition, not a form;
- the Exchange reads as a compact revision instrument, with the request and the exact offer in the same field of view;
- the Window is the measurement chamber: a dark, studio-lit device with concentric witness rings, a progress orbit, an interval ledger, and an explicit evidence boundary;
- the Accord closes as a signed cooperative record. The request, observation and consent read in sequence; the record’s limits and PayPal’s limits sit in a deliberate final strip rather than a footer disclaimer.

### Reference study

The uploaded `live-3d-guide.pdf` was used as a **direction reference only**. Its useful principles were adopted:

- one fixed visual layer, with the story and interaction in front;
- one dominant object of focus per screen;
- studio-lit contrast and physical depth, rather than flat dashboard cards;
- scroll-scale pacing, deliberate negative space, and fewer competing surfaces;
- motion that communicates a state change, not decoration.

It was intentionally **not copied**: there is no full-screen 3D showroom, no exploded-object gimmick, no scroll-video clone, and no generic product-marketing shell. Whirr’s screens remain operational; the visual system supports the agreement, not a fictitious product render.

### Implementation

- `apps/web/src/components/ambient-experience.tsx` provides the fixed atmosphere and process rail (`AmbientFrame`, `FlowRail`).
- `apps/web/src/styles/experience.css` is the high-end layer over the existing `ambient.css`: studio header/footer, sharper controls, the Window chamber, the Accord hero, responsive rules, and reduced-motion fallbacks.
- `apps/web/src/pages/Ambient*.tsx` consume the frame; no measurement, payment, consent or verifier logic changed.
- `npm run capture:v7` captures the six primary surfaces at 1440, 834 and 390, plus the interrupted Window/Accord at desktop.

## Voice

- Direct, specific, mechanically calm.
- “The window broke” rather than “an error occurred.”
- “No capture” rather than “payment failed.”
- “Synthetic replay” rather than “demo mode.”
- Never “AI-certified silence.”
- Never “powered off proven.”

## Palette

| Role | Direction |
| --- | --- |
| Ink / instrument | Near-black warm charcoal. |
| Paper | Warm off-white with a faint grid or fibre texture. |
| Signal | Whirr orange for active energy and attention. |
| Verified | Deep green for a completed continuous interval, used sparingly. |
| Uncertainty | Ochre/amber for unknown evidence, never for success. |
| Failure | Brick red for interruption, loss, or a broken contract. |

Colour is never the only signal. Every state has a word and a sentence.

## Type

- **Fraunces** for object names, headlines, and the emotional title.
- **Inter** for body, controls, and explanations.
- **JetBrains Mono** for hashes, timestamps, seconds, prices, and provider references.

Prices read like stamped amounts, not dashboard metrics.

## The primary surfaces

### The Wish

- One dominant question: “What do you need?”
- The natural-language wish is primary; the numeric duration/price fields are supporting constraints.
- The selected source and model are visible before the interpretation.
- Unsupported claims produce a clear refusal and a narrower proposal.
- The exact interpretation is a paper-like terms sheet, not a wall of JSON.
- The send button unlocks only after explicit review acknowledgment.

### The Exchange

- The object and bound model are at the top.
- The interpretation, price, duration, reset rule, no-capture rule, and recipient semantics are readable without opening a modal.
- Offer history is a compact revision ledger.
- Provider accept/decline/counter is one bounded decision area.
- Buyer final approval is a separate step.
- A buyer waiting for a provider sees a waiting state, not a false “read-only” warning.
- A provider accepted state tells the provider the buyer now controls the window.
- Session creation is buyer-only.

### The Window

- The central ring is the qualifying interval, not a decorative loader.
- The interval ledger is visible beneath it.
- Active, inactive, unknown, and disconnected segments are distinct.
- A machine interruption visibly breaks the ring.
- A replay is explicitly labelled and never presented as live.
- The microphone panel is closed until the user opens it.
- The financial state is separate from the physical state.
- The result card appears only from stored evaluation.
- The boundary card lists what the screen cannot say.

### The Accord

- Reads as a cooperative record, not a payment receipt.
- Separates request, agreement, observation, uncertainty, human acceptance, and provider state.
- The independent verification result is shown with its checks.
- A shareable proof is available without raw audio.
- The limitations are part of the document, not a footer disclaimer.

### Evidence

- The Judge surface is a credential-free comparison, not a marketing gallery.
- Interrupted and qualified histories share the same evidence strip and visual grammar.
- External gates remain textually explicit; none are painted green by implication.
- The same witness field and movement rail make the evidence feel like part of the product, while the gate ledger remains operational.

## Motion

- Ring completion uses measured progress, not a looping animation.
- A live dot or waveform may breathe only while the microphone is open.
- Replay progress advances from a fixed ledger; it is labelled.
- Under `prefers-reduced-motion`, decorative breathing/transition effects stop.
- No signal animates when sensing is closed.
- No fake financial success animation.

## Responsive targets

The required review sizes:

- 1440 × 900 desktop;
- 834 × 1112 tablet;
- 390 × 844 phone.

Rules:

- no horizontal page overflow;
- full-width primary controls on phone;
- 44 px minimum tap targets where practical;
- readable terms without microscopic columns;
- provider/buyer action areas stack before they squash;
- the Window ledger remains legible and does not rely on hover;
- PayPal return and reload states remain understandable.

### Review evidence

Generated by `npm run capture:v7` against the seeded local API and web app:

- `docs/v7/ambient-1440.png`, `ambient-834.png`, `ambient-390.png`;
- `docs/v7/wish-1440.png`, `wish-834.png`, `wish-390.png`;
- `docs/v7/evidence-1440.png`, `evidence-834.png`, `evidence-390.png`;
- `docs/v7/exchange-1440.png`, `exchange-834.png`, `exchange-390.png`;
- `docs/v7/window-1440.png`, `window-834.png`, `window-390.png`;
- `docs/v7/accord-1440.png`, `accord-834.png`, `accord-390.png`;
- `docs/v7/window-interrupted-1440.png` and `accord-interrupted-1440.png`.

The capture script seeks the replay to its final state, checks each page for horizontal overflow, and fails on runtime page errors. The 390 header resolves into a brand/More row and a separate scrollable navigation row; the four-movement rail fits all four labels without page overflow. The Evidence, Window and Accord were reviewed at desktop, tablet and phone widths, including the interrupted histories.

Final local gate: `npm run typecheck` and lint pass; `npm run build` passes; `npm test` is **149/149** across 24 files; `npm run test:e2e` is **78/78** across 1440×900, 834×1112 and 390×844. Automated overflow checks are not a substitute for a full visual or screen-reader review, and no independent accessibility audit was performed.

## Accessibility

- Real buttons and links for every action.
- Visible focus states.
- Headings follow hierarchy.
- Status is conveyed in text, not colour alone.
- The ring exposes an accessible percentage label.
- Synthetic/live/microphone-closed states are textual.
- Reduced motion is respected.
- Forms have labels and error text.
- No keyboard trap in the replay scrubber.
- The public proof has a readable HTML representation, not only a canvas.

Known gaps: no exhaustive screen-reader walkthrough, no independent accessibility audit, and no mobile physical microphone trial.

## Honesty as visual language

The design’s strongest signature is refusal:

- the Wish refuses to pretend silence is measurable;
- the Window refuses to animate when closed;
- the Accord refuses to collapse trust domains;
- the proof refuses to equate a signature with physical truth.

A beautiful surface that implies more certainty than the evidence supports is a design failure, not a success.
