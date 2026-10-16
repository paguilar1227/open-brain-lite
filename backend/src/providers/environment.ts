import { join } from 'node:path';

// Pass platform/network settings only. Installation secrets and ambient provider
// credentials must not silently select a different account or inference route.
const PLATFORM_ENV = [
  'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'WINDIR',
  'APPDATA', 'LOCALAPPDATA', 'PATH', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY',
  'https_proxy', 'http_proxy', 'no_proxy',
];

export function providerEnvironment(authDir: string, provider: 'copilot' | 'chatgpt'): Record<string, string> {
  const env = Object.fromEntries(PLATFORM_ENV.flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));
  env.CODEX_HOME = join(authDir, 'codex');
  env.COPILOT_HOME = join(authDir, 'copilot');
  env.COPILOT_DISABLE_KEYTAR = '1';
  env.GH_CONFIG_DIR = join(authDir, 'github-cli');
  // Copilot otherwise probes host CLI accounts and cached runtime packages.
  // Both login and inference use this installation-owned profile and cache.
  if (provider === 'copilot') {
    env.HOME = env.COPILOT_HOME;
    env.USERPROFILE = env.COPILOT_HOME;
    env.XDG_CACHE_HOME = join(env.COPILOT_HOME, '.cache');
    env.PATH = '';
  }
  return env;
}
