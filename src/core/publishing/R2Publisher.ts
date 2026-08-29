function requirePlainText(value: string, name: string, maxLength: number): string {
  if (!value || value.trim() !== value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} must be non-empty, trimmed, control-free, and at most ${maxLength} characters`);
  }
  return value;
}

export function normalizeR2AccountId(value: string): string {
  const accountId = requirePlainText(value, 'R2 accountId', 32).toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new Error('R2 accountId must contain exactly 32 hexadecimal characters');
  return accountId;
}

export function validateR2BucketName(value: string): string {
  const bucket = requirePlainText(value, 'R2 bucket', 63);
  if (bucket.length < 3
    || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)
    || bucket.includes('..')
    || bucket.includes('.-')
    || bucket.includes('-.')
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket)) {
    throw new Error('R2 bucket must be a DNS-compatible name between 3 and 63 characters');
  }
  return bucket;
}

export function validateR2PathPrefix(value: string): string {
  if (value === '') return '';
  requirePlainText(value, 'R2 pathPrefix', 500);
  if (value.startsWith('/') || value.endsWith('/') || value.includes('\\')) {
    throw new Error('R2 pathPrefix must be a normalized relative path');
  }
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('R2 pathPrefix contains an unsafe path segment');
  }
  return value;
}

export function validateR2ObjectKey(value: string): string {
  if (!value || value.startsWith('/') || value.endsWith('/') || value.includes('\\')) {
    throw new Error('R2 object key must be a normalized relative path');
  }
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('R2 object key contains an unsafe path segment');
  }
  if (Buffer.byteLength(value, 'utf8') > 1_024) throw new Error('R2 publication object key exceeds 1024 UTF-8 bytes');
  return value;
}

export function buildR2ObjectKey(pathPrefix: string, fileName: string): string {
  const prefix = validateR2PathPrefix(pathPrefix);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(fileName)) {
    throw new Error(`R2 publication filename must be a Markdown basename: ${fileName}`);
  }
  return validateR2ObjectKey(prefix ? `${prefix}/${fileName}` : fileName);
}

function encodePath(value: string): string {
  return value.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

export function buildR2ApiEndpoint(accountId: string): string {
  return `https://${normalizeR2AccountId(accountId)}.r2.cloudflarestorage.com`;
}

export function buildR2ObjectUrl(accountId: string, bucket: string, key: string): string {
  const endpoint = buildR2ApiEndpoint(accountId);
  const normalizedBucket = validateR2BucketName(bucket);
  return `${endpoint}/${encodeURIComponent(normalizedBucket)}/${encodePath(validateR2ObjectKey(key))}`;
}

export function normalizeR2PublicUrlPrefix(value: string): string | undefined {
  if (value === '') return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid R2 public URL prefix');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('R2 public URL prefix must be HTTPS and contain no credentials, query, or fragment');
  }
  return url.toString().replace(/\/$/, '');
}

export function buildR2PublicObjectUrl(prefix: string | undefined, key: string): string | undefined {
  const normalizedKey = validateR2ObjectKey(key);
  if (!prefix) return undefined;
  return `${normalizeR2PublicUrlPrefix(prefix)}/${encodePath(normalizedKey)}`;
}
