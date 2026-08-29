import type { ContentQuery, StoredContentRecord } from '../content/ContentStore.js';

export interface PublicationJobConfig {
  id: string;
  publisherId: string;
  intervalMs: number;
  enabled: boolean;
  runOnStart: boolean;
  selection: ContentQuery;
}

export interface PublicationSchedulerDependencies {
  select(query: ContentQuery): StoredContentRecord[];
  publish(
    publisherId: string,
    records: StoredContentRecord[],
    execution: { signal: AbortSignal; trigger: 'scheduler'; jobId: string },
  ): Promise<unknown>;
  now?: () => Date;
}

export const MIN_PUBLICATION_INTERVAL_MS = 60_000;
export const MAX_PUBLICATION_TIMER_DELAY_MS = 2_147_483_647;

function optionalFilter(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '' || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value))) {
    throw new Error(`Publication selection ${field} must be a non-empty string of at most 500 characters`);
  }
}

export function assertPublicationJobs(jobs: PublicationJobConfig[]): void {
  const ids = new Set<string>();
  for (const job of jobs) {
    if (!/^[A-Za-z0-9_-]+$/.test(job.id)) throw new Error(`Publication job id must match [A-Za-z0-9_-]+: ${job.id}`);
    if (ids.has(job.id)) throw new Error(`Duplicate publication job id: ${job.id}`);
    ids.add(job.id);
    if (typeof job.publisherId !== 'string' || job.publisherId.trim() === '' || job.publisherId.length > 256 || /[\u0000-\u001f\u007f]/.test(job.publisherId)) {
      throw new Error(`Publication job ${job.id} publisherId is required and must be at most 256 characters`);
    }
    if (!Number.isInteger(job.intervalMs)
      || job.intervalMs < MIN_PUBLICATION_INTERVAL_MS
      || job.intervalMs > MAX_PUBLICATION_TIMER_DELAY_MS) {
      throw new Error(`Publication job ${job.id} intervalMs must be an integer from ${MIN_PUBLICATION_INTERVAL_MS} to ${MAX_PUBLICATION_TIMER_DELAY_MS}`);
    }
    const selection = job.selection ?? {};
    optionalFilter(selection.storeId, 'storeId');
    optionalFilter(selection.sourceId, 'sourceId');
    optionalFilter(selection.category, 'category');
    optionalFilter(selection.search, 'search');
    if (selection.status !== undefined && !['unread', 'read', 'archived'].includes(selection.status)) {
      throw new Error(`Publication job ${job.id} has an unsupported content status`);
    }
    if (selection.limit !== undefined && (!Number.isInteger(selection.limit) || selection.limit < 1 || selection.limit > 100)) {
      throw new Error(`Publication job ${job.id} selection.limit must be an integer from 1 to 100`);
    }
    if (selection.offset !== undefined && (!Number.isInteger(selection.offset) || selection.offset < 0)) {
      throw new Error(`Publication job ${job.id} selection.offset must be a non-negative integer`);
    }
  }
}

export async function runPublicationJob(
  job: PublicationJobConfig,
  trigger: 'startup' | 'interval' | 'manual',
  dependencies: PublicationSchedulerDependencies,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (signal.aborted) throw new Error(`Publication job ${job.id} aborted before selection`);
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const records = dependencies.select(job.selection ?? {});
  if (!Array.isArray(records)) throw new Error('Publication content selection returned a non-array result');
  if (signal.aborted) throw new Error(`Publication job ${job.id} aborted after selection`);
  if (records.length === 0) {
    return {
      jobId: job.id,
      publisherId: job.publisherId,
      trigger,
      status: 'skipped',
      reason: 'no-content',
      startedAt,
      finishedAt: now().toISOString(),
      selected: 0,
    };
  }
  const publication = await dependencies.publish(job.publisherId, records, {
    signal,
    trigger: 'scheduler',
    jobId: job.id,
  });
  if (signal.aborted) throw new Error(`Publication job ${job.id} aborted after publication`);
  return {
    jobId: job.id,
    publisherId: job.publisherId,
    trigger,
    status: 'success',
    startedAt,
    finishedAt: now().toISOString(),
    selected: records.length,
    publication,
  };
}
