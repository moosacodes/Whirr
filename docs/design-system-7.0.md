# Design system 7.0 — the instrument and the agreement

## Idea

Whirr 7.0 should feel like a **negotiated instrument**, not a SaaS dashboard.

The visual language keeps Whirr’s warm paper, charcoal, and orange identity, then adds a darker, signal-driven Window. Paper carries the agreement; the dark instrument carries the observation.

The product should be understandable before the engineering is explained:

1. someone wants a change;
2. someone agrees;
3. the change is observed;
4. the record says what happened.

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

## The four surfaces

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

- `docs/v7/wish-1440.png` and `docs/v7/wish-390.png`;
- `docs/v7/window-1440.png`;
- `docs/v7/accord-1440.png` and `docs/v7/accord-390.png`;
- `docs/v7/judge-1440.png`.

The final Playwright run passes **57/57** across 1440×900, 834×1112 and 390×844, including page-level overflow and runtime-error checks on the Ambient surfaces and authenticated operator pages. All six captures were visually inspected at their declared widths. A Judge summary-card identifier overflow found at 1440 was fixed with wrapping, and the capture was retaken. At 390 the header wraps the logo below part of the navigation; this does not overflow the page, but it is a visual-polish limitation. Automated overflow checks are not a substitute for a full visual or screen-reader review, and no independent accessibility audit was performed.

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
