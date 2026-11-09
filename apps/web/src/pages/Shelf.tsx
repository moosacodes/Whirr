import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { HoldView, ShelfItem, ShelfView } from '../../../../packages/contracts/src/types.ts';
import { Button, LinkButton, Loading, Notice, PageHeader, usePageTitle } from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';
import { dateTime, duration, money } from '../lib/format.ts';

function driftCopy(status: ShelfItem['drift']['status']): { label: string; tone: string } {
  if (status === 'FRESH') return { label: 'Fresh calibration', tone: 'ok' };
  if (status === 'DRIFT_SUSPECTED') return { label: 'Drift suspected', tone: 'warn' };
  if (status === 'OVERDUE') return { label: 'Recalibration due', tone: 'danger' };
  return { label: 'No diagnostics yet', tone: '' };
}

export function Shelf() {
  usePageTitle('The shelf');
  const [view, setView] = useState<ShelfView | null>(null);
  const [holds, setHolds] = useState<Record<string, HoldView>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const next = await api<ShelfView>('/api/shelf');
      setView(next);
      setHolds(Object.fromEntries(next.items.filter((item) => item.hold).map((item) => [item.object.id, item.hold!])));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hold = async (objectId: string) => {
    setBusy(objectId);
    setError(null);
    try {
      const response = await api<{ hold: HoldView }>(`/api/objects/${objectId}/hold`, { method: 'POST' });
      setHolds((previous) => ({ ...previous, [objectId]: response.hold }));
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const release = async (objectId: string) => {
    setBusy(objectId);
    setError(null);
    try {
      await api(`/api/objects/${objectId}/hold`, { method: 'DELETE' });
      setHolds((previous) => {
        const next = { ...previous };
        delete next[objectId];
        return next;
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading label="Opening the shelf…" />;

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="The shelf"
        title="Ordinary objects, with a memory."
        lede="Every listing carries a calibrated model, a signed passport and a settled-session history. No renter identity and no raw audio ever appears here. A ten-minute hold only prevents two people colliding; it is not a paid reservation."
        actions={<LinkButton to="/verify" variant="secondary">Verify a document</LinkButton>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!view || view.items.length === 0 ? (
        <div className="empty">
          <h2 className="h3">The shelf is empty.</h2>
          <p className="small muted">An object appears here after a model is trained and price terms are published.</p>
        </div>
      ) : (
        <div className="shelf-grid">
          {view.items.map((item) => {
            const drift = driftCopy(item.drift.status);
            const activeHold = holds[item.object.id] ?? item.hold;
            const unavailable = item.activeSession || Boolean(activeHold && activeHold.id !== item.hold?.id);
            return (
              <article className="card shelf-card" key={item.object.id}>
                <div className="shelf-card__head">
                  <div className="row" style={{ gap: '0.7rem' }}>
                    <ObjectGlyph glyph={item.object.glyph as never} size={46} tone="accent" />
                    <div>
                      <span className="eyebrow">{item.object.category.replaceAll('_', ' ')}</span>
                      <h2 className="h3" style={{ marginTop: 2 }}>{item.object.name}</h2>
                    </div>
                  </div>
                  <span className={`chip ${item.signed ? 'chip--ok' : 'chip--warn'}`}>
                    <Icon name={item.signed ? 'shield' : 'alert'} size={13} /> {item.signed ? `passport v${item.passportVersion}` : 'unsigned'}
                  </span>
                </div>
                <p className="small muted" style={{ minHeight: '2.8em' }}>{item.object.description || 'A calibrated ordinary object with an acoustic passport.'}</p>
                <div className="row row--between">
                  <div>
                    <div className="shelf-card__price">{item.terms ? money(item.terms.minorPerMinute, item.terms.currency) : '—'}</div>
                    <span className="tiny muted">per measured minute</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="tiny muted">cap</span>
                    <div className="small mono">{item.terms ? money(item.terms.capMinor, item.terms.currency) : '—'}</div>
                  </div>
                </div>
                <div className="shelf-card__meta">
                  <span className={`chip ${drift.tone ? `chip--${drift.tone}` : ''}`}>{drift.label}</span>
                  <span>{item.calibrationAgeDays === null ? 'not calibrated' : `${item.calibrationAgeDays}d old`}</span>
                  {item.terms?.fairnessReserveMinor ? <span>{money(item.terms.fairnessReserveMinor, item.terms.currency)} reserve</span> : null}
                </div>
                <p className="tiny muted" style={{ margin: 0 }}>
                  {item.activeSession
                    ? 'In use right now.'
                    : activeHold
                      ? `Held until ${dateTime(activeHold.expiresAt)}.${activeHold.id === item.hold?.id ? ' Your hold.' : ''}`
                      : 'Available. A hold is free and expires in 10 minutes.'}
                </p>
                <div className="shelf-card__actions">
                  {activeHold?.id === item.hold?.id ? (
                    <Button variant="ghost" size="sm" onClick={() => void release(item.object.id)} loading={busy === item.object.id}>
                      Release hold
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void hold(item.object.id)}
                      loading={busy === item.object.id}
                      disabled={unavailable}
                    >
                      Hold for 10 min
                    </Button>
                  )}
                  <LinkButton to={`/s/${item.object.id}`} variant="primary" className={unavailable ? 'is-disabled' : ''}>
                    Open card <Icon name="arrow" size={14} />
                  </LinkButton>
                  <Link to={`/passport/${item.object.id}`} className="link tiny" style={{ alignSelf: 'center' }}>Passport</Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: '1.2rem' }}>
        A hold never charges anything. Payment starts only after you open the card, read the terms, consent and authorize.
      </p>
    </div>
  );
}