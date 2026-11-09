import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { OwnerObjectView } from '../../../../packages/contracts/src/types.ts';
import type { ModelArtifact } from '../../../../packages/audio/src/classifier.ts';
import {
  Button,
  EmptyState,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  Stat,
  usePageTitle,
} from '../components/ui.tsx';
import { ConfusionMatrix, Icon, ObjectGlyph, SoundprintBars } from '../components/visuals.tsx';
import { dateTime, percent } from '../lib/format.ts';

interface ArtifactResponse {
  artifact: ModelArtifact;
  modelId: string;
  modelVersion: string;
  modelHash: string;
}

const CLASS_LABELS_WORD = ['Idle', 'Active', 'Other'];

function statusTone(status: string): 'ok' | 'warn' | 'danger' {
  if (status === 'READY') return 'ok';
  if (status === 'LIMITED') return 'warn';
  return 'danger';
}

export function ModelReview() {
  const { objectId = '' } = useParams();
  const [view, setView] = useState<OwnerObjectView | null>(null);
  const [artifact, setArtifact] = useState<ArtifactResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const owner = await api<OwnerObjectView>(`/api/operator/objects/${objectId}`);
      setView(owner);
      if (owner.activeModel) {
        setArtifact(await api<ArtifactResponse>(`/api/operator/objects/${objectId}/model-artifact`));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    void load();
  }, [load]);

  usePageTitle(view ? `${view.object.name} model` : 'Model review');

  if (loading) return <Loading label="Loading model evidence…" />;
  if (!view) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Object not found.'}</Notice>
      </div>
    );
  }

  const model = view.activeModel;
  const modelArtifact = artifact?.artifact ?? null;

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Model review"
        breadcrumbs={
          <>
            <Link to="/studio">Studio</Link> <span aria-hidden="true">/</span>{' '}
            <Link to={`/studio/objects/${objectId}`}>{view.object.name}</Link> <span aria-hidden="true">/</span>{' '}
            <span>Model</span>
          </>
        }
        title={
          <span className="row" style={{ gap: '0.8rem' }}>
            <ObjectGlyph glyph={view.object.glyph} size={54} tone="accent" /> {view.object.name} model
          </span>
        }
        lede="Metrics below are computed on held-out takes, not on the data used to fit the weights. Thresholds are precision-first: a false bill is worse than missed usage."
        actions={
          <>
            <LinkButton to={`/studio/objects/${objectId}`} variant="secondary">
              Capture more takes
            </LinkButton>
            <LinkButton to={`/studio/objects/${objectId}/pricing`} variant="primary">
              Pricing
            </LinkButton>
            <LinkButton to={`/studio/objects/${objectId}/poster`} variant="ghost">
              Poster
            </LinkButton>
          </>
        }
      />

      {error ? (
        <div style={{ marginBottom: '1rem' }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      {!model ? (
        <EmptyState
          title="No model yet"
          action={
            <LinkButton to={`/studio/objects/${objectId}`} variant="primary">
              Open capture lab <Icon name="arrow" size={16} />
            </LinkButton>
          }
        >
          Record labelled takes and train a model. The training gate prevents a model that produces false bills from
          being published.
        </EmptyState>
      ) : (
        <div className="stack-lg">
          <section className="card stack">
            <div className="row row--between">
              <div className="stack" style={{ gap: '0.3rem' }}>
                <span className="eyebrow">Active model · {model.version}</span>
                <h2 className="h2">{model.status === 'READY' ? 'Cleared to bill automatically.' : model.status === 'LIMITED' ? 'Cleared only with operator review.' : 'Rejected — cannot publish terms.'}</h2>
              </div>
              <span className={`chip chip--${statusTone(model.status)}`} style={{ fontSize: '0.8rem', padding: '0.45rem 0.8rem' }}>
                <span className="chip__dot" aria-hidden="true" />
                {model.status}
              </span>
            </div>
            {model.metrics.provenance === 'SYNTHETIC_REFERENCE' ? (
              <Notice tone="warn" title="Synthetic reference model.">
                This artifact was trained on procedurally generated fixtures to exercise the pipeline. Its metrics are
                real measurements of that synthetic dataset, and are <strong>not</strong> evidence of field accuracy on
                a physical object. Record your own takes for a user-calibrated model.
              </Notice>
            ) : null}
            <div className="grid-4">
              <Stat label="Held-out precision" value={percent(model.metrics.precision)} tone="accent" />
              <Stat label="Recall" value={percent(model.metrics.recall)} />
              <Stat label="False billable time" value={percent(model.metrics.falseBillableRatio, 2)} />
              <Stat label="Active threshold" value={model.metrics.threshold.toFixed(2)} />
            </div>
            <p className="small muted">
              {model.metrics.takeCount} takes · {model.metrics.frameCount} frames · method{' '}
              <span className="mono">{model.metrics.method.toLowerCase().replaceAll('_', ' ')}</span> · trained{' '}
              {dateTime(model.metrics.trainedAt)} · calibration age {view.calibrationAgeDays ?? 0} day(s).
            </p>
            {model.takeaways.length > 0 ? (
              <div className="panel stack" style={{ gap: '0.4rem' }}>
                <strong className="small">Why this status</strong>
                <ul className="small muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  {model.takeaways.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="progress-steps">
              <span className="is-done">idle takes {view.takeCounts.idle}</span>
              <span className="is-done">active takes {view.takeCounts.active}</span>
              <span className="is-done">negative takes {view.takeCounts.negative}</span>
              {view.takeCounts.transition > 0 ? <span className="is-done">transitions {view.takeCounts.transition}</span> : null}
              <span className={model.status === 'READY' ? 'is-done' : model.status === 'LIMITED' ? 'is-current' : ''}>
                gate {model.status}
              </span>
              <span className={view.terms ? 'is-done' : ''}>{view.terms ? 'terms published' : 'terms pending'}</span>
            </div>
          </section>

          {modelArtifact ? (
            <>
              <section className="card stack">
                <div className="row row--between">
                  <div className="stack" style={{ gap: '0.25rem' }}>
                    <span className="eyebrow">Acoustic passport</span>
                    <h2 className="h3">The soundprint the renter sees.</h2>
                  </div>
                  <LinkButton to={`/passport/${objectId}`} variant="secondary">
                    Open public passport <Icon name="external" size={15} />
                  </LinkButton>
                </div>
                {modelArtifact.soundprint ? (
                  <>
                    <SoundprintBars soundprint={modelArtifact.soundprint} height={170} />
                    <div className="grid-3">
                      <div className="panel">
                        <span className="stat__label">Gate</span>
                        <div className="small" style={{ fontWeight: 600 }}>
                          {modelArtifact.soundprint.gateEnabled ? 'Enrolled · active' : 'Weak · disabled'}
                        </div>
                      </div>
                      <div className="panel">
                        <span className="stat__label">Match threshold</span>
                        <div className="small mono">{percent(modelArtifact.soundprint.matchThreshold)}</div>
                      </div>
                      <div className="panel">
                        <span className="stat__label">Active median</span>
                        <div className="small mono">{percent(modelArtifact.soundprint.activeMedianSimilarity)}</div>
                      </div>
                    </div>
                    <p className="tiny muted">
                      Fit on the calibration takes, not held out. A live active frame below the threshold is marked{' '}
                      <span className="mono">SOUNDPRINT_MISMATCH</span> and becomes UNCERTAIN, so it cannot add to the bill.
                      It can reduce billing; it cannot create a charge. Similar machines and playback remain limitations.
                    </p>
                  </>
                ) : (
                  <Notice tone="warn" title="No soundprint in this model.">
                    Retrain after recording active, idle and negative takes to enroll the acoustic passport.
                  </Notice>
                )}
              </section>

              <div className="grid-2">
                <section className="card stack">
                  <div className="row row--between">
                    <h2 className="h3">Held-out confusion</h2>
                    <span className="chip">{modelArtifact.metrics.totalTakeFrames} frames</span>
                  </div>
                  <ConfusionMatrix
                    matrix={modelArtifact.metrics.confusion}
                    labels={CLASS_LABELS_WORD.slice(0, modelArtifact.metrics.confusion[0]?.length ?? 3)}
                  />
                  <div className="grid-2" style={{ gap: '0.6rem' }}>
                    <div className="panel">
                      <span className="stat__label">Precision</span>
                      <div className="stat__value" style={{ fontSize: '1.4rem' }}>{percent(modelArtifact.metrics.precision)}</div>
                    </div>
                    <div className="panel">
                      <span className="stat__label">False billable</span>
                      <div className="stat__value" style={{ fontSize: '1.4rem' }}>{percent(modelArtifact.metrics.falseBillableRatio, 2)}</div>
                    </div>
                  </div>
                  <p className="tiny muted">
                    Precision = of all time billed as active, the fraction that was truly active. False billable time =
                    non-active time incorrectly billed, divided by all non-active time. Confusion counts come from
                    leave-one-take-out folds, so no frame is scored by a model that trained on its own take.
                  </p>
                </section>

                <section className="card stack">
                  <div className="row row--between">
                    <h2 className="h3">Against a dumb baseline</h2>
                    <span className="chip">RMS threshold</span>
                  </div>
                  <div className="table-wrap">
                    <table className="table" style={{ minWidth: 0 }}>
                      <thead>
                        <tr>
                          <th>Metric</th>
                          <th>Learned</th>
                          <th>RMS baseline</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Precision</td>
                          <td className="mono">{percent(modelArtifact.metrics.precision)}</td>
                          <td className="mono">{percent(modelArtifact.baseline.precision)}</td>
                        </tr>
                        <tr>
                          <td>Recall</td>
                          <td className="mono">{percent(modelArtifact.metrics.recall)}</td>
                          <td className="mono">{percent(modelArtifact.baseline.recall)}</td>
                        </tr>
                        <tr>
                          <td>False billable</td>
                          <td className="mono">{percent(modelArtifact.metrics.falseBillableRatio, 2)}</td>
                          <td className="mono">{percent(modelArtifact.baseline.falseBillableRatio, 2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="tiny muted">
                    The baseline is a tuned log-RMS threshold over the same frames. If it wins, that is reported — the
                    gate is not rigged for the classifier.
                  </p>
                  {modelArtifact.baseline.falseBillableRatio < modelArtifact.metrics.falseBillableRatio ? (
                    <Notice tone="warn">
                      The baseline had a lower false-billable ratio on this dataset. The learned model is still marked
                      by its own absolute gate, but this comparison is a real limitation.
                    </Notice>
                  ) : null}
                </section>
              </div>

              <section className="card stack">
                <div className="row row--between">
                  <h2 className="h3">What the model leans on</h2>
                  <span className="tiny muted">abs standardised weight, summed across classes</span>
                </div>
                <div className="stack" style={{ gap: '0.45rem' }}>
                  {[...modelArtifact.featureImportance]
                    .sort((a, b) => b.abs - a.abs)
                    .slice(0, 10)
                    .map((feature) => {
                      const max = Math.max(...modelArtifact.featureImportance.map((item) => item.abs)) || 1;
                      return (
                        <div key={feature.name} className="row" style={{ gap: '0.7rem' }}>
                          <span className="mono tiny" style={{ width: 190, flex: '0 0 auto' }}>
                            {feature.name}
                          </span>
                          <span style={{ flex: 1, height: 8, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                            <span
                              style={{
                                display: 'block',
                                height: '100%',
                                width: `${(feature.abs / max) * 100}%`,
                                background: 'var(--accent)',
                                borderRadius: 999,
                              }}
                            />
                          </span>
                        </div>
                      );
                    })}
                </div>
                <p className="tiny muted">
                  Feature weights are descriptive, not causal. Correlated acoustic cues can share weight arbitrarily.
                </p>
              </section>

              <section className="card stack">
                <div className="row row--between">
                  <div className="stack" style={{ gap: '0.25rem' }}>
                    <span className="eyebrow">Held-out validation</span>
                    <h2 className="h3">Does it generalise beyond the fitting takes?</h2>
                  </div>
                  <span className={`chip ${view.validationReport?.status === 'HELD_OUT_PASS' ? 'chip--ok' : view.validationReport?.status === 'HELD_OUT_FAIL' ? 'chip--danger' : 'chip--warn'}`}>
                    {view.validationReport?.status.replaceAll('_', ' ').toLowerCase() ?? 'not run'}
                  </span>
                </div>
                {view.validationReport ? (
                  <>
                    <div className="grid-4">
                      <Stat label="Held-out precision" value={percent(view.validationReport.precision)} tone="accent" />
                      <Stat label="Held-out recall" value={percent(view.validationReport.recall)} />
                      <Stat label="Held-out false billable" value={percent(view.validationReport.falseBillableRatio, 2)} />
                      <Stat label="Validation takes" value={view.validationReport.takeCount} />
                    </div>
                    <div className="table-wrap">
                      <table className="table" style={{ minWidth: 0 }}>
                        <thead><tr><th>Take</th><th>Label</th><th>Expected</th><th>Billable</th></tr></thead>
                        <tbody>
                          {view.validationReport.perTake.map((take) => (
                            <tr key={take.takeId}>
                              <td className="mono tiny">{take.takeId.slice(-8)}</td>
                              <td>{take.label}</td>
                              <td>{take.expectedActive ? 'running' : 'idle / negative'}</td>
                              <td className="mono">{percent(take.durationMs ? take.billableMs / take.durationMs : 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <ul className="small muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                      {view.validationReport.notes.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  </>
                ) : (
                  <Notice tone="warn" title="No held-out set was reserved.">
                    The main metrics are leave-one-take-out. To add an independent held-out check, label new takes as
                    “validation” in the capture lab and retrain. Validation takes are never used to fit the model.
                  </Notice>
                )}
              </section>

              <section className="card card--soft stack">
                <span className="eyebrow">Decision surface</span>
                <h2 className="h3">What would change this status?</h2>
                <ul className="checklist small">
                  <li><Icon name="arrow" size={15} /> <span>More distinct active and negative takes with the microphone in its rental position.</span></li>
                  <li><Icon name="arrow" size={15} /> <span>A held-out validation take that passes raises confidence; a failing one lowers it, not the reverse.</span></li>
                  <li><Icon name="arrow" size={15} /> <span>False billable time above 2% prevents automatic billing even when raw precision looks high.</span></li>
                  <li><Icon name="arrow" size={15} /> <span>Recalibrating after 90 days, a room change or repeated passport mismatches resets the drift signal.</span></li>
                </ul>
                <p className="tiny muted">
                  Model status is a policy decision over measured evidence, not a promise about a physical object. A
                  READY model can still be fooled by playback or a similar machine.
                </p>
              </section>

              <section className="card stack">
                <h2 className="h3">Limitations on the record</h2>
                <ul className="checklist checklist--x">
                  {modelArtifact.limitations.map((limitation) => (
                    <li key={limitation}>
                      <Icon name="alert" size={15} /> <span className="small">{limitation}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : null}

          <section className="card card--soft">
            <div className="row row--between">
              <div className="stack" style={{ gap: '0.25rem' }}>
                <h2 className="h3">Next: publish terms</h2>
                <p className="small muted">
                  {model.status === 'REJECTED'
                    ? 'A rejected model cannot be published. Record better takes and retrain.'
                    : model.status === 'LIMITED'
                      ? 'LIMITED models can be published, but every bill requires operator review before capture.'
                      : 'READY models bill automatically within the consented cap.'}
                </p>
              </div>
              <div className="row">
                <LinkButton to={`/studio/objects/${objectId}`} variant="secondary">
                  Retrain
                </LinkButton>
                <LinkButton
                  to={`/studio/objects/${objectId}/pricing`}
                  variant="primary"
                  className={model.status === 'REJECTED' ? 'is-disabled' : ''}
                >
                  Set pricing <Icon name="arrow" size={16} />
                </LinkButton>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
