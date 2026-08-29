import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchFollowEntries,
  normalizeFollowEntries,
  validateFollowSourceDefinition,
  type FollowSourceDefinition,
} from '../core/sources/FollowSource.js';

const definition: FollowSourceDefinition = {
  id: 'ai-list',
  name: 'AI List',
  apiUrl: 'https://api.follow.example.test/entries',
  category: 'ai',
  listId: 'list-123',
  fetchDays: 3,
  fetchPages: 2,
  view: 0,
};

test('validates Follow source identity, selector, and bounds', () => {
  assert.doesNotThrow(() => validateFollowSourceDefinition(definition));
  assert.throws(
    () => validateFollowSourceDefinition({ ...definition, listId: undefined, feedId: undefined }),
    /requires listId or feedId/,
  );
  assert.throws(
    () => validateFollowSourceDefinition({ ...definition, fetchPages: 21 }),
    /fetchPages must be an integer from 1 to 20/,
  );
});

test('fetches Follow pages with cursor, cookie, and cancellation signal', async () => {
  const controller = new AbortController();
  const bodies: Array<Record<string, unknown>> = [];
  const delays: number[] = [];
  let requestCount = 0;

  const rawData = await fetchFollowEntries(definition, {
    cookie: 'session=test-cookie',
    signal: controller.signal,
    userAgent: 'PrismFlow-Test/1.0',
    pageDelayMs: 25,
    sleepImpl: async milliseconds => { delays.push(milliseconds); },
    fetchImpl: async (_input, init) => {
      requestCount += 1;
      assert.equal(init?.method, 'POST');
      assert.equal(init?.signal, controller.signal);
      const requestHeaders = new Headers(init?.headers);
      assert.equal(requestHeaders.get('cookie'), 'session=test-cookie');
      assert.equal(requestHeaders.get('user-agent'), 'PrismFlow-Test/1.0');
      assert.equal(requestHeaders.get('x-app-version'), '1.12.0');
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);

      const data = requestCount === 1
        ? [
            {
              entries: {
                id: 'entry-1',
                title: 'First',
                url: 'https://example.test/first',
                content: '<p>First content</p>',
                publishedAt: '2025-01-02T12:00:00.000Z',
                author: 'Ada',
              },
              feeds: { title: 'Example Feed' },
            },
            {
              entries: {
                id: 'entry-2',
                title: 'Second',
                url: 'https://example.test/second',
                publishedAt: '2025-01-02T10:00:00.000Z',
                author: 'Grace',
              },
              feeds: { title: 'Example Feed' },
            },
          ]
        : [];

      return Response.json({ data });
    },
  });

  assert.equal(rawData.data.length, 2);
  assert.deepEqual(bodies[0], { view: 0, listId: 'list-123' });
  assert.deepEqual(bodies[1], {
    view: 0,
    listId: 'list-123',
    publishedAfter: '2025-01-02T10:00:00.000Z',
  });
  assert.deepEqual(delays, [25]);
});

test('filters and limits entries before detail lookup, skips failed details, and backfills the limit', async () => {
  const detailIds: string[] = [];
  const delays: number[] = [];
  const rawData = {
    data: [
      { entries: { id: 'old', title: 'Old', publishedAt: '2024-12-01T00:00:00.000Z' } },
      { entries: { id: 'failed', title: 'Failed', publishedAt: '2025-01-02T13:00:00.000Z' } },
      { entries: { id: 'embedded', title: 'Embedded', content: '<p>Embedded</p>', publishedAt: '2025-01-02T12:00:00.000Z' } },
      { entries: { id: 'backfill', title: 'Backfill', publishedAt: '2025-01-02T11:00:00.000Z' } },
      { entries: { id: 'beyond-limit', title: 'Beyond', publishedAt: '2025-01-02T10:00:00.000Z' } },
    ],
  };

  const normalized = await normalizeFollowEntries(rawData, definition, {
    now: new Date('2025-01-03T00:00:00.000Z'),
    limit: 2,
    detailDelayMs: 10,
    sleepImpl: async milliseconds => { delays.push(milliseconds); },
    fetchImpl: async input => {
      const id = new URL(String(input)).searchParams.get('id') ?? '';
      detailIds.push(id);
      return id === 'failed'
        ? new Response('failed', { status: 503 })
        : Response.json({ data: { content: `<p>${id}</p>` } });
    },
  });

  assert.deepEqual(detailIds, ['failed', 'backfill']);
  assert.deepEqual(delays, [10]);
  assert.deepEqual(normalized.map(item => item.id), ['embedded', 'backfill']);
});

