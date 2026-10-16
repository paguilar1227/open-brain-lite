import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Config } from '../../../src/config.js';

const mock = vi.hoisted(() => ({ mkdir: vi.fn(), spawn: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn() }));
vi.mock('node:fs/promises', () => ({ mkdir: mock.mkdir, readFile: mock.readFile, writeFile: mock.writeFile, rename: mock.rename }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));
import { ProviderLogin } from '../../../src/providers/login.js';

beforeEach(() => {
  vi.clearAllMocks();
  mock.readFile.mockRejectedValue(Object.assign(new Error('absent'), { code: 'ENOENT' }));
  mock.writeFile.mockResolvedValue(undefined);
});

it('creates the isolated Codex home before starting device sign-in', async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  mock.spawn.mockImplementation((_command, _args, options) => {
    expect(mock.mkdir).toHaveBeenCalledWith(options.env.CODEX_HOME, { recursive: true });
    expect(options.env.CODEX_HOME).toBe('/installation/auth/codex');
    return child;
  });
  const login = new ProviderLogin({ authDir: '/installation/auth' } as Config);
  expect(await login.start('chatgpt')).toMatchObject({ status: 'running' });
});

it('starts Copilot device sign-in through the official CLI in the installation profile', async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  mock.spawn.mockReturnValue(child);
  const login = new ProviderLogin({ authDir: '/installation/auth' } as Config);

  expect(await login.start('copilot')).toMatchObject({ status: 'running' });
  expect(mock.writeFile).toHaveBeenCalledWith('/installation/auth/copilot/settings.json.tmp', JSON.stringify({ storeTokenPlaintext: true }), { mode: 0o600 });
  expect(mock.rename).toHaveBeenCalledWith('/installation/auth/copilot/settings.json.tmp', '/installation/auth/copilot/settings.json');
  expect(mock.spawn).toHaveBeenCalledWith(process.execPath, [
    expect.stringMatching(/@github\/copilot\/npm-loader\.js$/), '--no-auto-update', 'login', '--device-code',
  ], expect.objectContaining({ env: expect.objectContaining({
    HOME: '/installation/auth/copilot', XDG_CACHE_HOME: '/installation/auth/copilot/.cache',
    COPILOT_HOME: '/installation/auth/copilot', COPILOT_DISABLE_KEYTAR: '1', PATH: '',
  }) }));
  child.stdout.emit('data', Buffer.from('Open https://github.com/login/device and enter ABCD-1234\n'));
  expect(login.status('copilot')).toEqual({ status: 'running', url: 'https://github.com/login/device', code: 'ABCD-1234' });
  child.emit('exit', 0);
  expect(login.status('copilot')).toMatchObject({ status: 'succeeded' });
});

it('does not start authorization when installation credential storage could not be configured', async () => {
  mock.writeFile.mockRejectedValue(new Error('storage unavailable'));
  const login = new ProviderLogin({ authDir: '/installation/auth' } as Config);
  await expect(login.start('copilot')).rejects.toThrow('storage unavailable');
  expect(mock.spawn).not.toHaveBeenCalled();
});

it('preserves existing Copilot settings when enabling installation file storage', async () => {
  mock.readFile.mockResolvedValue(JSON.stringify({ theme: 'dark', storeTokenPlaintext: false }));
  mock.spawn.mockReturnValue(Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() }));
  await new ProviderLogin({ authDir: '/installation/auth' } as Config).start('copilot');
  expect(JSON.parse(mock.writeFile.mock.calls[0][1])).toEqual({ theme: 'dark', storeTokenPlaintext: true });
});
