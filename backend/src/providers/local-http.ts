import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** Local CPU inference may take minutes before returning any response headers.
 * Node fetch imposes a five-minute headers deadline. Native HTTP has no such
 * default deadline, while connection and response errors still reject normally.
 */
export function postLocalJson(url: string, body: unknown, label: string): Promise<any> {
  const target = new URL(url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${label}: HTTP ${response.statusCode}: ${text.slice(0, 300)}`));
          return;
        }
        try { resolve(JSON.parse(text)); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
}
