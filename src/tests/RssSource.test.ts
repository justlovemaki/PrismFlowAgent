import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchParsedRssFeed,
  normalizeParsedRssFeed,
  validateRssFeedDefinition,
  type RssFeedDefinition,
} from '../core/sources/RssSource.js';

const feed: RssFeedDefinition = {
  id: 'test-feed',
  name: 'Test Feed',
  url: 'https://feeds.example.test/rss.xml',
  category: 'testing',
  limit: 2,
};

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <guid>entry-1</guid>
      <title>First item</title>
      <link>https://example.test/first</link>
      <description><![CDATA[<p>Hello <strong>world</strong></p>]]></description>
      <pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate>
      <author>Ada</author>
    </item>
    <item>
      <title>Second item</title>
      <link>https://example.test/second</link>
      <description><![CDATA[<script>bad()</script><p>Useful text</p>]]></description>
    </item>
  </channel>
</rss>`;

test('validates RSS feed protocol and configured limit', () => {
  assert.doesNotThrow(() => validateRssFeedDefinition(feed));
  assert.throws(
    () => validateRssFeedDefinition({ ...feed, url: 'file:///tmp/feed.xml' }),
    /must use http or https/,
  );
  assert.throws(
    () => validateRssFeedDefinition({ ...feed, limit: 1001 }),
    /limit must be an integer from 1 to 1000/,
  );
});

test('fetches, limits, and normalizes RSS through the shared core', async () => {
  const controller = new AbortController();
  let requestedUrl = '';
  let observedSignal: AbortSignal | null | undefined;

  const parsed = await fetchParsedRssFeed(feed, {
    limit: 1,
    signal: controller.signal,
    userAgent: 'PrismFlow-Test/1.0',
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      observedSignal = init?.signal;
      assert.equal(new Headers(init?.headers).get('user-agent'), 'PrismFlow-Test/1.0');
      return new Response(RSS_XML, {
        status: 200,
        headers: { 'Content-Type': 'application/rss+xml' },
      });
    },
  });

  assert.equal(requestedUrl, feed.url);
  assert.equal(observedSignal, controller.signal);
  assert.equal(parsed.title, 'Example Feed');
  assert.equal(parsed.items.length, 1);

  const normalized = normalizeParsedRssFeed(parsed, {
    feedId: feed.id,
    name: feed.name,
    category: feed.category,
    now: new Date('2025-01-02T00:00:00.000Z'),
  });

  assert.deepEqual(normalized, [{
    id: 'entry-1',
    title: 'First item',
    url: 'https://example.test/first',
    description: 'Hello world',
    published_date: '2025-01-01T00:00:00.000Z',
    ingestion_date: '2025-01-02',
    source: 'Example Feed',
    category: 'testing',
    author: 'Ada',
  }]);
});

test('creates deterministic fallback ids during normalization', () => {
  const raw = {
    title: 'No IDs',
    items: [{ title: 'Same item', content: 'Useful content', pubDate: '2025-01-01' }],
  };
  const options = {
    feedId: feed.id,
    name: feed.name,
    category: feed.category,
    now: new Date('2025-01-02T00:00:00.000Z'),
  };

  const first = normalizeParsedRssFeed(raw, options);
  const second = normalizeParsedRssFeed(raw, options);

  assert.match(first[0].id, /^rss-[a-f0-9]{24}$/);
  assert.equal(first[0].id, second[0].id);
});

test('skips malformed and empty RSS entries without interrupting later valid entries', () => {
  const normalized = normalizeParsedRssFeed({ title: 'Variants', items: [
    null as unknown as Record<string, unknown>,
    { title: 'Empty', link: 'https://example.test/empty', content: '' },
    { title: { malformed: true }, link: 'https://example.test/bad', content: 'Bad title' },
    { title: 'Valid', link: 'https://example.test/valid', content: '<p>Retained</p>' },
  ] }, { feedId: feed.id, name: feed.name, category: feed.category, now: new Date('2025-01-02T00:00:00.000Z') });
  assert.deepEqual(normalized.map(item => item.title), ['Valid']);
  assert.equal(normalized[0].description, 'Retained');
});