test('skips malformed and empty Follow entries without interrupting later valid entries', async () => {
  const normalized = await normalizeFollowEntries({ data: [
    null as unknown as { entries?: unknown },
    { entries: { id: 'empty', title: 'Empty', content: '' } },
    { entries: { id: 'variant', title: 'Variant', content: { html: '<p>bad</p>' } } },
    { entries: { id: 'valid', title: 'Valid', content: '<p>Retained</p>', publishedAt: '2025-01-02T12:00:00.000Z' } },
  ] as unknown as Parameters<typeof normalizeFollowEntries>[0]['data'] }, definition, {
    now: new Date('2025-01-03T00:00:00.000Z'),
    fetchImpl: async input => new URL(String(input)).searchParams.get('id') === 'valid'
      ? Response.json({ data: { content: '<p>Retained</p>' } })
      : Response.json({ data: { content: '' } }),
  });
  assert.deepEqual(normalized.map(item => item.id), ['valid']);
})

test('does not swallow cancellation while isolating ordinary detail failures', async () => {
  const controller = new AbortController();
  const reason = new Error('cancel detail lookup');
  await assert.rejects(normalizeFollowEntries({
    data: [{ entries: { id: 'entry-1', publishedAt: '2025-01-02T12:00:00.000Z' } }],
  }, definition, {
    now: new Date('2025-01-03T00:00:00.000Z'),
    signal: controller.signal,
    fetchImpl: async () => {
      controller.abort(reason);
      throw reason;
    },
  }), error => error === reason);
});

test('filters old entries and fills missing Follow content from detail API', async () => {
  const rawData = {
    data: [
      {
        entries: {
          id: 'entry-1',
          title: 'First',
          url: 'https://example.test/first',
          content: '<p>First <strong>content</strong></p>',
          publishedAt: '2025-01-02T12:00:00.000Z',
          author: 'Ada',
        },
        feeds: { title: 'Example Feed' },
      },
      {
        entries: {
          id: 'entry-2',
          title: 'Second',
          url: 'https://example.test/second',
          publishedAt: '2025-01-02T10:00:00.000Z',
          author: 'Grace',
        },
        feeds: { title: 'Example Feed' },
      },
      {
        entries: {
          id: 'entry-old',
          title: 'Old',
          publishedAt: '2024-12-01T00:00:00.000Z',
        },
      },
    ],
  };
  const detailDelays: number[] = [];
  let detailUrl = '';

  const normalized = await normalizeFollowEntries(rawData, definition, {
    cookie: 'session=test-cookie',
    now: new Date('2025-01-03T00:00:00.000Z'),
    detailDelayMs: 10,
    sleepImpl: async milliseconds => { detailDelays.push(milliseconds); },
    fetchImpl: async input => {
      detailUrl = String(input);
      return Response.json({ data: { content: '<div>Second detail</div>' } });
    },
  });

  assert.equal(new URL(detailUrl).searchParams.get('id'), 'entry-2');
  assert.deepEqual(detailDelays, [10]);
  assert.deepEqual(normalized, [
    {
      id: 'entry-1',
      title: 'First',
      url: 'https://example.test/first',
      description: 'First content',
      published_date: '2025-01-02T12:00:00.000Z',
      ingestion_date: '2025-01-03',
      source: 'Example Feed',
      category: 'ai',
      author: 'Ada',
      metadata: { content_html: '<p>First <strong>content</strong></p>' },
    },
    {
      id: 'entry-2',
      title: 'Second',
      url: 'https://example.test/second',
      description: 'Second detail',
      published_date: '2025-01-02T10:00:00.000Z',
      ingestion_date: '2025-01-03',
      source: 'Example Feed',
      category: 'ai',
      author: 'Grace',
      metadata: { content_html: '<div>Second detail</div>' },
    },
  ]);
});
