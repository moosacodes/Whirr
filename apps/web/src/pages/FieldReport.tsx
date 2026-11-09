import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { FieldTestReport } from '../../../../packages/contracts/src/types.ts';
import { Loading, Notice, PageHeader, usePageTitle } from '../components/ui.tsx';
import { Icon } from '../components/visuals.tsx';
import { dateTime, duration, percent } from '../lib/format.ts';

function ReportGateList({ gates }: { gates: FieldTestReport['gates'] }) {
  return (
    <div className="gate-list">
      {gates.map((entry) => (
        <div className="gate-row" key={entry.id}>
          <div className="gate-row__copy">
            <strong className="small">{entry.label}</strong>
            <span className="tiny muted">{entry.detail}</span>
          </div>
          <span className="gate-row__threshold tiny mono muted">{entry.threshold}</span>
          <span className="gate-row__observed tiny mono">{entry.observed}</span>
          <span
            className={`chip ${
              entry.status === 'PASS' ? 'chip--ok' : entry.status === 'FAIL' ? 'chip--danger' : 'chip--warn'
            }`}
          >
            {entry.status}
          </span>
        </div>
      ))}
    </div>
  );
}

const TRIAL_LABEL: Record<FieldTestReport['trials'][number]['kind'], string> = {
  THREE_CYCLE: 'Three-cycle ON/OFF',
  NOISE: 'Background noise',
  DISTANCE: 'Running at distance',
  REPLAY: 'Replay',
};

