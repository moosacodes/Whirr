import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AmbientCatalogView } from '../../../../packages/contracts/src/types.ts';
import type { CompiledAmbientAgreement } from '../../../../packages/ambient-engine/src/types.ts';
import type { Currency } from '../../../../packages/meter/src/currency.ts';
import { ApiError, api, errorMessage } from '../lib/api.ts';
import {
  Button,
  Check,
  Field,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { duration, money } from '../lib/format.ts';

const EXAMPLE =
  'I need 30 seconds without the reference desk fan running while I record a voiceover. I will pay $2.00.';

async function withBuyer<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await api('/api/auth/renter', { method: 'POST' });
      return call();
    }
    throw error;
  }
}

export function AmbientWish() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<AmbientCatalogView | null>(null);
  const [objectId, setObjectId] = useState('');
  const [text, setText] = useState(EXAMPLE);
  const [seconds, setSeconds] = useState('30');
  const [price, setPrice] = useState('2.00');
  const [compiled, setCompiled] = useState<CompiledAmbientAgreement | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  usePageTitle('State a wish');

  useEffect(() => {
    api<AmbientCatalogView>('/api/ambient')
      .then((value) => {
        setCatalog(value);
        setObjectId(value.sources[0]?.target.objectId ?? '');
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const object = useMemo(
    () => catalog?.sources.find((source) => source.target.objectId === objectId),
    [catalog, objectId],
  );

  const compile = async () => {
    if (!objectId) {
      setError('Choose an enrolled object first.');
      return;
    }
    setBusy(true);
    setError(null);
    setApproved(false);
    try {
      const value = await withBuyer(() =>
        api<CompiledAmbientAgreement>('/api/ambient/compile', {
          method: 'POST',
          body: {
            objectId,
            text,
            durationSeconds: Number(seconds),
            fixedPriceMinor: Math.round(Number(price) * 100),
            currency: 'USD' satisfies Currency,
          },
        }),
      );
      setCompiled(value);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const offer = async () => {
    if (!compiled || !approved) return;
    setBusy(true);
    setError(null);
    try {
      const view = await withBuyer(() =>
        api<{ id: string }>('/api/ambient/agreements', {
          method: 'POST',
          body: { terms: compiled.terms, termsHash: compiled.hash, approved: true },
        }),
      );
      navigate(`/ambient/exchange/${view.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page ambient-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow="The Wish · Whirr Ambient"
          title="Say what the world should do."
          lede="Start with the physical outcome you need. Whirr will narrow it to a condition a microphone and an enrolled model can actually observe — and will refuse claims it cannot measure."
          actions={
            <LinkButton to="/ambient" variant="ghost">
              Ambient overview
            </LinkButton>
          }
        />

        {error ? <Notice tone="danger">{error}</Notice> : null}

        {!catalog ? (
          <Loading label="Finding enrolled physical sources…" />
        ) : catalog.sources.length === 0 ? (
          <Notice tone="warn" title="No published source is ready.">
            An operator must publish an object that has a current READY event model before it can be a Wish source.
            Run <span className="mono">npm run setup</span> and <span className="mono">npm run seed:ambient</span> to
            install the synthetic Quiet Window reference.
          </Notice>
        ) : (
          <div className="wish-layout">
            <section className="card wish-form stack">
              <div className="row row--between">
                <div>
                  <span className="eyebrow">01 · Intention</span>
                  <h2 className="h2">What do you need?</h2>
                </div>
                <span className="chip chip--warn">bounded grammar</span>
              </div>
              <Field
                label="Enrolled source"
                htmlFor="ambient-object"
                hint="The agreement binds this exact object and its current model digest. A similar sound is not an identity."
              >
                <Select id="ambient-object" value={objectId} onChange={(event) => setObjectId(event.target.value)}>
                  {catalog.sources.map((source) => (
                    <option key={source.target.objectId} value={source.target.objectId}>
                      {source.target.objectName} · {source.model.status} · {source.model.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic reference' : 'local calibration'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="The wish"
                htmlFor="ambient-text"
                hint="Describe a pause, quiet window or recording need. Include the duration and a fixed offer if you have one."
              >
                <TextArea
                  id="ambient-text"
                  rows={5}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setCompiled(null);
                    setApproved(false);
                  }}
                  placeholder={EXAMPLE}
                />
              </Field>
              <div className="row ambient-example-row">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setText(EXAMPLE);
                    setCompiled(null);
                    setApproved(false);
                  }}
                >
                  Use the Quiet Window example
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setText('Make the whole room completely silent and temperature controlled for 30 seconds. I will pay $2.');
                    setCompiled(null);
                    setApproved(false);
                  }}
                >
                  Try an unsupported claim
                </Button>
              </div>
              <div className="inline-fields">
                <Field label="Requested seconds" htmlFor="ambient-seconds">
                  <TextInput
                    id="ambient-seconds"
                    type="number"
                    min={10}
                    max={120}
                    value={seconds}
                    onChange={(event) => {
                      setSeconds(event.target.value);
                      setCompiled(null);
                      setApproved(false);
                    }}
                  />
                </Field>
                <Field label="Fixed offer (USD)" htmlFor="ambient-price">
                  <TextInput
                    id="ambient-price"
                    type="number"
                    min={0.01}
                    max={100}
                    step="0.01"
                    value={price}
                    onChange={(event) => {
                      setPrice(event.target.value);
                      setCompiled(null);
                      setApproved(false);
                    }}
                  />
                </Field>
              </div>
              <div className="row">
                <Button variant="primary" onClick={() => void compile()} loading={busy} disabled={!objectId}>
                  Translate the wish <Icon name="arrow" size={16} />
                </Button>
                {object ? (
                  <span className="tiny muted">
                    Bound to <strong>{object.target.objectName}</strong> · {object.model.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic model' : 'local calibration'} · published source
                  </span>
                ) : null}
              </div>
              <p className="tiny muted">
                The compiler is deterministic and local. It does not use a paid language model, and it will not
                silently reinterpret “silence” as a certified sound-level measurement.
              </p>
            </section>

            <aside className="stack">
              {compiled ? (
                <section className={`card wish-result stack ${compiled.executable ? 'wish-result--ok' : 'wish-result--blocked'}`}>
                  <div className="row row--between">
                    <div>
                      <span className="eyebrow">02 · Measurable interpretation</span>
                      <h2 className="h2">{compiled.executable ? 'This is what Whirr can observe.' : 'This wish cannot be executed as stated.'}</h2>
                    </div>
                    <span className={`chip ${compiled.executable ? 'chip--ok' : 'chip--danger'}`}>
                      {compiled.executable ? 'executable' : 'blocked'}
                    </span>
                  </div>

                  <div className="wish-interpretation">
                    <div>
                      <span className="tiny muted">You asked for</span>
                      <p>{compiled.interpretation.requestedText}</p>
                    </div>
                    <div>
                      <span className="tiny muted">Desired condition</span>
                      <p>{compiled.interpretation.desiredCondition}</p>
                    </div>
                    <div className="wish-interpretation__observable">
                      <span className="tiny muted">Observable condition</span>
                      <p>{compiled.interpretation.observableCondition}</p>
                    </div>
                  </div>

                  {compiled.issues.length > 0 ? (
                    <div className="stack" style={{ gap: '0.5rem' }}>
                      {compiled.issues.map((issue) => (
                        <Notice key={`${issue.code}-${issue.message}`} tone={issue.severity === 'ERROR' ? 'danger' : 'warn'} title={issue.code}>
                          {issue.message}
                        </Notice>
                      ))}
                    </div>
                  ) : null}

                  {compiled.interpretation.unsupportedClaims.length > 0 ? (
                    <div className="wish-unsupported">
                      <span className="eyebrow">Refused claims</span>
                      <ul>
                        {compiled.interpretation.unsupportedClaims.map((claim) => (
                          <li key={claim}>{claim}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="terms-sheet">
                    <div><span>Target</span><strong>{compiled.interpretation.target.objectName}</strong></div>
                    <div><span>Required inactivity</span><strong>{duration(compiled.terms.condition.requiredInactiveMs)}</strong></div>
                    <div><span>Active baseline</span><strong>{duration(compiled.terms.condition.requiredBaselineActiveMs)}</strong></div>
                    <div><span>Confidence floor</span><strong>{compiled.terms.condition.confidenceFloor.toFixed(2)}</strong></div>
                    <div><span>Evidence gap limit</span><strong>{compiled.terms.condition.maxObservationGapMs}ms</strong></div>
                    <div><span>Offer</span><strong>{money(compiled.terms.financial.fixedPriceMinor, compiled.terms.financial.currency)}</strong></div>
                    <div><span>Maximum charge</span><strong>{money(compiled.terms.financial.maximumChargeMinor, compiled.terms.financial.currency)}</strong></div>
                    <div><span>Interruption</span><strong>Reset the window</strong></div>
                    <div><span>Uncertainty / sensor loss</span><strong>No capture</strong></div>
                    <div><span>Buyer acceptance</span><strong>Required before capture</strong></div>
                  </div>

                  <div className="notice notice--info">
                    <div>
                      {compiled.interpretation.proxyDisclosure}
                    </div>
                  </div>
                  <details className="details">
                    <summary>Assumptions and model limitations</summary>
                    <ul className="checklist">
                      {[...compiled.interpretation.assumptions, ...compiled.interpretation.limitations].map((line) => (
                        <li key={line}><Icon name="info" size={14} /><span className="tiny">{line}</span></li>
                      ))}
                    </ul>
                  </details>

                  {compiled.executable ? (
                    <>
                      <Check checked={approved} onChange={setApproved}>
                        I read the measurable interpretation, the exact price, the reset and no-capture rules. Send this
                        immutable offer to the provider.
                      </Check>
                      <Button variant="money" size="lg" disabled={!approved} loading={busy} onClick={() => void offer()}>
                        Send this exact offer <Icon name="arrow" size={16} />
                      </Button>
                      <p className="tiny muted">
                        No PayPal order exists yet. The provider must accept or counter first, and this buyer must
                        approve the final terms before any authorization.
                      </p>
                    </>
                  ) : (
                    <p className="small muted">
                      Narrow the request to the enrolled source remaining undetected for a continuous window. Whirr
                      cannot validate whole-room silence, safety, power consumption, or legal compliance.
                    </p>
                  )}
                </section>
              ) : (
                <section className="card card--dark wish-aside stack">
                  <span className="eyebrow" style={{ color: 'rgba(245,238,228,.55)' }}>The measurable move</span>
                  <ObjectGlyph glyph={object?.target.glyph ?? 'fan'} tone="dark" />
                  <h2 className="h2">A wish becomes a rule.</h2>
                  <p className="small" style={{ color: 'rgba(245,238,228,.72)' }}>
                    Whirr will propose a source, a baseline, a continuous interval and a confidence floor. You will see
                    exactly what can be inferred — and what remains outside the sensor’s reach.
                  </p>
                  <div className="wish-aside__list">
                    <span><i className="status-dot status-dot--ok" /> active baseline required</span>
                    <span><i className="status-dot" /> interruption resets the window</span>
                    <span><i className="status-dot status-dot--danger" /> no signal is not proof</span>
                  </div>
                </section>
              )}

              <section className="card stack">
                <span className="eyebrow">Why this is not a chatbot</span>
                <p className="small muted">
                  The result is not a conversation transcript. It is a typed, reviewed agreement with a hash. Changing
                  the duration, source, sensing rule or price creates a new revision that both parties must approve.
                </p>
                <p className="tiny muted">
                  The model can recognize learned acoustic states; it cannot authenticate a machine or certify that a
                  room was silent.
                </p>
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
