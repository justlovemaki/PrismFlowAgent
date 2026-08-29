export type PublicationStatus = 'created' | 'updated' | 'unchanged' | 'skipped';
export type PublicationTrigger = 'manual' | 'scheduler' | 'workflow' | 'host';

export interface NormalizedPublicationReceipt {
  publisherId: string;
  status: PublicationStatus;
  itemCount: number;
  truncated: number;
  /** Destination-specific media omitted while all source records remain represented. */
  omittedMedia?: number;
  bytes: number;
  sha256: string;
  publishedAt: string;
  contentStoreIds: string[];
  fileName?: string;
  path?: string;
  key?: string;
  repository?: string;
  branch?: string;
  bucket?: string;
  publicUrl?: string;
  operation?: string;
  commitSha?: string;
  contentSha?: string;
  etag?: string;
  versionId?: string;
  verification?: 'verified' | 'unverified';
  draftId?: string;
  draftVersion?: number;
  artifactSha256?: string;
  artifactBindingSha256?: string;
  articleType?: 'news' | 'newspic';
  wechatDraftMediaId?: string;
  /** Trusted production fields. Publishers are not allowed to provide these. */
  publicationAttemptId?: string;
  publicationAttemptNumber?: number;
  publicationIntent?: 'initial' | 'repeat';
}

export interface StoredPublicationReceipt extends NormalizedPublicationReceipt {
  receiptId: string;
  recordedAt: string;
  trigger: PublicationTrigger;
  jobId?: string;
  workflowId?: string;
}

