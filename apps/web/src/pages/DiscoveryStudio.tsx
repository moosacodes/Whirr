import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type {
  DiscoveryLabView,
  DiscoveryTrialResponse,
  DiscoveryTrialView,
} from '../../../../packages/contracts/src/types.ts';
import { compilePricingRule } from '../../../../packages/meter/src/pricing-rule.ts';
import { DiscoveryCapture, type DiscoveryCaptureSample } from '../components/DiscoveryCapture.tsx';
import {
  Button,
  EmptyState,
  Field,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  Select,
  TextArea,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { percent } from '../lib/format.ts';

const CONDITIONS: Array<{ value: DiscoveryTrialView['condition']; label: string; hint: string; unknown?: boolean }> = [
  { value: 'BASELINE', label: 'Baseline target', hint: 'The enrolled object running normally, same room and distance.' },
  { value: 'ROOM_NOISE', label: 'Room noise', hint: 'The object is off; ordinary room sound. Must not match the object.' },
  { value: 'APPLIANCE_NOISE', label: 'Another appliance', hint: 'A different machine runs. Must not match either enrollment.' },
  { value: 'DISTANCE_1M', label: 'Target at 1 m', hint: 'The enrolled object running at about one metre.' },
  { value: 'DISTANCE_2M', label: 'Target at 2 m', hint: 'The enrolled object running at about two metres.' },
  { value: 'REPLAY', label: 'Replay recording', hint: 'A phone speaker plays a recording of the truth object. No liveness claim.' },
  { value: 'UNKNOWN_OBJECT', label: 'Unknown object', hint: 'A third source that is not enrolled. Truth is null.', unknown: true },
];

function statusTone(status: DiscoveryLabView['reportStatus']): string {
  return status === 'PASS' ? 'chip--ok' : status === 'FAIL' ? 'chip--danger' : status === 'INCOMPLETE' ? 'chip--warn' : '';
}

function GateTable({ report }: { report: NonNullable<DiscoveryLabView['report']> }) {
  return (
    <div className="discover-gates discover-gates--lab">
      {report.gates.map((gate) => (
        <div key={gate.id} className="discover-gate">
          <span className={`discover-gate__dot is-${gate.status.toLowerCase()}`} />
          <div style={{ minWidth: 0 }}>
            <strong className="tiny">{gate.label}</strong>
            <span className="tiny muted" style={{ display: 'block' }}>{gate.detail}</span>
            <span className="mono tiny muted">{gate.observed} · gate {gate.threshold}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DiscoveryStudio() {
  usePageTitle('Discovery studio — Whirr 5.0');
  const [lab, setLab] = useState<DiscoveryLabView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [takes, setTakes] = useState<Record<string, DiscoveryCaptureSample[]>>({});
  const [condition, setCondition] = useState<DiscoveryTrialView['condition']>('BASELINE');
  const [truthId, setTruthId] = useState('');
  const [lastTrial, setLastTrial] = useState<DiscoveryTrialView | null>(null);
  const [busy, setBusy] = useState(false);
  const [ruleText, setRuleText] = useState('charge 0.20 per minute, cap at 5.00, uncertain time is excluded');

  const load = async () => {
    try {
      const result = await api<DiscoveryLabView>('/api/operator/discovery');
      setLab(result);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = lab?.objects.find((object) => object.id === selectedId) ?? lab?.objects[0] ?? null;
  const enrolled = lab?.objects.filter((object) => object.enrollment?.status === 'READY') ?? [];
  const selectedTakes = selected ? (takes[selected.id] ?? []) : [];
  const conditionCopy = CONDITIONS.find((entry) => entry.value === condition) ?? CONDITIONS[0]!;
  const compiled = useMemo(() => compilePricingRule(ruleText), [ruleText]);

  useEffect(() => {
    if (!selectedId && lab?.objects[0]) setSelectedId(lab.objects[0].id);
  }, [lab, selectedId]);

  useEffect(() => {
    if (condition === 'UNKNOWN_OBJECT') {
      setTruthId('');
      return;
    }
    if (!enrolled.some((object) => object.id === truthId)) setTruthId(enrolled[0]?.id ?? '');
  }, [condition, enrolled, truthId]);

  const enroll = async () => {
    if (!selected || selectedTakes.length < 2) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<DiscoveryLabView>(`/api/operator/objects/${selected.id}/discovery/enrollment`, {
        method: 'POST',
        body: {
          objectId: selected.id,
          takes: selectedTakes.map((take) => ({
            frames: take.frames,
            frameFlags: take.frameFlags,
            durationMs: take.durationMs,
            sampleRate: take.sampleRate,
            capturedAt: take.capturedAt,
            deviceLabel: take.deviceLabel,
            capture: take.capture,
          })),
        },
      });
      setLab(result);
      setTakes((current) => ({ ...current, [selected.id]: [] }));
      setNotice(`${selected.name} enrolled. Any previous trials and report were cleared because the evidence set changed.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const recordTrial = async (sample: DiscoveryCaptureSample) => {
    if (!conditionCopy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<DiscoveryTrialResponse>('/api/operator/discovery/trials', {
        method: 'POST',
        body: {
          frames: sample.frames,
          frameFlags: sample.frameFlags,
          durationMs: sample.durationMs,
          sampleRate: sample.sampleRate,
          capturedAt: sample.capturedAt,
          deviceLabel: sample.deviceLabel,
          capture: sample.capture,
          truthObjectId: conditionCopy.unknown ? null : truthId || null,
          condition,
        },
      });
      setLab(result.lab);
      setLastTrial(result.trial);
      setNotice('Held-out trial stored. It is not training data, and the match result was frozen by the server.');
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const generateReport = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ lab: DiscoveryLabView }>('/api/operator/discovery/report', {
        method: 'POST',
        body: {},
      });
      setLab(result.lab);
      setNotice('Report regenerated from the current held-out trials. An incomplete protocol stays marked INCOMPLETE.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const discard = async (trialId: string) => {
    setBusy(true);
    setError(null);
    try {
      setLab(await api<DiscoveryLabView>(`/api/operator/discovery/trials/${trialId}`, { method: 'DELETE' }));
      setNotice('Trial discarded and any report built from the old evidence set was removed.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading discovery enrollments…" />;
  if (!lab) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Discovery studio is not available.'}</Notice>
      </div>
    );
  }

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Whirr 5.0 · experimental vertical slice"
        breadcrumbs={
          <>
            <Link to="/studio">Studio</Link> <span aria-hidden="true">/</span> <span>Discovery</span>
          </>
        }
        title="Teach two objects to be found by ear."
        lede="This is a separate experiment from the 4.x per-object state meter. Enroll two genuinely different objects with new live takes, collect held-out target and unknown trials, then let the server publish the actual confusion matrix — including failure."
        actions={
          <>
            <LinkButton to="/invisible-checkout" variant="secondary">Public discovery</LinkButton>
            <LinkButton to="/studio" variant="ghost">Back to studio</LinkButton>
          </>
        }
      />

      {error ? <div style={{ marginBottom: '1rem' }}><Notice tone="danger">{error}</Notice></div> : null}
      {notice ? <div style={{ marginBottom: '1rem' }}><Notice tone="ok">{notice}</Notice></div> : null}
      <div className="notice notice--warn" style={{ marginBottom: '1.5rem' }}>
        <span className="notice__icon" aria-hidden="true"><Icon name="alert" size={17} /></span>
        <div>
          <strong>Not authentication.</strong> A discovery match is a similarity hypothesis, not identity, ownership or proof that a
          human is using the object. A phone replay can fool any acoustic matcher. Never use this to unlock, authorize, or bill solely on its result.
        </div>
      </div>

      <div className="sidebar-layout">
        <div className="stack-lg">
          <section className="card stack">
            <div className="row row--between">
              <div>
                <span className="eyebrow">Step 1 · enrollment</span>
                <h2 className="h2" style={{ fontSize: '1.8rem' }}>Two objects, two live takes each.</h2>
              </div>
              <span className="chip">{enrolled.length} ready enrollment{enrolled.length === 1 ? '' : 's'}</span>
            </div>
            <div className="discover-object-picker">
              {lab.objects.map((object) => (
                <button
                  key={object.id}
                  type="button"
                  className={`discover-object${selected?.id === object.id ? ' is-selected' : ''}`}
                  onClick={() => setSelectedId(object.id)}
                >
                  <ObjectGlyph glyph={object.glyph} size={38} tone={object.enrollment?.status === 'READY' ? 'accent' : undefined} />
                  <span className="discover-object__copy">
                    <strong>{object.name}</strong>
                    <span className="tiny muted">{object.category.replaceAll('_', ' ')} · {object.enrollment ? object.enrollment.status : 'not enrolled'}</span>
                  </span>
                  {object.enrollment?.status === 'READY' ? <Icon name="check" size={16} /> : null}
                </button>
              ))}
              {lab.objects.length === 0 ? (
                <EmptyState title="Create an object first" action={<LinkButton to="/studio">Open Studio</LinkButton>}>
                  Enrollment needs an object identity. Discovery does not infer one from the 4.x model.
                </EmptyState>
              ) : null}
            </div>

            {selected ? (
              <>
                <div className="panel">
                  <div className="row row--between">
                    <div>
                      <strong>{selected.name}</strong>
                      <p className="tiny muted" style={{ margin: '2px 0 0' }}>
                        {selected.enrollment
                          ? `${selected.enrollment.trainingTakeCount} training takes · ${selected.enrollment.usableFrameCount} usable frames · profile ${selected.enrollment.status}`
                          : 'No discovery enrollment yet. Record two separate takes of this object running normally.'}
                      </p>
                    </div>
                    <span className={`chip${selected.checkoutReady ? ' chip--ok' : ' chip--warn'}`}>
                      {selected.checkoutReady ? 'Checkout ready' : 'Checkout guarded'}
                    </span>
                  </div>
                  <p className="tiny muted" style={{ marginBottom: 0 }}>{selected.checkoutReason}</p>
                </div>

                <DiscoveryCapture
                  key={selected.id}
                  title={`Take ${selectedTakes.length + 1} of ${selected.name}`}
                  instruction="Put the object where it normally runs, start it, and let the room contain its ordinary operating sound. Do not reuse a previous take."
                  buttonLabel={selectedTakes.length >= 4 ? 'Four takes recorded' : 'Record a live take'}
                  onCapture={(sample) => {
                    setTakes((current) => ({
                      ...current,
                      [selected.id]: [...(current[selected.id] ?? []), sample].slice(-4),
                    }));
                  }}
                  disabled={selectedTakes.length >= 4 || busy}
                  compact
                />

                <div className="row row--between">
                  <span className="small muted">
                    {selectedTakes.length < 2
                      ? `Record ${2 - selectedTakes.length} more independent take${selectedTakes.length === 1 ? '' : 's'}.`
                      : `${selectedTakes.length} takes ready. Enrolling replaces this object’s profile and clears the old trial report.`}
                  </span>
                  <Button onClick={() => void enroll()} loading={busy} disabled={selectedTakes.length < 2}>
                    {selected.enrollment ? 'Replace enrollment' : 'Enroll object'}
                  </Button>
                </div>
              </>
            ) : null}
          </section>

          <section className="card stack">
            <div className="row row--between">
              <div>
                <span className="eyebrow">Step 2 · held-out trials</span>
                <h2 className="h2" style={{ fontSize: '1.8rem' }}>Measure confusion on new recordings.</h2>
              </div>
              <span className="chip">{lab.trials.length} trial{lab.trials.length === 1 ? '' : 's'}</span>
            </div>
            <div className="grid-2">
              <Field label="Trial condition" htmlFor="discovery-condition" hint={conditionCopy.hint}>
                <Select
                  id="discovery-condition"
                  value={condition}
                  onChange={(event) => setCondition(event.target.value as DiscoveryTrialView['condition'])}
                >
                  {CONDITIONS.map((entry) => (
                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Truth object" htmlFor="discovery-truth" hint={conditionCopy.unknown ? 'Unknown trials must have no truth object.' : 'The object that actually produced this recording.'}>
                <Select
                  id="discovery-truth"
                  value={conditionCopy.unknown ? '' : truthId}
                  onChange={(event) => setTruthId(event.target.value)}
                  disabled={conditionCopy.unknown}
                >
                  {conditionCopy.unknown ? <option value="">No truth object</option> : null}
                  {enrolled.map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}
                </Select>
              </Field>
            </div>
            {enrolled.length < 2 ? (
              <Notice tone="warn" title="Two distinct enrollments are required.">
                A discovery trial cannot be evaluated until at least two objects have READY profiles. This is the open-set rejection requirement, not a demo shortcut.
              </Notice>
            ) : null}
            {enrolled.length >= 2 ? (
              <DiscoveryCapture
                key={`${condition}-${truthId}`}
                title={`Held-out trial · ${conditionCopy.label}`}
                instruction={`${conditionCopy.hint} This must be a new recording, not one of the enrollment takes.`}
                buttonLabel="Record held-out trial"
                durationMs={6_000}
                onCapture={recordTrial}
                disabled={busy || (condition !== 'UNKNOWN_OBJECT' && !truthId)}
                compact
              />
            ) : null}

            {lastTrial ? (
              <div className="panel">
                <span className="eyebrow">Last server decision</span>
                <div className="row row--between">
                  <strong>{lastTrial.result}</strong>
                  <span className="tiny mono muted">{lastTrial.latencyMs.toFixed(1)} ms</span>
                </div>
                <p className="tiny muted" style={{ marginBottom: 0 }}>
                  Truth: {lastTrial.truthObjectName ?? 'unknown'} · predicted: {lastTrial.predictedObjectName ?? 'none'} · score{' '}
                  {lastTrial.score === null ? '—' : percent(lastTrial.score)}
                </p>
              </div>
            ) : null}

            {lab.trials.length ? (
              <div className="discover-table-wrap">
                <table className="discover-table">
                  <thead>
                    <tr><th>Truth</th><th>Condition</th><th>Result</th><th>Score</th><th>Latency</th><th /></tr>
                  </thead>
                  <tbody>
                    {lab.trials.map((trial) => (
                      <tr key={trial.id}>
                        <td>{trial.truthObjectName ?? 'unknown'}</td>
                        <td className="mono tiny">{trial.condition}</td>
                        <td><span className={`chip${trial.result === 'MATCH' ? ' chip--ok' : trial.result === 'AMBIGUOUS' ? ' chip--warn' : ''}`}>{trial.result}</span></td>
                        <td>{trial.score === null ? '—' : percent(trial.score)}</td>
                        <td className="mono tiny">{trial.latencyMs.toFixed(1)} ms</td>
                        <td><Button variant="ghost" size="sm" disabled={busy} onClick={() => void discard(trial.id)}>Discard</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="small muted">No held-out trials yet. The report stays NOT RUN rather than borrowing a number.</p>
            )}
          </section>

          <section className="card stack">
            <div className="row row--between">
              <div>
                <span className="eyebrow">Step 3 · actual evidence</span>
                <h2 className="h2" style={{ fontSize: '1.8rem' }}>The confusion matrix is the result.</h2>
              </div>
              <span className={`chip ${statusTone(lab.reportStatus)}`}>{lab.reportStatus}</span>
            </div>
            <div className="row row--between">
              <p className="small muted" style={{ margin: 0, maxWidth: '58ch' }}>
                The server recomputes gates from stored held-out decisions. A PASS requires every pre-declared threshold; an
                incomplete or failed experiment stays visible and blocks the claim.
              </p>
              <Button onClick={() => void generateReport()} loading={busy} disabled={lab.trials.length === 0}>
                Generate report
              </Button>
            </div>
            {lab.report ? (
              <>
                <div className="grid-3">
                  <div className="stat"><span className="stat__value">{percent(lab.report.metrics.targetAccuracy, 0)}</span><span className="stat__label">target accuracy · {lab.report.metrics.targetCorrect}/{lab.report.metrics.targetTrials}</span></div>
                  <div className="stat"><span className="stat__value">{lab.report.metrics.falseMatches}</span><span className="stat__label">false matches · {lab.report.metrics.unknownTrials} unknown trials</span></div>
                  <div className="stat"><span className="stat__value">{lab.report.metrics.medianLatencyMs.toFixed(1)} ms</span><span className="stat__label">median match latency</span></div>
                </div>
                <div className="discover-matrix-wrap">
                  <table className="discover-matrix">
                    <thead><tr><th>truth ↓ / predicted →</th>{lab.report.confusion.columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead>
                    <tbody>
                      {lab.report.confusion.rows.map((row, rowIndex) => (
                        <tr key={row}>
                          <th>{row.replaceAll('_', ' ')}</th>
                          {lab.report!.confusion.columns.map((column, columnIndex) => (
                            <td key={column} className={rowIndex === columnIndex ? 'is-diagonal' : ''}>{lab.report!.confusion.matrix[rowIndex]?.[columnIndex] ?? 0}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <GateTable report={lab.report} />
                <div className="discover-table-wrap">
                  <table className="discover-table">
                    <thead><tr><th>Condition</th><th>Trials</th><th>Correct</th><th>False matches</th><th>Unknown</th><th>Ambiguous</th></tr></thead>
                    <tbody>
                      {lab.report.conditions.map((entry) => (
                        <tr key={entry.condition}><td className="mono tiny">{entry.condition}</td><td>{entry.trials}</td><td>{entry.correct}</td><td>{entry.falseMatches}</td><td>{entry.unknown}</td><td>{entry.ambiguous}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="tiny muted" style={{ margin: 0 }}>Evidence hash: <span className="mono break">{lab.report.evidenceHash}</span></p>
              </>
            ) : (
              <p className="small muted">No report generated. Try to make the experiment pass; do not relabel an incomplete run as evidence.</p>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="card card--soft stack">
            <span className="eyebrow">Protocol · frozen</span>
            <div className="panel">
              <dl className="kv">
                <dt>Enrollments</dt><dd>{lab.protocol.minEnrollments} objects, {lab.protocol.trainingTakesPerObject} takes each</dd>
                <dt>Min frames</dt><dd>{lab.protocol.minTakeFrames} / take</dd>
                <dt>Match score</dt><dd>{percent(lab.protocol.minScore)}</dd>
                <dt>Separation</dt><dd>{percent(lab.protocol.minMargin, 1)}</dd>
                <dt>Target accuracy</dt><dd>≥ {percent(lab.protocol.targetAccuracy)}</dd>
                <dt>Unknown rejection</dt><dd>≥ {percent(lab.protocol.unknownRejection)}</dd>
                <dt>False match</dt><dd>≤ {percent(lab.protocol.falseMatchRate)}</dd>
                <dt>Replay cross-match</dt><dd>≤ {percent(lab.protocol.replayCrossMatchRate)}</dd>
                <dt>Distance / noise</dt><dd>≥ {percent(lab.protocol.distanceAccuracy)} / {percent(lab.protocol.noiseAccuracy)}</dd>
                <dt>Latency</dt><dd>≤ {lab.protocol.maxMedianLatencyMs} ms</dd>
              </dl>
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              These are pre-declared gates. They were not tuned after seeing results. The protocol requires {lab.protocol.minTargetTrials} target,
              {' '}{lab.protocol.minUnknownTrials} unknown, {lab.protocol.minReplayTrials} replay, {lab.protocol.minDistanceTrials} distance and{' '}
              {lab.protocol.minNoiseTrials} noise trials.
            </p>
          </section>

          <section className="card stack">
            <span className="eyebrow">Natural-language pricing prototype</span>
            <h2 className="h3">Compile, preview… then use the real pricing page.</h2>
            <p className="small muted" style={{ margin: 0 }}>
              This parser accepts only the existing rate, hard cap and uncertain-time exclusion semantics. It cannot publish.
              Unsupported clauses are rejected rather than guessed.
            </p>
            <Field label="Rule text" htmlFor="nl-rule" hint="Example: charge 0.20 per minute, cap at 5.00, uncertain time is excluded.">
              <TextArea id="nl-rule" value={ruleText} onChange={(event) => setRuleText(event.target.value)} rows={3} />
            </Field>
            {compiled.ok ? (
              <div className="panel stack" style={{ gap: '0.4rem' }}>
                <span className="chip chip--ok">Deterministically compiled</span>
                <span className="mono tiny break">{compiled.normalized}</span>
                <span className="tiny muted">Owner approval: required. No rule is saved, published or applied by this preview.</span>
              </div>
            ) : (
              <Notice tone="warn" title="Rejected.">{compiled.reason}</Notice>
            )}
            {selected ? (
              <Link className="link small" to={`/studio/objects/${selected.id}/pricing`}>
                Review and publish pricing for {selected.name} →
              </Link>
            ) : null}
          </section>

          <section className="card stack">
            <span className="eyebrow">Separate from 4.x</span>
            <p className="small muted" style={{ margin: 0 }}>
              Discovery enrollment is new evidence. It does not alter the object’s operational-state model, acoustic
              passport, field gate, terms, session ledger or PayPal authorization. A match only produces a hypothesis and,
              when eligible, a link to the existing service card.
            </p>
            <Link className="link small" to="/judge">Inspect the preserved 4.x evidence →</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
