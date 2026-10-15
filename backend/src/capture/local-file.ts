import { extractLocalMedia } from './local-media.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mammoth from 'mammoth';
const exec = promisify(execFile);
export async function extractLocalFile(file: { data: Buffer; filename: string; mimeType: string }): Promise<string | null> {
  if (file.mimeType.startsWith('text/') || /\.(txt|md|markdown|csv|json)$/i.test(file.filename)) return file.data.toString('utf8');
  if (file.mimeType.includes('wordprocessingml') || /\.docx$/i.test(file.filename)) return (await mammoth.extractRawText({ buffer: file.data })).value;
  if (file.mimeType === 'application/pdf') return null; // existing local pdf-parse path
  if (file.mimeType.startsWith('image/')) {
    const dir = await mkdtemp(join(tmpdir(), 'brain-ocr-'));
    try {
      const path = join(dir, 'image');
      await writeFile(path, file.data);
      const { stdout } = await exec('tesseract', [path, 'stdout']);
      if (!stdout.trim()) throw new Error('No text found in this image. Add a text description to make it searchable.');
      return stdout;
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  if (file.mimeType.startsWith('audio/') || file.mimeType.startsWith('video/')) {
    const dir = await mkdtemp(join(tmpdir(), 'brain-transcribe-'));
    try {
      const path = join(dir, 'media');
      await writeFile(path, file.data);
      return (await extractLocalMedia('transcribe', path)).text;
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  throw new Error(`Local text extraction is not configured for ${file.mimeType}. Upload a text transcript or supported document.`);
}
