import { defineTool } from '@deepseek-ai/dsh-tools'
import { createManagedMediaFetch } from './secure-rss-fetch.js'
import { registerPrismFlowTool } from './store-prismflow-toolsets.js'

const productionMediaFetch = createManagedMediaFetch({ rejectFragments: true })

export const name = 'prismflow-tool-production-media'
export const inject = ['tools', 'prismProduction', 'prismProductionMedia', 'prismToolsets']

const claimOutput = {
  type: 'object', additionalProperties: false,
  properties: {
    assetId: { type: 'string', required: true }, sha256: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
    mime: { type: 'string', required: true }, width: { type: 'integer', required: true }, height: { type: 'integer', required: true },
  },
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 2_048) throw new Error('Media URL is invalid')
  let url
  try { url = new URL(value) } catch { throw new Error('Media URL is invalid') }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Media URL is not allowed')
  return url.toString()
}

export function apply(ctx) {
  registerPrismFlowTool(ctx, defineTool({
    name: 'prismflow_ingest_production_image',
    description: 'Ingest one HTTPS image through the bounded public-network fetcher into the content-addressed Production media store. This is a pre-production operation; it does not publish or upload to WeChat.',
    parameters: { url: { type: 'string', required: true, description: 'Credential-free public HTTPS image URL.' } },
    output: { schema: claimOutput, render: (_args, value) => [{ type: 'text', text: `Production image ${value.assetId} admitted (${value.mime}, ${value.width}×${value.height}, ${value.bytes} bytes).` }] },
    async execute(args, execution) {
      const response = await (ctx.get?.('prismMediaFetch') ?? productionMediaFetch)(safeHttpsUrl(args.url), { kind: 'image', signal: execution.signal })
      return ctx.prismProductionMedia.ingest(Buffer.from(await response.arrayBuffer()))
    },
  }))

  registerPrismFlowTool(ctx, defineTool({
    name: 'prismflow_get_production_image_claim',
    description: 'Resolve the exact bounded Production Media claim for one previously persisted assetId. It returns no image bytes or Base64 and performs no mutation, approval, or publication.',
    parameters: { assetId: { type: 'string', required: true, description: 'Exact SHA-256 assetId returned by prismflow_image_generation or image ingestion.' } },
    output: { schema: claimOutput, render: (_args, value) => [{ type: 'text', text: `Production image claim ${value.assetId} resolved (${value.mime}, ${value.width}×${value.height}, ${value.bytes} bytes).` }] },
    async execute(args) { return ctx.prismProductionMedia.getClaim(args.assetId) },
  }))

  for (const [toolName, legacy] of [
    ['prismflow_create_draft_image_revision', false],
    ['prismflow_create_approved_draft_image_revision', true],
  ]) registerPrismFlowTool(ctx, defineTool({
    name: toolName,
    description: `${legacy ? 'Compatibility alias. ' : ''}Chat-safe image supplement for an approved or published Draft. It never mutates the source Draft. It creates a new unapproved Draft and Generation Request with exact derivation provenance, binds verified Production Media claims, and requires fresh Dashboard approval before publication.`,
    parameters: {
      sourceDraftId: { type: 'string', required: true, description: 'Exact approved or published source Draft id.' },
      expectedVersion: { type: 'integer', required: true, description: 'Exact source Draft version.' },
      expectedSha256: { type: 'string', required: true, description: 'Exact source Draft Markdown SHA-256.' },
      publisherId: { type: 'string', required: true, description: 'Configured wechat-draft Publisher id whose presentation receives the images.' },
      assets: { type: 'array', required: true, items: claimOutput, description: 'One to twenty complete claims returned by prismflow_image_generation or prismflow_ingest_production_image.' },
      placement: { type: 'string', required: true, enum: ['cover-and-first', 'append', 'cover-only'], description: 'cover-and-first sets the first new image as cover and prepends all new images; append keeps the current cover and appends; cover-only changes only the cover.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      sourceDraftId: { type: 'string', required: true }, draftId: { type: 'string', required: true }, requestId: { type: 'string', required: true },
      version: { type: 'integer', required: true }, sha256: { type: 'string', required: true }, artifactBindingSha256: { type: 'string', required: true },
      status: { type: 'string', required: true }, imageCount: { type: 'integer', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: `Created image-bound Draft ${value.draftId} from source Draft ${value.sourceDraftId}. It is unapproved and requires Dashboard review.` }] },
    async execute(args) {
      const draft = await ctx.prismProduction.createApprovedDraftImageRevision(
        args.sourceDraftId, args.expectedVersion, args.expectedSha256, args.publisherId, args.assets, args.placement,
      )
      return { sourceDraftId: args.sourceDraftId, draftId: draft.draftId, requestId: draft.requestId,
        version: draft.version, sha256: draft.sha256, artifactBindingSha256: draft.artifactBindingSha256,
        status: draft.status, imageCount: draft.mediaAssets.length }
    },
  }))

  registerPrismFlowTool(ctx, defineTool({
    name: 'prismflow_set_draft_presentation',
    description: 'Create a new unapproved Draft version that binds image claims and destination presentation choices to a mutable draft/rejected Draft. Never use this for approved or published Drafts; derive a new Draft with prismflow_create_draft_image_revision instead. It never publishes.',
    parameters: {
      draftId: { type: 'string', required: true }, expectedVersion: { type: 'integer', required: true }, expectedSha256: { type: 'string', required: true },
      mediaAssets: { type: 'array', required: true, items: claimOutput },
      destinationPresentations: { type: 'array', required: true, items: {
        type: 'object', additionalProperties: false,
        properties: {
          publisherId: { type: 'string', required: true }, author: { type: 'string' }, digest: { type: 'string' },
          cover: { type: 'object', additionalProperties: false, properties: { assetId: { type: 'string', required: true }, crops: { type: 'array', items: {
            type: 'object', additionalProperties: false, properties: { ratio: { type: 'string', required: true }, x1: { type: 'number', required: true }, y1: { type: 'number', required: true }, x2: { type: 'number', required: true }, y2: { type: 'number', required: true } },
          } } } },
          imageOrder: { type: 'array', items: { type: 'string' } },
        },
      } },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      draftId: { type: 'string', required: true }, version: { type: 'integer', required: true }, sha256: { type: 'string', required: true },
      artifactBindingSha256: { type: 'string', required: true }, status: { type: 'string', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: `Draft ${value.draftId} presentation is bound as v${value.version}; Dashboard approval is required.` }] },
    async execute(args) {
      const draft = await ctx.prismProduction.setDraftPresentation(args.draftId, args.expectedVersion, args.expectedSha256, args.mediaAssets, args.destinationPresentations)
      return { draftId: draft.draftId, version: draft.version, sha256: draft.sha256, artifactBindingSha256: draft.artifactBindingSha256, status: draft.status }
    },
  }))
}
