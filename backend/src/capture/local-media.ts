import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
export async function extractLocalMedia(action: 'transcribe' | 'url', source: string): Promise<{ text: string; title?: string }> {
  const script = fileURLToPath(new URL('../../python/media.py', import.meta.url));
  const { stdout } = await exec(process.env.MEDIA_PYTHON || '/opt/media/bin/python', [script, action, source]);
  const result = JSON.parse(stdout);
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('Local transcription returned no text');
  return result;
}
