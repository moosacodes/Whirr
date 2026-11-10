import { canonicalJson, sha256Hex } from '../../protocol/src/index.ts';
import type { EventModelArtifact } from '../../audio/src/event-model.ts';

export async function canonicalHashOfEventModel(artifact: EventModelArtifact): Promise<string> {
  return sha256Hex(canonicalJson(artifact));
}
