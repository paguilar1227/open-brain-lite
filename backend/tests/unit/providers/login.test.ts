import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Config } from '../../../src/config.js';

const mock = vi.hoisted(() => ({ mkdir: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs/promises', () => ({ mkdir: mock.mkdir }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));
import { ProviderLogin } from '../../../src/providers/login.js';

beforeEach(() => vi.clearAllMocks());

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
