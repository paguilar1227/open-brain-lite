// tests/unit/storage/blob.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpload = vi.fn();
const mockGetProperties = vi.fn();
const mockGetBlockBlobClient = vi.fn(() => ({
  upload: mockUpload,
  getProperties: mockGetProperties,
  url: 'https://storage.blob.core.windows.net/container/test-file',
}));
const mockGetContainerClient = vi.fn(() => ({
  getBlockBlobClient: mockGetBlockBlobClient,
}));

const mockSharedKeyCredentialCtor = vi.fn();
const mockGenerateBlobSAS = vi.fn(() => ({ toString: () => 'sig=fake-sas-token&se=2099-01-01' }));
const mockBlobSASPermissions = { parse: vi.fn((s: string) => ({ permissions: s })) };

vi.mock('@azure/storage-blob', () => ({
  BlobServiceClient: {
    fromConnectionString: vi.fn(() => ({
      getContainerClient: mockGetContainerClient,
    })),
  },
  StorageSharedKeyCredential: mockSharedKeyCredentialCtor,
  generateBlobSASQueryParameters: mockGenerateBlobSAS,
  BlobSASPermissions: mockBlobSASPermissions,
}));

const VALID_CONN = 'DefaultEndpointsProtocol=https;AccountName=testacct;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net';
const ACCOUNT_HOST_PREFIX = 'https://testacct.blob.core.windows.net/test-container/';

describe('BlobStorage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads a file and returns the URL', async () => {
    mockUpload.mockResolvedValueOnce({});

    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');

    const url = await storage.upload('test-file.jpg', Buffer.from('data'), 'image/jpeg');
    expect(url).toContain('test-file');
    expect(mockUpload).toHaveBeenCalled();
  });

  it('checks if a blob exists', async () => {
    mockGetProperties.mockResolvedValueOnce({});

    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');

    const exists = await storage.exists('test-file.jpg');
    expect(exists).toBe(true);
  });

  it('returns false when blob does not exist', async () => {
    mockGetProperties.mockRejectedValueOnce({ statusCode: 404 });

    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');

    const exists = await storage.exists('missing.jpg');
    expect(exists).toBe(false);
  });

  it('rejects connection strings missing AccountName / AccountKey', async () => {
    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    expect(() => createBlobStorage('AccountName=foo', 'c')).toThrow(/missing AccountName or AccountKey/);
    expect(() => createBlobStorage('garbage', 'c')).toThrow();
  });
});

describe('BlobStorage.getReadSasUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('appends a SAS token to a same-account URL', async () => {
    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');

    const blobUrl = `${ACCOUNT_HOST_PREFIX}1234-sample.pdf`;
    const signed = storage.getReadSasUrl(blobUrl);

    expect(signed).toBe(`${blobUrl}?sig=fake-sas-token&se=2099-01-01`);
    expect(mockGenerateBlobSAS).toHaveBeenCalledOnce();
    const callArgs = mockGenerateBlobSAS.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.containerName).toBe('test-container');
    expect(callArgs.blobName).toBe('1234-sample.pdf');
    expect(mockBlobSASPermissions.parse).toHaveBeenCalledWith('r');
  });

  it('passes through URLs that already contain a SAS token', async () => {
    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');

    const blobUrl = `${ACCOUNT_HOST_PREFIX}foo.pdf?sig=existing&se=2099-01-01`;
    expect(storage.getReadSasUrl(blobUrl)).toBe(blobUrl);
    expect(mockGenerateBlobSAS).not.toHaveBeenCalled();
  });

  it('passes through URLs from a different account / container without signing', async () => {
    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');

    const externalUrl = 'https://otheraccount.blob.core.windows.net/other/foo.png';
    expect(storage.getReadSasUrl(externalUrl)).toBe(externalUrl);
    expect(mockGenerateBlobSAS).not.toHaveBeenCalled();
  });

  it('passes through empty / falsy URLs', async () => {
    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');
    expect(storage.getReadSasUrl('')).toBe('');
  });

  it('uses a 60-minute default TTL but accepts an override', async () => {
    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');
    const before = Date.now();

    storage.getReadSasUrl(`${ACCOUNT_HOST_PREFIX}default.pdf`);
    const defaultExpiry = (mockGenerateBlobSAS.mock.calls[0][0] as any).expiresOn as Date;
    expect(defaultExpiry.getTime()).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1000);
    expect(defaultExpiry.getTime()).toBeLessThanOrEqual(before + 60 * 60 * 1000 + 1000);

    mockGenerateBlobSAS.mockClear();
    storage.getReadSasUrl(`${ACCOUNT_HOST_PREFIX}custom.pdf`, 5);
    const customExpiry = (mockGenerateBlobSAS.mock.calls[0][0] as any).expiresOn as Date;
    expect(customExpiry.getTime()).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
    expect(customExpiry.getTime()).toBeLessThanOrEqual(before + 5 * 60 * 1000 + 2000);
  });
});

describe('BlobStorage.getDownloadSasUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signs with contentDisposition so the storage service returns Content-Disposition: attachment', async () => {
    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');

    const blobUrl = `${ACCOUNT_HOST_PREFIX}1234-sample.pdf`;
    const signed = storage.getDownloadSasUrl(blobUrl, 'Sample document.pdf');

    expect(signed).toBe(`${blobUrl}?sig=fake-sas-token&se=2099-01-01`);
    const callArgs = mockGenerateBlobSAS.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.containerName).toBe('test-container');
    expect(callArgs.blobName).toBe('1234-sample.pdf');
    // The disposition is the whole point — without it the browser navigates
    // cross-origin even though the link has `download`.
    expect(callArgs.contentDisposition).toBe(
      'attachment; filename="Sample document.pdf"; filename*=UTF-8\'\'Sample%20document.pdf',
    );
  });

  it('strips non-ASCII chars from the bare filename and keeps the original in filename*', async () => {
    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');

    storage.getDownloadSasUrl(`${ACCOUNT_HOST_PREFIX}f.pdf`, 'résumé — final.pdf');

    const callArgs = mockGenerateBlobSAS.mock.calls[0][0] as Record<string, unknown>;
    const disposition = callArgs.contentDisposition as string;
    // Bare filename is ASCII-safe (underscores in for unicode chars), unicode
    // version goes in filename* per RFC 5987 / 6266.
    expect(disposition).toMatch(/^attachment; filename="[\x20-\x7E]+"; filename\*=UTF-8''/);
    expect(disposition).toContain(encodeURIComponent('résumé — final.pdf'));
    expect(disposition).not.toMatch(/filename="[^"]*[^\x20-\x7E][^"]*"/);
  });

  it('passes through cross-account / already-signed / empty URLs without calling the SAS generator', async () => {
    const { createBlobStorage } = await import('../../../src/storage/blob.js');
    const storage = createBlobStorage(VALID_CONN, 'test-container');

    expect(storage.getDownloadSasUrl('', 'x.pdf')).toBe('');
    expect(
      storage.getDownloadSasUrl(`${ACCOUNT_HOST_PREFIX}foo.pdf?sig=existing`, 'foo.pdf'),
    ).toBe(`${ACCOUNT_HOST_PREFIX}foo.pdf?sig=existing`);
    expect(
      storage.getDownloadSasUrl('https://other.blob.core.windows.net/c/foo.pdf', 'foo.pdf'),
    ).toBe('https://other.blob.core.windows.net/c/foo.pdf');
    expect(mockGenerateBlobSAS).not.toHaveBeenCalled();
  });
});
