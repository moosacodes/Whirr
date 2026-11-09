# The Whirr acoustic protocol

**Status:** implemented alongside the v1 receipt and evidence formats.  
**Purpose:** make an object's acoustic calibration, rental evidence and billing summary portable and independently checkable without turning a local signature into a claim of physical truth.

## 1. The honest claim

Whirr is a supervised acoustic meter. A successful signature means:

> This Whirr installation held this public key and signed this canonical payload.

It does **not** mean a trusted timestamp, a third-party identity, a notarised observation, a physical inspection, or that the object was present. A similar machine, playback, a changed room or a compromised installation can defeat the sensing. Those limits are carried in every signed document's `limitations` and `attestation` fields.

The protocol is additive. Existing `whirr.receipt.v1` receipts, session evidence hashes and the historical **8/8** verification remain valid. New documents are labelled v2 and legacy artifacts are shown as **legacy—not signed** rather than silently upgraded.

## 2. Canonical bytes and signatures

| Layer | Rule |
| --- | --- |
| Canonical JSON | Object keys are sorted recursively; array order is preserved; JSON numbers must be finite; no whitespace is emitted. |
| Signature algorithm | ECDSA P-256 with SHA-256 over the canonical envelope payload. |
| Envelope | `schema: whirr.signed.v2`, `type`, `keyId`, `algorithm`, `payload`, `signature`. |
| Key ID | SHA-256 of the SPKI public key, represented as lowercase hex. |
| Private key | PKCS#8 in the ignored `.whirr/signing-key.json`; never returned by an API or included in a public artifact. |
| Public key | Embedded in each signed envelope so verification needs no server. |
| Rotation | New documents use the current key; old documents keep their embedded public key and key ID. Both verify independently. |

The verifier does not trust the embedded key for identity. It checks that the embedded public key hashes to the claimed `keyId` and that the signature matches the canonical payload. That is installation attestation, not a certificate chain.

## 3. Passport v2

`type: passport`, `payload.schema: whirr.passport.v2`.

The signed passport contains:

- public object metadata: name, category, glyph, description, owner label, status and creation time;
- the active model identity and hash, model status, provenance, metrics, training take count, feature-spec version and dataset hash;
- the enrolled soundprint and its fit statistics, if one exists;
- the published terms and their canonical hash, including the cap and optional fairness reserve;
- calibration age, take count and the optional held-out validation report;
- drift state and its aggregate diagnostic inputs;
- aggregate passport stamps: calibration, terms, session count, resolved disputes and previous editions;
- the previous passport hash, edition number, creation time, limitations and attestation.

Public passports never contain renter references, payment IDs, audio, feature vectors from a session or dispute text. Session totals are aggregate only. The ledger of editions is stored in `passport_versions`; an unchanged view reuses its edition rather than minting a new one per page load.

The passport is available at:

- `GET /api/passport/:objectId` — JSON view;
- `GET /api/passport/:objectId/proof` — download of the signed `.whirr-passport.json` envelope.

## 4. Receipt proof v2

`type: receipt-proof`, `payload.schema: whirr.receipt-proof.v2`.

The proof is a redacted, installation-signed summary of a v1 evidence receipt. It includes the receipt hash, session evidence root hash, object identity, model pin, terms hash and rate, quote arithmetic, payment mode/state and captured/refunded amounts, passport status and mismatch duration, interval aggregates, review hash and limitations. It excludes the renter reference, full PayPal order/authorization/capture/refund IDs and audio.

The full evidence receipt remains available to its renter (and operator) at `GET /api/sessions/:id/receipt`. The proof is available at `GET /api/sessions/:id/proof`; its redacted public copy is `GET /api/proofs/:proofId`. A proof is stable for a given receipt hash and is refreshed if the receipt changes before it is final.

The proof does not reproduce every interval. It cannot independently prove that the meter classified physical sound correctly; it proves the stored summary the installation signed. Use the receipt explorer and interval evidence hashes for the detailed audit.

## 5. Interval and receipt versions

- `whirr.interval.v1` is the original interval evidence hash.
- `whirr.interval.v2` adds an optional compact explanation: passport score and at most three top feature contributions, hashed into the interval evidence. Raw audio is still never included.
- `whirr.receipt.v1` remains the full evidence receipt schema. A receipt may include v2 interval explanations without invalidating the v1 hash structure.
- New receipts continue to verify through the existing quote, cap, interval consistency, passport and audit-chain checks. The historical Sandbox receipt remains 8/8.

