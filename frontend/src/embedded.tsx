import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ErrorBoundary, AppErrorFallback } from './components/ErrorBoundary';
import { bootAuth } from './lib/api';
import { configureHost, type EmbeddedHost } from './lib/host';
import styles from './styles.css?inline';
import theme from './theme.css?inline';

/** The same application and API client used by the standalone web entry. */
export async function mount(element: HTMLElement, options: Omit<EmbeddedHost, 'element'>) {
  configureHost({ ...options, element });
  const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = (styles + theme).replace(/:root/g, ':host').replace(/\[data-theme=(["'])(dark|light)\1\]/g, ':host([data-theme="$2"])').replace(/\bhtml\s*,\s*body\b/g, ':host').replace(/(?<![\w.-])body\b/g, '.brain-root').replace(/url\(['"]?\/([^)'" ]+)['"]?\)/g, (_match: string, path: string) => `url('${options.assetBase}/${path}')`) + '\n:host{display:block;height:100%;min-height:0}.brain-root,.app{height:100%;width:100%;min-height:0}.brain-root{position:relative;isolation:isolate;overflow:hidden}.app{min-height:0!important}';
  const surface = document.createElement('div'); surface.className = 'brain-root';
  shadow.replaceChildren(style, surface);
  await bootAuth();
  const root = createRoot(surface), query = new QueryClient();
  root.render(<React.StrictMode><ErrorBoundary label="embedded-brain" fallback={error => <AppErrorFallback error={error} />}><QueryClientProvider client={query}><ConfirmProvider><App /></ConfirmProvider></QueryClientProvider></ErrorBoundary></React.StrictMode>);
  return { unmount() { root.unmount(); query.clear(); shadow.replaceChildren(); } };
}
