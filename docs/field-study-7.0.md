# Field study 7.0

## Current status

**OPEN. No 7.0 physical field study has been performed.**

No real appliance was enrolled for this release, no physical Quiet Window was observed, no real interrupted/qualifying pair was recorded, and no external participant comprehension test was run. The seeded histories are synthetic.

This document is the protocol required to close that gap. It must not be filled with the synthetic seed.

## Safety and authority

Use a safe household fan or comparable appliance. Do not open an enclosure, defeat a guard, use a device that can injure someone, or ask a provider to stop activity required by law or safety rules. Both participants must have legitimate authority over the activity and the space. The operator must voluntarily consent.

## Gate A — Real source enrollment

1. Choose one physical appliance.
2. Record at least five idle takes, five active takes, and five distinct background takes with the microphone at a fixed measured distance.
3. Include varied normal operating states and realistic nearby sounds.
4. Train a `USER_CALIBRATION` event model locally.
5. Preserve the recording hashes, model hash, feature specification, device description, and calibration notes.
6. Record the object identity and provider authority.

Pass only if a real model is READY and bound to the object. Publish the object through a service or an owner-approved Physical Promise; the Wish source catalog only lists active objects with published terms and a current READY event model. A synthetic reference model is not Gate A.

## Gate B — Source observability

Predeclare the observation conditions:

- microphone model and placement;
- distance;
- appliance speed/setting;
- background conditions;
- confidence floor;
- blocking flags.

Run at least 10 held-out active and 10 held-out inactive trials, plus unknown sounds and a second similar appliance if available. Report:

- true active detection;
- true inactive non-detection;
- unknown/refusal;
- false active;
- false inactive;
- confidence intervals;
- sample size.

Pass only if the target and relevant negative conditions are separable under the declared conditions. Do not tune thresholds after seeing final results.

## Gate C — Physical window evaluation

Execute both:

1. a genuine interrupted observation (source restarts halfway or near the end);
2. a genuine qualifying observation (source stops and remains undetected for the full contract).

The contract expectation is fixed before each trial. Preserve the entire interval ledger, not only the good part.

Pass only if the interrupted run resets and the qualifying run completes under the declared model and conditions.

## Gate D — Agreement consent

Two authorized participants must:

- review the exact source, duration, price, failure policy, and sensor limitations;
- have the provider accept or counter;
- have the buyer accept the exact final hash;
- preserve audit and consent timestamps.

## Gate E — Correct PayPal authorization

The buyer must approve the correct Sandbox authorization for the exact accepted terms. Record order, authorization, amount, currency, expiry, and the browser return path. Do not treat a pending redirect as authorization.

## Gate F — Financial failure safety

Run a failed/interrupted agreement with an authorization present. Confirm:

- no automatic capture;
- no duplicate capture on retry;
- authorization is voided or left in an explicitly reconciled state;
- the Accord does not claim a charge.

## Gate G — Financial success

Run a genuine qualifying agreement through:

- buyer acceptance of the result;
- explicit capture;
- provider-confirmed `COMPLETED` capture;
- amount equal to the fixed price and within the ceiling;
- reconciliation.

This is the only evidence that can close the 7.0 Sandbox success gate.

## Gate H — Genuine webhook

Register an HTTPS listener in the same Sandbox app, receive an authentic PayPal-signed event, verify the signature, record the event ID and related transaction IDs, and exercise duplicate/replay behavior. A loopback test or handcrafted event is not Gate H.

## Gate I — Independent proof

Run the released verifier on the genuine agreement and the defined tamper cases. The verifier must accept the genuine document and reject mutated amount, terms, model, observation, evidence root, acceptance, and signature.

## Gate J — Product comprehension

Test at least five genuine first-time participants who do not already know Whirr. Ask them to explain:

- what is being requested;
- who can accept;
- what counts as success;
- what an interruption does;
- when money can move;
- what the proof does not establish.

Record actual answers and failures. Do not invent participants or results.

## Gate K — Public submission

Complete the public repository, license, setup instructions, functioning demo, public video under three minutes, and Devpost entry. Do not claim submission before a confirmation exists.

## Predeclared quantitative targets

| Measure | Target |
| --- | --- |
| False qualifying physical agreements (FQPA) | 0 on the held-out nonqualifying set |
| Occupancy of source loss in qualifying set | 0 |
| Unknown-state capture eligibility | 0 |
| Substituted-model capture eligibility | 0 |
| Duplicate/out-of-order evidence capture eligibility | 0 |
| Capture amount | exactly the accepted fixed price |
| Capture above ceiling | 0 |
| Interrupted window rejection | 100% of predeclared interrupted trials |
| Genuine qualifying ledger | accepted by the verifier |

A small sample cannot prove reliability. Report uncertainty and retain failures.

## Artifacts to preserve

- raw assessment method and model card;
- recording hashes and device/placement notes;
- predeclared expectations;
- interval ledgers;
- signed proof and public verification result;
- provider transaction references;
- participant comprehension notes;
- explicit list of failed cases.

## Decision rule

A failed physical trial remains failed. Do not lower thresholds or relabel synthetic replay to make the release look complete. 7.0 can be a useful local vertical slice while every physical and financial gate remains OPEN.
