// Thin wrapper around the OpenTelemetry tracer API. When telemetry.ts
// initialized the SDK (i.e. APPLICATIONINSIGHTS_CONNECTION_STRING was
// set) these calls become real spans on the global TracerProvider. When
// it didn't, the no-op TracerProvider hands back no-op spans, so this
// helper costs effectively nothing in local dev or tests.
//
// Use this for the *entry points* we want to slice latency by — the
// service-layer functions adapters call into. Don't sprinkle it deep
// into helpers; auto-instrumentation already covers HTTP/pg/exceptions.
import { SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('open-brain-api');

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
