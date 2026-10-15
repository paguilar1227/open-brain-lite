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

// bootAuth resolves the Bearer key in production by exchanging the Easy Auth
// session cookie via /api/auth/token. In local dev (VITE_OPEN_BRAIN_API_KEY
// set) it's a no-op. If the user's session has expired bootAuth performs a
// hard navigation to the AAD login URL and never resolves — that's why we
// don't render anything inside the catch.
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
        <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); signIn(String(data.get('key') ?? '')); }}>
          <label htmlFor="key">Installation API key</label>
          <input id="key" name="key" type="password" required autoComplete="current-password" />
          <button className="btn btn-primary" type="submit">Open my brain</button>
        </form>
        <p className="page-subtle">Find the key in the .env file created by the setup command.</p>
        {err?.message !== 'LOCAL_LOGIN_REQUIRED' && <p role="alert">{String(err?.message ?? err)}</p>}
      </main>,
    );
  });
