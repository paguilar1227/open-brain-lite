// Side-effect module: must be imported BEFORE anything that reaches for
// `http`, `https`, `fetch`, or `pg`. The Azure Monitor distro patches
// those modules at require-time, so any import that resolves them first
// will silently miss instrumentation.
//
// No-op when APPLICATIONINSIGHTS_CONNECTION_STRING is unset, so local
// dev, vitest, and the stub-mode e2e stack stay quiet.
import { useAzureMonitor } from '@azure/monitor-opentelemetry';

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

if (connectionString) {
  // service.name / service.version are set via OTEL_SERVICE_NAME and
  // OTEL_SERVICE_VERSION env vars on the Container App — no Resource
  // instance needed in code.
  useAzureMonitor({ azureMonitorExporterOptions: { connectionString } });
  // eslint-disable-next-line no-console
  console.log('[telemetry] Azure Monitor OpenTelemetry distro initialized');
}
