import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { HoldView, ShelfItem, ShelfView } from '../../../../packages/contracts/src/types.ts';
import { Button, LinkButton, Loading, Notice, usePageTitle } from '../components/ui.tsx';
import { Icon, ObjectGlyph, SoundTag } from '../components/visuals.tsx';
import { dateTime, money } from '../lib/format.ts';
import { formatMinor, type Currency } from '../../../../packages/meter/src/currency.ts';

function driftCopy(status: ShelfItem['drift']['status']): { label: string; tone: string } {
  if (status === 'FRESH') return { label: 'Fresh calibration', tone: 'ok' };
  if (status === 'DRIFT_SUSPECTED') return { label: 'Drift suspected', tone: 'warn' };
  if (status === 'OVERDUE') return { label: 'Recalibration due', tone: 'danger' };
  return { label: 'No sessions yet', tone: '' };
}

export function Shelf() {
  usePageTitle('The bench');
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

  if (loading) return <Loading label="Opening the bench…" />;

  const items = view?.items ?? [];
  const readyNow = items.filter((item) => !item.activeSession).length;
  const lowestRate = items.reduce<number | null>(
    (lowest, item) => (item.terms ? Math.min(lowest ?? item.terms.minorPerMinute, item.terms.minorPerMinute) : lowest),
    null,
  );
  const currencies = new Set(items.map((item) => item.terms?.currency).filter(Boolean));
  const currency: Currency = currencies.size === 1 ? ([...currencies][0] as Currency) : 'USD';

  return (
    <div className="page container page--wide">
      <header className="bench-head">
        <div className="bench-head__copy">
          <div className="breadcrumbs">
            <Link to="/">Whirr</Link> <span aria-hidden="true">/</span> <span>Bench</span>
          </div>
          <span className="eyebrow">The shared workshop · Bay 01</span>
          <h1 className="display">
            Tools with a <em>sound tag.</em>
          </h1>
          <p className="lede">
            Borrow the tool, not the stopwatch. Each object below has been taught the sound of its own work. Whirr
            bills only the running minutes it can defend; holds are free and expire in ten minutes.
          </p>
        </div>
        <div className="bench-head__stats" aria-label="Bench status">
          <div>
            <strong>
              {readyNow} of {items.length}
            </strong>
            <span>ready now</span>
          </div>
          <div>
            <strong>{lowestRate === null ? '—' : money(lowestRate, currency)}</strong>
            <span>from / running min</span>
          </div>
          <div>
            <strong>{items.filter((item) => item.signed).length}</strong>
            <span>signed passports</span>
          </div>
        </div>
      </header>

      <div className="bench-ribbon" aria-label="How the bench bills">
        <span>
          <Icon name="wave" size={15} /> The motor starts the meter
        </span>
        <span>
          <Icon name="clock" size={15} /> Uncertain time is free
        </span>
        <span>
          <Icon name="shield" size={15} /> Hard cap before listening
        </span>
        <span>
          <Icon name="check" size={15} /> Receipt verifies offline
        </span>
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {items.length === 0 ? (
        <div className="empty">
          <span className="eyebrow">Bench empty</span>
          <h2 className="h3">No tools have a sound tag yet.</h2>
          <p className="small muted">An object appears here after it is calibrated and its terms are published.</p>
          <LinkButton to="/studio" variant="secondary">
            Open the studio
          </LinkButton>
        </div>
      ) : (
        <div className="bench-board">
          <div className="bench-board__items">
            {items.map((item, index) => {
              const drift = driftCopy(item.drift.status);
              const activeHold = holds[item.object.id] ?? item.hold;
              const unavailable = item.activeSession || Boolean(activeHold && activeHold.id !== item.hold?.id);
              const benchNumber = String(index + 1).padStart(2, '0');
              return (
                <article className={`card bench-card${unavailable ? ' is-unavailable' : ''}`} key={item.object.id}>
                  <div className="bench-card__top">
                    <span className="bench-card__number">BENCH / {benchNumber}</span>
                    <span className={`bench-card__state${unavailable ? ' is-busy' : ''}`}>
                      <span className="live-dot" aria-hidden="true" />
                      {item.activeSession ? 'In use now' : activeHold ? 'Held' : 'Ready to listen'}
                    </span>
                  </div>

                  <div className="bench-card__main">
                    <div className="bench-card__image">
                      {item.object.photoDataUrl ? (
                        <img src={item.object.photoDataUrl} alt={item.object.name} />
                      ) : (
                        <ObjectGlyph glyph={item.object.glyph} size={94} tone="accent" label={item.object.name} />
                      )}
                    </div>
                    <div className="bench-card__identity">
                      <span className="eyebrow">{item.object.category.replaceAll('_', ' ')}</span>
                      <h2 className="h2">{item.object.name}</h2>
                      <p className="small muted">
                        {item.object.description || 'A calibrated ordinary object with a signed acoustic passport.'}
                      </p>
                      <div className="bench-card__trust">
                        <span className={`chip ${item.signed ? 'chip--ok' : 'chip--warn'}`}>
                          <Icon name={item.signed ? 'shield' : 'alert'} size={13} />{' '}
                          {item.signed ? `passport v${item.passportVersion}` : 'unsigned'}
                        </span>
                        <span className={`chip ${drift.tone ? `chip--${drift.tone}` : ''}`}>{drift.label}</span>
                        <span className="tiny muted">
                          {item.calibrationAgeDays === null ? 'not calibrated' : `${item.calibrationAgeDays}d old`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <SoundTag soundprint={item.model?.soundprint} />

                  <div className="bench-card__terms">
                    <div>
                      <span className="stat__label">Rate</span>
                      <strong>{item.terms ? money(item.terms.minorPerMinute, item.terms.currency) : '—'}</strong>
                      <span className="tiny muted">per running minute</span>
                    </div>
                    <div>
                      <span className="stat__label">Your ceiling</span>
                      <strong>{item.terms ? money(item.terms.capMinor, item.terms.currency) : '—'}</strong>
                      <span className="tiny muted">authorized before use</span>
                    </div>
                    <div>
                      <span className="stat__label">Free time</span>
                      <strong>Idle + uncertain</strong>
                      <span className="tiny muted">never guessed into a bill</span>
                    </div>
                  </div>

                  <div className="bench-card__availability">
                    <span className={`live-dot${!unavailable ? ' is-live' : ''}`} aria-hidden="true" />
                    <span className="small">
                      {item.activeSession
                        ? 'A session is open right now. Only one live meter is allowed at this bench.'
                        : activeHold
                          ? `Held until ${dateTime(activeHold.expiresAt)}.${activeHold.id === item.hold?.id ? ' This hold is yours.' : ''}`
                          : 'Available. A ten-minute hold is free and does not start a payment.'}
                    </span>
                  </div>

                  <div className="bench-card__actions">
                    {activeHold?.id === item.hold?.id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void release(item.object.id)}
                        loading={busy === item.object.id}
                      >
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
                    <LinkButton
                      to={`/s/${item.object.id}`}
                      variant="primary"
                      className={unavailable ? 'is-disabled' : ''}
                    >
                      Open bench card <Icon name="arrow" size={14} />
                    </LinkButton>
                    <Link to={`/passport/${item.object.id}`} className="link tiny bench-card__passport">
                      Passport
                    </Link>
                  </div>

                  <p className="tiny muted bench-card__fine">
                    {item.terms
                      ? `Examples on the card: 15s ${formatMinor(Math.round(item.terms.minorPerMinute * 0.25), item.terms.currency)} · 35s ${formatMinor(Math.round(item.terms.minorPerMinute * 0.5833), item.terms.currency)}. Rounded once at the end.`
                      : 'Terms are not published yet.'}
                  </p>
                </article>
              );
            })}
          </div>

          <aside className="bench-guide card card--dark">
            <span className="eyebrow" style={{ color: 'rgba(245,238,228,.55)' }}>
              Bench rules
            </span>
            <h2 className="h2">Pay for the run, not the clock.</h2>
            <ol className="bench-rules">
              <li>
                <span>01</span>
                <div>
                  <strong>The tool stays ordinary.</strong>
                  <p className="tiny">No lock, tag or firmware. A microphone listens to what it already does.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Only confident running counts.</strong>
                  <p className="tiny">Idle, ambiguous, mismatched and disconnected time are excluded.</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>The cap comes first.</strong>
                  <p className="tiny">You approve a ceiling in PayPal Sandbox before the microphone opens.</p>
                </div>
              </li>
              <li>
                <span>04</span>
                <div>
                  <strong>The receipt is shared.</strong>
                  <p className="tiny">Renter and owner see the same intervals; anyone can check the bytes offline.</p>
                </div>
              </li>
            </ol>
            <div className="bench-guide__note">
              <Icon name="info" size={16} />
              <p className="tiny">
                This checkout ships with one <strong>synthetic reference fan</strong>. It demonstrates the full
                product loop; it is not field accuracy or a live customer bench.
              </p>
            </div>
            <div className="bench-guide__links">
              <Link to="/judge" className="link">
                Evidence and open gates →
              </Link>
              <Link to="/studio" className="link">
                Owner studio →
              </Link>
            </div>
          </aside>
        </div>
      )}

      <p className="tiny muted bench-footnote">
        A hold reserves nothing and charges nothing. Payment starts only after you open the bench card, read the
        terms, consent and authorize. Sandbox only — no real money moves.
      </p>
    </div>
  );
}
