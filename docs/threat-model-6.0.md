# Whirr 6.0 threat model

## Assets

- The exact approved agreement and price ceiling.
- Authorization and capture identifiers.
- Observation ledger and model binding.
- Operator key, cookies, signing key, and PayPal credentials.
- Historical evidence for earlier releases.

## Adversaries and failure sources

- A renter who controls the browser and microphone.
- A replay of a previous machine recording.
- A nearby machine that sounds similar.
- An operator who attempts to publish a weakened or substituted agreement.
- A network or process failure during a financial operation.
- A forged or out-of-order webhook delivery.
- A user who closes the tab, loses the microphone, or sleeps the browser.
- A future model retraining that changes the evidence interpretation.

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Forged feature batch | Server binds intervals, sequence numbers, time ordering, and hashes; proof labels sensor provenance as not independently verifiable |
| Replayed audio | Open-set refusal and quality checks reduce accidental acceptance; replay remains a residual risk and is not claimed solved |
| Unknown appliance accepted | Similarity floor, margin, quality flags, and open-set refusal |
| Silent model substitution | Terms bind model id and artifact hash; evaluator checks current model binding |
| Agreement altered after approval | Canonical digest, reviewed snapshot recompilation, immutable terms copy per execution |
| Buyer charged without approval | Order and authorization are separate; authorization comes from PayPal, not the browser |
| Duplicate capture | Unique operation row, stable request id, recomputed eligibility, captured amount check |
| Capture after sensor loss | `DISCONNECTED` observations and continuity check force non-eligible outcome |
| Capture after uncertainty | `UNCERTAIN` observations, confidence floor, and quality flags |
| Expired authorization | Server checks expiry before start and before capture |
| Forged webhook | Existing raw-body signature verification; unverified delivery is not financial evidence |
| Cross-execution evidence | Every observation is keyed to one execution; terms and agreement hash are rechecked |
| Cross-object model use | Model lookup is scoped to the object and latest active model |
| Secrets in proof or UI | Public proof excludes credentials and private environment values |
| Browser sleep or tab hidden | Quality flags and gaps are preserved; no automatic charge follows |
| LLM prompt injection | No LLM is used for contract execution, payment commands, or authorization |

## Privacy

Feature vectors stay local until a demonstration is explicitly saved. Raw audio is never uploaded by the promise flow. The catalog and proof are public by design, so personal data is minimized to a short representative reference. A deployment should add retention and deletion controls appropriate to its jurisdiction and use.

## Residual risks

- A determined attacker can fabricate a feature stream or replay a recording.
- Acoustic similarity does not prove physical presence, ownership, or successful work.
- The signature proves installation integrity, not the truth of the sensor claim.
- A small synthetic validation set does not establish field reliability.
- A webhook or capture is not verified here without genuine Sandbox activity.
