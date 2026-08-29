import Schema from '@deepseek-ai/schemastery'
import {
  fetchGitHubTrending,
  normalizeGitHubTrending,
  validateGitHubTrendingDefinition,
} from './shared/github-trending-source.js'

export const name = 'prismflow-source-github-trending'
export const inject = ['prismSources']

const SourceConfig = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().required(),
  baseUrl: Schema.string().default('https://github.com/trending'),
  category: Schema.string().default('githubTrending'),
  since: Schema.union(['daily', 'weekly', 'monthly']).default('daily'),
  spokenLanguageCode: Schema.string().default(''),
  limit: Schema.number().default(25),
})

export const Config = Schema.object({
  sources: Schema.array(SourceConfig).default([]),
})

export function apply(ctx, config) {
  const seenIds = new Set()

  for (const source of config.sources) {
    if (!/^[a-zA-Z0-9_-]+$/.test(source.id)) {
      throw new Error(`GitHub Trending source id must match [a-zA-Z0-9_-]+: ${source.id}`)
    }
    if (seenIds.has(source.id)) {
      throw new Error(`Duplicate GitHub Trending source id: ${source.id}`)
    }
    seenIds.add(source.id)
    validateGitHubTrendingDefinition(source)

    const sourceId = `github-trending:${source.id}`
    ctx.effect(() => ctx.prismSources.register({
      id: sourceId,
      name: source.name,
      description: `Fetch GitHub Trending repositories for the ${source.since} range.`,
      async fetch(request = {}, execution) {
        const repositories = await fetchGitHubTrending(source, {
          limit: request.limit,
          signal: execution.signal,
          userAgent: 'PrismFlow-DSH/0.1',
        })

        return normalizeGitHubTrending(repositories, {
          sourceName: source.name,
          category: source.category,
        })
      },
    }))
  }
}
