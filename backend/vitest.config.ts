import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // The default 5s testTimeout is a wall-clock timer. With pool:'forks'
    // (one fork per CPU) the suite false-times-out under CPU contention in a
    // resource-limited CI container — a deterministic, fully-mocked test that
    // runs in ms on the host hits 5s when its fork is starved. A per-test
    // ceiling is free for the fast majority (they finish in ms) and only bites
    // when a test would otherwise exceed it; a real hang still fails, just at
    // 20s. De-noises CI without masking logic bugs.
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: 'forks',
    poolOptions: {
      forks: {
        // Each integration test file creates many full app instances — give forks enough heap
        execArgv: ['--max-old-space-size=4096'],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
    },
  },
});
