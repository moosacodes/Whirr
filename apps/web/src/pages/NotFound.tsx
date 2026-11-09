import { LinkButton, usePageTitle } from '../components/ui.tsx';
import { Icon } from '../components/visuals.tsx';

export function NotFound() {
  usePageTitle('Not found');
  return (
    <div className="page container page--narrow">
      <div className="card stack" style={{ padding: 'clamp(2rem, 6vw, 4rem)' }}>
        <span className="eyebrow">404 · no such surface</span>
        <h1 className="display display--sm">This object is not in the room.</h1>
        <p className="lede">
          The page you asked for does not exist, or the service card has not been published yet. A service
          card only becomes public after an operator trains a READY model and publishes terms.
        </p>
        <div className="row">
          <LinkButton to="/" variant="primary">
            Back to Whirr <Icon name="arrow" size={16} />
          </LinkButton>
          <LinkButton to="/judge" variant="secondary">
            Judge mode
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
