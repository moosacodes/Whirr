import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.ts';
import type { ShelfItem, ShelfView } from '../../../../packages/contracts/src/types.ts';
import { useAuth } from '../lib/auth.tsx';
import { LinkButton, usePageTitle } from '../components/ui.tsx';
import { Icon, ObjectGlyph, SoundTag } from '../components/visuals.tsx';
import { money } from '../lib/format.ts';

export function Landing() {
  usePageTitle('Whirr Bench — pay for the work');
  const { session } = useAuth();
  const [featured, setFeatured] = useState<ShelfItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<ShelfView>('/api/shelf')
      .then((view) => {
        if (!cancelled) setFeatured(view.items[0] ?? null);
      })
      .catch(() => {
        // The landing page remains useful if the bench is offline.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const objectName = featured?.object.name ?? 'Reference desk fan';
  const category = featured?.object.category.replaceAll('_', ' ') ?? 'shared workshop';
  const rate = featured?.terms ? money(featured.terms.minorPerMinute, featured.terms.currency) : '—';
  const cap = featured?.terms ? money(featured.terms.capMinor, featured.terms.currency) : '—';

  return (
    <>
      <section className="hero hero--bench">
        <div className="hero__inner">
          <div className="hero__copy">
            <span className="eyebrow hero__eyebrow">Whirr Bench · shared workshop / Bay 01</span>
            <h1 className="hero__title">
              Borrow the tool.
              <br />
              <em>Pay for the work.</em>
            </h1>
            <p className="hero__lede">
              A tool library where the tool proves it was used. Whirr listens to an ordinary machine, bills only the
              minutes it can defend, and gives the owner and renter the same evidence. No lock, no dongle, no new
              hardware.
            </p>
            <div className="hero__actions">
              <LinkButton to="/shelf" variant="primary">
                Open the bench <Icon name="arrow" size={16} />
              </LinkButton>
              <LinkButton to="/verify" variant="secondary">
                Inspect a proof
              </LinkButton>
            </div>
            <div className="row hero__truths">
              <span className="chip chip--dark">
                <Icon name="wave" size={13} />
                Running time, not clock time
              </span>
              <span className="chip chip--dark">
                <Icon name="mic" size={13} />
                Audio stays on-device
              </span>
              <span className="chip chip--dark">
                <Icon name="shield" size={13} />
                {session?.paypal.configured ? 'PayPal Sandbox ready' : 'Demo metering'}
              </span>
            </div>
          </div>

          <div className="hero__stage hero__stage--bench">
            <div className="bench-ticket">
              <div className="bench-ticket__head">
                <span className="bench-ticket__no">BENCH 01 / SHARED WORKSHOP</span>
                <span className={`bench-ticket__status${featured?.activeSession ? ' is-busy' : ''}`}>
                  <span className="live-dot is-live" aria-hidden="true" />
                  {featured?.activeSession ? 'In use now' : 'Ready to listen'}
                </span>
              </div>

              <div className="bench-ticket__object">
                <div className="bench-ticket__object-image">
                  <span className="bench-ticket__tag">FAN / 01</span>
                  <ObjectGlyph glyph={featured?.object.glyph ?? 'fan'} size={104} tone="accent" label={objectName} />
                </div>
                <div className="bench-ticket__object-copy">
                  <span className="eyebrow">On the bench</span>
                  <strong>{objectName}</strong>
                  <span className="tiny muted">{category} · calibrated by ear</span>
                </div>
              </div>

              <SoundTag soundprint={featured?.model?.soundprint} />

              <div className="bench-ticket__price">
                <div>
                  <strong>{rate}</strong>
                  <span>per running minute</span>
                </div>
                <div className="bench-ticket__cap">
                  <span>You authorize</span>
                  <strong>{cap}</strong>
                </div>
              </div>

              <div className="bench-ticket__foot">
                <span className="mono">LISTEN → CLASSIFY → BILL</span>
                <span className="bench-ticket__arrow" aria-hidden="true">
                  <Icon name="arrow" size={18} />
                </span>
              </div>
            </div>
            <p className="hero__micro">
              <Icon name="mic" size={13} /> one microphone · zero new hardware
            </p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="stack">
              <span className="eyebrow">The useful difference</span>
              <h2 className="h2">
                A timer bills the clock. <em className="serif">Whirr bills the work.</em>
              </h2>
            </div>
            <p className="muted">
              Shared workshops already have tools, trust and a payment problem. Whirr does not add another rental
              marketplace. It adds a meter that can tell <strong>use</strong> from <strong>presence</strong>.
            </p>
          </div>

          <div className="compare-grid">
            <article className="compare-card compare-card--old">
              <span className="eyebrow">The old bench</span>
              <h3 className="h3">“Book it for an hour.”</h3>
              <p className="small muted">
                The clock starts before the setup. It keeps running through the pause, the search for a bit, the
                conversation. The owner has a calendar, not evidence of use.
              </p>
              <div className="compare-card__stamp">TIME-BASED · ESTIMATED</div>
            </article>
            <article className="compare-card compare-card--new">
              <span className="eyebrow">The Whirr bench</span>
              <h3 className="h3">“Pay for the minutes it runs.”</h3>
              <p className="small muted">
                The meter starts when the motor does. Ambiguous sound is free. The renter sees the exact quote before
                settlement; the owner keeps the interval evidence behind it.
              </p>
              <div className="compare-card__stamp">USE-BASED · EVIDENCED</div>
            </article>
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="container">
          <div className="section-head">
            <div className="stack">
              <span className="eyebrow">The three-beat interaction</span>
              <h2 className="h2">Find. Run. Keep the proof.</h2>
            </div>
            <p className="muted">The object never becomes smart. The interaction around it does.</p>
          </div>

          <div className="bench-steps">
            <article className="bench-step">
              <span className="bench-step__number">01</span>
              <div className="bench-step__icon">
                <Icon name="qr" size={22} />
              </div>
              <h3 className="h3">Find a tool with a past.</h3>
              <p className="small muted">
                Scan the bench card or open its link. See the rate, the hard cap, the last calibration and the
                object’s signed history before you commit.
              </p>
              <span className="bench-step__note">The card is the front door.</span>
            </article>
            <article className="bench-step">
              <span className="bench-step__number">02</span>
              <div className="bench-step__icon">
                <Icon name="mic" size={22} />
              </div>
              <h3 className="h3">Use it like a tool.</h3>
              <p className="small muted">
                Press start and work normally. The browser listens locally, compares the sound with the object’s
                sound tag and marks anything uncertain as free.
              </p>
              <span className="bench-step__note">No app to install on the tool.</span>
            </article>
            <article className="bench-step">
              <span className="bench-step__number">03</span>
              <div className="bench-step__icon">
                <Icon name="shield" size={22} />
              </div>
              <h3 className="h3">Keep the receipt.</h3>
              <p className="small muted">
                Stop, inspect the interval ledger, then let PayPal capture the reviewed amount. The signed receipt
                verifies without the Whirr server.
              </p>
              <span className="bench-step__note">The evidence leaves with you.</span>
            </article>
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="container">
          <div className="handshake">
            <div className="handshake__copy">
              <span className="eyebrow">PayPal is the handshake</span>
              <h2 className="h2">Permission first. Payment for what happened.</h2>
              <p className="small">
                The renter authorizes a ceiling before the microphone opens. Whirr captures only the reviewed quote
                after the session stops — never an open-ended tap. PayPal is not a badge on the footer; it is the
                boundary that makes a shared tool safe to try.
              </p>
              <div className="row" style={{ marginTop: '1rem' }}>
                <span className="chip chip--dark">
                  <span className="chip__dot" /> Authorize the cap
                </span>
                <span className="chip chip--dark">
                  <span className="chip__dot" /> Review the evidence
                </span>
                <span className="chip chip--dark">
                  <span className="chip__dot" /> Capture once
                </span>
              </div>
            </div>
            <div className="handshake__steps">
              <div>
                <span className="mono">01 / BEFORE</span>
                <strong>Authorize a ceiling in Sandbox.</strong>
                <p className="tiny">No sensing starts until the authorization is verified.</p>
              </div>
              <div>
                <span className="mono">02 / DURING</span>
                <strong>Meter the motor, not the minute.</strong>
                <p className="tiny">Idle, uncertain and disconnected time stay free.</p>
              </div>
              <div>
                <span className="mono">03 / AFTER</span>
                <strong>Capture the reviewed amount.</strong>
                <p className="tiny">The receipt binds the physical claim to the payment state.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="stack">
              <span className="eyebrow">A receipt built for a skeptic</span>
              <h2 className="h2">Trust is a page you can read.</h2>
            </div>
            <p className="muted">
              Whirr makes the boundary visible instead of hiding it behind a green check. A judge can inspect the
              same evidence the renter and owner receive.
            </p>
          </div>
          <div className="proof-pair">
            <article className="card proof-pair__card">
              <span className="eyebrow">What the proof establishes</span>
              <h3 className="h3">The bytes have not changed.</h3>
              <ul className="checklist">
                <li>
                  <Icon name="check" size={16} /> The quote recomputes from the recorded intervals.
                </li>
                <li>
                  <Icon name="check" size={16} /> The cap, rate and terms are pinned to this session.
                </li>
                <li>
                  <Icon name="check" size={16} /> The receipt, interval leaves and passport are signed.
                </li>
                <li>
                  <Icon name="check" size={16} /> The same result verifies offline, without a Whirr login.
                </li>
              </ul>
            </article>
            <article className="card card--soft proof-pair__card">
              <span className="eyebrow">What it refuses to claim</span>
              <h3 className="h3">A microphone is not a witness.</h3>
              <ul className="checklist checklist--x">
                <li>
                  <Icon name="alert" size={16} /> That the object was physically present or not shared.
                </li>
                <li>
                  <Icon name="alert" size={16} /> That a recording or a similar machine could not fool it.
                </li>
                <li>
                  <Icon name="alert" size={16} /> That PayPal settlement can be verified without the network.
                </li>
                <li>
                  <Icon name="alert" size={16} /> That a calibration-fit score is a biometric identity.
                </li>
              </ul>
            </article>
          </div>
          <div className="row" style={{ marginTop: '1rem' }}>
            <Link to="/judge" className="link">
              Read the judge gauntlet and open gates →
            </Link>
            <Link to="/passport/obj_reference_fan" className="link">
              Open the reference passport →
            </Link>
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="container">
          <div className="bench-closing">
            <div>
              <span className="eyebrow">The demo bench is ready</span>
              <h2 className="h2">Hear an ordinary object become a service.</h2>
              <p className="small muted">
                The reference fan is synthetic and clearly labelled. Use it to walk the full loop: sound tag, live
                session, reviewed payment and a proof that survives without the server.
              </p>
            </div>
            <div className="row">
              <LinkButton to="/shelf" variant="primary">
                Open the bench <Icon name="arrow" size={16} />
              </LinkButton>
              <LinkButton to="/verify" variant="secondary">
                Verify a receipt
              </LinkButton>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
