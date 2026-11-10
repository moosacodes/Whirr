import type { AmbientSessionView } from '../../../../packages/contracts/src/types.ts';
import { ApiError, api } from './api.ts';

/**
 * Participants use the scoped session endpoint. A judge visitor with an unrelated
 * renter cookie may still inspect a seeded demo; that route is deliberately
 * limited by the server to the reference agreement.
 */
export async function loadAmbientSession(sessionId: string, demoOnly = false): Promise<AmbientSessionView> {
  if (demoOnly) {
    return api<AmbientSessionView>(`/api/ambient/judge/sessions/${sessionId}`);
  }
  try {
    return await api<AmbientSessionView>(`/api/ambient/sessions/${sessionId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return api<AmbientSessionView>(`/api/ambient/judge/sessions/${sessionId}`);
    }
    throw error;
  }
}
