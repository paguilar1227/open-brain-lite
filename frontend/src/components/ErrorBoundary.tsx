import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Render the fallback UI. Gets the caught error + a reset() that clears the
   *  boundary and re-renders children. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** When any value here changes, the boundary auto-resets. Use it to clear the
   *  error on navigation / modal change / tab switch so a stale crash doesn't
   *  stick after the user has moved on. */
  resetKeys?: ReadonlyArray<unknown>;
  /** Names the boundary in logs/telemetry so we know WHICH one tripped. */
  label?: string;
  /** Observability hook — fired for every caught error. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/**
 * Catches render/lifecycle errors in its subtree and shows a fallback instead of
 * letting the throw unmount the whole React root (the "blank screen" failure).
 *
 * Note: React error boundaries only catch errors thrown during render, in
 * lifecycles, and in constructors — NOT in event handlers or async code. Those
 * paths (incl. React Query fetch errors) are handled where they occur.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Always surface it, tagged with the boundary that caught it. A frontend
    // telemetry sink can hang off this same call later.
    const tag = this.props.label ? `[ErrorBoundary: ${this.props.label}]` : '[ErrorBoundary]';
    console.error(tag, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !sameKeys(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}

function sameKeys(a?: ReadonlyArray<unknown>, b?: ReadonlyArray<unknown>): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

// ── Fallback UIs ────────────────────────────────────────────────────────────

/** Root: the last-resort net. A full-page card so the app never shows a bare
 *  background again. Reload is the only safe recovery from an app-level crash. */
export function AppErrorFallback({ error }: { error: Error }) {
  return (
    <div className="err-fullpage">
      <div className="err-card">
        <div className="err-title">Something went wrong</div>
        <p className="err-msg">
          The app hit an unexpected error and couldn’t continue. Reloading usually fixes it.
        </p>
        <pre className="err-detail">{error.message}</pre>
        <div className="err-actions">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}

/** Page view: the shell (sidebar, topbar, nav) stays alive around it, so the
 *  user can retry or navigate away. */
export function ViewErrorFallback({
  error,
  reset,
  onHome,
}: {
  error: Error;
  reset: () => void;
  onHome?: () => void;
}) {
  return (
    <div className="err-view">
      <div className="err-card">
        <div className="err-title">This view ran into a problem</div>
        <p className="err-msg">The rest of the app is fine — retry, or head back.</p>
        <pre className="err-detail">{error.message}</pre>
        <div className="err-actions">
          <button className="btn btn-primary" onClick={reset}>Retry</button>
          {onHome ? <button className="btn" onClick={onHome}>Go home</button> : null}
        </div>
      </div>
    </div>
  );
}

/** Widget / tab: compact, fits inside a column or tab body so its siblings keep
 *  working. */
export function PanelErrorFallback({
  error,
  reset,
  title = 'Couldn’t load this',
}: {
  error: Error;
  reset: () => void;
  title?: string;
}) {
  return (
    <div className="err-panel">
      <div className="err-panel-title">{title}</div>
      <div className="err-panel-msg" title={error.message}>{error.message}</div>
      <button className="btn btn-sm" onClick={reset}>Retry</button>
    </div>
  );
}

/** Modal / drawer: a crashed overlay degrades to a small dismissible overlay so
 *  the page behind it stays usable. */
export function ModalErrorFallback({ error, onClose }: { error: Error; onClose: () => void }) {
  return (
    <div className="err-overlay" role="alertdialog" aria-modal="true">
      <div className="err-card">
        <div className="err-title">This dialog ran into a problem</div>
        <p className="err-msg">It’s been closed so you can keep working. Nothing else was affected.</p>
        <pre className="err-detail">{error.message}</pre>
        <div className="err-actions">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
