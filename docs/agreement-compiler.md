# Agreement compiler

## Scope

The 6.0 compiler supports a documented narrow grammar. It is deterministic TypeScript and does not require a paid model, API key, cloud call, or code execution. AI is used for acoustic event learning; the financial contract parser remains deterministic on purpose.

Example supported proposal:

> Charge $2 for one complete cycle. The machine must run for at least 15 seconds and return to idle. Do not charge if it stops early or the microphone disconnects.

## Pipeline

```text
natural-language text
  -> parsed proposal
  -> semantic validation
  -> typed agreement terms
  -> canonical digest
  -> explicit owner approval
  -> immutable published revision
```

The parser extracts an integer price, currency, minimum duration, derived maximum duration, completion language, and an early-stop policy. It reports unsupported phrases instead of guessing.

## Rejections and warnings

The compiler returns structured issues. Errors prevent executable status. Examples:

- missing or non-positive price;
- variable, hourly, recurring, percentage, or punitive pricing;
- escrow or fund-release requests;
- ambiguous words such as roughly, around, or maybe;
- missing minimum duration;
- minimum below three seconds;
- maximum shorter than minimum;
- maximum above fifteen minutes;
- no completion or observable stop condition;
- untrained or non-READY event model;
- malformed model digest;
- missing object or service name;
- invalid approval window.

A missing early-stop sentence produces a warning because the fixed failure policy still forbids capture. It does not silently create a charge.

## Exact approval

The browser receives the compiled terms and digest. Publishing sends both the digest and the reviewed terms snapshot. The server recompiles using the snapshot's original creation clock and expiry, then compares the fresh digest with the reviewed digest. A mismatch returns `TERMS_CHANGED`.

This prevents a second compilation at a new timestamp from changing the hash after the owner reviewed it. It also blocks storing a hand-edited agreement that the supported grammar would not produce.

## Model binding

The terms bind the model id, version, artifact digest, dataset digest, status, and provenance. Evaluation fails if the object currently points to another model. The system never substitutes a retrained model into an approved agreement.

## What the compiler refuses to become

- A general-purpose legal drafting system.
- An LLM that emits capture instructions.
- A code interpreter or SQL generator.
- A dynamic pricing engine.
- Escrow, payout, or recurring billing.
- An automatic approval mechanism.

## Test coverage

Unit tests cover successful compilation, unsupported clauses, digest changes, duration contradictions, immediate stop failure, uncertainty, sensor loss, extra cycles, model substitution, expiration, and deterministic evidence roots. Integration tests compile and publish through the real API, then run the requirement that the reviewed snapshot matches a fresh compile.
