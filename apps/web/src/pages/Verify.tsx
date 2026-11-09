import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { verifyDocument, type DocumentVerification } from '../../../../packages/verify/src/index.ts';
import { Button, LinkButton, Notice, PageHeader, TextArea, usePageTitle } from '../components/ui.tsx';
import { Icon } from '../components/visuals.tsx';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function Verify() {
  usePageTitle('Verify a Whirr document');
  const [input, setInput] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<DocumentVerification | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const check = useCallback(async (text: string, name?: string) => {
    setError(null);
    setResult(null);
    setLegacy(false);
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed) || parsed.schema !== 'whirr.signed.v2') {
        setLegacy(true);
        setFileName(name ?? null);
        return;
      }
      const next = await verifyDocument(parsed);
      setResult(next);
      setFileName(name ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The document is not valid JSON.');
    }
  }, []);

  const readFile = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      setError('Document is larger than 2 MB. A Whirr proof is normally a few kilobytes.');
      return;
    }
    const text = await file.text();
    setInput(text);
    await check(text, file.name);
  };

  const tamper = async (kind: 'amount' | 'signature' | 'object' | 'interval' | 'merkle' | 'passport' | 'key') => {
    try {
      const parsed = JSON.parse(input) as Record<string, unknown>;
      if (!isRecord(parsed.payload)) throw new Error('Load a signed document first.');
      if (kind === 'signature') {
        const signature = String(parsed.signature ?? '');
        parsed.signature = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
      } else if (kind === 'key') {
        parsed.keyId = '0'.repeat(32);
      } else if (kind === 'amount') {
        const payload = parsed.payload as Record<string, unknown>;
        const receipt = isRecord(payload.receipt) ? payload.receipt : null;
        const pricing = isRecord(payload.pricing) ? payload.pricing : receipt && isRecord(receipt.pricing) ? receipt.pricing : null;
        if (!pricing || typeof pricing.quoteMinor !== 'number') throw new Error('This document has no editable quote amount.');
        pricing.quoteMinor += 1;
      } else if (kind === 'interval') {
        const payload = parsed.payload as Record<string, unknown>;
        const intervals = Array.isArray(payload.intervals) ? payload.intervals : null;
        const first = intervals && isRecord(intervals[0]) ? intervals[0] : null;
        if (!first) throw new Error('This document has no v3 interval ledger.');
        first.state = first.state === 'IDLE' ? 'ACTIVE_CONFIDENT' : 'IDLE';
      } else if (kind === 'merkle') {
        const payload = parsed.payload as Record<string, unknown>;
        const merkle = isRecord(payload.merkle) ? payload.merkle : null;
        if (!merkle || typeof merkle.root !== 'string') throw new Error('This document has no Merkle root.');
        merkle.root = `${merkle.root.slice(0, -1)}${merkle.root.endsWith('0') ? '1' : '0'}`;
      } else if (kind === 'passport') {
        const payload = parsed.payload as Record<string, unknown>;
        const passport = isRecord(payload.passport) ? payload.passport : null;
        if (!passport) throw new Error('This bundle has no nested passport.');
        passport.keyId = 'f'.repeat(32);
      } else {
        const payload = parsed.payload as Record<string, unknown>;
        const receipt = isRecord(payload.receipt) ? payload.receipt : null;
        const object = isRecord(payload.object) ? payload.object : receipt && isRecord(receipt.object) ? receipt.object : null;
        if (!object) throw new Error('This document has no object block.');
        object.name = `${String(object.name)} (edited)`;
      }
      const text = JSON.stringify(parsed, null, 2);
      setInput(text);
      await check(text, fileName ?? undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not edit that document.');
    }
  };

  return (
    <div className="page container page--wide">
      <PageHeader
        eyebrow="Offline verifier"
        title="Check the seal, not the story."
        lede="Drop a .whirr-passport.json or signed receipt proof here. Verification happens in this tab: no upload, no server round-trip, no login. A legacy unsigned artifact is labelled as legacy, never silently trusted."
        actions={<LinkButton to="/shelf" variant="secondary">Browse the shelf</LinkButton>}
      />

      <div className="verify-grid">
        <div className="stack">
          <section
            className={`verify-drop${dragOver ? ' is-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const file = event.dataTransfer.files[0];
              if (file) void readFile(file);
            }}
          >
            <Icon name="shield" size={30} />
            <h2 className="h3" style={{ marginTop: 10 }}>Drop a signed document</h2>
            <p className="small muted" style={{ maxWidth: '44ch', margin: '8px auto 14px' }}>
              Passports and receipt proofs are canonical JSON envelopes signed with ECDSA P-256. The verifier checks the
              signature against the embedded key and validates the document's own semantic boundaries.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
                event.target.value = '';
              }}
            />
            <Button variant="primary" onClick={() => inputRef.current?.click()}>Choose a file</Button>
            {fileName ? <p className="tiny mono muted" style={{ marginTop: 10 }}>{fileName}</p> : null}
          </section>

          <section className="card stack">
            <div className="row row--between">
              <h2 className="h3">Or paste JSON</h2>
              <Button variant="secondary" size="sm" onClick={() => void check(input)} disabled={!input.trim()}>
                Verify pasted JSON
              </Button>
            </div>
            <TextArea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={'{\n  "schema": "whirr.signed.v2",\n  ...\n}'}
              spellCheck={false}
              style={{ minHeight: 180, fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}
            />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            {legacy ? (
              <Notice tone="warn" title="Legacy — not signed.">
                This file is readable JSON, but it is not a v2 signed envelope. Whirr will not present it as signed or
                verified. Keep v1 receipts for compatibility, but verify their semantics with the server-side receipt
                checks rather than this signature tool.
              </Notice>
            ) : null}
          </section>

          <section className="card stack">
            <span className="eyebrow">Tamper lab · local only</span>
            <h2 className="h3">Edit one field and watch the seal fail.</h2>
            <p className="small muted">
              This mutates only the JSON in this textarea. Nothing is written to the server and no real session changes.
            </p>
            <div className="row">
              <Button variant="secondary" size="sm" onClick={() => void tamper('amount')}>Change the amount</Button>
              <Button variant="secondary" size="sm" onClick={() => void tamper('object')}>Change the object name</Button>
              <Button variant="secondary" size="sm" onClick={() => void tamper('interval')}>Edit an interval</Button>
              <Button variant="secondary" size="sm" onClick={() => void tamper('merkle')}>Edit the Merkle root</Button>
              <Button variant="secondary" size="sm" onClick={() => void tamper('passport')}>Edit the passport key</Button>
              <Button variant="secondary" size="sm" onClick={() => void tamper('key')}>Substitute the bundle key</Button>
              <Button variant="danger" size="sm" onClick={() => void tamper('signature')}>Corrupt the signature</Button>
            </div>
          </section>
        </div>

        <aside className="stack">
          {result ? (
            <section className="card stack">
              <div className="row row--between">
                <span className="eyebrow">Result</span>
                <span className={`chip ${result.valid ? 'chip--ok' : 'chip--danger'}`}>
                  {result.valid ? 'signature + semantics pass' : 'does not verify'}
                </span>
              </div>
              <h2 className="h3">{result.kind === 'passport' ? 'Signed passport' : result.kind === 'receipt-proof' ? 'Signed receipt proof' : 'Unknown document'}</h2>
              <p className="small muted">
                {result.valid
                  ? 'The signature matches the embedded installation key, and the visible document fields satisfy the protocol checks.'
                  : 'The document is not trustworthy as a signed artifact. Do not use it to settle, accuse or justify a charge.'}
              </p>
              <div className="stack" style={{ gap: '0.5rem' }}>
                {result.checks.map((entry) => (
                  <div key={entry.id} className={`check-row check-row--${entry.pass ? 'pass' : 'fail'}`}>
                    <Icon name={entry.pass ? 'check' : 'alert'} size={16} />
                    <div>
                      <strong>{entry.label}</strong>
                      <p>{entry.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
              <dl className="kv">
                <dt>Type</dt>
                <dd>{result.kind}</dd>
                <dt>Key</dt>
                <dd className="mono tiny break">{String((result.envelope as unknown as { keyId?: string }).keyId ?? '—')}</dd>
              </dl>
            </section>
          ) : (
            <section className="card card--soft stack">
              <span className="eyebrow">What this proves</span>
              <h2 className="h3">A seal is a statement about bytes.</h2>
              <p className="small muted">
                A valid signature means this installation produced these document bytes and fields. It is not a
                third-party identity, a trusted timestamp, or proof that a physical object was present.
              </p>
              <ul className="checklist checklist--x">
                <li><Icon name="alert" size={15} /> <span className="small">It does not prove the object was switched on.</span></li>
                <li><Icon name="alert" size={15} /> <span className="small">It does not prevent a similar machine or playback.</span></li>
                <li><Icon name="alert" size={15} /> <span className="small">It does not verify a PayPal capture by itself.</span></li>
              </ul>
              <Link to="/judge" className="link tiny">See the full judge gauntlet →</Link>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}