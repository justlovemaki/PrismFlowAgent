import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePublicationReceipt,
  prepareStoredPublicationReceipt,
  queryPublicationReceipts,
} from '../core/publishing/PublicationReceipt.js';

const STORE_ID = 'a'.repeat(64);
const RAW = {
  publisherId: 'local-markdown:daily',
  status: 'created',
  itemCount: 1,
  truncated: 0,
  bytes: 120,
  sha256: 'b'.repeat(64),
  contentStoreIds: [STORE_ID],
  fileName: 'daily.md',
  publishedAt: '2025-01-02T00:00:00.000Z',
  credential: 'must-not-survive',
};

test('normalizes publication receipts through a strict allowlist', () => {
  const receipt = normalizePublicationReceipt(RAW, RAW.publisherId, [{ storeId: STORE_ID }]);
  assert.equal(receipt.status, 'created');
  assert.equal(receipt.fileName, 'daily.md');
  assert.equal('credential' in receipt, false);
  const artifact = normalizePublicationReceipt({ ...RAW, draftId: 'draft-1', draftVersion: 1, artifactSha256: 'c'.repeat(64),
    artifactBindingSha256: 'd'.repeat(64), articleType: 'news', wechatDraftMediaId: 'draft-media-id', omittedMedia: 2,
    markdown: '# secret' }, RAW.publisherId, [{ storeId: STORE_ID }]);
  assert.equal(artifact.draftId, 'draft-1');
  assert.equal(artifact.artifactBindingSha256, 'd'.repeat(64));
  assert.equal(artifact.articleType, 'news');
  assert.equal(artifact.wechatDraftMediaId, 'draft-media-id');
  assert.equal(artifact.omittedMedia, 2);
  assert.equal('markdown' in artifact, false);
  assert.throws(() => normalizePublicationReceipt({ ...RAW, artifactSha256: 'bad' }, RAW.publisherId, [{ storeId: STORE_ID }]), /artifactSha256/);
  assert.throws(() => normalizePublicationReceipt({ ...RAW, omittedMedia: 101 }, RAW.publisherId, [{ storeId: STORE_ID }]), /omittedMedia/);
  assert.throws(
    () => normalizePublicationReceipt({ ...RAW, contentStoreIds: ['c'.repeat(64)] }, RAW.publisherId, [{ storeId: STORE_ID }]),
    /invalid contentStoreId/,
  );
  assert.throws(
    () => normalizePublicationReceipt({ ...RAW, itemCount: 2 }, RAW.publisherId, [{ storeId: STORE_ID }]),
    /itemCount/,
  );
  assert.throws(
    () => normalizePublicationReceipt({ ...RAW, publicUrl: 'https://example.test/file?token=secret' }, RAW.publisherId, [{ storeId: STORE_ID }]),
    /credential-free HTTPS/,
  );
});

test('prepares and queries immutable publication receipt snapshots', () => {
  const normalized = normalizePublicationReceipt(RAW, RAW.publisherId, [{ storeId: STORE_ID }]);
  const first = prepareStoredPublicationReceipt(normalized, {
    receiptId: 'receipt-1',
    trigger: 'manual',
    recordedAt: new Date('2025-01-02T00:01:00.000Z'),
  });
  const second = prepareStoredPublicationReceipt({ ...normalized, status: 'unchanged', publishedAt: '2025-01-03T00:00:00.000Z' }, {
    receiptId: 'receipt-2',
    trigger: 'scheduler',
    jobId: 'daily',
    recordedAt: new Date('2025-01-03T00:01:00.000Z'),
  });
  assert.deepEqual(queryPublicationReceipts([first, second], { limit: 10 }).map(item => item.receiptId), ['receipt-2', 'receipt-1']);
  assert.deepEqual(queryPublicationReceipts([first, second], { trigger: 'scheduler', jobId: 'daily' }).map(item => item.receiptId), ['receipt-2']);
  assert.deepEqual(queryPublicationReceipts([first, second], {
    from: '2025-01-03T00:00:00.000Z',
    to: '2025-01-03T00:00:00.000Z',
  }).map(item => item.receiptId), ['receipt-2']);
  assert.throws(() => queryPublicationReceipts([first], { status: '' as never }), /Unsupported publication receipt status/);
  assert.throws(() => queryPublicationReceipts([first], { unknown: true } as never), /Unsupported publication receipt query field/);
  assert.throws(() => prepareStoredPublicationReceipt({ ...normalized, sha256: 'not-a-hash' }, {
    receiptId: 'receipt-invalid',
  }), /sha256/);
  const result = queryPublicationReceipts([first], { limit: 1 });
  result[0].fileName = 'mutated.md';
  assert.equal(first.fileName, 'daily.md');
});
