import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './visuals.tsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'money' | 'danger';

export function Button({
  variant = 'primary',
  size,
  loading,
  block,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'lg';
  loading?: boolean;
  block?: boolean;
}) {
  return (
    <button
      {...rest}
      className={`btn btn--${variant}${size ? ` btn--${size}` : ''}${block ? ' btn--block' : ''} ${className}`}
      disabled={rest.disabled || loading}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = 'primary',
  children,
  className = '',
  external,
  block,
}: {
  to: string;
  variant?: Variant;
  children: ReactNode;
  className?: string;
  external?: boolean;
  block?: boolean;
}) {
  const classes = `btn btn--${variant}${block ? ' btn--block' : ''} ${className}`;
  if (external) {
    return (
      <a className={classes} href={to} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  }
  return (
    <Link className={classes} to={to}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className ?? ''}`} />;
}

export function Check({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span>{children}</span>
    </label>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <span className="notice__icon" aria-hidden="true">
        <Icon name={tone === 'ok' ? 'check' : tone === 'danger' || tone === 'warn' ? 'alert' : 'info'} size={17} />
      </span>
      <div>
        {title ? <strong>{title} </strong> : null}
        {children}
      </div>
    </div>
  );
}

export function SandboxBanner({
  configured,
  webhookConfigured,
}: {
  configured: boolean;
  webhookConfigured?: boolean;
}) {
  if (configured) {
    return (
      <div className="sandbox-banner">
        <Icon name="shield" size={18} />
        <div>
          <strong>PayPal Sandbox only.</strong> Every amount is simulated; no real money can move. Webhooks:{' '}
          {webhookConfigured ? 'registered and signature-verified.' : 'not configured; provider polling only.'}
        </div>
      </div>
    );
  }
  return (
    <div className="sandbox-banner sandbox-banner--demo">
      <Icon name="alert" size={18} />
      <div>
        <strong>PayPal Sandbox is not configured on this installation.</strong> Sessions run in demo metering mode:
        usage is measured and receipts are issued, but no payment is created, authorized or captured. Add Sandbox
        credentials to <span className="mono">.env</span> to run the genuine flow.
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
  breadcrumbs,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head__copy">
        {breadcrumbs ? <div className="breadcrumbs">{breadcrumbs}</div> : null}
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1 className="display display--sm">{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'accent' | 'dark';
}) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h2 className="h3">{title}</h2>
      {children ? <p className="muted small" style={{ maxWidth: '46ch' }}>{children}</p> : null}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function CopyButton({ value, label = 'Copy', copiedLabel = 'Copied' }: { value: string; label?: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          window.prompt('Copy this link', value);
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={15} />
      {copied ? copiedLabel : label}
    </Button>
  );
}

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Whirr`;
    return () => {
      document.title = 'Whirr — make anything rentable';
    };
  }, [title]);
}

export function SkeletonCard() {
  return (
    <div className="card" aria-hidden="true">
      <div style={{ height: 14, width: '40%', background: 'var(--surface-2)', borderRadius: 6 }} />
      <div style={{ height: 34, width: '70%', background: 'var(--surface-2)', borderRadius: 8, marginTop: 16 }} />
      <div style={{ height: 12, width: '90%', background: 'var(--surface-2)', borderRadius: 6, marginTop: 18 }} />
      <div style={{ height: 12, width: '60%', background: 'var(--surface-2)', borderRadius: 6, marginTop: 8 }} />
    </div>
  );
}
