import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { PassportView } from '../../../../packages/contracts/src/types.ts';
import {
  CopyButton,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph, SignatureSeal, SoundprintBars } from '../components/visuals.tsx';
import { PassportProbe } from '../components/PassportProbe.tsx';
import { dateTime, percent } from '../lib/format.ts';
import { formatMinor } from '../../../../packages/meter/src/currency.ts';

function statusCopy(view: PassportView): {
  label: string;
  tone: 'ok' | 'warn' | 'danger';
  detail: string;
} {
  const soundprint = view.soundprint;
  if (!soundprint) {
    return {
      label: 'Not enrolled',
      tone: 'warn',
      detail: 'This model predates the acoustic passport, or it could not build one from its takes.',
    };
  }
  if (soundprint.gateEnabled) {
    return {
      label: 'Identity gate active',
      tone: 'ok',
      detail: 'A confidently active frame that falls outside the enrolled spectral profile becomes uncertain and free.',
    };
  }
  return {
    label: 'Passport weak',
    tone: 'danger',
    detail: 'The calibration did not separate active and non-active profiles safely, so the identity gate is disabled rather than guessed.',
  };
}

export function Passport() {
  const { objectId = '' } = useParams();
  const [view, setView] = useState<PassportView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<PassportView>(`/api/passport/${objectId}`)
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [objectId]);

  usePageTitle(view ? `${view.object.name} acoustic passport` : 'Acoustic passport');

  if (loading) return <Loading label="Reading the acoustic passport…" />;
  if (!view) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger" title="Passport unavailable.">
          {error ?? 'This object has no enrolled model.'}
        </Notice>
        <div style={{ marginTop: 12 }}>
          <LinkButton to="/" variant="secondary">
            Back to Whirr
          </LinkButton>
        </div>
      </div>
    );
  }

  const { object, model, soundprint, terms } = view;
  const status = statusCopy(view);
  const modelTone = model.status === 'READY' ? 'ok' : model.status === 'LIMITED' ? 'warn' : 'danger';
  const serviceLive = Boolean(terms) && object.status === 'ACTIVE' && model.status !== 'REJECTED';
  const signed = view.signedPassport;
  const driftTone =
    view.drift.status === 'FRESH' ? 'fresh' : view.drift.status === 'DRIFT_SUSPECTED' ? 'suspected' : 'overdue';

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Acoustic passport"
        breadcrumbs={
          <>
            <Link to="/">Whirr</Link> <span aria-hidden="true">/</span>{' '}
            <Link to={`/s/${object.id}`}>{object.name}</Link> <span aria-hidden="true">/</span>{' '}
            <span>Passport</span>
          </>
        }
        title={
          <span className="row" style={{ gap: '0.8rem' }}>
            <ObjectGlyph glyph={object.glyph} size={54} tone="accent" /> {object.name}
          </span>
        }
        lede="The object’s public acoustic identity: what the operator taught the meter, how it separates use from the room, and what the identity gate can — and cannot — prove."
        actions={
          <>
            <CopyButton value={view.shareUrl} label="Copy service link" />
            <a className="btn btn--secondary" href={`/api/passport/${object.id}/proof`} download>
              <Icon name="download" size={15} /> Signed passport
            </a>
            <LinkButton to="/verify" variant="ghost">Verify offline</LinkButton>
            <LinkButton to={`/s/${object.id}`} variant="primary">
              {serviceLive ? 'Open service card' : 'View service card'} <Icon name="arrow" size={16} />
            </LinkButton>
          </>
        }
      />

      <div className="stack-lg">
        <section className="passport-hero">
          <div className="passport-hero__top">
            <div className="stack" style={{ gap: '0.45rem' }}>
              <span className="eyebrow" style={{ color: 'rgba(245,238,228,.58)' }}>
                Whirr acoustic passport · {model.version}
              </span>
              <h1 className="display" style={{ fontSize: 'clamp(2.4rem, 5vw, 4.2rem)' }}>
                {object.name}
              </h1>
              <p className="small" style={{ color: 'rgba(245,238,228,.66)' }}>
                {object.ownerLabel} · {object.category.replaceAll('_', ' ')} · {view.sessionCount} recorded session
                {view.sessionCount === 1 ? '' : 's'}
              </p>
            </div>
            <div className={`passport-stamp passport-stamp--${status.tone}`}>
              <span className="passport-stamp__ring" aria-hidden="true" />
              <span className="passport-stamp__label">{status.label}</span>
              <strong>{soundprint?.gateEnabled ? percent(soundprint.activeMedianSimilarity) : '—'}</strong>
              <span className="passport-stamp__sub">
                {soundprint?.gateEnabled ? 'calibration match' : 'no active gate'}
              </span>
            </div>
          </div>

          <div className="passport-hero__print">
            <div className="row row--between">
              <span className="eyebrow" style={{ color: 'rgba(245,238,228,.58)' }}>
                Spectral profile
              </span>
              <span className="tiny mono" style={{ color: 'rgba(245,238,228,.48)' }}>
                <span className="passport-legend passport-legend--active" /> active{' '}
                <span className="passport-legend passport-legend--idle" /> idle / negative
              </span>
            </div>
            {soundprint ? (
              <SoundprintBars soundprint={soundprint} dark height={190} />
            ) : (
              <div className="passport-empty">
                No soundprint was enrolled. Retrain with at least two idle, two active and one negative take.
              </div>
            )}
          </div>

          <div className="passport-hero__facts">
            <div>
              <span>Model status</span>
              <strong>
                <span className={`chip chip--${modelTone}`}>{model.status}</span>
              </strong>
            </div>
            <div>
              <span>Calibration takes</span>
              <strong>{model.metrics.takeCount}</strong>
            </div>
            <div>
              <span>Model precision</span>
              <strong>{percent(model.metrics.precision)}</strong>
            </div>
            <div>
              <span>Last calibrated</span>
              <strong>{dateTime(model.createdAt)}</strong>
            </div>
          </div>
        </section>

        <section className="card stack">
          <div className="row row--between">
            <div className="stack" style={{ gap: '0.25rem' }}>
              <span className="eyebrow">Portable proof</span>
              <h2 className="h3">This edition is installation-signed.</h2>
            </div>
            <span className={`chip ${signed ? 'chip--ok' : 'chip--warn'}`}>
              {signed ? `passport v${signed.payload.passportVersion}` : 'legacy — not signed'}
            </span>
          </div>
          <div className="row" style={{ alignItems: 'flex-start', gap: '1.4rem', flexWrap: 'wrap' }}>
            <SignatureSeal signed={Boolean(signed)} keyId={signed?.keyId ?? null} />
            <div className="stack" style={{ gap: '0.55rem', flex: 1, minWidth: 230 }}>
              <p className="small muted" style={{ margin: 0 }}>
                {signed
                  ? 'The downloadable JSON contains the full passport payload and its ECDSA P-256 signature. Keep it as a portable artifact: it verifies without this server and without a login.'
                  : 'This installation predates signed passports. The public evidence remains readable, but it is explicitly not presented as signed.'}
              </p>
              <div className="row">
                <span className={`chip drift-chip--${driftTone}`}>{view.drift.status.replaceAll('_', ' ')}</span>
                <span className="chip">{view.validation ? view.validation.status.replaceAll('_', ' ').toLowerCase() : 'no held-out check'}</span>
                <span className="chip">{view.passportHistory.length} edition(s)</span>
              </div>
              <p className="tiny muted" style={{ margin: 0 }}>{view.drift.reason}</p>
              <dl className="kv">
                <dt>Key fingerprint</dt>
                <dd className="mono tiny break">{signed?.keyId ?? '—'}</dd>
                <dt>Previous passport</dt>
                <dd className="mono tiny break">{signed?.payload.previousPassportHash ?? 'genesis'}</dd>
                <dt>Attestation</dt>
                <dd className="tiny">installation signature, not third-party identity or trusted time</dd>
              </dl>
            </div>
          </div>
        </section>

        <section className="card stack">
          <div className="row row--between">
            <div className="stack" style={{ gap: '0.25rem' }}>
              <span className="eyebrow">Trust boundaries</span>
              <h2 className="h3">Three claims, three different kinds of evidence.</h2>
            </div>
            <span className="chip">read this before relying on a proof</span>
          </div>
          <div className="passport-grid">
            <div className="stack" style={{ gap: '0.4rem' }}>
              <span className="chip chip--ok">Integrity</span>
              <strong>Signature and history can be checked offline.</strong>
              <p className="small muted" style={{ margin: 0 }}>
                The passport and bundle signatures cover their payloads, and the bundle’s Merkle root covers its
                interval ledger. Without a pinned key fingerprint, the installation key is self-attested; pinning
                detects key substitution, not who owns the key.
              </p>
            </div>
            <div className="stack" style={{ gap: '0.4rem' }}>
              <span className="chip chip--warn">Sensing</span>
              <strong>Capture provenance is signed client testimony.</strong>
              <p className="small muted" style={{ margin: 0 }}>
                Model pins, calibration hashes, interval evidence and the declared capture source travel with the
                proof. A live-microphone claim is reported by the client; it is not physical proof, anti-spoofing or
                a guarantee that the room contained only this object.
              </p>
            </div>
            <div className="stack" style={{ gap: '0.4rem' }}>
              <span className="chip chip--warn">Payment</span>
              <strong>Offline verification cannot query PayPal.</strong>
              <p className="small muted" style={{ margin: 0 }}>
                A session bundle records payment references and the last observed provider state, but only an
                online reconciliation can claim current provider confirmation. The passport itself makes no payment
                claim.
              </p>
            </div>
          </div>
        </section>

        <PassportProbe soundprint={soundprint} objectName={object.name} />

        <section className="card stack">
          <div className="row row--between">
            <div className="stack" style={{ gap: '0.25rem' }}>
              <span className="eyebrow">Object autobiography</span>
              <h2 className="h3">Stamps accumulate. Audio does not.</h2>
            </div>
            <span className="chip chip--ok">aggregate only · no renter PII</span>
          </div>
          <div className="passport-stamp-row">
            {view.stamps.map((stamp) => (
              <div className="passport-stamp-card" key={stamp.id}>
                <span className="passport-stamp-card__kind">{stamp.kind}</span>
                <strong>{stamp.label}</strong>
                <p>{stamp.detail}</p>
                {stamp.hash ? <code className="mono tiny break">{stamp.hash.slice(0, 28)}…</code> : null}
              </div>
            ))}
          </div>
        </section>

        <div className="passport-grid">
          <section className="card stack">
            <div className="row row--between">
              <div className="stack" style={{ gap: '0.25rem' }}>
                <span className="eyebrow">The identity gate</span>
                <h2 className="h2">It must sound like this object.</h2>
              </div>
              <span className={`chip chip--${status.tone}`}>
                <span className="chip__dot" /> {status.label}
              </span>
            </div>
            <p className="small muted">{status.detail}</p>
            {soundprint ? (
              <>
                <div className="passport-threshold">
                  <div>
                    <span className="stat__label">Live match threshold</span>
                    <strong>{percent(soundprint.matchThreshold)}</strong>
                  </div>
                  <div>
                    <span className="stat__label">Active calibration median</span>
                    <strong>{percent(soundprint.activeMedianSimilarity)}</strong>
                  </div>
                  <div>
                    <span className="stat__label">Idle / negative ceiling</span>
                    <strong>{percent(soundprint.nonActiveP95Similarity)}</strong>
                  </div>
                </div>
                <div className="passport-gate-flow">
                  <span>active frame</span>
                  <Icon name="arrow" size={16} />
                  <span>band profile</span>
                  <Icon name="arrow" size={16} />
                  <span className={soundprint.gateEnabled ? 'is-gate' : ''}>
                    cosine ≥ {percent(soundprint.matchThreshold)}
                  </span>
                  <Icon name="arrow" size={16} />
                  <span>{soundprint.gateEnabled ? 'billable' : 'uncertain'}</span>
                </div>
                <p className="tiny muted">
                  {soundprint.gateEnabled
                    ? `On the calibration set, this gate would have blocked ${percent(soundprint.activeBlockRatio, 2)} of active frames and passed ${percent(soundprint.nonActivePassRatio, 2)} of non-active frames. It only lowers the bill: a mismatch becomes UNCERTAIN, never ACTIVE.`
                    : 'Because the two profiles overlap too much, the gate is off. Whirr still uses the activity classifier and excludes uncertainty, but it does not claim an identity check.'}
                </p>
              </>
            ) : (
              <Notice tone="warn" title="No identity gate on this model.">
                The service can still meter activity with its classifier, but it cannot show a calibrated soundprint until it
                is retrained.
              </Notice>
            )}
          </section>

          <aside className="stack">
            <section className="card stack">
              <span className="eyebrow">What you are looking at</span>
              <h2 className="h3">A fingerprint made of bands, not audio.</h2>
              <p className="small muted">
                Each bar is one octave-ish band from 50 Hz to 7.8 kHz. The solid bar is the average spectral shape of the
                object running; the outlined bar is the room and negative sounds. Raw audio never leaves the browser.
              </p>
              <div className="passport-key">
                <span><i className="passport-key__swatch passport-key__swatch--active" /> Active profile</span>
                <span><i className="passport-key__swatch passport-key__swatch--idle" /> Idle / negative profile</span>
              </div>
              <p className="tiny muted">
                The threshold is intentionally conservative. A low similarity is a reason to stop billing, not a reason to
                accuse a renter of tampering.
              </p>
            </section>

            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Service terms</h2>
                {terms ? <span className="chip chip--ok">published</span> : <span className="chip">not published</span>}
              </div>
              {terms ? (
                <dl className="kv">
                  <dt>Rate</dt>
                  <dd>{formatMinor(terms.minorPerMinute, terms.currency)} / billable min</dd>
                  <dt>Hard cap</dt>
                  <dd>{formatMinor(terms.capMinor, terms.currency)}</dd>
                  <dt>Uncertain</dt>
                  <dd>excluded</dd>
                </dl>
              ) : (
                <p className="small muted">The model exists, but no public price terms have been published yet.</p>
              )}
              <LinkButton to={`/s/${object.id}`} variant={serviceLive ? 'primary' : 'secondary'} block>
                {serviceLive ? 'Open service card' : 'Open preview'}
              </LinkButton>
            </section>
          </aside>
        </div>

        <div className="grid-2">
          <section className="card stack">
            <span className="eyebrow">Calibration provenance</span>
            <h2 className="h3">What was recorded</h2>
            <div className="grid-3">
              <div className="panel">
                <span className="stat__label">Takes</span>
                <div className="big-number" style={{ fontSize: '1.8rem' }}>{model.metrics.takeCount}</div>
              </div>
              <div className="panel">
                <span className="stat__label">Frames</span>
                <div className="big-number" style={{ fontSize: '1.8rem' }}>{model.metrics.frameCount}</div>
              </div>
              <div className="panel">
                <span className="stat__label">Held-out recall</span>
                <div className="big-number" style={{ fontSize: '1.8rem' }}>{percent(model.metrics.recall)}</div>
              </div>
            </div>
            <dl className="kv">
              <dt>Provenance</dt>
              <dd>{model.metrics.provenance === 'SYNTHETIC_REFERENCE' ? 'synthetic reference' : 'operator calibration'}</dd>
              <dt>Method</dt>
              <dd className="mono">{model.metrics.method.replaceAll('_', ' ').toLowerCase()}</dd>
              <dt>Dataset</dt>
              <dd className="mono tiny break">{model.datasetHash}</dd>
              <dt>Last session</dt>
              <dd>{dateTime(view.lastSessionAt)}</dd>
            </dl>
            {model.metrics.provenance === 'SYNTHETIC_REFERENCE' ? (
              <Notice tone="warn">
                This passport belongs to a synthetic demo model. It demonstrates the mechanism; it is not evidence of
                accuracy on a physical object.
              </Notice>
            ) : null}
          </section>

          <section className="card stack">
            <span className="eyebrow">The honest boundary</span>
            <h2 className="h3">What the passport does not prove</h2>
            <ul className="checklist checklist--x">
              <li>
                <Icon name="alert" size={15} /> <span className="small">It does not prove the object is physically present or switched on; it measures sound.</span>
              </li>
              <li>
                <Icon name="alert" size={15} /> <span className="small">A similar or identical machine can share the same spectral profile.</span>
              </li>
              <li>
                <Icon name="alert" size={15} /> <span className="small">A microphone cannot detect playback of a recording of the object.</span>
              </li>
              <li>
                <Icon name="alert" size={15} /> <span className="small">The gate is fit on calibration takes, not held out; the model metrics remain the held-out evidence.</span>
              </li>
              <li>
                <Icon name="alert" size={15} /> <span className="small">It is a billing fairness mechanism, not a lock, identity document or security system.</span>
              </li>
            </ul>
            <p className="tiny muted">
              That boundary is deliberate. Whirr refuses to turn an acoustic guess into a bill or a security claim.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
