import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { OwnerObjectView } from '../../../../packages/contracts/src/types.ts';
import { makeQrDataUrl } from '../lib/qr.ts';
import {
  Button,
  CopyButton,
  EmptyState,
  LinkButton,
  Loading,
  Notice,
  PageHeader,
  usePageTitle,
} from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { formatMinor } from '../../../../packages/meter/src/currency.ts';
import { money } from '../lib/format.ts';

export function ServiceCardPage() {
  const { objectId = '' } = useParams();
  const [view, setView] = useState<OwnerObjectView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shelfBusy, setShelfBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api<OwnerObjectView>(`/api/operator/objects/${objectId}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shareUrl = view?.shareUrl ?? '';

  useEffect(() => {
    if (!shareUrl) {
      setQr(null);
      return;
    }
    makeQrDataUrl(shareUrl)
      .then(setQr)
      .catch(() => setQr(null));
  }, [shareUrl]);

  usePageTitle(view ? `${view.object.name} service card` : 'Service card');

  const toggleRevoked = async () => {
    if (!view) return;
    const revoke = view.object.status === 'ACTIVE';
    if (revoke && !window.confirm('Revoke this service card? New sessions will be blocked immediately. Existing sessions are unaffected.')) {
      return;
    }
    setBusy(true);
    try {
      setView(
        await api<OwnerObjectView>(`/api/operator/objects/${objectId}/revoke`, {
          method: 'POST',
          body: { revoked: revoke },
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleShelf = async () => {
    if (!view) return;
    setShelfBusy(true);
    setError(null);
    try {
      setView(
        await api<OwnerObjectView>(`/api/operator/objects/${objectId}/shelf`, {
          method: 'POST',
          body: { listed: !view.shelfListed },
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setShelfBusy(false);
    }
  };

  if (loading) return <Loading label="Opening service card…" />;
  if (!view) {
    return (
      <div className="page container page--narrow">
        <Notice tone="danger">{error ?? 'Object not found.'}</Notice>
      </div>
    );
  }

  const { object, activeModel, terms } = view;
  const published = Boolean(activeModel && terms && object.status === 'ACTIVE' && activeModel.status !== 'REJECTED');

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Service card"
        breadcrumbs={
          <>
            <Link to="/studio">Studio</Link> <span aria-hidden="true">/</span> <span>{object.name}</span> <span aria-hidden="true">/</span>{' '}
            <span>Card</span>
          </>
        }
        title={
          <span className="row" style={{ gap: '0.8rem' }}>
            <ObjectGlyph glyph={object.glyph} size={54} tone="accent" /> {object.name}
          </span>
        }
        lede="One link is the entire storefront. A renter sees plain terms, the model's honest accuracy and a microphone consent step before any sensing begins."
        actions={
          <>
            <LinkButton to={`/passport/${objectId}`} variant="ghost">
              Acoustic passport
            </LinkButton>
            <LinkButton to={`/studio/objects/${objectId}/poster`} variant="secondary">
              Poster
            </LinkButton>
            <LinkButton to={`/studio/objects/${objectId}/pricing`} variant="secondary">
              Edit terms
            </LinkButton>
            {published ? (
              <LinkButton to={`/s/${object.id}`} variant="primary">
                Open as renter <Icon name="external" size={15} />
              </LinkButton>
            ) : null}
          </>
        }
      />

      {error ? (
        <div style={{ marginBottom: '1rem' }}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      {!activeModel || !terms ? (
        <EmptyState
          title="Not shareable yet"
          action={
            <LinkButton to={`/studio/objects/${objectId}`} variant="primary">
              Finish training and pricing <Icon name="arrow" size={16} />
            </LinkButton>
          }
        >
          A service card needs an active model and published terms. {!activeModel ? 'No model yet. ' : ''}
          {activeModel?.status === 'REJECTED' ? 'The active model was rejected by the safety gate. ' : ''}
          {!terms ? 'No price terms yet.' : ''}
        </EmptyState>
      ) : (
        <div className="sidebar-layout">
          <div className="stack">
            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Renter preview</h2>
                <span className={`chip ${object.status === 'ACTIVE' ? 'chip--ok' : 'chip--danger'}`}>
                  <span className="chip__dot" aria-hidden="true" />
                  {object.status === 'ACTIVE' ? 'Live' : 'Revoked'}
                </span>
              </div>
              <div className="panel panel--accent stack" style={{ gap: '0.8rem' }}>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <ObjectGlyph glyph={object.glyph} size={64} tone="accent" />
                  <div className="stack" style={{ gap: '0.25rem' }}>
                    <h3 className="h2" style={{ fontSize: '1.8rem' }}>{object.name}</h3>
                    <p className="small muted">{object.description || 'No description added yet.'}</p>
                  </div>
                </div>
                <div className="grid-3" style={{ gap: '0.6rem' }}>
                  <div className="panel">
                    <span className="stat__label">Rate</span>
                    <div className="big-number" style={{ fontSize: '1.5rem' }}>{formatMinor(terms.minorPerMinute, terms.currency)}</div>
                    <span className="tiny muted">per billable minute</span>
                  </div>
                  <div className="panel">
                    <span className="stat__label">Hard cap</span>
                    <div className="big-number" style={{ fontSize: '1.5rem' }}>{formatMinor(terms.capMinor, terms.currency)}</div>
                    <span className="tiny muted">consented before start</span>
                  </div>
                  <div className="panel">
                    <span className="stat__label">Review</span>
                    <div className="small" style={{ marginTop: 6, fontWeight: 600 }}>{terms.billingPolicy === 'AUTO' ? 'Automatic' : 'Operator required'}</div>
                    <span className="tiny muted">{activeModel.metrics.precision * 100 > 0 ? `${(activeModel.metrics.precision * 100).toFixed(1)}% precision` : ''}</span>
                  </div>
                </div>
              </div>
              <p className="tiny muted">
                The renter card includes the model provenance, measured precision and false-bill rate, the four sensing
                states, privacy behaviour and the sandbox no-real-money notice.
              </p>
            </section>

            <section className="card stack">
              <h2 className="h3">Share</h2>
              <div className="row" style={{ alignItems: 'stretch' }}>
                <div className="input mono" style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', overflowX: 'auto', whiteSpace: 'nowrap' }}>
                  {view.shareUrl}
                </div>
                <CopyButton value={view.shareUrl} label="Copy link" />
                <a className="btn btn--secondary btn--sm" href={view.shareUrl} target="_blank" rel="noreferrer noopener">
                  <Icon name="external" size={15} /> Open
                </a>
              </div>
              <p className="tiny muted">
                The link is stable. Revoking the object blocks new sessions without deleting history or receipts.
              </p>
            </section>

            <section className="card stack">
              <div className="row row--between">
                <h2 className="h3">Publish state</h2>
                <span className="chip">{view.sessionCount} session(s)</span>
              </div>
              <ul className="checklist">
                <li>
                  <Icon name="check" size={15} /> Model {activeModel.status} — {activeModel.metrics.takeCount} takes,{' '}
                  {(activeModel.metrics.precision * 100).toFixed(1)}% precision
                </li>
                <li>
                  <Icon
                    name={
                      view.fieldTest.status === 'FIELD_PASS' || view.fieldTest.status === 'NOT_ELIGIBLE'
                        ? 'check'
                        : 'alert'
                    }
                    size={15}
                  />{' '}
                  {view.fieldTest.status === 'FIELD_PASS'
                    ? 'Real-object field test passed'
                    : view.fieldTest.status === 'NOT_ELIGIBLE'
                      ? 'Synthetic reference model — real-object field validation not applicable'
                      : 'Real-object field test required'}
                  {view.fieldTest.reportId ? (
                    <>
                      {' '}
                      <Link className="tiny" to={`/field-report/${view.fieldTest.reportId}`}>inspect report</Link>
                    </>
                  ) : null}
                </li>
                <li>
                  <Icon name={activeModel.soundprint?.gateEnabled ? 'check' : 'alert'} size={15} /> Acoustic passport{' '}
                  {activeModel.soundprint?.gateEnabled
                    ? `enrolled · ${(activeModel.soundprint.matchThreshold * 100).toFixed(0)}% match gate`
                    : activeModel.soundprint
                      ? 'weak · identity gate disabled'
                      : 'not enrolled'}
                </li>
                <li>
                  <Icon name="check" size={15} /> Terms v{terms.version} — {money(terms.minorPerMinute, terms.currency)}/min,
                  cap {money(terms.capMinor, terms.currency)}
                </li>
                <li>
                  <Icon name={object.status === 'ACTIVE' ? 'check' : 'alert'} size={15} /> Object {object.status.toLowerCase()}
                  {view.activeSessions > 0 ? ` · ${view.activeSessions} active session(s)` : ''}
                </li>
                <li>
                  <Icon name={view.shelfListed ? 'check' : 'alert'} size={15} /> Shelf {view.shelfListed ? 'listed' : 'unlisted'}
                </li>
              </ul>
              {view.activeSessions > 0 ? (
                <Notice tone="warn">
                  There are open sessions. Revocation only blocks new sessions; finish or stop the live ones from the
                  operator console.
                </Notice>
              ) : null}
              <div className="row">
                <Button
                  variant={object.status === 'ACTIVE' ? 'danger' : 'secondary'}
                  onClick={() => void toggleRevoked()}
                  loading={busy}
                >
                  {object.status === 'ACTIVE' ? 'Revoke service card' : 'Reactivate service card'}
                </Button>
                <LinkButton to={`/studio/objects/${objectId}/model`} variant="ghost">
                  Model evidence
                </LinkButton>
                <Button variant="secondary" onClick={() => void toggleShelf()} loading={shelfBusy}>
                  {view.shelfListed ? 'Unlist from shelf' : 'List on shelf'}
                </Button>
              </div>
            </section>
          </div>

          <aside className="stack">
            <section className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
              <span className="eyebrow">Scan to rent</span>
              {qr ? (
                <img
                  src={qr}
                  alt={`QR code for ${object.name} service card`}
                  width={240}
                  height={240}
                  style={{ borderRadius: 12, border: '1px solid var(--line)' }}
                />
              ) : (
                <div className="empty" style={{ width: 240, height: 240 }}>QR unavailable</div>
              )}
              <p className="tiny muted">Generated locally from the share URL; no third-party QR service is contacted.</p>
              {qr ? (
                <a className="link tiny" href={qr} download={`whirr-${object.id}.png`}>
                  Download QR
                </a>
              ) : null}
            </section>
            <section className="card card--soft stack">
              <img
                src="/favicon.svg"
                alt=""
                width={40}
                height={40}
                style={{ borderRadius: 10 }}
              />
              <h2 className="h3">What happens after the scan</h2>
              <ol className="small muted" style={{ paddingLeft: '1.1rem', margin: 0, lineHeight: 1.7 }}>
                <li>Read the rate, cap and model limitations.</li>
                <li>Accept the exact terms hash.</li>
                <li>Authorize only the cap in PayPal Sandbox.</li>
                <li>Start the microphone; watch every state change live.</li>
                <li>Review the interval evidence before any capture.</li>
              </ol>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
