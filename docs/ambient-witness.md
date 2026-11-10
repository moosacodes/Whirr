# Ambient witness

## Scope

The Ambient witness is the local observation path that turns microphone frames into ordered interval states for the deterministic evaluator. It is a **bounded browser sensor**, not a trusted physical witness.

Implementation:

- `apps/web/src/lib/audio.ts` — microphone capture and frame delivery.
- `apps/web/src/lib/ambient-audio.ts` — negative-space interval collector.
- `packages/audio/src/event-model.ts` — local event classifier.
- `apps/api/src/domain/ambient.ts` — append validation, evaluation, proof.
- `packages/ambient-engine/src/evaluator.ts` — temporal authority.

## Capture and inference

- The user explicitly opens the microphone.
- Audio is processed locally in the browser; raw audio is not uploaded.
- Frames become the existing feature representation and are classified by the event model bound to the agreement.
- A classification requires a non-refused event and a similarity at or above the confidence floor.
- `RUNNING` maps to `ACTIVE`; `IDLE`/`BACKGROUND` map to `INACTIVE`; refusal, low confidence, or transition uncertainty maps to `UNKNOWN`.
- The collector coalesces consecutive states into intervals of at least 32 ms.
- Each interval stores sequence, start/end milliseconds, source state, confidence, quality flags, and optional event-match score.

The live display is driven by the collector snapshot. When the microphone is closed, no signal animation runs.

## Baseline and qualification

The collector tracks:

- elapsed local time;
- baseline active duration;
- total inactive duration;
- unknown/sensor-loss duration;
- current continuous inactive run;
- longest continuous run;
- progress toward the approved target.

The browser displays a local “target reached” state, but it does not decide money. The server re-evaluates the uploaded ledger when the buyer stops the window. The proof verifier independently replays it.

## Upload and idempotency

Intervals are uploaded in batches with an increasing `clientSeq`. The server:

- scopes the session to the buyer;
- requires `OBSERVING`;
- rejects non-increasing sequence numbers;
- rejects overlapping or backward intervals;
- rejects single intervals over 120 seconds;
- rejects a gap above the agreement limit;
- caps a session at 15 minutes;
- stores only interval states and flags.

A rejected upload surfaces an error and cannot silently become capture evidence.

## Sensor loss

When the microphone ends, the collector appends a 32 ms `DISCONNECTED` interval with `MICROPHONE_ENDED`. The UI calls the stop endpoint with `SENSOR_LOST`. The evaluator records sensor loss and refuses capture. A missing signal is never treated as a quiet success.

## Model binding

The session stores:

- target object;
- model id;
- model version;
- model hash;
- dataset hash;
- provenance.

The evaluator receives the current model hash where available. If it differs from the agreement, the outcome is `REJECTED`. The proof carries the same model identity and the verifier checks that the agreement, evidence, evaluation, and public model agree.

A model match means “the same approved classifier digest,” not “the physical object is authentic.”

## Clock and sequence limitations

The browser clock is not trusted as a timestamp authority. The server records receipt time, but interval times are client-reported. The proof can demonstrate internal ordering and hashes; it cannot prove that the client did not manipulate its clock or fabricate a ledger.

The operator of the browser can also mute, move, or spoof the microphone. These are declared trust boundaries, not solved problems.

## Live UI truthfulness

- The top state says `REPLAY`, `MICROPHONE CLOSED`, `LIVE MICROPHONE`, or the explicit demo label.
- A synthetic replay displays a banner saying no microphone is open and no physical machine was observed.
- A demo/live session says it is a demo with no PayPal order and no capture, even when live classification is used for testing.
- The ring, ledger, and progress derive from interval states or replay position.
- A quiet screen is not described as proof of silence.
- Quality, unknown, and sensor-loss values are visible.

## Raw audio and privacy

- Raw audio is not sent to the server in the Ambient path.
- Feature summaries are not stored in the signed proof.
- Evidence stores interval states, confidence, flags, model identity, and hashes.
- No ambient session should run covertly; the user must open the microphone and can stop it.
- No public proof includes raw audio.
- No background continuous listening is implemented.

A diagnostic export of raw audio is not part of this release. Any future export must disclose destination and retention before use.

## Second-device corroboration

No second-device corroboration is shipped in this release. The architecture does not claim that two devices would make evidence fraud-proof. A future implementation would need independent device identities, clock-skew handling, window alignment, contradiction detection, per-device consent, and separate evidence provenance.

A second browser owned by the same person is not automatically an independent witness.

## What the witness proves

It can prove, relative to the signed ledger:

- the recorded sequence and temporal result;
- that the agreed model digest was bound;
- that the evaluator’s checks pass;
- that the proof was not modified after signing.

It cannot prove:

- that a real machine was off;
- that the room was silent;
- that the microphone or browser was honest;
- that the provider caused the change;
- that the recorded time is globally correct;
- that the provider has authority or that the activity was lawful.
