import { describe, it, expect, vi, beforeEach } from 'vitest';

// useAzureMonitor() throws under jsdom-less / unset connection-string
// scenarios if it ever actually runs. We mock the module so the test
// can assert call shape without spinning up the SDK.
const useAzureMonitorMock = vi.fn();
vi.mock('@azure/monitor-opentelemetry', () => ({
  useAzureMonitor: useAzureMonitorMock,
}));

describe('telemetry init', () => {
  beforeEach(() => {
    useAzureMonitorMock.mockReset();
    vi.resetModules();
    delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  });

  it('is a no-op when APPLICATIONINSIGHTS_CONNECTION_STRING is unset', async () => {
    await import('../../src/telemetry.js');
    expect(useAzureMonitorMock).not.toHaveBeenCalled();
  });

  it('initializes useAzureMonitor with the connection string when set', async () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING =
      'InstrumentationKey=00000000-0000-0000-0000-000000000000';
    await import('../../src/telemetry.js');
    expect(useAzureMonitorMock).toHaveBeenCalledOnce();
    const arg = useAzureMonitorMock.mock.calls[0][0];
    expect(arg.azureMonitorExporterOptions.connectionString).toBe(
      'InstrumentationKey=00000000-0000-0000-0000-000000000000',
    );
  });
});
