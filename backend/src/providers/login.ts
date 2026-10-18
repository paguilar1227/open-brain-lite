import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import type { Config } from '../config.js';
import { providerEnvironment } from './environment.js';
import { trySelectCopilotDefault } from './subscription.js';
type Provider = 'copilot' | 'chatgpt';
const require = createRequire(import.meta.url);
type LoginState = { status: 'running' | 'succeeded' | 'failed'; url?: string; code?: string; message?: string; child?: ChildProcess };
export class ProviderLogin {
  private states = new Map<Provider, LoginState>();
  constructor(private config: Config) {}
  status(provider: Provider) {
    const { child, ...publicState } = this.states.get(provider) ?? { status: 'failed' as const, message: 'Not signed in through this app yet.' };
    return publicState;
  }
  async start(provider: Provider) {
    if (this.states.get(provider)?.status === 'running') return this.status(provider);
    await mkdir(join(this.config.authDir, provider === 'chatgpt' ? 'codex' : 'copilot'), { recursive: true });
    const env = providerEnvironment(this.config.authDir, provider);
    let command: string;
    let args: string[];
    if (provider === 'chatgpt') {
      command = process.execPath;
      const cli = require.resolve('@openai/codex/bin/codex.js');
      args = [cli, 'login', '--device-auth'];
    } else {
      // The SDK runtime serves inference; device sign-in belongs to the official CLI.
      command = process.execPath;
      const cli = require.resolve('@github/copilot/npm-loader.js');
      // This installation persists credentials in its private Docker volume.
      // A headless CLI cannot prompt to accept file storage when no OS keychain exists.
      const settingsPath = join(env.COPILOT_HOME, 'settings.json');
      let settings: Record<string, unknown> = {};
      try { settings = JSON.parse(await readFile(settingsPath, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Copilot settings must be a JSON object.');
      await writeFile(`${settingsPath}.tmp`, JSON.stringify({ ...settings, storeTokenPlaintext: true }), { mode: 0o600 });
      await rename(`${settingsPath}.tmp`, settingsPath);
      args = [cli, '--no-auto-update', 'login', '--device-code'];
    }
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const state: LoginState = { status: 'running', child };
    this.states.set(provider, state);
    let output = '';
    const collect = (data: Buffer) => {
      output += data.toString().replace(/\x1b\[[0-9;]*m/g, '');
      // Return only device authorization coordinates, never raw CLI output or credentials.
      state.url = output.match(/https:\/\/(?:auth\.openai\.com|github\.com)\/[^\s\x1b]+/)?.[0];
      state.code = output.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0];
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', () => { state.status = 'failed'; state.message = 'Sign-in could not start. Check the container logs and CLI installation.'; });
    child.on('exit', code => {
      state.child = undefined;
      state.status = code === 0 ? 'succeeded' : 'failed';
      state.message = code === 0 ? 'Signed in. Select this provider and save.' : 'Sign-in did not finish. Try again or check device-login access for your account.';
      if (code === 0 && provider === 'copilot' && this.config.autoSelectCopilot) {
        state.status = 'running';
        state.message = 'Signed in. Checking available models…';
        void trySelectCopilotDefault(this.config).then(selected => {
          state.message = selected ? 'Signed in. Copilot with Claude Sonnet 5.5 is now selected.' : 'Signed in. Select an available provider and save.';
        }).finally(() => { state.status = 'succeeded'; });
      }
    });
    return this.status(provider);
  }
}
