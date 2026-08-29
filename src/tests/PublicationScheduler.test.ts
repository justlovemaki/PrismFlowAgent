import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPublicationJobs,
  runPublicationJob,
  type PublicationJobConfig,
} from '../core/scheduling/PublicationScheduler.js';
import type { StoredContentRecord } from '../core/content/ContentStore.js';

const JOB: PublicationJobConfig = {
  id: 'daily',
  publisherId: 'local-markdown:daily',
  intervalMs: 60_000,
  enabled: true,
  runOnStart: false,
  selection: { sourceId: 'rss:test', status: 'unread', limit: 20, offset: 0 },
};

const RECORD = { storeId: 'a'.repeat(64) } as StoredContentRecord;

test('validates publication scheduler job identity, interval, and selection', () => {
  assert.doesNotThrow(() => assertPublicationJobs([JOB]));
  assert.throws(() => assertPublicationJobs([JOB, { ...JOB }]), /Duplicate publication job id/);
  assert.throws(() => assertPublicationJobs([{ ...JOB, intervalMs: 10 }]), /intervalMs/);
  assert.throws(() => assertPublicationJobs([{ ...JOB, selection: { limit: 101 } }]), /selection.limit/);
});

test('selects and publishes a configured content snapshot', async () => {
  const calls: unknown[] = [];
  const times = [new Date('2025-01-01T00:00:00.000Z'), new Date('2025-01-01T00:00:01.000Z')];
  const receipt = await runPublicationJob(JOB, 'interval', {
    select(query) {
      calls.push(query);
      return [RECORD];
    },
    async publish(publisherId, records, execution) {
      calls.push({ publisherId, records, execution });
      return { status: 'created' };
    },
    now: () => times.shift() ?? new Date(),
  }, new AbortController().signal);
  assert.equal(receipt.status, 'success');
  assert.equal(receipt.selected, 1);
  assert.deepEqual(calls[0], JOB.selection);
  const publicationCall = calls[1] as {
    publisherId: string;
    records: StoredContentRecord[];
    execution: { signal: AbortSignal; trigger: string; jobId: string };
  };
  assert.equal(publicationCall.publisherId, JOB.publisherId);
  assert.deepEqual(publicationCall.records, [RECORD]);
  assert.equal(publicationCall.execution.trigger, 'scheduler');
  assert.equal(publicationCall.execution.jobId, 'daily');
  assert.equal(publicationCall.execution.signal.aborted, false);
});

test('skips empty selections and observes cancellation', async () => {
  let published = false;
  const skipped = await runPublicationJob(JOB, 'startup', {
    select: () => [],
    async publish() { published = true; },
  }, new AbortController().signal);
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.reason, 'no-content');
  assert.equal(published, false);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runPublicationJob(JOB, 'manual', { select: () => [RECORD], async publish() {} }, controller.signal),
    /aborted before selection/,
  );
});