## 6. Validation and drift

**Validation** is a held-out set of takes marked `VALIDATION` and never used to fit the model it evaluates. The UI reports take-level and aggregate precision/recall/FBT with a clear `NOT_RUN` state when no held-out takes exist. The model card explains the distinction between calibration fit and validation.

**Drift** is derived from stored interval diagnostics, not audio and not billing evidence. The passport exposes `FRESH`, `DRIFT_SUSPECTED` or `OVERDUE`, with mismatch and uncertainty ratios and calibration age. A drift flag can prompt operator review and recalibration; it never retroactively changes a settled bill.

## 7. Shelf and holds

The public shelf (`GET /api/shelf`) lists active, published objects with their active terms, model, calibration age, drift, passport edition, signature presence, live-session state and current hold. It never exposes renter identity.

A hold is a local, non-paid 10-minute collision guard:

- `POST /api/objects/:objectId/hold`
- `DELETE /api/objects/:objectId/hold`

A hold is bound to the renter cookie and expires automatically. It is not a reservation, a payment, an authorization or a promise of availability. Payment still starts only after consent and explicit PayPal Sandbox approval (or clearly labelled demo mode).

## 8. Preflight

`POST /api/sessions/:id/preflight` records a measured room check: frame count, noise floor, level variance, clipping ratio, silent ratio and flags. The server classifies it:

| Status | Behaviour |
| --- | --- |
| `READY` | Session may start. |
| `NOISY` | Warning; session may start, but ambiguous time remains free. |
| `UNSTABLE` | Severe: start blocked until a new check passes. |
| `NO_SIGNAL` | Severe: start blocked until a new check passes. |

Preflight is a usability check, not a physical-presence proof. It does not authenticate the microphone or inhibit playback later.

## 9. Privacy boundaries

- No raw audio is uploaded or stored by Whirr.
- Calibration uploads feature vectors and quality flags.
- Sessions upload sealed intervals, optional compact explanations and a diagnostic summary.
- Public proofs redact renter references and full payment IDs and contain no audio.
- Public stamps contain aggregate counts and hashes, not renter identity.
- The verifier and Tamper Lab run locally; pasted documents are not uploaded.

## 10. What is deliberately not here

Meter Cast SSE, cross-installation passport handoff, multi-object workshop billing, two-device corroboration, public daily evidence roots and camera/anti-spoof remain held. They would widen trust claims before the signed proof, privacy boundaries and tests are solid. The current protocol is a local-installation attestation, not a public transparency log.

## 11. Reproduce

```bash
npm run typecheck
npm test
npm run build
npm run proof:verify -- path/to/document.json
```

The protocol tests cover canonical JSON, signing, tampering, key rotation, legacy labelling and semantic checks. The integration test covers a stable signed passport, severe-preflight blocking, v2 explanations, fairness arithmetic, redacted proof verification and a hold race.

## Whirr 3.0 protocol notes

The signed envelope schema stays `whirr.signed.v2`; v3 adds the `proof-bundle` document type and payload `whirr.proof-bundle.v3`. Existing passports and receipt proofs are unchanged.

Evidence leaves use `whirr.evidence-leaf.v1` over the session ID, sequence, timestamps, state, model version, confidence rounded to three decimals, sorted quality flags and optional explanation. Parent nodes use `whirr.merkle.v1:<left>:<right>` with SHA-256; odd nodes are promoted unchanged. The signed root and every inclusion proof are verified offline, and the receipt timeline is compared field-by-field with the ledger.

Intervals may carry structured uncertainty reasons derived from flags: `UNKNOWN_OBJECT`, `LOW_CONFIDENCE`, `SOUNDPRINT_MISMATCH`, `COMPETING_SOUND`, `CLIPPED`, `SILENT`, `LOW_LEVEL`, `GAP`, `DEVICE_LOST`, `TAB_HIDDEN`. Explanations are aggregated across each closed interval instead of copying the final frame.

The bundle separates integrity (cryptographically checkable), sensing (signed capture claim and classifier evidence, not physical truth) and payment (installation-recorded; not verifiable offline). See [proof verification](proof-verification.md) and [demo v3](demo-v3.md).