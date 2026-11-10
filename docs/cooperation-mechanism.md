# Cooperation mechanism

## The exchange, not a marketplace

Whirr Ambient is an **invited cooperation exchange**, not an open marketplace. The prototype binds:

- one buyer requesting a condition;
- one enrolled object and its owning operator as provider;
- one fixed price and one currency;
- one exact agreement revision;
- one observation window and one evaluator result.

The provider is the party authorized to pause the relevant activity. The PayPal merchant is the configured Sandbox operator account. Whirr does not claim that a separate workshop participant was paid when the merchant is the operator.

## Roles

### Buyer

- states the desired physical outcome;
- chooses the enrolled source;
- sets a fixed offer;
- approves the measurable interpretation and exact final revision;
- authorizes the Sandbox payment;
- opens the window and explicitly accepts a qualifying result.

### Provider

- sees the source, terms, duration, evidence rules, failure policy, and price;
- voluntarily accepts, rejects, or counters;
- is not given control of the buyer’s payment authorization;
- can be the same operator account that receives the Sandbox merchant funds, which must be stated honestly.

### Venue / operator

- owns or supervises the enrolled object;
- controls calibration, object status, and provider authority;
- may supervise evidence and disputes.

### Observer

- a browser/device collecting consented interval states;
- is not assumed independent of the buyer or provider;
- does not become a trusted witness merely because it is a second device.

## Offer mechanism

The first offer is a buyer proposal:

```text
buyer wish + object + duration + price + exact interpretation
```

The provider can:

- accept the exact revision;
- reject it;
- counter with a changed price and/or duration.

The buyer can accept or reject the counter. Every accepted amendment creates a new immutable revision and a new hash. A provider cannot edit an agreement in place, and a buyer cannot accept “roughly” the same terms.

The mechanism is intentionally narrow:

- no autonomous agent negotiating on a person’s behalf;
- no hidden market price;
- no fabricated demand curve;
- no psychological inference;
- no provider-suggested price presented as objective.

A deterministic assistant can explain differences between two revisions. It cannot invent a reservation price or consent for either party.

## Pricing

The prototype uses a **fixed buyer offer**. This is deliberately simpler than dynamic pricing:

- both sides know the maximum exposure before observation;
- the same amount is the authorization ceiling and the fixed capture amount;
- no elapsed-time fallback if the condition fails;
- no surprise “market rate” after the physical event.

A provider counteroffer is explicit. It must change the price, the duration, or both. The counteroffer compiler uses the explicit negotiated values, not a reparse of the original wish.

### Economic hypotheses

Payment can be justified when:

- the pause has a real, time-specific opportunity cost;
- both parties value a recorded commitment;
- the buyer’s task is time-sensitive;
- the provider’s schedule has alternative uses;
- the relationship crosses organizational boundaries.

The baseline alternative is “just ask.” Whirr should lose to a free favour when the coordination cost is low. The product is not claiming that every quiet request should be monetized.

### Fee and scale caution

The Sandbox demonstration uses small amounts. This is not evidence of a viable price point. Payment-processing fees, operator time, dispute handling, and calibration overhead may exceed the value of a short pause. Any real deployment must measure those costs.

## Incentive problems

A naive market could reward:

1. creating a nuisance;
2. offering to stop it for money;
3. targeting a person who must stop anyway;
4. coercing a neighbour;
5. surveilling a shared space;
6. laundering an unauthorized request through a marketplace.

Whirr 7.0’s initial constraints:

- invited, authorized participants only;
- the provider is bound to the enrolled object and venue;
- no anonymous public bounty;
- no request to violate safety or law;
- no claim that a payment makes an unsafe or unauthorized activity acceptable;
- buyer and provider must both accept exact terms;
- no automatic capture from a model prediction;
- no public listing or open solicitation in this release.

These constraints reduce the obvious abuse cases. They do not prove the mechanism is safe at scale.

## Why not a chat-based negotiation?

A free-form chat would hide the material facts:

- which object and model are bound;
- what counts as an interruption;
- whether a missing signal is enough;
- whether human acceptance is required;
- what happens on sensor loss;
- which exact revision is financially actionable.

A structured exchange makes those facts comparable and immutable. The visual design can still feel conversational, but the contract is not a transcript.

## Merchant and payout truth

The Sandbox merchant is the operator account configured for the installation. If a different workshop participant controls the machine, Whirr does not claim to have paid that person. The Accord says “Sandbox merchant / operator” and the documentation repeats the limitation.

Marketplace splitting, provider payouts, escrow, disputes, and multi-party settlement are out of scope for this release.

## What would validate the mechanism

- Real operators accept a request without feeling coerced.
- Buyers understand the failure and no-capture rules before paying.
- A short pause is worth more than the coordination and fee overhead.
- Both parties can inspect and contest the evidence.
- Providers do not invent disturbances to attract offers.
- Venue supervision remains affordable.

None of these has been established by synthetic replay or unit tests.
