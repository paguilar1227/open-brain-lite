import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Icons } from '../components/Icons';
import { logout, isLocalAccess, liteRequest } from '../lib/api';
import { enableNotifications } from '../lib/notifications';
import { cls } from '../lib/util';
import type { Theme } from '../types';

type Provider = 'ollama' | 'llama.cpp' | 'copilot' | 'chatgpt';
type Runtime = { provider: Provider; llamaUrl: string; llamaModel: string; localModel: string; embeddingModel: string; copilotModel: string; chatgptModel: string };
type Login = { status: 'running' | 'succeeded' | 'failed'; url?: string; code?: string; message?: string };
function ProviderSignIn({ provider }: { provider: 'copilot' | 'chatgpt' }) {
  const client = useQueryClient();
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const status = useQuery({ queryKey: ['provider-login', provider], queryFn: () => liteRequest<Login>(`/providers/${provider}/login`), enabled: started, refetchInterval: query => query.state.data?.status === 'running' ? 1000 : false });
  useEffect(() => {
    if (status.data?.status === 'succeeded') { void client.invalidateQueries({ queryKey: ['runtime'] }); void client.invalidateQueries({ queryKey: ['model-catalog', provider] }); }
  }, [status.data?.status, client]);
  return <div className="provider-login"><button type="button" className="btn" disabled={status.data?.status === 'running'} onClick={async () => {
    try { setError(''); await liteRequest(`/providers/${provider}/login`, { method: 'POST' }); setStarted(true); await status.refetch(); }
    catch (err) { setError(String(err)); }
  }}>Sign in with {provider === 'chatgpt' ? 'ChatGPT' : 'GitHub Copilot'}</button>
    {status.data?.url && <p><a href={status.data.url} target="_blank" rel="noreferrer">Open secure sign-in</a> {status.data.code && <code>{status.data.code}</code>}</p>}
    {status.data?.status === 'running' && <p className="page-subtle">Waiting for sign-in… If asked, enter the code above.</p>}
    {status.data?.message && <p role="status">{status.data.message}</p>}
    {(error || status.error) && <p role="alert">{error || status.error?.message}</p>}
  </div>;
}
type Catalog = { status: 'available' | 'sign_in_required' | 'manual' | 'unavailable'; models: Array<{ id: string; name: string }>; message: string };
const providers: Record<Provider, string> = { ollama: 'Local · Ollama', 'llama.cpp': 'Local · llama.cpp', copilot: 'GitHub Copilot', chatgpt: 'ChatGPT · Codex' };
const modelKeys = { ollama: 'localModel', 'llama.cpp': 'llamaModel', copilot: 'copilotModel', chatgpt: 'chatgptModel' } as const;

