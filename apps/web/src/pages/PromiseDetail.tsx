import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { AgreementView, PromiseExecutionView } from '../../../../packages/contracts/src/types.ts';
import {
  Button,
  Check,
  Field,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  SandboxBanner,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { money } from '../lib/format.ts';
import { useAuth } from '../lib/auth.tsx';

export function PromiseDetail() {
  const { agreementId = '' } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const paypalReady = Boolean(session?.paypal.configured);
  const [agreement, setAgreement] = useState<AgreementView | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  usePageTitle(agreement?.serviceName ?? 'Physical promise');

  useEffect(() => {
    api<AgreementView>(`/api/promises/${agreementId}`)
      .then(setAgreement)
      .catch((err) => setError(errorMessage(err)));
  }, [agreementId]);

  useEffect(() => {
    if (!paypalReady) setDemo(true);
  }, [paypalReady]);

  if (!agreement) {
    return (
      <div className="page">
        <div className="container">
          {error ? <Notice tone="danger">{error}</Notice> : <Loading label="Loading the agreement…" />}
        </div>
      </div>
    );
  }

  const expired = Date.parse(agreement.expiresAt) <= Date.now();
  const create = async () => {
    if (!accepted) return;
    setBusy(true);
    setError(null);
    try {
      const execution = await api<PromiseExecutionView>(`/api/promises/${agreement.id}/executions`, {
        method: 'POST',
        body: { termsHash: agreement.termsHash, accepted: true, demo, observationMode: 'LIVE' },
      });
      navigate(`/promise/run/${execution.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page promise-page">
      <div className="container stack stack--lg">
        <PageHeader
          eyebrow="Physical promise"
          title={agreement.serviceName}
          lede={`A fixed-price agreement for ${agreement.object.name}. The machine must demonstrate the exact observable sequence before any capture can be requested.`}
          breadcrumbs={
            <>
              <Link to="/promise">Promises</Link> <span aria-hidden="true">/</span> {agreement.object.name}
            </>
          }
          actions={
            <span className={`chip ${agreement.eventModel.provenance === 'SYNTHETIC_REFERENCE' ? 'chip--warn' : 'chip--ok'}`}>
              {agreement.eventModel.provenance === 'SYNTHETIC_REFERENCE' ? 'SYNTHETIC MODEL' : 'LOCALLY TAUGHT'}
            </span>
          }
        />

        {error ? <Notice tone="danger">{error}</Notice> : null}
        <SandboxBanner configured={paypalReady} />

        <div className="promise-layout">
          <section className="card promise-agreement">
            <div className="promise-agreement__head">
              <div className="row">
                <ObjectGlyph glyph={agreement.object.glyph} />
                <div>
                  <span className="eyebrow">Agreement</span>
                  <h2 className="h2">{agreement.serviceName}</h2>
                </div>
              </div>
              <div className="promise-price">
                <span className="promise-price__amount">{money(agreement.terms.financial.fixedPriceMinor, agreement.terms.financial.currency)}</span>
                <span className="tiny muted">fixed price · maximum charge</span>
              </div>
            </div>

            <div className="promise-sequence" aria-label="Required physical sequence">
              {agreement.terms.requiredSequence.map((stage, index) => (
                <div className="promise-sequence__stage" key={stage}>
                  <span className="mono">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{stage.replaceAll('_', ' ')}</strong>
                  {index === 3 ? <span className="tiny muted">inferred from return to idle</span> : null}
                </div>
              ))}
            </div>

            <div className="promise-terms-grid">
              <div>
                <span className="eyebrow">Qualifies</span>
                <ul className="promise-rules">
                  <li>Idle baseline of at least 1 second.</li>
                  <li>One sustained run of {(agreement.terms.constraints.minRunMs / 1000).toFixed(1)} to {(agreement.terms.constraints.maxRunMs / 1000).toFixed(1)} seconds.</li>
                  <li>Return to confident idle after the run.</li>
                  <li>Confidence at or above {agreement.terms.constraints.confidenceFloor.toFixed(2)} with no disqualifying quality flags.</li>
                  <li>No sensor loss, no uncertain interval, and no second cycle.</li>
                </ul>
              </div>
              <div>
                <span className="eyebrow">Does not qualify</span>
                <ul className="promise-rules promise-rules--warn">
                  <li>Stopping before the minimum duration.</li>
                  <li>Restarting or starting a second cycle.</li>
                  <li>Microphone disconnection or uncertain evidence.</li>
                  <li>An expired authorization or a superseded event model.</li>
                </ul>
              </div>
            </div>

            <div className="notice notice--info">
              <span className="notice__icon" aria-hidden="true"><Icon name="shield" size={17} /></span>
              <div>
                <strong>No automatic charge.</strong> A qualifying observation only makes capture eligible. Whirr
                re-evaluates the evidence at capture time and requests the exact fixed price within the authorized
                ceiling. An incomplete or uncertain attempt stays uncaptured.
              </div>
            </div>

            <details className="promise-details">
              <summary>Inspect the exact compiled terms</summary>
              <pre className="proof-json">{JSON.stringify(agreement.terms, null, 2)}</pre>
            </details>
          </section>

          <aside className="stack">
            <section className="card stack">
              <div>
                <span className="eyebrow">Buyer approval</span>
                <h2 className="h3">Decide before you begin</h2>
              </div>
              <div className="promise-mode">
                <button
                  type="button"
                  className={`promise-mode__option${demo ? ' is-selected' : ''}`}
                  onClick={() => setDemo(true)}
                >
                  <strong>Demo observation</strong>
                  <span className="small muted">No PayPal order. No authorization. No capture. Clearly labelled.</span>
                </button>
                <button
                  type="button"
                  className={`promise-mode__option${!demo ? ' is-selected' : ''}`}
                  onClick={() => setDemo(false)}
                  disabled={!paypalReady}
                >
                  <strong>PayPal Sandbox settlement</strong>
                  <span className="small muted">
                    {paypalReady
                      ? 'Approve the fixed-price ceiling in PayPal before the live observation.'
                      : 'PayPal Sandbox is not configured on this installation. Use a demo observation.'}
                  </span>
                </button>
              </div>
              {!demo && !agreement ? null : (
                <p className="tiny muted">
                  {demo
                    ? 'Demo mode is useful for judging the interaction. It cannot produce a provider capture.'
                    : 'The authorization may temporarily hold Sandbox funds. Whirr only captures after the exact contract qualifies. Sandbox only; no real money.'}
                </p>
              )}
              <Field label="Explicit consent">
                <Check checked={accepted} onChange={setAccepted}>
                  I understand what qualifies, what does not, the maximum charge, and that uncertain or interrupted
                  evidence will not be captured.
                </Check>
              </Field>
              <Button variant="money" block loading={busy} disabled={!accepted || expired || (!demo && !paypalReady)} onClick={() => void create()}>
                {expired ? 'Agreement expired' : demo ? 'Begin demo observation' : 'Continue to PayPal approval'}
              </Button>
              <p className="tiny muted">
                Agreement digest: <span className="mono">{agreement.termsHash.slice(0, 24)}…</span>
              </p>
            </section>

            <section className="card stack">
              <span className="eyebrow">Learned model</span>
              <h2 className="h3">{agreement.eventModel.version}</h2>
              <div className="promise-metrics">
                <div><span className="mono">{(agreement.eventModel.metrics.macroRecall * 100).toFixed(1)}%</span><span className="tiny muted">macro recall</span></div>
                <div><span className="mono">{(agreement.eventModel.metrics.unknownRate * 100).toFixed(1)}%</span><span className="tiny muted">unknown refusal</span></div>
                <div><span className="mono">{agreement.eventModel.takeCount}</span><span className="tiny muted">demonstration takes</span></div>
              </div>
              <p className="small muted">
                {agreement.eventModel.limitations[1] ?? 'The model only recognizes the acoustic vocabulary it was taught.'}
              </p>
              <LinkButton to={`/promise/${agreement.id}/model`} variant="ghost">
                Inspect model card
              </LinkButton>
            </section>

            <section className="card stack">
              <span className="eyebrow">Trust boundary</span>
              <p className="small muted">
                The browser reports microphone observations. The server binds them, replays the contract, and signs a
                portable proof. A signature proves installation integrity, not microphone honesty or physical success.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
