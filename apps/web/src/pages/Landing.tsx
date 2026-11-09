import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { usePageTitle, LinkButton } from '../components/ui.tsx';
import { Icon, ObjectGlyph } from '../components/visuals.tsx';

export function Landing() {
  usePageTitle('Every object has a sound');
  const { session } = useAuth();

  return (
    <>
      <section className="hero">
        <div className="hero__inner">
          <div>
            <span className="eyebrow hero__eyebrow">Whirr 2.0 · the acoustic passport office</span>
            <h1 className="hero__title">
              Every object
              <br />
              <em>has a sound.</em>
            </h1>
            <p className="hero__lede">
              Give it a passport. Whirr teaches an ordinary fan, drill or hair dryer to prove its own use, meter only
              confident activity, and issue a signed receipt anyone can check offline. No new hardware.
            </p>
            <div className="hero__actions">
              <LinkButton to="/shelf" variant="primary">
                Open the shelf <Icon name="arrow" size={16} />
              </LinkButton>
              <LinkButton to="/verify" variant="secondary">
                Verify a passport
              </LinkButton>
            </div>
            <div className="row" style={{ marginTop: '1.4rem', gap: '0.45rem' }}>
              <span className="chip chip--dark">
                <Icon name="shield" size={13} />
                {session?.paypal.configured ? 'PayPal Sandbox configured' : 'Demo metering · no PayPal'}
              </span>
              <span className="chip chip--dark">
                <Icon name="mic" size={13} />
                Audio never uploaded
              </span>
              <span className="chip chip--dark">
                <Icon name="clock" size={13} />
                Uncertain time is free
              </span>
              <span className="chip chip--dark">
                <Icon name="shield" size={13} />
                Signed proofs, offline
              </span>
            </div>
          </div>
          <div className="hero__stage" aria-hidden="true">
            <div className="hero-rings">
              <span />
              <span />
              <span />
            </div>
            <div className="hero-object">
              <ObjectGlyph glyph="fan" size={112} tone="dark" />
            </div>
            <span className="hero__micro">
              <Icon name="mic" size={13} /> one microphone · zero new hardware
            </span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="stack">
              <span className="eyebrow">Three acts · one protocol</span>
              <h2 className="h2">Teach. Listen. Prove.</h2>
            </div>
            <p className="muted">
              The object stays dumb. The proof gets smart. Every number below is computed by code in this repository,
              not a slide.
            </p>
          </div>
          <div className="step-grid">
            <article className="step">
              <h3 className="h3">01 · Teach</h3>
              <p className="muted small">
                A guided sitting records idle, running, different-sound and held-out examples. The browser extracts
                features; the acoustic passport enrolls the object's spectral profile. Raw audio never leaves the device.
              </p>
            </article>
            <article className="step">
              <h3 className="h3">02 · Listen</h3>
              <p className="muted small">
                A four-second room check, a live eight-band waterfall and a “why this second” explanation make the
                meter legible. Ambiguous, idle, mismatched and disconnected time is marked free, not guessed into a charge.
              </p>
            </article>
            <article className="step">
              <h3 className="h3">03 · Prove</h3>
              <p className="muted small">
                Each passport edition is signed with this installation's ECDSA P-256 key. Receipts get a redacted
                proof card and QR. Drag the JSON into <strong>/verify</strong> and the whole check runs locally — with
                the honest boundary printed beside it.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="container">
          <div className="card card--dark" style={{ borderRadius: 24 }}>
            <div className="sidebar-layout" style={{ alignItems: 'center' }}>
              <div className="stack">
                <span className="eyebrow" style={{ color: 'rgba(245,238,228,.55)' }}>
                  What a signature can say
                </span>
                <h2 className="h2">
                  A seal is not a <span className="serif" style={{ fontStyle: 'italic' }}>lock</span>.
                </h2>
                <p className="small" style={{ color: 'rgba(245,238,228,.72)', maxWidth: '60ch' }}>
                  Signed means this installation attested these bytes. It does not mean a trusted timestamp, a
                  third-party identity or physical truth. Playback can fool any microphone; a similar machine can share
                  a soundprint. Whirr reduces ambiguity to free time and shows the boundary instead of hiding it.
                </p>
              </div>
              <div className="stack" style={{ gap: '0.6rem' }}>
                <div className="stat stat--dark">
                  <span className="stat__label">Sensing states</span>
                  <span className="small" style={{ lineHeight: 1.7 }}>
                    <strong style={{ color: '#e9b085' }}>ACTIVE</strong> · billable
                    <br />
                    <strong>IDLE</strong> · free
                    <br />
                    <strong>UNCERTAIN</strong> · free, never guessed
                    <br />
                    <strong>DISCONNECTED</strong> · free
                  </span>
                </div>
                <Link to="/judge" className="link" style={{ color: '#e9b085' }}>
                  Inspect the judge gauntlet →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="stack">
              <span className="eyebrow">Built for a skeptical judge</span>
              <h2 className="h2">Real provider calls, or nothing at all.</h2>
            </div>
          </div>
          <div className="honesty">
            <div className="card">
              <h3 className="h3" style={{ marginBottom: '1rem' }}>
                What is genuinely implemented
              </h3>
              <ul className="checklist">
                <li>
                  <Icon name="check" size={16} /> On-device feature extraction and logistic-regression
                  inference from a real WAV pipeline
                </li>
                <li>
                  <Icon name="check" size={16} /> Precision-first hysteresis, uncertainty exclusion, hard
                  consented cap, integer minor-unit rounding
                </li>
                <li>
                  <Icon name="check" size={16} /> PayPal Orders &amp; Payments v2 authorization and partial
                  capture, with idempotency and webhook signature verification
                </li>
                <li>
                  <Icon name="check" size={16} /> Hash-chained audit log, evidence receipts and a
                  tamper-evident verification panel
                </li>
              </ul>
            </div>
            <div className="card card--soft">
              <h3 className="h3" style={{ marginBottom: '1rem' }}>
                What this installation may not have
              </h3>
              <ul className="checklist checklist--x">
                <li>
                  <Icon name="alert" size={16} /> Live PayPal credentials: without them, every session is
                  labelled demo metering and no payment is attempted
                </li>
                <li>
                  <Icon name="alert" size={16} /> A real-object recording: the bundled reference fan is
                  procedurally synthesised and never presented as field accuracy
                </li>
                <li>
                  <Icon name="alert" size={16} /> A public deployment, video or Devpost submission: those
                  remain open gates in the repository
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="container">
          <div className="card panel--accent" style={{ padding: 'clamp(1.5rem,4vw,3rem)' }}>
            <div className="row row--between" style={{ alignItems: 'center' }}>
              <div className="stack" style={{ maxWidth: '60ch' }}>
              <span className="eyebrow">Try the full loop</span>
              <h2 className="h2">Calibrate, listen, dispute, verify — in one sitting.</h2>
                <p className="small muted">
                  The seeded reference fan is ready to use. Calibrate it, watch the listening room explain every
                  second, hold it on the shelf, then verify a signed receipt offline.
                </p>
              </div>
              <div className="row">
                <LinkButton to="/shelf" variant="primary">
                  Enter the shelf
                </LinkButton>
                <LinkButton to="/verify" variant="secondary">
                  Open the verifier
                </LinkButton>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