function ModelForm({ current }: { current: Runtime }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(current);
  const [custom, setCustom] = useState(false);
  const [message, setMessage] = useState('');
  const key = modelKeys[draft.provider];
  const catalog = useQuery({ queryKey: ['model-catalog', draft.provider], queryFn: () => liteRequest<Catalog>(`/providers/${draft.provider}/models`) });
  const save = useMutation({ mutationFn: (value: Runtime) => liteRequest('/runtime', { method: 'PUT', body: JSON.stringify(value) }), onSuccess: () => {
    setMessage('Model settings saved.'); void client.invalidateQueries({ queryKey: ['runtime'] });
  } });
  const change = (patch: Partial<Runtime>) => { setDraft(value => ({ ...value, ...patch })); setMessage(''); };
  const local = draft.provider === 'ollama' || draft.provider === 'llama.cpp';
  const options = catalog.data?.models ?? [];
  return <div className="settings-model-layout">
    <section className="settings-section" aria-labelledby="completion-heading">
      <div className="settings-section-heading"><span className="settings-role">01 / Completion</span><h2 id="completion-heading">Answers &amp; understanding</h2><p>Writes answers and project summaries, and extracts useful details from your uploads. One model handles these tasks.</p></div>
      <form className="settings-model-form" onSubmit={event => { event.preventDefault(); save.mutate({ ...draft }); }}>
        <div className="settings-active"><span>Currently saved</span><strong>{providers[current.provider]} · {current[modelKeys[current.provider]]}</strong></div>
        <label>Provider<select disabled={save.isPending} value={draft.provider} onChange={event => { change({ provider: event.target.value as Provider }); setCustom(false); }}>
          {Object.entries(providers).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <label>Completion model{options.length > 0 ? <select disabled={save.isPending} value={custom ? '__custom__' : draft[key]} onChange={event => {
          if (event.target.value === '__custom__') setCustom(true); else { setCustom(false); change({ [key]: event.target.value }); }
        }}>
          {!options.some(model => model.id === draft[key]) && <option value={draft[key]}>{draft[key]} (current choice)</option>}
          {options.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
          <option value="__custom__">Enter a model name…</option>
        </select> : <input disabled={save.isPending} required value={draft[key]} onChange={event => change({ [key]: event.target.value })} />}</label>
        {custom && <label>Custom model name<input disabled={save.isPending} required value={draft[key]} onChange={event => change({ [key]: event.target.value })} /></label>}
        <div className="settings-provider-status"><p role="status">{catalog.isPending ? 'Loading available models…' : catalog.data?.message ?? 'Could not load models. You can still enter a model name.'}</p><button type="button" className="btn btn-sm" disabled={catalog.isFetching} onClick={() => void catalog.refetch()}>Refresh models</button></div>
        <p className="page-subtle">{local ? 'Runs on your local model server.' : `Completion input is sent to ${providers[draft.provider]}. Embeddings stay local.`}</p>
        {draft.provider === 'llama.cpp' && <details className="settings-advanced"><summary>Advanced connection</summary><label>llama.cpp endpoint<input disabled={save.isPending} type="url" required value={draft.llamaUrl} onChange={event => change({ llamaUrl: event.target.value })} /></label></details>}
        <div className="settings-form-actions"><button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save model settings'}</button><button type="button" className="btn" disabled={save.isPending} onClick={() => { setDraft(current); setCustom(false); setMessage(''); }}>Reset changes</button></div>
        {message && <p role="status">{message}</p>}{save.error && <p role="alert">Couldn’t save model settings. {save.error.message}</p>}
      </form>
      {(draft.provider === 'copilot' || draft.provider === 'chatgpt') && <ProviderSignIn key={draft.provider} provider={draft.provider} />}
    </section>
    <section className="settings-section" aria-labelledby="embedding-heading">
      <div className="settings-section-heading"><span className="settings-role">02 / Embedding</span><h2 id="embedding-heading">Search &amp; retrieval</h2><p>Turns documents and searches into vectors so related information can be found. It does not write answers.</p></div>
      <div className="settings-embedding"><div><strong>{current.embeddingModel}</strong><span>Local · managed by this installation</span></div><span className="settings-local-badge">On device</span></div>
      <p className="page-subtle">Changing the embedding model requires rebuilding the search index, so it is managed during setup.</p>
    </section>
  </div>;
}
function ModelSettings() {
  const runtime = useQuery({ queryKey: ['runtime'], queryFn: () => liteRequest<Runtime>('/runtime') });
  if (runtime.isError) return <div role="alert"><p>Couldn’t load model settings.</p><button className="btn" onClick={() => void runtime.refetch()}>Try again</button></div>;
  if (!runtime.data) return <p role="status">Loading model settings…</p>;
  return <ModelForm current={runtime.data} />;
}
function NotificationSettings() {
  const [message, setMessage] = useState('Reminders are delivered while this app is open. HTTPS is required on phones.');
  return <div className="settings-section" id="notifications"><h2>Browser notifications</h2><p className="page-subtle">{message}</p>
    <div className="row-flex gap-2"><button type="button" className="btn" onClick={async () => {
      try { const permission = await enableNotifications(); setMessage(permission === 'granted' ? 'Enabled for this browser. Due todo reminders will appear.' : 'Notifications are blocked or dismissed. Change your browser’s site permissions to enable them.'); }
      catch (err) { setMessage(err instanceof Error ? err.message : String(err)); }
    }}>Enable reminders</button>
    <button type="button" className="btn" onClick={() => { localStorage.removeItem('obl-notifications'); setMessage('Reminders disabled for this browser.'); }}>Disable reminders</button></div>
  </div>;
}
export function SettingsPage({ theme, onTheme, onBack }: { theme: Theme; onTheme: (t: Theme) => void; onBack: () => void }) {
  return <div className="page settings-page">
    <header className="settings-page-heading"><div><h1>Settings</h1><p className="page-subtle">Your models, appearance, and preferences for this installation.</p></div><button type="button" className="btn" onClick={onBack}>Back to workspace</button></header>
    <ModelSettings />
    <section className="settings-section"><div className="settings-row"><div><h2>Appearance</h2><p className="page-subtle">Mono Drafting · light paper or dark charcoal.</p></div><div className="thm-toggle">
      <button type="button" className={cls(theme === 'dark' && 'active')} onClick={() => onTheme('dark')} aria-label="Dark theme" aria-pressed={theme === 'dark'}><Icons.Moon size={13} /></button>
      <button type="button" className={cls(theme === 'light' && 'active')} onClick={() => onTheme('light')} aria-label="Light theme" aria-pressed={theme === 'light'}><Icons.Sun size={13} /></button>
    </div></div></section>
    <NotificationSettings />
    <footer className="settings-section settings-row"><p className="page-subtle">Open Brain Lite · Sign-in is stored in this installation’s private Docker volume.</p>{!isLocalAccess() && <button type="button" className="btn" onClick={logout}>Lock workspace</button>}</footer>
  </div>;
}
