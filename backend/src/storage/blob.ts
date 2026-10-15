// src/storage/blob.ts
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} from '@azure/storage-blob';

export interface BlobStorage {
  upload(blobName: string, data: Buffer, contentType: string): Promise<string>;
  exists(blobName: string): Promise<boolean>;
  getUrl(blobName: string): string;
  /**
   * Download a same-account blob's bytes. Accepts either a bare blob name or a
   * full blob URL (with or without a SAS query). Throws if the URL belongs to
   * a different storage account/container.
   *
   * Used by the retry path on failed ingests to re-feed the original bytes
   * through the pipeline without requiring the caller to re-upload.
   */
  download(blobUrlOrName: string): Promise<Buffer>;
  /**
   * Size of a same-account blob in bytes via a single properties (HEAD) call —
   * no body transfer. Accepts a bare name or a full URL (with or without a SAS
   * query), same resolution rules as `download`. Lets callers report file size
   * without downloading the bytes.
   */
  getSize(blobUrlOrName: string): Promise<number>;
  /**
   * Append a read-only SAS query string to a blob URL so it can be fetched
   * without account credentials. Default TTL: 60 minutes.
   *
   * Pass-through behavior: returns the input URL unchanged if it is empty,
   * not a same-account URL, or already contains a SAS token (`sig=...`).
   * That makes this safe to apply to arbitrary `blob_url` values pulled
   * from the database without first checking whether they belong to us.
   */
  getReadSasUrl(blobUrl: string, ttlMinutes?: number): string;
  /**
   * Like `getReadSasUrl`, but adds the SAS `rscd` parameter so the storage
   * service responds with `Content-Disposition: attachment; filename="..."`.
   * Browsers then save the file instead of navigating to it, even cross-origin
   * (where the HTML `download` attribute would otherwise be ignored per spec).
   *
   * `filename` is used verbatim — caller is responsible for sanitization /
   * extension. Same pass-through behavior as `getReadSasUrl`.
   */
  getDownloadSasUrl(blobUrl: string, filename: string, ttlMinutes?: number): string;
}

interface ConnStringParts {
  accountName: string;
  accountKey: string;
  blobEndpoint: string | null;
}

function parseConnectionString(connStr: string): ConnStringParts {
  const parts: Record<string, string> = {};
  for (const segment of connStr.split(';')) {
    const eq = segment.indexOf('=');
    if (eq > 0) {
      const key = segment.slice(0, eq);
      const value = segment.slice(eq + 1);
      parts[key] = value;
    }
  }
  if (!parts.AccountName || !parts.AccountKey) {
    throw new Error('Azure Storage connection string missing AccountName or AccountKey');
  }
  return {
    accountName: parts.AccountName,
    accountKey: parts.AccountKey,
    blobEndpoint: parts.BlobEndpoint ?? null,
  };
}

export function createBlobStorage(connectionString: string, containerName: string): BlobStorage {
  const { accountName, accountKey, blobEndpoint } = parseConnectionString(connectionString);
  const sharedKey = new StorageSharedKeyCredential(accountName, accountKey);
  const serviceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = serviceClient.getContainerClient(containerName);

  // Pre-compute the prefix that all of our same-account blob URLs share so we
  // can recognize them when sign-ing arbitrary URLs from the DB. In production
  // the prefix is https://{account}.blob.core.windows.net/{container}/; against
  // Azurite locally the connection string carries BlobEndpoint=http://host:port/
  // {account}, so we honor that when present so dev SAS-signing works too.
  const baseEndpoint = blobEndpoint
    ? blobEndpoint.replace(/\/+$/, '')
    : `https://${accountName}.blob.core.windows.net`;
  const accountHostPrefix = `${baseEndpoint}/${containerName}/`;

  // Resolve a bare blob name or a same-account blob URL (with/without a SAS
  // query) down to the blob name. Refuses cross-account URLs so we can't be
  // tricked into touching arbitrary same-host blobs.
  const resolveBlobName = (blobUrlOrName: string, op: string): string => {
    if (blobUrlOrName.startsWith('http://') || blobUrlOrName.startsWith('https://')) {
      if (!blobUrlOrName.startsWith(accountHostPrefix)) {
        throw new Error(`${op}: refusing to access blob URL outside of ${accountHostPrefix}`);
      }
      const queryIdx = blobUrlOrName.indexOf('?');
      const noQuery = queryIdx === -1 ? blobUrlOrName : blobUrlOrName.slice(0, queryIdx);
      return decodeURIComponent(noQuery.slice(accountHostPrefix.length));
    }
    return blobUrlOrName;
  };

  return {
    async upload(blobName, data, contentType) {
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.upload(data, data.length, {
        blobHTTPHeaders: { blobContentType: contentType },
      });
      return blockBlobClient.url;
    },

    async exists(blobName) {
      try {
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.getProperties();
        return true;
      } catch (err: any) {
        if (err.statusCode === 404) return false;
        throw err;
      }
    },

    getUrl(blobName) {
      return containerClient.getBlockBlobClient(blobName).url;
    },

    async download(blobUrlOrName) {
      const blobName = resolveBlobName(blobUrlOrName, 'download');
      return containerClient.getBlockBlobClient(blobName).downloadToBuffer();
    },

    async getSize(blobUrlOrName) {
      const blobName = resolveBlobName(blobUrlOrName, 'getSize');
      const props = await containerClient.getBlockBlobClient(blobName).getProperties();
      return props.contentLength ?? 0;
    },

    getReadSasUrl(blobUrl, ttlMinutes = 60) {
      if (!blobUrl) return blobUrl;
      // Don't double-sign — if the URL already has a SAS token, pass through.
      if (blobUrl.includes('sig=')) return blobUrl;
      // Don't sign URLs we don't own (different storage account / container).
      if (!blobUrl.startsWith(accountHostPrefix)) return blobUrl;

      const blobName = blobUrl.slice(accountHostPrefix.length);
      const sas = generateBlobSASQueryParameters(
        {
          containerName,
          blobName,
          permissions: BlobSASPermissions.parse('r'),
          expiresOn: new Date(Date.now() + ttlMinutes * 60 * 1000),
        },
        sharedKey,
      ).toString();
      return `${blobUrl}?${sas}`;
    },

    getDownloadSasUrl(blobUrl, filename, ttlMinutes = 60) {
      if (!blobUrl) return blobUrl;
      if (blobUrl.includes('sig=')) return blobUrl;
      if (!blobUrl.startsWith(accountHostPrefix)) return blobUrl;

      const blobName = blobUrl.slice(accountHostPrefix.length);
      // RFC 5987 / 6266 — wrap the filename in quotes and use filename*=UTF-8''
      // for anything non-ASCII so unicode titles survive the round-trip.
      const asciiSafe = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
      const encoded = encodeURIComponent(filename);
      const disposition = `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encoded}`;
      const sas = generateBlobSASQueryParameters(
        {
          containerName,
          blobName,
          permissions: BlobSASPermissions.parse('r'),
          expiresOn: new Date(Date.now() + ttlMinutes * 60 * 1000),
          contentDisposition: disposition,
        },
        sharedKey,
      ).toString();
      return `${blobUrl}?${sas}`;
    },
  };
}
