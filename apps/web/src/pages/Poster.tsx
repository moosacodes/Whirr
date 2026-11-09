import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import type { OwnerObjectView } from '../../../../packages/contracts/src/types.ts';
import { makeQrDataUrl } from '../lib/qr.ts';
import { Button, LinkButton, Loading, Notice, usePageTitle } from '../components/ui.tsx';
import { Icon, ObjectGlyph, SignatureSeal } from '../components/visuals.tsx';
import { money } from '../lib/format.ts';

export function Poster() {
  const { objectId = '' } = useParams();
  const [view, setView] = useState<OwnerObjectView | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [verifyQr, setVerifyQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(view ? `${view.object.name} poster` : 'Object poster');

  useEffect(() => {
    (async () => {
      try {
        const next = await api<OwnerObjectView>(`/api/operator/objects/${objectId}`);
        setView(next);
        setQr(await makeQrDataUrl(next.shareUrl));
        setVerifyQr(await makeQrDataUrl(`${window.location.origin}/verify`));
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [objectId]);

  if (error) return <div className="page container page--narrow"><Notice tone="danger">{error}</Notice></div>;
  if (!view) return <Loading label="Preparing the poster…" />;

  return (
    <div className="page container page--wide">
      <div className="row row--between no-print" style={{ marginBottom: '1rem' }}>
        <div className="breadcrumbs">
          <Link to="/studio">Studio</Link> <span aria-hidden="true">/</span>{' '}
          <Link to={`/studio/objects/${objectId}`}>{view.object.name}</Link> <span aria-hidden="true">/</span>{' '}
          <span>Poster</span>
        </div>
        <div className="row">
          <Button variant="secondary" onClick={() => window.print()}><Icon name="download" size={15} /> Print poster</Button>
          <LinkButton to={`/studio/objects/${objectId}/card`} variant="ghost">Service card</LinkButton>
        </div>
      </div>

      <article className="poster">
        <div className="row row--between" style={{ alignItems: 'flex-start' }}>
          <span className="eyebrow">Whirr acoustic passport · ordinary object</span>
          <span className="chip chip--dark">{view.object.category.replaceAll('_', ' ')}</span>
        </div>
        <div className="row" style={{ gap: '1.2rem', marginTop: '1.2rem', alignItems: 'center' }}>
          <ObjectGlyph glyph={view.object.glyph as never} size={86} tone="accent" />
          <div>
            <h1 className="display" style={{ fontSize: 'clamp(2.2rem, 7vw, 4.4rem)' }}>{view.object.name}</h1>
            <p className="lede" style={{ maxWidth: '34ch' }}>{view.object.description || 'Give an ordinary object a portable acoustic passport.'}</p>
          </div>
        </div>
        <p className="small muted" style={{ maxWidth: '58ch', marginTop: '1rem' }}>
          Scan to open the service card. The card explains what is measured, what is never uploaded and exactly how a
          billable second is decided. A hold costs nothing; payment begins only after consent and authorization.
        </p>
        <div className="row" style={{ gap: '1.5rem', marginTop: '1.4rem', flexWrap: 'wrap' }}>
          {qr ? (
            <div style={{ textAlign: 'center' }}>
              <img src={qr} alt={`QR code for ${view.object.name} service card`} width={176} height={176} style={{ borderRadius: 8 }} />
              <p className="tiny mono" style={{ marginTop: 6 }}>open service card</p>
            </div>
          ) : null}
          {verifyQr ? (
            <div style={{ textAlign: 'center' }}>
              <img src={verifyQr} alt="QR code for the offline Whirr verifier" width={132} height={132} style={{ borderRadius: 8 }} />
              <p className="tiny mono" style={{ marginTop: 6 }}>verify a document</p>
            </div>
          ) : null}
          <div className="stack" style={{ gap: '0.4rem', flex: 1, minWidth: 190 }}>
            <div className="row"><span className="tiny muted">Rate</span><strong className="small">{view.terms ? `${money(view.terms.minorPerMinute, view.terms.currency)} / min` : 'not published'}</strong></div>
            <div className="row"><span className="tiny muted">Cap</span><strong className="small">{view.terms ? money(view.terms.capMinor, view.terms.currency) : '—'}</strong></div>
            <div className="row"><span className="tiny muted">Model</span><strong className="small">{view.activeModel?.status ?? 'not trained'}</strong></div>
            <div className="row"><span className="tiny muted">Passport</span><strong className="small">{view.activeModel ? 'installation-signed' : 'not yet issued'}</strong></div>
          </div>
          <SignatureSeal signed={Boolean(view.activeModel)} keyId={view.activeModel?.hash} />
        </div>
        <div className="poster__footer">
          <span className="tiny muted" style={{ maxWidth: '44ch' }}>
            This poster identifies an acoustic installation, not a person. A signature is installation attestation; it is
            not a trusted timestamp or proof that the object was physically present.
          </span>
          <span className="tiny mono muted">Whirr · sandbox prototype</span>
        </div>
      </article>
    </div>
  );
}