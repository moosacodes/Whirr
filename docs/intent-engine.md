# Intent engine

## Design choice

Whirr 7.0 uses a **deterministic local compiler**, not a paid language model, to turn a wish into contractual terms. The choice is deliberate:

- the runtime must work offline with $0 additional spend;
- the same text and form inputs must produce the same terms hash;
- unsupported physical claims must fail consistently, not depending on model temperature;
- the final financial eligibility decision must not be delegated to a generative model.

The compiler is in `packages/ambient-engine/src/compiler.ts`.

## Inputs

| Input | Role |
| --- | --- |
| `text` | Natural-language wish, 10–800 characters. |
| `target` | Explicitly selected enrolled object and model. |
| `durationSeconds` | Form duration, 10–120 seconds. |
| `fixedPriceMinor` | Buyer’s fixed positive offer in minor units. |
| `currency` | Prototype supports USD. |
| `buyerRef`, `providerRef` | Bound pseudonymous parties. |
| `now`, `expiresInMinutes` | Time validity. |

The buyer must select the object. The system never assigns ownership or responsibility merely because a sound resembles an enrolled machine.

## Supported outcome grammar

The prototype can compile a request that combines:

- a pause, quiet window, silence-adjacent recording need, source inactivity, or deferral;
- an explicit or default duration;
- a fixed positive price;
- the selected enrolled source.

Accepted example:

> “I need 30 seconds without the reference desk fan running while I record a voiceover. I will pay $2.00.”

Resulting interpretation:

> “The validated model must detect Reference desk fan active for at least 3 continuous seconds, then must not detect it for 30 seconds of continuous, observable microphone evidence.”

## Refused claims

The compiler refuses claims a microphone plus a bounded acoustic model cannot establish. Errors include:

| Claim | Issue |
| --- | --- |
| Complete silence, soundproofing, zero decibels | `UNSUPPORTED_PHYSICAL_CLAIM` |
| Certified sound-level measurement | `UNSUPPORTED_PHYSICAL_CLAIM` |
| Temperature, humidity, air quality, smell, chemicals | `UNSUPPORTED_PHYSICAL_CLAIM` |
| Electricity, power, or energy savings | `UNSUPPORTED_PHYSICAL_CLAIM` |
| Safety, security, legal compliance | `UNSUPPORTED_PHYSICAL_CLAIM` |
| Whole-room/all-source guarantee | `UNSUPPORTED_PHYSICAL_CLAIM` |
| Unconditional/anything guarantee | `UNSUPPORTED_PHYSICAL_CLAIM` |
| No quiet/pause/recording intent at all | `UNSUPPORTED_CONDITION` |

A refusal is returned with an explanation and a narrower alternative. The UI never sends a blocked interpretation to the Exchange.

## Parsing rules

- Duration supports seconds and minutes; the request text wins over the form, with a warning when they disagree.
- Price supports `$2`, `2 dollars`, and similar forms; text wins over the form, with a warning on disagreement.
- A provider counteroffer uses `preferExplicitTerms: true`: the provider’s explicit negotiated price and duration are authoritative. The original wish text is retained only as history.
- Price must be a positive integer in minor units and no more than 10,000 minor units in this prototype.
- Duration must be between 10 and 120 seconds.
- A request must include a quiet/pause/recording/inactivity intent.

## Interpretation structure

The compiled `interpretation` contains:

- `requestedText` — the buyer’s original words;
- `desiredCondition` — the human outcome;
- `observableCondition` — the measurable proxy;
- `proxyDisclosure` — what “inactive” does and does not mean;
- `unsupportedClaims` — detected overclaims;
- `assumptions` — legitimate authority, observability, provider control;
- `limitations` — silence, sensor trust, payment proof, invited-participant scope.

This is what the buyer reviews before sending an offer. The same text is shown to the provider.

## Determinism and identity

- Terms are canonicalized and hashed with SHA-256.
- The hash covers the entire terms object, including the interpretation and policies.
- The buyer must approve the exact hash; the session stores it.
- A counteroffer cannot reuse the buyer’s old hash.
- A later model digest change invalidates the binding.

## Examples

### Executable

> “Please keep the reference desk fan inactive for 45 seconds while I record. I’ll pay $3.50.”

→ 45,000 ms required inactivity, $3.50 fixed offer.

### Refused

> “Make the whole room completely silent and temperature controlled for 30 seconds. I will pay $2.”

→ unsupported whole-room guarantee, complete silence, and temperature claims. No offer is created.

### Refused

> “Cut the fan’s electricity use by half.”

→ power/energy claim cannot be established acoustically.

## Limitations

- The compiler is a bounded rules engine, not open-domain language understanding.
- It recognises a small vocabulary of quiet-window intent.
- It cannot verify that the selected object is the source the buyer actually means.
- It cannot infer a provider’s reservation price or authority.
- It cannot make an ambiguous wish safe by clever wording.
- It cannot establish real-world truth from text.

The product’s value is that the interpretation is narrow enough to audit, not that it understands everything.
