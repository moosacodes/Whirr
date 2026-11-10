# Evidence and trust

Whirr 6.0 separates claims that are often collapsed into one green badge.

## Trust domains

| Domain | What the record can establish | What it cannot establish |
| --- | --- | --- |
| Integrity | The installation signed the payload; hashes match | That the installation or browser was honest |
| Sensor provenance | A stated capture process produced the uploaded feature intervals | That the microphone heard the claimed machine |
| Inference | The embedded model artifact and its validation results hash to the terms binding | Field accuracy or correctness of a physical outcome |
| Contract compliance | The exact approved terms, replayed against the observation ledger, produce the stated outcome | That the contract language captured every human intention |
| Financial confirmation | A provider capture or void id and amount are present and internally consistent | Provider settlement without an independent PayPal lookup |
| Real-world fulfillment | Nothing beyond the observable operating sequence | That a product was manufactured, repaired, or successfully completed |

## Portable proof

Schema: `whirr.physical-proof.v1`
Signer: installation ECDSA key
Verifier: `verifyPhysicalProofDocument`

The proof embeds or binds:

- agreement id, exact terms, and agreement hash;
- model artifact, model hash, dataset hash, provenance, and metrics;
- session approval timestamps;
- ordered observations and observations hash;
- temporal evaluation, checks, events, outcome, and evidence root;
- payment mode and provider references;
- human-acceptance record when present;
- explicit trust-domain statements and limitations.

The private stored document and public document are both retained. The public inspector recomputes the signature and internal hashes. Existing 4.x proof verifiers remain untouched.

## Independent checks

The verifier does not trust `qualified: true`. It recomputes:

1. the signed envelope;
2. the agreement terms hash;
3. the model artifact hash against the terms binding;
4. the observation ledger digest;
5. the evidence root;
6. the deterministic contract evaluation;
7. amount and payment-state consistency.

The integration test alters an observation after signing and confirms signature failure. The API test confirms that a legitimate demo proof passes and that demo capture is refused.

## Why the proof is intentionally not stronger

A microphone is not a witness. A renter-controlled browser can fabricate feature vectors. A recording can impersonate a machine. The proof records the claim and its internal consistency; it does not turn the browser into a trusted sensor. A future version could add a hardware attestation or an independent capture device, but that is outside the zero-hardware constraint.

## Public access

`/promise/proof/:proofId` displays the public document and the verification checks. The proof is portable JSON and can be retained after the server is gone. Provider confirmation still requires access to the relevant PayPal Sandbox account.
