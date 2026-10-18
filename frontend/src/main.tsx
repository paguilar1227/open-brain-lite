import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ErrorBoundary, AppErrorFallback } from './components/ErrorBoundary';
import { queryClient } from './lib/queryClient';
import { bootAuth, signIn } from './lib/api';
import './styles.css';
import './theme.css';
import { startNotifications } from './lib/notifications';

// Open the local workspace directly; authenticated servers retain their login.
bootAuth()
  .then(() => {
    startNotifications();
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <ErrorBoundary label="app-root" fallback={(error) => <AppErrorFallback error={error} />}>
          <QueryClientProvider client={queryClient}>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </React.StrictMode>,
    );
  })
  .catch((err) => {
    const root = document.getElementById('root');
    if (root) ReactDOM.createRoot(root).render(
      <main className="login-card">
        <h1>Open Brain Lite</h1>
        <p>Your projects. Your memory. On your machine.</p>
        {err?.message === 'AUTH_REQUIRED' ? <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); signIn(String(data.get('key') ?? '')); }}>
          <label htmlFor="key">Workspace API key</label>
          <input id="key" name="key" type="password" required autoComplete="current-password" />
          <button className="btn btn-primary" type="submit">Open my brain</button>
        </form> : <><p role="alert">{String(err?.message ?? err)}</p><button className="btn" onClick={() => window.location.reload()}>Retry connection</button></>}
      </main>,
    );
  });