export function FieldReportPage() {
  const { reportId = '' } = useParams();
  const [report, setReport] = useState<FieldTestReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(report ? `Field test ${report.id}` : 'Field-test report');

  const load = useCallback(async () => {
    try {
      setReport(await api<FieldTestReport>(`/api/field-reports/${reportId}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Loading label="Loading field-test report…" />;
  if (!report) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Field-test report not found.'}</Notice>
      </div>
    );
  }

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Inspectable field evidence"
        breadcrumbs={
          <>
            <Link to="/studio">Studio</Link> <span aria-hidden="true">/</span> <span>{report.object.name}</span>{' '}
            <span aria-hidden="true">/</span> <span>Field report</span>
          </>
        }
        title="A real-object field test, with the failures kept."
        lede="This report was produced by the local server from held-out live-microphone captures. It names the exact model, shows every gate and records the limitations. It is not a proof of physical presence or replay resistance."
        actions={
          <>
            <Link className="btn btn--secondary btn--sm" to={`/passport/${report.object.id}`}>
              Acoustic passport
            </Link>
            <Link className="btn btn--ghost btn--sm" to={`/studio/objects/${report.object.id}/calibration-lab`}>
              Calibration Lab
            </Link>
          </>
        }
      />

      <section className="card stack">
        <div className="row row--between" style={{ alignItems: 'flex-start' }}>
          <div>
            <span className="eyebrow">Outcome</span>
            <h2 className="h2" style={{ fontSize: '2rem' }}>
              {report.status === 'FIELD_PASS' ? 'Field test passed.' : 'Field test failed.'}
            </h2>
            <p className="small muted" style={{ margin: 0 }}>{report.outcomeDetail}</p>
          </div>
          <span className={`chip ${report.status === 'FIELD_PASS' ? 'chip--ok' : 'chip--danger'}`}>
            {report.status}
          </span>
        </div>
        <div className="grid-2" style={{ gap: '0.6rem' }}>
          <div className="panel"><span className="stat__label">Object</span><div className="small" style={{ marginTop: 4 }}>{report.object.name} · {report.object.category}</div></div>
          <div className="panel"><span className="stat__label">Model</span><div className="small" style={{ marginTop: 4 }}>{report.model.version} · {report.model.status} · {report.model.provenance.replaceAll('_', ' ').toLowerCase()}</div></div>
          <div className="panel"><span className="stat__label">Generated</span><div className="small" style={{ marginTop: 4 }}>{dateTime(report.createdAt)}</div></div>
          <div className="panel"><span className="stat__label">Recordings</span><div className="small" style={{ marginTop: 4 }}>{report.recordingSet.recordings} · {duration(report.recordingSet.totalDurationMs)}</div></div>
        </div>
        <p className="tiny mono break" style={{ margin: 0 }}>evidence {report.evidenceHash}</p>
        <p className="tiny mono break" style={{ margin: 0 }}>model {report.model.hash}</p>
      </section>

      <section className="card stack" style={{ marginTop: '1.25rem' }}>
        <div className="row row--between">
          <h2 className="h3">Measured on held-out recordings</h2>
          <span className="chip">{report.metrics.trialCount} trials · {report.metrics.cycles} cycles</span>
        </div>
        <div className="grid-2" style={{ gap: '0.6rem' }}>
          <div className="panel"><span className="stat__label">Precision</span><div className="h3 mono">{percent(report.metrics.precision, 2)}</div></div>
          <div className="panel"><span className="stat__label">Recall</span><div className="h3 mono">{percent(report.metrics.recall, 2)}</div></div>
          <div className="panel"><span className="stat__label">False-billable duration</span><div className="h3 mono">{duration(report.metrics.falseBillableMs)}</div><span className="tiny muted">{percent(report.metrics.falseBillableRatio, 2)} of protocol OFF time</span></div>
          <div className="panel"><span className="stat__label">Billing error</span><div className="h3 mono">{duration(report.metrics.billingErrorMs)}</div><span className="tiny muted">{percent(report.metrics.billingErrorRatio, 2)} of observed time</span></div>
          <div className="panel"><span className="stat__label">Noise trial false-billable</span><div className="h3 mono">{percent(report.metrics.noiseFalseBillableRatio, 2)}</div></div>
          <div className="panel"><span className="stat__label">Distance trial active</span><div className="h3 mono">{percent(report.metrics.distanceActiveRatio, 2)}</div></div>
          <div className="panel"><span className="stat__label">Replay trial active</span><div className="h3 mono">{percent(report.metrics.replayActiveRatio, 2)}</div></div>
          <div className="panel"><span className="stat__label">Overbilling error</span><div className="h3 mono">{percent(report.metrics.overbillingRatio, 2)}</div></div>
        </div>
      </section>

      <section className="card stack" style={{ marginTop: '1.25rem' }}>
        <h2 className="h3">Every gate</h2>
        <ReportGateList gates={report.gates} />
      </section>

      <section className="card stack" style={{ marginTop: '1.25rem' }}>
        <h2 className="h3">Trials and anonymised recordings</h2>
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Trial</th>
                <th>Status</th>
                <th>Attempt</th>
                <th>Duration</th>
                <th>Billed</th>
                <th>Expected ON</th>
                <th>Device ref</th>
              </tr>
            </thead>
            <tbody>
              {report.trials.map((trial) => (
                <tr key={trial.recordingId}>
                  <td>{TRIAL_LABEL[trial.kind]}</td>
                  <td><span className={`chip ${trial.status === 'PASS' ? 'chip--ok' : 'chip--danger'}`}>{trial.status}</span></td>
                  <td>{trial.attempt}</td>
                  <td>{duration(trial.durationMs)}</td>
                  <td>{duration(trial.metrics.billedMs)}</td>
                  <td>{duration(trial.metrics.expectedOperatingMs)}</td>
                  <td className="mono tiny">{trial.recording.deviceRef ?? 'default input'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>
          Raw audio was not uploaded or stored. Device labels are reduced to short non-reversible references. The report is
          client-reported live-microphone evidence; the server recomputed each metric from the submitted feature frames.
        </p>
        <div className="row">
          <a className="btn btn--secondary btn--sm" href={`/api/field-reports/${report.id}`} target="_blank" rel="noreferrer">
            <Icon name="download" size={15} /> Open raw JSON
          </a>
        </div>
      </section>

      <div className="sidebar-layout" style={{ marginTop: '1.25rem' }}>
        <section className="card stack">
          <h2 className="h3">Methodology</h2>
          <ol className="small muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {report.methodology.map((line) => <li key={line}>{line}</li>)}
          </ol>
        </section>
        <aside className="stack">
          <section className="card stack">
            <h2 className="h3">Limitations</h2>
            <ul className="small muted" style={{ margin: 0, paddingLeft: '1rem' }}>
              {report.limitations.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>
          <section className="card stack">
            <h2 className="h3">Attestation</h2>
            <p className="small muted" style={{ margin: 0 }}>{report.attestation}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
