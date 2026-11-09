# Whirr 4.0 — the shared bench

**Product line:** Whirr Bench  
**Tagline:** Borrow the tool. Pay for the work.  
**Category hypothesis:** acoustic pay-per-use for shared physical equipment.  
**Release status:** local release candidate. External gates remain open.

## The product in one paragraph

Whirr Bench is a tool library where an ordinary machine becomes a pay-per-use service by being heard. A shared workshop publishes a tool with a rate and a hard cap. A member scans its bench card, authorizes the cap in PayPal Sandbox, and uses the tool normally. The browser listens on-device, bills only intervals it can confidently classify as the object running, and gives both sides a signed receipt that can be checked offline. The tool is not modified, locked or connected.

## Who has the problem

**The workshop steward.** A makerspace, tool library, repair café, community workshop or small equipment library owns useful machines but cannot afford to staff every bench. Today the steward chooses between free-for-all access, an honour-system clipboard, an hourly booking that charges for setup and conversation, or an expensive lock-and-billing retrofit.

**The member.** A member wants a capable tool for twenty minutes without buying it, booking a half-day, or negotiating with a volunteer. They need to know the price, the ceiling and what happens if the tool is not recognised.

The purchase is not “another rental marketplace.” It is **cost recovery for equipment that already exists**, with a lower administrative burden than a stopwatch and a clearer evidence trail than a clipboard.

## Why this use case

The first release deliberately targets a shared, supervised workshop rather than a universal marketplace.

| Candidate | Frequency | Existing alternative | Acoustic fit | Why not first |
| --- | --- | --- | --- | --- |
| Community tool library / makerspace | Recurring for members; many small charges | Clipboard, volunteer, booking system, coin box | Strong: motors, fans, compressors and power tools have repeatable sound | **Chosen.** Supervised room, known objects, clear owner, high trust value |
| Consumer peer-to-peer rental | Episodic | General rental marketplaces | Weak: unknown rooms and microphones; physical handoff dominates | Trust and logistics are wider problems than metering |
| Hotel / facilities equipment | Frequent | Staff issue tracking | Possible | Buyer cycle and integration burden are enterprise-scale |
| Home appliance sharing | Rare | Informal | Weak | Low transaction value and no natural owner workflow |
| Vending / unattended rental | High | Locks and payment terminals | Weak on its own | A microphone is not a lock; Whirr explicitly refuses this claim |

This is a **chosen beachhead**, not a claim of proven market demand. No customer interviews or pilot revenue are represented as fact.

## The interaction

1. **Bench card** — a public object page with rate, cap, calibration age, sound tag and passport. The card is the front door, not a checkout funnel.
2. **Consent and authorization** — the renter accepts the terms and authorizes a ceiling in PayPal Sandbox. The microphone cannot open before a verified authorization.
3. **Listening Room** — the object becomes a live instrument. Its sound field, state and provisional quote are visible. Idle, uncertain, mismatched and disconnected time are free.
4. **Stop and review** — the renter sees the interval ledger and the exact quote before capture.
5. **Receipt and proof** — the receipt binds terms, intervals, quote, payment state and passport into a signed bundle. Integrity verifies offline; physical presence and settlement do not.

## What Whirr enables

- A tool with no electronics can have usage-based economics.
- A steward can publish a tool without installing a lock or a smart plug.
- A member can see why a minute was billable rather than trusting a timer.
- A disputed interval can point to evidence instead of a verbal account.
- A receipt can leave the platform and remain verifiable.

## What Whirr cannot do

- It cannot prove that a physical object was present.
- It cannot distinguish a recording from the object, or two identical machines running together.
- It cannot secure an unattended object.
- It cannot prove PayPal settlement offline.
- It cannot infer a universal “tool identity” from one microphone in every room.
- It cannot make a $0.05 charge economically efficient for a payment network.

These limits are part of the product, not footnotes. The customer-facing surfaces state them in plain language.

## Commercial hypothesis

The owner pays for reduced administration and better cost recovery. The renter pays for access without a booking minimum. Whirr could charge the owner a small platform fee per settled session, or a monthly bench fee for multiple tools. **Neither billing model is implemented or validated.** The current application is Sandbox-only and no real money moves.

### Unit economics: an honest example

The seeded object is **$0.20 per billable minute, capped at $5.00**. At the cap, a 25-minute session produces $5.00 of usage. A six-minute session produces $1.20; a 15-second session produces $0.05.

PayPal’s fixed per-transaction cost can make tiny captures irrational. This release therefore positions the bench for sessions where the **expected charge is materially above the provider’s fixed cost**. It does not include minimum charges, netting, monthly aggregation or subscription settlement. An owner serving many sub-$0.50 uses should not treat per-session capture as production economics. The product direction is aggregation or a bench membership, but that is a **future design**, not a shipped claim.

### What must be true for a pilot

1. Members repeatedly borrow the same few tools.
2. The steward is willing to calibrate each tool and keep the microphone/room stable.
3. A per-session authorization is acceptable to members.
4. The median session is large enough to absorb payment costs.
5. Members understand that the meter is an acoustic estimate with free uncertainty, not a lock.

These are assumptions to test with real sites. They are not established facts.

## Verified, assumed and speculative

### Verified in this checkout

- The browser extracts features locally and runs a frozen classifier.
- The meter produces four states and excludes idle, uncertain and disconnected time from billing.
- Pricing is integer minor units with one final rounding and a hard cap.
- The PayPal Sandbox path supports authorization, capture, reconciliation, void and refund contracts in tests.
- A historical Sandbox capture is preserved and provider-reconciled. It is simulated money.
- Signed v1/v2 receipts and v3 bundles verify offline.
- The 4.0 UI, browser page sweep, mobile layouts and build pass in this checkout.

### Assumptions

- Shared workshops will pay for evidence-backed cost recovery.
- A supervised room reduces the spoofing risk enough for a useful product.
- Owners can calibrate a small number of high-value tools.
- A cap-first authorization is understandable to members.

### Speculative

- A network of benches with portable reputation.
- Aggregated monthly settlement for micro-usage.
- Insurance or dispute products built on interval evidence.
- Automatic re-calibration from normal sessions.

None of these speculative directions is implemented.

## Product principles

1. **The object stays ordinary.** No retrofit is the product.
2. **The meter shows its reasons.** Every billed state has a visible explanation.
3. **Uncertainty is free.** The system never guesses its way into a charge.
4. **Permission precedes sensing.** The microphone opens after consent and authorization.
5. **The proof states its limits.** Integrity, sensing and payment are separate trust domains.
6. **The demo is labelled.** A synthetic reference is never presented as a physical fan.
7. **One interaction, not a dashboard.** The bench card → Listening Room → receipt loop is the product.

## What was deliberately cut

- A multi-owner marketplace and social feed.
- A booking calendar and shift scheduler.
- A blockchain token or NFT receipt.
- A generative AI assistant.
- Automatic tool identification across an inventory.
- Real-money payments, subscriptions or credit balances.
- An unattended lock or access-control claim.

Each would add surface area without making the core interaction more credible.
