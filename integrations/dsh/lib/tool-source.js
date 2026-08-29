import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerPrismFlowTool } from './store-prismflow-toolsets.js'

export const name = 'prismflow-tool-source'
export const inject = ['tools', 'prismSources']

export function apply(ctx) {
  registerPrismFlowTool(ctx, defineTool({
    name: 'prismflow_sources',
    description: 'List the native PrismFlow content sources configured in this DSH profile.',
    parameters: {},
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            name: { type: 'string', required: true },
            description: { type: 'string', required: true },
            requiresAgent: { type: 'boolean', required: true },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.length > 0
          ? value.map(item => `- ${item.id}: ${item.name}`).join('\n')
          : 'No PrismFlow sources are configured.',
      }],
    },
    async execute() {
      return ctx.prismSources.list()
    },
  }))

}
