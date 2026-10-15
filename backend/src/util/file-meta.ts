// Shared file-metadata helpers used by both the REST adapter (download SAS
// filenames) and the MCP `download` tool, so the MIME→extension map, the
// save-filename logic, and the human-size formatter have a single home.

export const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
};

/**
 * Pick a save-to-disk filename for a content item: its title, plus a sensible
 * extension derived from the MIME type when the title doesn't already carry
 * one. Falls back to "document" so a UUID never becomes the save name.
 *
 * Accepts a loose record (`rest` from the REST serializer, or a DB row) — only
 * `title` and `mime_type` are read.
 */
export function downloadFilename(item: { title?: unknown; mime_type?: unknown }): string {
  const title = (typeof item.title === 'string' ? item.title.trim() : '') || 'document';
  const mime = typeof item.mime_type === 'string' ? item.mime_type : '';
  const ext = MIME_TO_EXT[mime] ?? '';
  return /\.\w{2,5}$/.test(title) ? title : `${title}${ext}`;
}

/** Human-readable byte size, e.g. 4283910 → "4.1 MB". */
export function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}
