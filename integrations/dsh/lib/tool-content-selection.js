import { defineTool } from '@deepseek-ai/dsh-tools'
import { registerPrismFlowTool } from './store-prismflow-toolsets.js'

export const name = 'prismflow-tool-content-selection'
export const inject = ['tools', 'prismContentSelections']

const EXPLICIT_SOURCE_SELECTION_TOOL = 'prismflow_create_ai_selection_from_explicit_source'

const TOPICS = [
  'foundation-models', 'machine-learning', 'agents-rag-inference',
  'multimodal-generative-ai', 'frameworks-deployment', 'ai-compute',
  'robotics-autonomy', 'safety-governance', 'ai-companies-funding',
]
function serviceQuery(args) {
  if (args.asOf === undefined) return args
  if (typeof args.asOf !== 'string' || args.asOf.length > 40 || !Number.isFinite(Date.parse(args.asOf))
    || new Date(Date.parse(args.asOf)).toISOString() !== args.asOf) throw new Error('asOf must be a canonical ISO-8601 UTC timestamp')
  return { ...args, asOf: new Date(args.asOf) }
}
const selectionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    selectionId: { type: 'string', required: true }, selectionSha256: { type: 'string', required: true },
    createdAt: { type: 'string', required: true }, asOf: { type: 'string', required: true }, since: { type: 'string', required: true },
    hours: { type: 'integer', required: true }, counts: { type: 'json', required: true }, selectedCount: { type: 'integer', required: true },
    totalMaterialChars: { type: 'integer', required: true }, estimatedTokens: { type: 'integer', required: true },
    contentStoreIds: { type: 'array', items: { type: 'string' }, required: true },
    sourceIds: { type: 'array', items: { type: 'string' }, required: true },
  },
}
const filters = () => ({
  hours: { type: 'integer', description: 'Lookback hours from 1 to 168. Defaults to 48.' },
  asOf: { type: 'string', description: 'Optional canonical UTC cutoff to freeze the selection window.' },
  category: { type: 'string', description: 'Optional exact category.' },
  topic: { type: 'string', enum: TOPICS, description: 'Optional fixed AI topic family; narrowing from the default requires user approval.' },
})

export function apply(ctx) {
  if (typeof ctx.on === 'function') {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const downstream = await next()
      if (downstream.kind !== 'allow') return downstream
      if (exec.name === EXPLICIT_SOURCE_SELECTION_TOOL) {
        return { kind: 'ask', reason: 'Restrict AI Selection to the displayed exact source. Use the all-sources default unless the user explicitly requested this source.' }
      }
      const args = exec.name === 'prismflow_create_ai_selection' && exec.arguments && typeof exec.arguments === 'object'
        ? exec.arguments : {}
      if (args.category !== undefined || args.topic !== undefined || Number.isInteger(args.hours) && args.hours < 48) {
        return { kind: 'ask', reason: 'Narrow the default all-sources 48-hour Selection window or topic scope. Continue only if the user explicitly requested the displayed narrowing.' }
      }
      return downstream
    })
  }

  registerPrismFlowTool(ctx, defineTool({
    name: 'prismflow_create_ai_selection',
    description: 'Default all-sources path over records already persisted in PrismFlow Content Store. This tool never fetches, refreshes, or synchronizes a source; do not call prismflow_sources or prismflow_sync_source unless the user separately and explicitly requests synchronization. Create one immutable AI-only Selection using batched AI editorial scoring, bounded AI title-summary event clustering passes, diverse ranking, and bounded verbatim material packing. This tool cannot narrow to one source or lower item/token budgets. A window below 48 hours or category/topic filter requires explicit user approval.',
    parameters: filters(), output: {
      schema: selectionSchema,
      render: (_args, value) => [{ type: 'text', text: `AI selection ${value.selectionId}: ${value.selectedCount} items across ${value.sourceIds.length} selected source(s), about ${value.estimatedTokens} conservative tokens. Use prismflow_create_generation_request_from_ai_selection next.` }],
    },
    async execute(args, exec) { return ctx.prismContentSelections.create(serviceQuery(args), { signal: exec?.signal, agent: exec?.agent }) },
  }))
  registerPrismFlowTool(ctx, defineTool({
    name: EXPLICIT_SOURCE_SELECTION_TOOL,
    description: 'Restricted exact-source AI Selection. Use only when the user explicitly requests one exact persisted source; every call requires one-shot user approval. Otherwise use prismflow_create_ai_selection across all sources.',
    parameters: { ...filters(), sourceId: { type: 'string', required: true, description: 'Exact source id explicitly requested by the user.' } },
    output: {
      schema: selectionSchema,
      render: (_args, value) => [{ type: 'text', text: `Source-restricted AI selection ${value.selectionId}: ${value.selectedCount} items from ${value.sourceIds.join(', ') || 'no projected source'}.` }],
    },
    async execute(args, exec) { return ctx.prismContentSelections.create(serviceQuery(args), { signal: exec?.signal, agent: exec?.agent }) },
  }))
}