export interface PublicationReceiptQuery {
  receiptId?: string;
  publisherId?: string;
  status?: PublicationStatus;
  trigger?: PublicationTrigger;
  jobId?: string;
  workflowId?: string;
  draftId?: string;
  draftVersion?: number;
  artifactSha256?: string;
  publicationAttemptId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

const STATUSES = new Set<PublicationStatus>(['created', 'updated', 'unchanged', 'skipped']);
const TRIGGERS = new Set<PublicationTrigger>(['manual', 'scheduler', 'workflow', 'host']);

function requireBoundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Publication receipt ${field} must be a non-empty control-free string of at most ${maxLength} characters`);
  }
  return value;
}

function optionalBoundedString(value: unknown, field: string, maxLength = 2_048): string | undefined {
  return value === undefined ? undefined : requireBoundedString(value, field, maxLength);
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Publication receipt ${field} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireIsoInstant(value: unknown, field: string): string {
  const timestamp = requireBoundedString(value, field, 40);
  if (!Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
    throw new Error(`Publication receipt ${field} must be an ISO timestamp`);
  }
  return timestamp;
}

function optionalPublicUrl(value: unknown): string | undefined {
  const publicUrl = optionalBoundedString(value, 'publicUrl', 2_048);
  if (publicUrl === undefined) return undefined;
  try {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('unsafe');
  } catch {
    throw new Error('Publication receipt publicUrl must be credential-free HTTPS');
  }
  return publicUrl;
}

function optionalVerification(value: unknown): 'verified' | 'unverified' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'verified' && value !== 'unverified') {
    throw new Error('Publication receipt verification must be verified or unverified');
  }
  return value;
}

function optionalSha(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value)) {
    throw new Error(`Publication receipt ${field} must be a lowercase Git SHA`);
  }
  return value;
}

function optionalArtifactSha(value: unknown, field = 'artifactSha256'): string | undefined {
  if (value === undefined) return undefined;
  const sha = requireBoundedString(value, field, 64);
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error(`Publication receipt ${field} must be lowercase hexadecimal`);
  return sha;
}

function optionalArticleType(value: unknown): 'news' | 'newspic' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'news' && value !== 'newspic') throw new Error('Publication receipt articleType is invalid');
  return value;
}

function optionalDraftVersion(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const version = requireNonNegativeInteger(value, 'draftVersion');
  if (version < 1) throw new Error('Publication receipt draftVersion must be positive');
  return version;
}

function normalizeContentStoreIds(value: unknown, itemCount: number, records: unknown[]): string[] {
  if (!Array.isArray(value) || value.length !== itemCount || value.length > 100) {
    throw new Error('Publication receipt contentStoreIds must match itemCount and contain at most 100 ids');
  }
  const allowed = new Set(records.flatMap((record) => {
    if (record && typeof record === 'object' && typeof (record as { storeId?: unknown }).storeId === 'string') {
      return [(record as { storeId: string }).storeId];
    }
    return [];
  }));
  const ids = value.map((id) => {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || !allowed.has(id)) {
      throw new Error('Publication receipt contains an invalid contentStoreId');
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new Error('Publication receipt contentStoreIds must be unique');
  return ids;
}

export function normalizePublicationReceipt(
  value: unknown,
  publisherId: string,
  records: unknown[],
): NormalizedPublicationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Publisher returned an invalid publication receipt');
  }
  const raw = value as Record<string, unknown>;
  if (raw.publisherId !== publisherId) throw new Error('Publisher receipt id does not match the selected publisher');
  if (typeof raw.status !== 'string' || !STATUSES.has(raw.status as PublicationStatus)) {
    throw new Error('Publisher returned an unsupported publication status');
  }
  const itemCount = requireNonNegativeInteger(raw.itemCount, 'itemCount');
  if (itemCount < 1 || itemCount > 100 || itemCount > records.length) {
    throw new Error('Publication receipt itemCount must be from 1 to 100 and not exceed the input records');
  }
  const truncated = requireNonNegativeInteger(raw.truncated, 'truncated');
  if (truncated > 100 || itemCount + truncated !== records.length) {
    throw new Error('Publication receipt itemCount and truncated count do not match the input records');
  }
  const bytes = requireNonNegativeInteger(raw.bytes, 'bytes');
  const sha256 = requireBoundedString(raw.sha256, 'sha256', 64);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Publication receipt sha256 must be lowercase hexadecimal');

  return {
    publisherId,
    status: raw.status as PublicationStatus,
    itemCount,
    truncated,
    omittedMedia: raw.omittedMedia === undefined ? undefined : (() => {
      const count = requireNonNegativeInteger(raw.omittedMedia, 'omittedMedia');
      if (count > 100) throw new Error('Publication receipt omittedMedia must not exceed 100');
      return count;
    })(),
    bytes,
    sha256,
    publishedAt: requireIsoInstant(raw.publishedAt, 'publishedAt'),
    contentStoreIds: normalizeContentStoreIds(raw.contentStoreIds, itemCount, records),
    fileName: optionalBoundedString(raw.fileName, 'fileName', 512),
    path: optionalBoundedString(raw.path, 'path'),
    key: optionalBoundedString(raw.key, 'key'),
    repository: optionalBoundedString(raw.repository, 'repository', 256),
    branch: optionalBoundedString(raw.branch, 'branch', 256),
    bucket: optionalBoundedString(raw.bucket, 'bucket', 128),
    publicUrl: optionalPublicUrl(raw.publicUrl),
    operation: optionalBoundedString(raw.operation, 'operation', 64),
    commitSha: optionalSha(raw.commitSha, 'commitSha'),
    contentSha: optionalSha(raw.contentSha, 'contentSha'),
    etag: optionalBoundedString(raw.etag, 'etag', 256),
    versionId: optionalBoundedString(raw.versionId, 'versionId', 512),
    verification: optionalVerification(raw.verification),
    draftId: optionalBoundedString(raw.draftId, 'draftId', 128),
    draftVersion: optionalDraftVersion(raw.draftVersion),
    artifactSha256: optionalArtifactSha(raw.artifactSha256),
    artifactBindingSha256: optionalArtifactSha(raw.artifactBindingSha256, 'artifactBindingSha256'),
    articleType: optionalArticleType(raw.articleType),
    wechatDraftMediaId: optionalBoundedString(raw.wechatDraftMediaId, 'wechatDraftMediaId', 128),
  };
}

export function prepareStoredPublicationReceipt(
  receipt: NormalizedPublicationReceipt,
  context: {
    receiptId: string; trigger?: string; jobId?: string; workflowId?: string; recordedAt?: Date;
    publicationAttemptId?: string; publicationAttemptNumber?: number; publicationIntent?: 'initial' | 'repeat';
  },
): StoredPublicationReceipt {
  const trigger = context.trigger ?? 'host';
  if (!TRIGGERS.has(trigger as PublicationTrigger)) throw new Error(`Unsupported publication trigger: ${trigger}`);
  const rawReceipt = receipt as unknown;
  const rawObject = rawReceipt && typeof rawReceipt === 'object' && !Array.isArray(rawReceipt)
    ? rawReceipt as Record<string, unknown>
    : {};
  const rawContentStoreIds = rawObject.contentStoreIds;
  const rawTruncated = rawObject.truncated;
  const validationRecords = [
    ...(Array.isArray(rawContentStoreIds) && rawContentStoreIds.length <= 100
      ? rawContentStoreIds.map(storeId => ({ storeId }))
      : []),
    ...Array(Number.isSafeInteger(rawTruncated) && (rawTruncated as number) > 0 && (rawTruncated as number) <= 100
      ? rawTruncated as number
      : 0).fill({}),
  ];
  const normalized = normalizePublicationReceipt(rawReceipt, typeof rawObject.publisherId === 'string' ? rawObject.publisherId : '', validationRecords);
  return {
    ...normalized,
    receiptId: requireBoundedString(context.receiptId, 'receiptId', 128),
    recordedAt: (context.recordedAt ?? new Date()).toISOString(),
    trigger: trigger as PublicationTrigger,
    jobId: optionalBoundedString(context.jobId, 'jobId', 128),
    workflowId: optionalBoundedString(context.workflowId, 'workflowId', 128),
    publicationAttemptId: optionalBoundedString(context.publicationAttemptId, 'publicationAttemptId', 128),
    publicationAttemptNumber: context.publicationAttemptNumber === undefined
      ? undefined : (() => { const number = requireNonNegativeInteger(context.publicationAttemptNumber, 'publicationAttemptNumber'); if (number < 1) throw new Error('Publication receipt publicationAttemptNumber must be positive'); return number; })(),
    publicationIntent: context.publicationIntent === undefined ? undefined
      : context.publicationIntent === 'initial' || context.publicationIntent === 'repeat'
        ? context.publicationIntent : (() => { throw new Error('Publication receipt publicationIntent is invalid'); })(),
  };
}

export function queryPublicationReceipts(
  receipts: Iterable<StoredPublicationReceipt>,
  query: PublicationReceiptQuery = {},
): StoredPublicationReceipt[] {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('Publication receipt query must be an object');
  const allowedKeys = new Set(['receiptId', 'publisherId', 'status', 'trigger', 'jobId', 'workflowId', 'draftId', 'draftVersion', 'artifactSha256', 'publicationAttemptId', 'from', 'to', 'limit', 'offset']);
  const unknownKey = Object.keys(query).find(key => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Unsupported publication receipt query field: ${unknownKey}`);
  const limit = query.limit ?? 20;
  const offset = query.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Publication receipt query limit must be an integer from 1 to 100');
  if (!Number.isInteger(offset) || offset < 0) throw new Error('Publication receipt query offset must be a non-negative integer');
  if (query.receiptId !== undefined) requireBoundedString(query.receiptId, 'receiptId', 128);
  if (query.publisherId !== undefined) requireBoundedString(query.publisherId, 'publisherId', 256);
  if (query.status !== undefined && !STATUSES.has(query.status)) throw new Error(`Unsupported publication receipt status: ${query.status}`);
  if (query.trigger !== undefined && !TRIGGERS.has(query.trigger)) throw new Error(`Unsupported publication trigger: ${query.trigger}`);
  if (query.jobId !== undefined) requireBoundedString(query.jobId, 'jobId', 128);
  if (query.workflowId !== undefined) requireBoundedString(query.workflowId, 'workflowId', 128);
  if (query.draftId !== undefined) requireBoundedString(query.draftId, 'draftId', 128);
  if (query.draftVersion !== undefined) optionalDraftVersion(query.draftVersion);
  if (query.artifactSha256 !== undefined) optionalArtifactSha(query.artifactSha256);
  if (query.publicationAttemptId !== undefined) requireBoundedString(query.publicationAttemptId, 'publicationAttemptId', 128);
  const from = query.from === undefined ? undefined : Date.parse(requireIsoInstant(query.from, 'from'));
  const to = query.to === undefined ? undefined : Date.parse(requireIsoInstant(query.to, 'to'));
  if (from !== undefined && to !== undefined && from > to) throw new Error('Publication receipt query from must not be after to');

  return Array.from(receipts)
    .filter(receipt => !query.receiptId || receipt.receiptId === query.receiptId)
    .filter(receipt => !query.publisherId || receipt.publisherId === query.publisherId)
    .filter(receipt => !query.status || receipt.status === query.status)
    .filter(receipt => !query.trigger || receipt.trigger === query.trigger)
    .filter(receipt => !query.jobId || receipt.jobId === query.jobId)
    .filter(receipt => !query.workflowId || receipt.workflowId === query.workflowId)
    .filter(receipt => !query.draftId || receipt.draftId === query.draftId)
    .filter(receipt => query.draftVersion === undefined || receipt.draftVersion === query.draftVersion)
    .filter(receipt => !query.artifactSha256 || receipt.artifactSha256 === query.artifactSha256)
    .filter(receipt => !query.publicationAttemptId || receipt.publicationAttemptId === query.publicationAttemptId)
    .filter(receipt => from === undefined || Date.parse(receipt.publishedAt) >= from)
    .filter(receipt => to === undefined || Date.parse(receipt.publishedAt) <= to)
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)
      || right.recordedAt.localeCompare(left.recordedAt)
      || left.receiptId.localeCompare(right.receiptId))
    .slice(offset, offset + limit)
    .map(receipt => JSON.parse(JSON.stringify(receipt)) as StoredPublicationReceipt);
}
