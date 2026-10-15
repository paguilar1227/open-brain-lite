import { describe, it, expect } from 'vitest';
import { inferMimeFromFilename, resolveUploadMime } from '../../../src/capture/mime-utils.js';

describe('inferMimeFromFilename', () => {
  it('maps common extensions to their MIME types', () => {
    expect(inferMimeFromFilename('sample.wav')).toBe('audio/wav');
    expect(inferMimeFromFilename('photo.JPG')).toBe('image/jpeg');
    expect(inferMimeFromFilename('photo.jpeg')).toBe('image/jpeg');
    expect(inferMimeFromFilename('voice.m4a')).toBe('audio/mp4');
    expect(inferMimeFromFilename('clip.mp4')).toBe('video/mp4');
    expect(inferMimeFromFilename('doc.PDF')).toBe('application/pdf');
    expect(inferMimeFromFilename('image.png')).toBe('image/png');
  });

  it('returns null for unknown extensions', () => {
    expect(inferMimeFromFilename('binary.xyz')).toBeNull();
    expect(inferMimeFromFilename('no-extension')).toBeNull();
    expect(inferMimeFromFilename('.hidden')).toBeNull();
  });

  it('handles paths with multiple dots — uses the last extension', () => {
    expect(inferMimeFromFilename('file.tar.gz')).toBeNull();
    expect(inferMimeFromFilename('photo.backup.jpg')).toBe('image/jpeg');
  });
});

describe('resolveUploadMime', () => {
  it('keeps a client-declared MIME type when it is informative', () => {
    expect(resolveUploadMime('image/png', 'whatever.txt')).toBe('image/png');
  });

  it('falls back to filename inference when client sends application/octet-stream', () => {
    expect(resolveUploadMime('application/octet-stream', 'sample.wav')).toBe('audio/wav');
    expect(resolveUploadMime('application/octet-stream', 'doc.pdf')).toBe('application/pdf');
  });

  it('falls back to filename inference when client sends nothing', () => {
    expect(resolveUploadMime(null, 'photo.jpg')).toBe('image/jpeg');
    expect(resolveUploadMime(undefined, 'photo.jpg')).toBe('image/jpeg');
    expect(resolveUploadMime('', 'clip.mp4')).toBe('video/mp4');
  });

  it('returns octet-stream as last resort when filename is unhelpful', () => {
    expect(resolveUploadMime('', 'binary.xyz')).toBe('application/octet-stream');
    expect(resolveUploadMime('application/octet-stream', 'no-extension')).toBe('application/octet-stream');
  });
});
