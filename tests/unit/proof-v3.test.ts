import { describe, expect, it } from 'vitest';
import {
  evidenceLeafHash,
  merkleBatchProofs,
  merkleRoot,
  verifyMerkleProof,
} from '../../packages/protocol/src/index.ts';

function leafInput(seq: number, state: 'ACTIVE_CONFIDENT' | 'IDLE' | 'UNCERTAIN' = 'ACTIVE_CONFIDENT') {
  return {
    sessionId: 'ses_merkle_test',
    seq,
    startMs: seq * 1_000,
    endMs: (seq + 1) * 1_000,
    state,
    modelVersion: 'model-v1',
    confidence: 0.9 + seq / 100,
    qualityFlags: seq % 2 === 0 ? ['SILENT', 'LOW_LEVEL'] : ['UNKNOWN_OBJECT'],
    explanation: {
      schema: 'whirr.explanation.v1' as const,
      passportScore: 0.8,
      topFeatures: [{ name: 'band_2', value: 0.4, contribution: 0.2 }],
      summary: `Interval ${seq}`,
    },
  };
}

describe('Whirr v3 Merkle evidence ledger', () => {
  it('proves every interval and rejects changed content, ordering and proofs', async () => {
    const leaves = await Promise.all([1, 2, 3, 4, 5].map((seq) => evidenceLeafHash(leafInput(seq))));
    const { root, proofs } = await merkleBatchProofs(leaves);
    expect(root).toMatch(/^[a-f0-9]{64}$/);
    expect(proofs).toHaveLength(5);

    for (let index = 0; index < leaves.length; index += 1) {
      expect(await verifyMerkleProof(leaves[index]!, proofs[index]!, root)).toBe(true);
    }

    const changedTimestamp = await evidenceLeafHash({ ...leafInput(2), startMs: 2_001 });
    const changedState = await evidenceLeafHash({ ...leafInput(2), state: 'IDLE' });
    const changedModel = await evidenceLeafHash({ ...leafInput(2), modelVersion: 'model-v2' });
    const changedFlags = await evidenceLeafHash({ ...leafInput(2), qualityFlags: ['LOW_LEVEL', 'SILENT', 'CLIPPED'] });
    const changedExplanation = await evidenceLeafHash({
      ...leafInput(2),
      explanation: { ...leafInput(2).explanation!, summary: 'Edited explanation' },
    });

    for (const changed of [changedTimestamp, changedState, changedModel, changedFlags, changedExplanation]) {
      expect(changed).not.toBe(leaves[1]);
      expect(await verifyMerkleProof(changed, proofs[1]!, root)).toBe(false);
    }

    const forgedProof = [{ side: 'right' as const, hash: 'f'.repeat(64) }];
    expect(await verifyMerkleProof(leaves[0]!, forgedProof, root)).toBe(false);
    expect(await verifyMerkleProof(leaves[0]!, proofs[0]!, '0'.repeat(64))).toBe(false);

    const reordered = await merkleRoot([leaves[1]!, leaves[0]!, leaves[2]!, leaves[3]!, leaves[4]!]);
    expect(reordered).not.toBe(root);

    const inserted = await merkleRoot([...leaves, await evidenceLeafHash(leafInput(6))]);
    expect(inserted).not.toBe(root);

    const removed = await merkleRoot(leaves.slice(0, 4));
    expect(removed).not.toBe(root);
  });

  it('handles the empty ledger deterministically instead of inventing a root', async () => {
    const empty = await merkleRoot([]);
    expect(empty).toMatch(/^[a-f0-9]{64}$/);
    await expect(merkleBatchProofs([])).resolves.toEqual({ root: empty, proofs: [] });
    expect(await verifyMerkleProof('a'.repeat(64), [], empty)).toBe(false);
  });
});
