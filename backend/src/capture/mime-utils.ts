// src/capture/mime-utils.ts
//
// Filename-extension → MIME type fallback for multipart uploads when the
// client doesn't send a useful Content-Type. Browsers via the File API
// usually get this right, but CLI clients (curl with `-F file=@...`) often
// send `application/octet-stream` or nothing. Without this, the multimodal
// embedding + Haiku metadata extraction paths silently skip the file
// because they key off the MIME type.

const EXT_TO_MIME: Record<string, string> = {
  // Documents
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',

  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',

  // Audio
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',

  // Video
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

/** Return the canonical MIME type for a filename's extension, or null if unknown. */
export function inferMimeFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = lower.slice(dot);
  return EXT_TO_MIME[ext] ?? null;
}

/**
 * Pick the best MIME type for an uploaded file.
 *
 * Preference order:
 *   1. Client-declared type, IF it's not the useless `application/octet-stream`
 *      fallback (which means "I have no idea")
 *   2. Inferred from filename extension
 *   3. `application/octet-stream` as final fallback
 */
export function resolveUploadMime(declaredType: string | null | undefined, filename: string): string {
  const declared = (declaredType ?? '').trim();
  const isUseless = !declared || declared === 'application/octet-stream';
  if (!isUseless) return declared;
  return inferMimeFromFilename(filename) ?? 'application/octet-stream';
}
