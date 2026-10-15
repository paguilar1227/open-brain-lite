import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import type { Config } from '../config.js';
import { providerEnvironment } from './environment.js';
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
    let command: string;
    let args: string[];
    if (provider === 'chatgpt') {
      command = process.execPath;
      const cli = require.resolve('@openai/codex/bin/codex.js');
      args = [cli, 'login', '--device-auth'];
    } else {
      // Runtime API is pinned with the SDK dependency. No global CLI/auth state is used.
      const entry = import.meta.resolve('@github/copilot-sdk');
      const runtime = await import(new URL('./runtimeArtifacts.js', entry).href);
      command = await runtime.ensureRuntimeBundle('1.0.98');
      args = ['login', '--device-code'];
    }
    const env = providerEnvironment(this.config.authDir, provider);
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
    child.on('exit', code => { state.status = code === 0 ? 'succeeded' : 'failed'; state.message = code === 0 ? 'Signed in. Select this provider and save.' : 'Sign-in did not finish. Try again or check device-login access for your account.'; state.child = undefined; });
    return this.status(provider);
  }
}
