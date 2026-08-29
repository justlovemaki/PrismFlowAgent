export interface IngestionJobConfig {
  id: string;
  sourceId: string;
  intervalMs: number;
  enabled: boolean;
  runOnStart: boolean;
  limit?: number;
  overwrite: boolean;
}

export interface IngestionPersistenceSummary {
  inserted: number;
  updated: number;
  skipped: number;
  total: number;
}

export interface IngestionRunReceipt extends IngestionPersistenceSummary {
  jobId: string;
  sourceId: string;
  trigger: 'startup' | 'interval' | 'manual';
  status: 'success';
  startedAt: string;
  finishedAt: string;
  fetched: number;
  batches: number;
}

export interface IngestionRunDependencies {
  fetch(
    sourceId: string,
    request: { limit?: number },
    signal: AbortSignal,
  ): Promise<unknown>;
  persist(
    sourceId: string,
    items: unknown[],
    options: { overwrite: boolean; signal: AbortSignal },
  ): Promise<IngestionPersistenceSummary>;
  now?: () => Date;
}

export const MAX_INGESTION_BATCH_SIZE = 500;
export const MIN_INGESTION_INTERVAL_MS = 60_000;
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function assertIngestionJobs(jobs: IngestionJobConfig[]): void {
  const ids = new Set<string>();
  const sourceIds = new Set<string>();

  for (const job of jobs) {
    if (!/^[a-zA-Z0-9_-]+$/.test(job.id)) {
      throw new Error(`Ingestion job id must match [a-zA-Z0-9_-]+: ${job.id}`);
    }
    if (ids.has(job.id)) throw new Error(`Duplicate ingestion job id: ${job.id}`);
    ids.add(job.id);

    if (typeof job.sourceId !== 'string' || job.sourceId.trim() === '') {
      throw new Error(`Ingestion job ${job.id} sourceId is required`);
    }
    if (sourceIds.has(job.sourceId)) {
      throw new Error(`Duplicate ingestion sourceId: ${job.sourceId}`);
    }
    sourceIds.add(job.sourceId);

    if (!Number.isInteger(job.intervalMs)
      || job.intervalMs < MIN_INGESTION_INTERVAL_MS
      || job.intervalMs > MAX_TIMER_DELAY_MS) {
      throw new Error(
        `Ingestion job ${job.id} intervalMs must be an integer from ${MIN_INGESTION_INTERVAL_MS} to ${MAX_TIMER_DELAY_MS}`,
      );
    }
    if (job.limit !== undefined
      && (!Number.isInteger(job.limit) || job.limit < 1 || job.limit > MAX_INGESTION_BATCH_SIZE)) {
      throw new Error(`Ingestion job ${job.id} limit must be an integer from 1 to ${MAX_INGESTION_BATCH_SIZE}`);
    }
  }
}

export async function runIngestionJob(
  job: IngestionJobConfig,
  trigger: IngestionRunReceipt['trigger'],
  dependencies: IngestionRunDependencies,
  signal: AbortSignal,
): Promise<IngestionRunReceipt> {
  if (signal.aborted) throw new Error(`Ingestion job ${job.id} aborted before fetch`);
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const fetched = await dependencies.fetch(
    job.sourceId,
    job.limit === undefined ? {} : { limit: job.limit },
    signal,
  );
  if (signal.aborted) throw new Error(`Ingestion job ${job.id} aborted after fetch`);
  if (!Array.isArray(fetched)) {
    throw new Error(`Ingestion source ${job.sourceId} returned a non-array result`);
  }

  const aggregate: IngestionPersistenceSummary = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    total: 0,
  };
  let batches = 0;
  for (let offset = 0; offset < fetched.length; offset += MAX_INGESTION_BATCH_SIZE) {
    if (signal.aborted) throw new Error(`Ingestion job ${job.id} aborted before persistence`);
    const chunk = fetched.slice(offset, offset + MAX_INGESTION_BATCH_SIZE);
    const result = await dependencies.persist(job.sourceId, chunk, {
      overwrite: job.overwrite,
      signal,
    });
    aggregate.inserted += result.inserted;
    aggregate.updated += result.updated;
    aggregate.skipped += result.skipped;
    aggregate.total += result.total;
    batches += 1;
  }

  return {
    jobId: job.id,
    sourceId: job.sourceId,
    trigger,
    status: 'success',
    startedAt,
    finishedAt: now().toISOString(),
    fetched: fetched.length,
    batches,
    ...aggregate,
  };
}
