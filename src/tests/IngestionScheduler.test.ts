import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIngestionJobs,
  runIngestionJob,
  type IngestionJobConfig,
} from '../core/scheduling/IngestionScheduler.js';

const job: IngestionJobConfig = {
  id: 'rss-sync',
  sourceId: 'rss:deepseek',
  intervalMs: 60_000,
  enabled: true,
  runOnStart: false,
  limit: 50,
  overwrite: false,
};

test('validates ingestion job identities, intervals, limits, and source uniqueness', () => {
  assert.doesNotThrow(() => assertIngestionJobs([job]));
  assert.throws(
    () => assertIngestionJobs([job, { ...job, id: 'rss-sync-2' }]),
    /Duplicate ingestion sourceId/,
  );
  assert.throws(
    () => assertIngestionJobs([{ ...job, intervalMs: 999 }]),
    /intervalMs must be an integer/,
  );
  assert.throws(
    () => assertIngestionJobs([{ ...job, limit: 501 }]),
    /limit must be an integer from 1 to 500/,
  );
});

test('fetches once and chunks oversized source results into bounded persistence batches', async () => {
  const items = Array.from({ length: 501 }, (_, index) => ({
    id: `item-${index}`,
    title: `Item ${index}`,
  }));
  const controller = new AbortController();
  const fetchCalls: unknown[] = [];
  const persistCalls: Array<{ sourceId: string; length: number; overwrite: boolean; signal: AbortSignal }> = [];
  const times = [
    new Date('2025-01-01T00:00:00.000Z'),
    new Date('2025-01-01T00:01:00.000Z'),
  ];

  const receipt = await runIngestionJob(job, 'manual', {
    async fetch(sourceId, request, signal) {
      fetchCalls.push({ sourceId, request, signal });
      return items;
    },
    async persist(sourceId, batch, options) {
      persistCalls.push({ sourceId, length: batch.length, ...options });
      return {
        inserted: batch.length,
        updated: 0,
        skipped: 0,
        total: batch.length,
      };
    },
    now: () => times.shift() ?? new Date('2025-01-01T00:01:00.000Z'),
  }, controller.signal);

  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(persistCalls.map(call => call.length), [500, 1]);
  assert.ok(persistCalls.every(call => call.signal === controller.signal));
  assert.deepEqual(receipt, {
    jobId: 'rss-sync',
    sourceId: 'rss:deepseek',
    trigger: 'manual',
    status: 'success',
    startedAt: '2025-01-01T00:00:00.000Z',
    finishedAt: '2025-01-01T00:01:00.000Z',
    fetched: 501,
    batches: 2,
    inserted: 501,
    updated: 0,
    skipped: 0,
    total: 501,
  });
});

test('rejects malformed source results and observes pre-fetch cancellation', async () => {
  const controller = new AbortController();
  await assert.rejects(
    runIngestionJob(job, 'interval', {
      async fetch() { return { items: [] }; },
      async persist() { throw new Error('must not persist'); },
    }, controller.signal),
    /returned a non-array result/,
  );

  controller.abort('test');
  await assert.rejects(
    runIngestionJob(job, 'startup', {
      async fetch() { throw new Error('must not fetch'); },
      async persist() { throw new Error('must not persist'); },
    }, controller.signal),
    /aborted before fetch/,
  );

  const duringFetch = new AbortController();
  await assert.rejects(
    runIngestionJob(job, 'manual', {
      async fetch() {
        duringFetch.abort('fetch swallowed cancellation');
        return [];
      },
      async persist() { throw new Error('must not persist'); },
    }, duringFetch.signal),
    /aborted after fetch/,
  );
});
