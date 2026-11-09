import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Button, Field, Notice, TextInput, usePageTitle } from '../components/ui.tsx';
import { Icon } from '../components/visuals.tsx';

export function OperatorLogin() {
  usePageTitle('Operator sign in');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh, session } = useAuth();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextParam = params.get('next');
  const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/studio';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/operator', { method: 'POST', body: { key: key.trim() } });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (session?.operator) {
    return (
      <div className="page container page--narrow">
        <Notice tone="ok" title="Already signed in.">
          You are signed in as {session.displayName ?? 'operator'}.{' '}
          <button className="link" onClick={() => navigate('/studio')}>
            Open the studio
          </button>
          .
        </Notice>
      </div>
    );
  }

  return (
    <div className="page container page--narrow">
      <div className="stack-lg">
        <header className="stack">
          <span className="eyebrow">Operator access</span>
          <h1 className="display display--sm">The owner's side of the meter.</h1>
          <p className="lede">
            The operator key is generated locally by <span className="mono">npm run setup</span> and never
            logged or sent to the browser. It is hashed into a signed, httpOnly session cookie.
          </p>
        </header>

        <form className="card stack" onSubmit={submit}>
          <Field
            label="Operator key"
            htmlFor="operator-key"
            hint={
              <>
                Read it with <span className="mono">npm run key</span>. Stored in{' '}
                <span className="mono">.whirr/operator-key</span> unless{' '}
                <span className="mono">WHIRR_OPERATOR_KEY</span> is set.
              </>
            }
            error={error}
          >
            <TextInput
              id="operator-key"
              name="key"
              type="password"
              autoComplete="current-password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="whirr_op_…"
              required
            />
          </Field>
          <div className="row row--between">
            <span className="tiny muted">
              <Icon name="lock" size={13} /> Session cookie is httpOnly and same-site.
            </span>
            <Button type="submit" loading={busy} disabled={key.trim().length < 8}>
              Sign in
            </Button>
          </div>
        </form>

        <div className="card card--soft">
          <h2 className="h3" style={{ marginBottom: '0.6rem' }}>
            First run?
          </h2>
          <ol className="small muted" style={{ paddingLeft: '1.2rem', margin: 0, lineHeight: 1.8 }}>
            <li>
              Run <span className="mono">npm run setup</span> to generate the operator key, create the
              database and seed the synthetic reference fan.
            </li>
            <li>
              Run <span className="mono">npm run dev</span> and open{' '}
              <span className="mono">http://localhost:5173</span>.
            </li>
            <li>Read the key with <span className="mono">npm run key</span> and paste it above.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
