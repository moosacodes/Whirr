# Temporal event model

## What is learned

The 6.0 event model learns acoustic identities for `IDLE`, `RUNNING`, `BACKGROUND`, and optional `INTERRUPTED` demonstrations. `START`, `RUNNING`, and `EXPECTED_STOP` are also contract states. They are not separate claims that a model heard a unique physical completion sound.

This distinction is enforced in the agreement: `evidence.acousticStopDistinction` is `false`, and `EXPECTED_STOP` is inferred when confident active reporting returns to confident idle. For many appliances an expected and an unexpected stop sound cannot be separated. Whirr must not invent that difference.

## Features and training

The existing 21-feature, 32 ms frame pipeline is reused. Training data is stored as feature vectors, never raw audio. Each demonstration records:

- object id and declared label;
- frame vectors and quality flags;
- duration and feature-spec version;
- live, imported, or synthetic source;
- synthetic or user-calibration provenance;
- session group and capture time;
- a dataset digest and model version.

Validation uses leave-one-take-out. A complete take is held out; frames from that take do not enter its validation fold. The model does not split adjacent frames across train and test.

## Per-demonstration prototypes

A single centroid per class was not adequate for a background class containing a hair dryer, music, speech, a kettle, clatter, and a vacuum. The implemented model stores one standardised centroid per demonstration prototype and scores a frame against the best prototype in each class. This is still a lightweight local model, but it can represent several known distractors without pretending they share one sound.

The final reference model has 15 takes, 3,183 frames, 6 session groups, and 5 prototypes per core class. Its leave-one-take-out confusion matrix is recorded in `docs/model-card-6.0.md`.

## Open-set refusal

`classifyEventFrame` refuses when:

- the feature vector or quality flags fail;
- the best similarity is below `minTopSimilarity`;
- the margin over the second class is below `minMargin`.

A refusal becomes `UNCERTAIN`, never a confident payable event. The browser sends reporting states, not a stored `qualified` flag.

## Deterministic temporal evaluator

Reporting states are `IDLE`, `ACTIVE_CONFIDENT`, `UNCERTAIN`, and `DISCONNECTED`. The evaluator:

1. validates sequence numbers, ordering, intervals, confidence, and flags;
2. computes idle baseline before the first run;
3. groups confident active intervals into runs;
4. checks single-cycle and maximum duration;
5. checks minimum run duration;
6. checks return to idle as the stop inference;
7. checks gaps, continuity, uncertainty, and model binding;
8. hashes the observation ledger and evaluation evidence root.

The same terms and ordered observations produce the same result. Reordered, duplicate, stale, or contradictory observations fail structural validation.

## Outcome mapping

- `QUALIFIED` - all mandatory conditions pass.
- `INCOMPLETE` - start, sustained run, or stop was not established.
- `INTERRUPTED` - a run stopped before the minimum.
- `UNCERTAIN` - uncertain or low-confidence evidence contaminated the cycle.
- `SENSOR_LOST` - disconnection occurred before completion.
- `EXPIRED` - the approval window ended.
- `REJECTED` - structural failure, extra cycle, overlong run, or hash/model disagreement.

## Limitations

- One object, one microphone, and one room do not generalise.
- The synthetic reference metrics are not field accuracy.
- A browser operator can forge feature streams.
- A replay can sound like the machine.
- Completion is temporal, not proof of manufacturing success.
- An untaught machine may be refused, but a sufficiently similar distractor may be accepted.
