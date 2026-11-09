import type { AppContext } from '../context.ts';
import type { DriftView } from '../../../../packages/contracts/src/types.ts';

const DAY_MS = 86_400_000;

export function driftForObject(ctx: AppContext, objectId: string, modelCreatedAt: string | null): DriftView {
  const rows = ctx.store.all<{ report_json: string; created_at: string }>(
    `SELECT sr.report_json, sr.created_at
       FROM session_sensor_reports sr
       JOIN sessions s ON s.id = sr.session_id
      WHERE s.object_id = ?
      ORDER BY sr.created_at DESC LIMIT 8`,
    objectId,
  );
  const reports = rows.map((row) => JSON.parse(row.report_json) as {
    mismatchRatio?: number;
    uncertainRatio?: number;
  });
  const sessions = reports.length;
  const mismatchRatio = sessions > 0 ? reports.reduce((sum, report) => sum + (report.mismatchRatio ?? 0), 0) / sessions : 0;
  const uncertainRatio = sessions > 0 ? reports.reduce((sum, report) => sum + (report.uncertainRatio ?? 0), 0) / sessions : 0;
  const calibrationAgeDays = modelCreatedAt
    ? Math.max(0, Math.floor((ctx.now().getTime() - Date.parse(modelCreatedAt)) / DAY_MS))
    : null;
  let status: DriftView['status'] = 'FRESH';
  let reason = 'No diagnostic drift signal has been recorded yet.';
  if (sessions === 0) {
    status = 'NO_DATA';
    reason = 'No settled session has produced a diagnostic acoustic summary yet.';
  } else if (calibrationAgeDays !== null && calibrationAgeDays > 90) {
    status = 'OVERDUE';
    reason = `This calibration is ${calibrationAgeDays} days old. Recalibrate before relying on the meter.`;
  } else if (mismatchRatio >= 0.2 || uncertainRatio >= 0.5) {
    status = 'DRIFT_SUSPECTED';
    reason = `Recent diagnostics show ${(mismatchRatio * 100).toFixed(0)}% passport mismatches and ${(uncertainRatio * 100).toFixed(0)}% uncertain time. Review the microphone and recalibrate if it persists.`;
  } else {
    reason = `Recent diagnostics are within the calibration envelope (${(mismatchRatio * 100).toFixed(0)}% mismatches over ${sessions} session${sessions === 1 ? '' : 's'}).`;
  }
  return { status, reason, sessions, mismatchRatio, uncertainRatio, calibrationAgeDays };
}
