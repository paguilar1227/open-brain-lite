import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerEnvironment } from '../../../src/providers/environment.js';

afterEach(() => vi.unstubAllEnvs());
describe('installation-owned provider environments', () => {
  it('does not forward installation keys, ambient provider tokens or model overrides', () => {
    for (const name of ['OPEN_BRAIN_API_KEY', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_SDK_AUTH_TOKEN', 'COPILOT_CLI_PATH', 'NODE_OPTIONS']) vi.stubEnv(name, 'must-not-leave-parent');
    const env = providerEnvironment('/installation/auth', 'copilot');
    expect(Object.values(env)).not.toContain('must-not-leave-parent');
    expect(env).toMatchObject({ CODEX_HOME: '/installation/auth/codex', COPILOT_HOME: '/installation/auth/copilot', COPILOT_DISABLE_KEYTAR: '1', PATH: '' });
  });
  it('keeps platform and network settings without changing the parent environment', () => {
    vi.stubEnv('PATH', '/parent/bin');
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example');
    expect(providerEnvironment('/installation/auth', 'chatgpt')).toMatchObject({ PATH: '/parent/bin', HTTPS_PROXY: 'http://proxy.example' });
    expect(providerEnvironment('/installation/auth', 'copilot').PATH).toBe('');
    expect(process.env.PATH).toBe('/parent/bin');
  });
});
