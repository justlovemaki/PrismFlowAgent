import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentStoreId,
  countStoredContent,
  prepareStoredContentRecord,
  queryStoredContent,
} from '../core/content/ContentStore.js';

const baseItem = {
  id: 'item-1',
  title: 'DeepSeek Harness released',
  url: 'https://example.test/harness',
  description: 'A native agent harness release',
  published_date: '2025-01-02T00:00:00.000Z',
  source: 'Example',
  category: 'ai',
  metadata: { ai_summary: 'Harness release summary' },
};

test('creates source-qualified deterministic content store ids', () => {
  const first = contentStoreId('rss:deepseek', 'item-1');
  assert.equal(first, contentStoreId('rss:deepseek', 'item-1'));
  assert.notEqual(first, contentStoreId('follow:deepseek', 'item-1'));
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('prepares JSON-safe stored records and preserves first-seen state on overwrite', () => {
  const initial = prepareStoredContentRecord(
    'rss:deepseek',
    { ...baseItem, status: 'read' },
    undefined,
    new Date('2025-01-03T00:00:00.000Z'),
  );
  const refreshed = prepareStoredContentRecord(
    'rss:deepseek',
    { ...baseItem, title: 'DeepSeek Harness updated', status: 'unread' },
    initial,
    new Date('2025-01-04T00:00:00.000Z'),
  );

  assert.equal(initial.status, 'read');
  assert.equal(refreshed.status, 'read');
  assert.equal(refreshed.firstSeenAt, initial.firstSeenAt);
  assert.equal(refreshed.updatedAt, '2025-01-04T00:00:00.000Z');
  assert.equal(refreshed.item.title, 'DeepSeek Harness updated');

  const malformedOptional = prepareStoredContentRecord('rss:deepseek', {
    ...baseItem,
    ingestion_date: 123,
    author: ['invalid'],
    status: { invalid: true },
    metadata: ['invalid'],
  });
  assert.equal(malformedOptional.item.ingestion_date, undefined);
  assert.equal(malformedOptional.item.author, undefined);
  assert.equal(malformedOptional.item.status, undefined);
  assert.equal(malformedOptional.item.metadata, undefined);
  assert.equal(malformedOptional.status, 'unread');

  assert.throws(
    () => prepareStoredContentRecord('rss:deepseek', { title: 'missing id' }),
    /id must be a non-empty string/,
  );
  assert.throws(
    () => prepareStoredContentRecord('rss:deepseek', { ...baseItem, description: '   ', metadata: {} }),
    /description or metadata\.content_html must be non-empty/,
  );
  assert.doesNotThrow(() => prepareStoredContentRecord('follow:deepseek', {
    ...baseItem, description: '', metadata: { content_html: '<img src="https://example.test/image.png">' },
  }));
  assert.throws(() => prepareStoredContentRecord('rss:deepseek', { ...baseItem, description: '坏字符 \uFFFD' }), /Unicode replacement character/u);
  assert.throws(() => prepareStoredContentRecord('rss:deepseek', { ...baseItem, description: 'broken \uD800' }), /unpaired surrogate/u);
  assert.doesNotThrow(() => prepareStoredContentRecord('rss:deepseek', { ...baseItem, description: '正常 emoji 🤖' }));
});

test('filters, searches, orders, and paginates stored content', () => {
  const older = prepareStoredContentRecord(
    'rss:deepseek',
    baseItem,
    undefined,
    new Date('2025-01-03T00:00:00.000Z'),
  );
  const newer = prepareStoredContentRecord(
    'follow:ai',
    {
      ...baseItem,
      id: 'item-2',
      title: 'New model announcement',
      published_date: '2025-01-05T00:00:00.000Z',
      category: 'models',
      metadata: { ai_summary: 'DeepSeek model summary' },
    },
    undefined,
    new Date('2025-01-05T01:00:00.000Z'),
  );

  assert.deepEqual(queryStoredContent([older, newer]).map(record => record.externalId), ['item-2', 'item-1']);
  assert.deepEqual(queryStoredContent([older, newer], { sourceId: 'rss:deepseek' }), [older]);
  assert.deepEqual(queryStoredContent([older, newer], { category: 'models', search: 'deepseek' }), [newer]);
  assert.deepEqual(queryStoredContent([older, newer], { limit: 1, offset: 1 }), [older]);
  assert.throws(() => queryStoredContent([], { limit: 101 }), /limit must be an integer from 1 to 100/);

  assert.equal(countStoredContent(Array(150).fill(older)), 150);
  assert.equal(countStoredContent([older, newer], { sourceId: 'rss:deepseek' }), 1);
  assert.equal(countStoredContent([older, newer], { category: 'models', search: 'deepseek' }), 1);
  assert.equal(countStoredContent([older, newer], { status: 'archived' }), 0);
});
