import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Icons } from '../Icons';
import { Modal } from '../primitives';
import { logout, liteRequest } from '../../lib/api';
import { enableNotifications } from '../../lib/notifications';
import { cls } from '../../lib/util';
import type { Theme } from '../../types';

type Runtime = { provider: string; llamaUrl: string; llamaModel: string; localModel: string; embeddingModel: string; copilotModel: string; chatgptModel: string };
type Login = { status: 'running' | 'succeeded' | 'failed'; url?: string; code?: string; message?: string };
function ProviderSignIn({ provider }: { provider: 'copilot' | 'chatgpt' }) {
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const status = useQuery({ queryKey: ['provider-login', provider], queryFn: () => liteRequest<Login>(`/providers/${provider}/login`), enabled: started, refetchInterval: query => query.state.data?.status === 'running' ? 1000 : false });
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
function ModelSettings() {
  const client = useQueryClient();
  const runtime = useQuery({ queryKey: ['runtime'], queryFn: () => liteRequest<Runtime>('/runtime') });
  const [message, setMessage] = useState('');
  const save = useMutation({ mutationFn: (value: Runtime) => liteRequest('/runtime', { method: 'PUT', body: JSON.stringify(value) }), onSuccess: () => { setMessage('Model settings saved.'); client.invalidateQueries({ queryKey: ['runtime'] }); } });
  if (!runtime.data) return <p role="status">{runtime.error?.message ?? 'Loading models…'}</p>;
  return <div className="settings-card"><h3>Models</h3>
    <p className="page-subtle">EmbeddingGemma runs locally. Completion and consolidation use the provider you choose; only that provider receives their input.</p>
    <form key={JSON.stringify(runtime.data)} className="settings-model-form" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      save.mutate({ ...runtime.data!, provider: String(form.get('provider')), localModel: String(form.get('localModel')), llamaUrl: String(form.get('llamaUrl')), llamaModel: String(form.get('llamaModel')), copilotModel: String(form.get('copilotModel')), chatgptModel: String(form.get('chatgptModel')) });
    }}>
      <label>Completion provider<select name="provider" defaultValue={runtime.data.provider}><option value="ollama">Local · Ollama</option><option value="llama.cpp">Local · llama.cpp</option><option value="copilot">GitHub Copilot</option><option value="chatgpt">ChatGPT · Codex</option></select></label>
      <label>Local model<input name="localModel" defaultValue={runtime.data.localModel} required /></label>
      <label>llama.cpp endpoint<input name="llamaUrl" defaultValue={runtime.data.llamaUrl} type="url" required /></label>
      <label>llama.cpp model<input name="llamaModel" defaultValue={runtime.data.llamaModel} required /></label>
      <label>Copilot model<input name="copilotModel" defaultValue={runtime.data.copilotModel} required /></label>
      <label>ChatGPT model<input name="chatgptModel" defaultValue={runtime.data.chatgptModel} required /></label>
      <button type="submit" className="btn btn-primary" disabled={save.isPending}>Save model settings</button>
    </form>
    {message && <p role="status">{message}</p>}{save.error && <p role="alert">{save.error.message}</p>}
    <ProviderSignIn provider="copilot" /><ProviderSignIn provider="chatgpt" />
    <p className="page-subtle">Sign-in is stored in this installation’s private Docker volume.</p>
  </div>;
}
function NotificationSettings() {
  const [message, setMessage] = useState('Reminders are delivered while this app is open. HTTPS is required on phones.');
  return <div className="settings-card"><h3>Browser notifications</h3><p className="page-subtle">{message}</p>
    <div className="row-flex gap-2"><button type="button" className="btn" onClick={async () => {
      try { const permission = await enableNotifications(); setMessage(permission === 'granted' ? 'Enabled for this browser. Due todo reminders will appear.' : 'Notifications are blocked or dismissed. Change your browser’s site permissions to enable them.'); }
      catch (err) { setMessage(err instanceof Error ? err.message : String(err)); }
    }}>Enable reminders</button>
    <button type="button" className="btn" onClick={() => { localStorage.removeItem('obl-notifications'); setMessage('Reminders disabled for this browser.'); }}>Disable reminders</button></div>
  </div>;
}
export function SettingsModal({ theme, onTheme, onClose }: { theme: Theme; onTheme: (t: Theme) => void; onClose: () => void }) {
  return <Modal title="Settings" size="lg" onClose={onClose}>
    <div className="settings-card"><div className="settings-row"><div><div className="settings-row-h">Appearance</div><div className="page-subtle">Choose a light or dark workspace.</div></div><div className="thm-toggle">
      <button type="button" className={cls(theme === 'dark' && 'active')} onClick={() => onTheme('dark')} aria-label="Dark theme"><Icons.Moon size={13} /></button>
      <button type="button" className={cls(theme === 'light' && 'active')} onClick={() => onTheme('light')} aria-label="Light theme"><Icons.Sun size={13} /></button>
    </div></div></div>
    <ModelSettings /><NotificationSettings />
    <div className="settings-card"><div className="settings-row"><p>Open Brain Lite · local project memory</p><button type="button" className="btn" onClick={logout}>Lock workspace</button></div></div>
  </Modal>;
}
