import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

// A child that throws on demand — the render-phase failure boundaries exist for.
function Boom({ when }: { when: boolean }) {
  if (when) throw new Error('boom');
  return <div>safe content</div>;
}

afterEach(cleanup);

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary fallback={() => <div>fallback</div>}>
        <div>hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('renders the fallback and reports the error instead of unmounting', () => {
    const onError = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary label="test" onError={onError} fallback={(e) => <div>caught: {e.message}</div>}>
        <Boom when />
      </ErrorBoundary>,
    );
    expect(screen.getByText('caught: boom')).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('reset() re-renders the children once the cause is gone', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Harness() {
      const [boom, setBoom] = useState(true);
      return (
        <ErrorBoundary
          fallback={(_e, reset) => (
            <button onClick={() => { setBoom(false); reset(); }}>retry</button>
          )}
        >
          <Boom when={boom} />
        </ErrorBoundary>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByText('retry'));
    expect(screen.getByText('safe content')).toBeTruthy();
    spy.mockRestore();
  });

  // Regression for the navigation case: a stale crash must clear when a resetKey
  // (route / modal / tab) changes, without the user having to click Retry.
  it('auto-resets when a resetKey changes', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Harness() {
      const [key, setKey] = useState(0);
      const [boom, setBoom] = useState(true);
      return (
        <>
          <button onClick={() => { setBoom(false); setKey(1); }}>navigate</button>
          <ErrorBoundary resetKeys={[key]} fallback={() => <div>fallback</div>}>
            <Boom when={boom} />
          </ErrorBoundary>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByText('fallback')).toBeTruthy();
    fireEvent.click(screen.getByText('navigate'));
    expect(screen.getByText('safe content')).toBeTruthy();
    spy.mockRestore();
  });
});
