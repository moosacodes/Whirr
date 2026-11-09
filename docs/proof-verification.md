# Verifying a Whirr proof

Whirr proofs are signed JSON. Verification is local: the file is not uploaded, and no Whirr server has to be online. This is useful because a receipt should survive the installation that issued it.

## 1. Export a passport

Open `/passport/:objectId` and choose **Download signed passport**. The file is a `whirr.signed.v2` envelope with `type: passport` and payload schema `whirr.passport.v2`. The browser also offers **Verify offline**, which uses the same verifier and Tamper Lab as `/verify`.

## 2. Export or share a receipt proof

From a stopped or settled session, open the receipt. Whirr creates a redacted, signed proof card and QR code. Download the JSON or copy the proof URL. The proof contains the receipt hash, quote arithmetic, model pin, passport summary and payment mode, but no renter reference, full payment IDs or audio.

The raw evidence receipt is different: it is available only to the renter or operator and contains the interval ledger and session evidence. Share the proof card publicly; share the full receipt only when the evidence detail is required.

## 3. Verify in the browser

1. Open `/verify`.
2. Drop a `.json` envelope or paste it into the box.
3. Read every line. A failed line is a failed document; there is no single green “trusted” badge that hides the individual checks.
4. Use the Tamper Lab to edit a quote, object name or signature in the browser and re-run verification. The lab never mutates a live session or the downloaded file.

## 4. Verify from the command line

```bash
npm run proof:verify -- path/to/whirr-passport.json
npm run proof:verify -- path/to/whirr-receipt-proof.json
```

The command exits `0` only when every check passes, `1` for an invalid document, and `2` for a missing or unparseable file. It prints each check with a short detail.

## 5. Checks performed

| Check | Pass condition |
| --- | --- |
| Envelope schema | `schema` is `whirr.signed.v2`, required envelope fields are present, algorithm is ECDSA P-256 + SHA-256. |
| Key identifier | SHA-256 of the embedded SPKI public key equals the claimed `keyId`. |
| Signature | ECDSA P-256 signature verifies over the exact canonical payload. |
| Passport schema | Payload schema is `whirr.passport.v2`. |
| Object identity | Non-empty object ID and name are present. |
| Model pin | A 64-hex model hash is present. |
| Key identifier length | A stable installation key ID is present. |
| Receipt-proof schema | Payload schema is `whirr.receipt-proof.v2`. |
| Receipt hash | A 64-hex receipt hash is present. |
| Cap | The proof quote is non-negative and no greater than the stated cap. |
| Payload digest | A second SHA-256 digest can be recomputed from the canonical payload. |

The full evidence receipt's eight checks (quote, cap, evidence root, receipt hash, intervals, passport consistency, provider amount, audit chain) remain in the API and receipt UI. They are separate from the signed-envelope checks because a proof deliberately omits the detailed ledger.

## 6. What a passing result proves

- The canonical payload has not changed since the signature was made.
- The embedded public key corresponds to the claimed key ID.
- This installation signed the document with its private key.
- For a receipt proof, the signed summary is internally consistent with its own stated cap and receipt hash.

## 7. What it does not prove

- That the signature was made at a particular wall-clock time.
- That a third party, certificate authority or auditor endorsed the installation.
- That the object was physically present, that the microphone heard it, or that playback did not occur.
- That the classifier was correct on every interval or that the renter agreed with the bill.
- That a public copy is authentic merely because it is on a web page. Verify the bytes, not a screenshot.

The passport's `attestation` and `limitations` fields say this in the document itself. A verifier should show those lines rather than reducing the result to “verified = true”.

## 8. Key rotation and old files

Each envelope embeds its public key and key ID. Rotating the installation key affects new signatures only. Keep the old signed files; they continue to verify against their embedded key. Losing a private key prevents new signatures but does not invalidate old files. Never publish the private key to make old files “verifiable”.

## 9. Legacy artifacts

An unsigned v1 passport, v1 receipt or arbitrary JSON is **legacy—not signed**. It may still be useful evidence, and the original receipt verification endpoint remains available, but it must not be shown with a seal. The `/verify` page labels it as legacy rather than treating silence as success.

## 10. Tamper Lab threat boundary

The Tamper Lab is a demonstration and test surface. It changes a copy in memory in the current browser tab; it does not call an API, alter a stored receipt, invalidate a real signature or prove that a live system is immutable. Its value is showing which field fails when bytes change. A host administrator can rewrite a database; the signature is a checkpoint, not an external notary.