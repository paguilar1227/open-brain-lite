import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { BlobStorage } from './blob.js';

export class LocalFileStorage implements BlobStorage {
  constructor(private root: string, private key: string) {}
  private name(value: string) {
    const raw = value.startsWith('/api/files/') ? decodeURIComponent(value.split('?')[0].slice('/api/files/'.length)) : value;
    if (!raw || raw.includes('\0') || raw.includes('\\')) throw new Error('Invalid file path');
    const path = resolve(this.root, raw);
    if (!path.startsWith(resolve(this.root) + sep)) throw new Error('File path escapes storage');
    return { name: raw, path };
  }
  private signature(name: string, expires: string, filename: string) {
    return createHmac('sha256', this.key).update(JSON.stringify([name, expires, filename])).digest('hex');
  }
  verify(name: string, expires: string, filename: string, signature: string): boolean {
    if (!/^\d+$/.test(expires) || Number(expires) < Date.now()) return false;
    const expected = Buffer.from(this.signature(name, expires, filename));
    const provided = Buffer.from(signature);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
  async upload(name: string, data: Buffer, contentType: string) {
    const file = this.name(name);
    await mkdir(resolve(file.path, '..'), { recursive: true });
    const temp = `${file.path}.${randomUUID()}.tmp`;
    await writeFile(temp, data, { mode: 0o600 });
    await rename(temp, file.path);
    await writeFile(`${file.path}.json`, JSON.stringify({ contentType }), { mode: 0o600 });
    return this.getUrl(name);
  }
  async exists(name: string) { try { return (await stat(this.name(name).path)).isFile(); } catch (err: any) { if (err.code === 'ENOENT') return false; throw err; } }
  getUrl(name: string) { return `/api/files/${encodeURIComponent(this.name(name).name)}`; }
  async download(value: string) { return readFile(this.name(value).path); }
  async getSize(value: string) { return (await stat(this.name(value).path)).size; }
  async getContentType(value: string) { return JSON.parse(await readFile(`${this.name(value).path}.json`, 'utf8')).contentType as string; }
  getReadSasUrl(value: string, ttlMinutes = 60) { return this.sign(value, '', ttlMinutes); }
  getDownloadSasUrl(value: string, filename: string, ttlMinutes = 60) { return this.sign(value, filename, ttlMinutes); }
  private sign(value: string, filename: string, ttlMinutes: number) {
    if (!value) return value;
    const { name } = this.name(value);
    const expires = String(Date.now() + ttlMinutes * 60_000);
    const params = new URLSearchParams({ expires, filename, sig: this.signature(name, expires, filename) });
    return `${this.getUrl(name)}?${params}`;
  }
}
