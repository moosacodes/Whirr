import { useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { Button } from './ui.tsx';
import { Icon } from './visuals.tsx';

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Whirr Bench home">
      <span className="brand__mark" aria-hidden="true">
        <svg width="19" height="19" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <circle cx="16" cy="18" r="4.4" fill="currentColor" opacity=".9" />
          <path d="M7.5 15a9.2 9.2 0 0 1 17 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".8" />
          <path d="M3.5 12.5a13.7 13.7 0 0 1 25 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".45" />
        </svg>
      </span>
      <span className="brand__word">
        Whirr<span className="brand__dot" aria-hidden="true" />
      </span>
      <span className="brand__edition">Bench</span>
    </Link>
  );
}

export function SiteHeader() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Brand />
        <nav className="nav" aria-label="Main navigation">
          <NavLink to="/shelf">Bench</NavLink>
          <NavLink to="/invisible-checkout">Invisible checkout</NavLink>
          <NavLink to="/verify">Verify</NavLink>
          <NavLink to="/judge">Judge mode</NavLink>
          {session?.operator ? (
            <>
              <NavLink to="/studio">Studio</NavLink>
              <NavLink to="/studio/discovery">Discovery lab</NavLink>
              <NavLink to="/operator">Operator</NavLink>
            </>
          ) : (
            <NavLink to="/operator/login">Operator</NavLink>
          )}
        </nav>
        <div className="site-header__right">
          {session?.paypal.configured ? (
            <span className="chip chip--ok">
              <span className="chip__dot" aria-hidden="true" />
              PayPal Sandbox
            </span>
          ) : (
            <span className="chip chip--warn">
              <span className="chip__dot" aria-hidden="true" />
              Demo metering
            </span>
          )}
          {session?.operator ? (
            <>
              <span className="small muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session.displayName ?? 'Operator'}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="btn--inline"
                onClick={async () => {
                  await logout();
                  navigate('/');
                }}
              >
                Sign out
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <span>
          Whirr Bench — acoustic pay-per-use for shared workshops. Sandbox prototype, no real money.
        </span>
        <span className="row" style={{ gap: '0.5rem' }}>
          <Icon name="shield" size={14} />
          PayPal Sandbox only
          <span aria-hidden="true">·</span>
          <Link to="/judge">Evidence &amp; gates</Link>
        </span>
      </div>
    </footer>
  );
}

export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}
