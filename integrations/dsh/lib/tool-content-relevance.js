import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'prismflow-tool-content-relevance'
export const inject = ['tools', 'prismContentRelevance']

const commonFilters = () => ({
  hours: { type: 'integer', description: 'Bounded lookback window in hours, from 1 to 168. Defaults to the deployment profile value.' },
  asOf: { type: 'string', description: 'Optional canonical ISO-8601 UTC cutoff returned by an earlier relevance call, used to freeze pagination.' },
  sourceId: { type: 'string', description: 'Optional exact configured source id.' },
  category: { type: 'string', description: 'Optional exact content category.' },
})

function serviceQuery(args) {
  if (args.asOf === undefined) return args
  if (typeof args.asOf !== 'string' || args.asOf.length > 40 || /[\u0000-\u001f\u007f]/u.test(args.asOf)) throw new Error('asOf is invalid')
  const parsed = Date.parse(args.asOf)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== args.asOf) throw new Error('asOf must be a canonical ISO-8601 UTC timestamp')
  return { ...args, asOf: new Date(parsed) }
}

const prepareSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    asOf: { type: 'string', required: true }, since: { type: 'string', required: true }, hours: { type: 'integer', required: true },
    candidateCount: { type: 'integer', required: true }, cached: { type: 'integer', required: true }, assessed: { type: 'integer', required: true },
    matchedAi: { type: 'integer', required: true }, ambiguous: { type: 'integer', required: true }, unmatched: { type: 'integer', required: true },
    failed: { type: 'integer', required: true }, incomplete: { type: 'integer', required: true }, malformed: { type: 'integer', required: true },
    complete: { type: 'boolean', required: true },
  },
}
const evidenceSchema = {
  type: 'object', additionalProperties: false,
  properties: { field: { type: 'string', required: true }, topic: { type: 'string' }, excerpt: { type: 'string', required: true } },
}
const compactCardSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    storeId: { type: 'string', required: true }, sourceId: { type: 'string', required: true }, title: { type: 'string', required: true },
    url: { type: 'string' }, source: { type: 'string' }, category: { type: 'string' }, publishedAt: { type: 'string', required: true },
    verdict: { type: 'string', required: true }, topics: { type: 'array', items: { type: 'string' }, required: true },
    reasonCodes: { type: 'array', items: { type: 'string' }, required: true }, evidence: { type: 'array', items: evidenceSchema, required: true },
    timestampBasis: { type: 'string', required: true }, truncated: { type: 'boolean' },
  },
}
const coverageSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    asOf: { type: 'string', required: true }, since: { type: 'string', required: true }, hours: { type: 'integer', required: true },
    candidateCount: { type: 'integer', required: true }, currentAssessments: { type: 'integer', required: true },
    matchedAi: { type: 'integer', required: true }, ambiguous: { type: 'integer', required: true }, unmatched: { type: 'integer', required: true },
    missing: { type: 'integer', required: true }, stale: { type: 'integer', required: true }, failed: { type: 'integer', required: true },
    malformed: { type: 'integer', required: true }, complete: { type: 'boolean', required: true },
  },
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'prismflow_prepare_ai_relevance',
    description: 'Explicitly scan persisted content in a bounded frozen time window and cache deterministic bilingual AI-relevance assessments. No remote model is called.',
    parameters: commonFilters(), output: {
      schema: prepareSchema,
      render: (_args, value) => [{ type: 'text', text: `Assessed ${value.assessed}, reused ${value.cached}; matched AI ${value.matchedAi}, ambiguous ${value.ambiguous}, unmatched ${value.unmatched}, failed ${value.failed}.` }],
    },
    async execute(args, exec) { return ctx.prismContentRelevance.prepare(serviceQuery(args), { signal: exec?.signal }) },
  }))
  ctx.tools.register(defineTool({
    name: 'prismflow_count_ai_relevance',
    description: 'Count current, missing, stale, malformed, and failed cached AI-relevance assessments for a frozen content window. Run prepare first when coverage is incomplete.',
    parameters: commonFilters(), output: {
      schema: coverageSchema,
      render: (_args, value) => [{ type: 'text', text: `${value.matchedAi} matched AI; ${value.ambiguous} ambiguous; ${value.unmatched} unmatched out of ${value.candidateCount}. Coverage ${value.complete ? 'complete' : 'incomplete'}.` }],
    },
    async execute(args, exec) { return ctx.prismContentRelevance.coverage(serviceQuery(args), { signal: exec?.signal }) },
  }))
  ctx.tools.register(defineTool({
    name: 'prismflow_query_ai_content',
    description: 'Query compact cards for cached AI-relevance results without exposing long persisted bodies to Chat. Reuse asOf across pages.',
    parameters: {
      ...commonFilters(),
      verdict: { type: 'string', enum: ['matched-ai', 'ambiguous', 'unmatched'], description: 'Assessment verdict. Defaults to matched-ai.' },
      topic: {
        type: 'string', enum: ['foundation-models', 'machine-learning', 'agents-rag-inference', 'multimodal-generative-ai', 'frameworks-deployment', 'ai-compute', 'robotics-autonomy', 'safety-governance', 'ai-companies-funding'],
        description: 'Optional fixed AI topic family.',
      },
      limit: { type: 'integer', description: 'Maximum compact cards to return, from 1 to 100. Defaults to 20.' },
      offset: { type: 'integer', description: 'Non-negative pagination offset. Defaults to 0.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          asOf: { type: 'string', required: true }, since: { type: 'string', required: true }, total: { type: 'integer', required: true },
          missing: { type: 'integer', required: true }, stale: { type: 'integer', required: true }, failed: { type: 'integer', required: true },
          malformed: { type: 'integer', required: true }, items: { type: 'array', items: compactCardSchema, required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text', text: value.items.length
          ? `${value.total} matched compact record(s).\n${value.items.map(item => `- ${item.storeId}: ${item.title}`).join('\n')}`
          : `No compact AI-relevance records matched. Total ${value.total}.`,
      }],
    },
    async execute(args, exec) { return ctx.prismContentRelevance.query(serviceQuery(args), { signal: exec?.signal }) },
  }))
}
