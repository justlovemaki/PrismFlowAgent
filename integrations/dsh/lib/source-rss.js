import Schema from '@deepseek-ai/schemastery'
import {
  fetchParsedRssFeed,
  normalizeParsedRssFeed,
  validateRssFeedDefinition,
} from './shared/rss-source.js'

export const name = 'prismflow-source-rss'
export const inject = ['prismSources']

const FeedConfig = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().required(),
  url: Schema.string().required(),
  category: Schema.string().default('rss'),
  limit: Schema.number().default(20),
})

export const Config = Schema.object({
  feeds: Schema.array(FeedConfig).default([]),
})

export function apply(ctx, config) {
  const seenIds = new Set()

  for (const feed of config.feeds) {
    if (!/^[a-zA-Z0-9_-]+$/.test(feed.id)) {
      throw new Error(`RSS feed id must match [a-zA-Z0-9_-]+: ${feed.id}`)
    }
    if (seenIds.has(feed.id)) {
      throw new Error(`Duplicate RSS feed id: ${feed.id}`)
    }
    seenIds.add(feed.id)
    validateRssFeedDefinition(feed)

    const sourceId = `rss:${feed.id}`
    ctx.effect(() => ctx.prismSources.register({
      id: sourceId,
      name: feed.name,
      description: `Fetch configured RSS/Atom feed ${feed.name}.`,
      async fetch(request = {}, execution) {
        const parsed = await fetchParsedRssFeed(feed, {
          limit: request.limit,
          signal: execution.signal,
          userAgent: 'PrismFlow-DSH/0.1',
        })

        return normalizeParsedRssFeed(parsed, {
          feedId: feed.id,
          name: feed.name,
          category: feed.category,
        })
      },
    }))
  }
}
