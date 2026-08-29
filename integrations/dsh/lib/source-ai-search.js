import Schema from '@deepseek-ai/schemastery'
import {
  buildAISearchPrompt,
  normalizeAISearchItems,
  parseAISearchItems,
} from './shared/ai-search-source.js'

export const name = 'prismflow-source-ai-search'
export const inject = ['prismSources', 'subagents']

const SourceConfig = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().required(),
  keyword: Schema.string().required(),
  category: Schema.string().default('aiSearch'),
  limit: Schema.number().default(10),
  subagentProvider: Schema.string().default('spawn'),
  webSearchTool: Schema.string().default('web_search'),
  restrictToWebSearch: Schema.boolean().default(true),
})

export const Config = Schema.object({
  sources: Schema.array(SourceConfig).default([]),
})

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          description: { type: 'string' },
          content: { type: 'string' },
          author: { type: 'string' },
          published_date: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
        },
        required: ['title', 'url', 'description', 'content'],
      },
    },
  },
  required: ['items'],
}

function positiveLimit(value, sourceId) {
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error(`AI Search source ${sourceId} limit must be an integer from 1 to 50`)
  }
}

function outputText(blocks) {
  return blocks
    .filter(block => block?.type === 'text')
    .map(block => block.text)
    .join('')
}

async function settleRun(run) {
  const [execution] = await Promise.allSettled([run.result])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError([execution.reason, disposal.reason], 'AI Search subagent execution and disposal failed')
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

export function apply(ctx, config) {
  const seenIds = new Set()

  for (const source of config.sources) {
    if (!/^[a-zA-Z0-9_-]+$/.test(source.id)) {
      throw new Error(`AI Search source id must match [a-zA-Z0-9_-]+: ${source.id}`)
    }
    if (seenIds.has(source.id)) {
      throw new Error(`Duplicate AI Search source id: ${source.id}`)
    }
    if (!source.keyword.trim()) throw new Error(`AI Search source ${source.id} keyword is required`)
    positiveLimit(source.limit, source.id)
    seenIds.add(source.id)

    const sourceId = `ai-search:${source.id}`
    ctx.effect(() => ctx.prismSources.register({
      id: sourceId,
      name: source.name,
      description: `Research current information for the configured keyword: ${source.keyword}.`,
      requiresAgent: true,
      async fetch(request = {}, execution) {
        if (!execution.agent) {
          throw new Error('AI Search requires a model-driven DSH tool call with a parent agent')
        }
        const requestedLimit = request.limit ?? source.limit
        positiveLimit(requestedLimit, source.id)
        const limit = Math.min(requestedLimit, source.limit)
        const prompt = buildAISearchPrompt(source.keyword, limit)

        const run = await ctx.subagents.start(source.subagentProvider, {
          label: `search ${source.id}`,
          prompt: [{ type: 'text', text: prompt }],
          parent: execution.agent,
          signal: execution.signal,
          outputSchema: OUTPUT_SCHEMA,
          persona: 'You are a careful web researcher. Use only verified web-search results, never invent URLs or facts, and finish through the structured-output tool.',
          ...(source.restrictToWebSearch
            ? { toolFilter: { allow: [source.webSearchTool] } }
            : {}),
        })

        const result = await settleRun(run)
        if (result.stopReason !== 'completed') {
          throw new Error(`AI Search subagent stopped with reason: ${result.stopReason}`)
        }

        const structuredItems = result.structured
          && typeof result.structured === 'object'
          && Array.isArray(result.structured.items)
          ? result.structured.items
          : undefined
        const items = structuredItems ?? parseAISearchItems(outputText(result.output))
        if (items.length === 0) {
          throw new Error('AI Search subagent returned no structured search items')
        }

        return normalizeAISearchItems(items.slice(0, limit), {
          sourceName: source.name,
          category: source.category,
          keyword: source.keyword,
          executorId: `dsh-subagent:${source.subagentProvider}`,
        })
      },
    }))
  }
}
