import Schema from '@deepseek-ai/schemastery'
import {
  fetchFollowEntries,
  normalizeFollowEntries,
  validateFollowSourceDefinition,
} from './shared/follow-source.js'

export const name = 'prismflow-source-follow'
export const inject = ['prismSources']

const SourceConfig = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().required(),
  apiUrl: Schema.string().required(),
  category: Schema.string().default('follow'),
  listId: Schema.string(),
  feedId: Schema.string(),
  fetchDays: Schema.number().default(3),
  fetchPages: Schema.number().default(1),
  view: Schema.number().default(0),
  limit: Schema.number().default(50),
  cookieEnv: Schema.string().default(''),
  pageDelayMs: Schema.number().default(1500),
  detailDelayMs: Schema.number().default(400),
})

export const Config = Schema.object({
  sources: Schema.array(SourceConfig).default([]),
})

function positiveInteger(value, field, sourceId) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Follow source ${sourceId} ${field} must be a positive integer`)
  }
}

export function apply(ctx, config) {
  const seenIds = new Set()

  for (const source of config.sources) {
    if (!/^[a-zA-Z0-9_-]+$/.test(source.id)) {
      throw new Error(`Follow source id must match [a-zA-Z0-9_-]+: ${source.id}`)
    }
    if (seenIds.has(source.id)) {
      throw new Error(`Duplicate Follow source id: ${source.id}`)
    }
    seenIds.add(source.id)
    positiveInteger(source.limit, 'limit', source.id)
    validateFollowSourceDefinition(source)

    const sourceId = `follow:${source.id}`
    ctx.effect(() => ctx.prismSources.register({
      id: sourceId,
      name: source.name,
      description: `Fetch configured Follow ${source.listId ? 'list' : 'feed'} ${source.name}.`,
      async fetch(request = {}, execution) {
        const requestedLimit = request.limit ?? source.limit
        positiveInteger(requestedLimit, 'requested limit', source.id)
        const limit = Math.min(requestedLimit, source.limit)
        const cookie = source.cookieEnv ? process.env[source.cookieEnv] : undefined
        const requestOptions = {
          cookie,
          signal: execution.signal,
          pageDelayMs: source.pageDelayMs,
          detailDelayMs: source.detailDelayMs,
        }

        const rawData = await fetchFollowEntries(source, requestOptions)
        return normalizeFollowEntries(rawData, source, { ...requestOptions, limit })
      },
    }))
  }
}
