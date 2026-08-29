import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerPrismFlowTool } from './store-prismflow-toolsets.js'

export const name = 'prismflow-tool-content'
export const inject = ['tools', 'prismSources', 'prismContentStore']

export function apply(ctx) {
  registerPrismFlowTool(ctx, defineTool({
    name: 'prismflow_sync_source',
    description: 'Fetch a configured native PrismFlow source and durably persist its normalized content in the DSH content store.',
    parameters: {
      sourceId: {
        type: 'string',
        required: true,
        description: 'Source id returned by prismflow_sources.',
      },
      limit: {
        type: 'integer',
        description: 'Optional result limit; the configured source limit remains authoritative.',
      },
      overwrite: {
        type: 'boolean',
        description: 'Update records already seen from this source. Defaults to false.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fetched: { type: 'integer', required: true },
          inserted: { type: 'integer', required: true },
          updated: { type: 'integer', required: true },
          skipped: { type: 'integer', required: true },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Fetched ${value.fetched}; inserted ${value.inserted}, updated ${value.updated}, skipped ${value.skipped}.`,
      }],
    },
    async execute(args, exec) {
      const items = await ctx.prismSources.fetch(
        args.sourceId,
        args.limit === undefined ? {} : { limit: args.limit },
        { signal: exec.signal, agent: exec.agent },
      )
      const summary = await ctx.prismContentStore.putBatch(args.sourceId, items, {
        overwrite: args.overwrite ?? false,
        signal: exec.signal,
      })
      return { fetched: items.length, ...summary }
    },
  }))

}
