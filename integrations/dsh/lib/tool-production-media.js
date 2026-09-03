import { defineTool } from '@deepseek-ai/dsh-tools'
import { createManagedMediaFetch } from './secure-rss-fetch.js'
import { registerPrismFlowTool } from './store-prismflow-toolsets.js'
import { renderWechatMarkdown } from './shared/wechat-publisher.js'

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

const SHA256 = /^[a-f0-9]{64}$/u
function mediaAssetId(source) {
  const match = /^prismflow-media:([a-f0-9]{64})$/u.exec(source)
  return match?.[1]
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

  registerPrismFlowTool(ctx, defineTool({
    name: 'prismflow_inherit_draft_images',
    description: 'Use this exact tool when the user asks to inherit or copy a published/approved Draft cover and other images, or add that Draft images to a WeChat image list. It securely resolves the source presentation and Markdown images, retries each body-image admission up to three times, fails without creating a Draft if any image is omitted, creates a new unapproved image-bound Draft for the selected WeChat publisher, and never publishes or changes the source. Dashboard approval is still required before prismflow_publish.',
    parameters: {
      sourceDraftId: { type: 'string', required: true, description: 'Exact approved or published source Draft id.' },
      expectedVersion: { type: 'integer', required: true, description: 'Exact source Draft version returned by prismflow_drafts.' },
      expectedSha256: { type: 'string', required: true, description: 'Exact source Draft Markdown SHA-256 returned by prismflow_drafts.' },
      publisherId: { type: 'string', required: true, description: 'Configured destination wechat-draft Publisher id.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      sourceDraftId: { type: 'string', required: true }, draftId: { type: 'string', required: true }, requestId: { type: 'string', required: true },
      version: { type: 'integer', required: true }, sha256: { type: 'string', required: true }, artifactBindingSha256: { type: 'string', required: true },
      status: { type: 'string', required: true }, imageCount: { type: 'integer', required: true }, inheritedImageCount: { type: 'integer', required: true },
      ingestedBodyImageCount: { type: 'integer', required: true }, omittedBodyImageCount: { type: 'integer', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: `Created unapproved Draft ${value.draftId} with ${value.inheritedImageCount} inherited images (${value.ingestedBodyImageCount} imported from body URLs, ${value.omittedBodyImageCount} omitted). Approve it in Dashboard before publishing.` }] },
    async execute(args, execution) {
      const source = ctx.prismProduction.getDraft(args.sourceDraftId)
      if (!source || !['approved', 'published'].includes(source.status)) throw new Error('Only an approved or published source Draft can inherit images')
      if (source.version !== args.expectedVersion || source.sha256 !== args.expectedSha256) throw new Error('Source Draft version or SHA-256 changed before image inheritance')
      if (!Number.isInteger(args.expectedVersion) || args.expectedVersion < 1 || typeof args.expectedSha256 !== 'string' || !SHA256.test(args.expectedSha256)) throw new Error('Source Draft version or SHA-256 is invalid')
      const sourceClaims = new Map((source.mediaAssets ?? []).map(claim => [claim.assetId, claim]))
      const presentations = source.destinationPresentations ?? []
      const sourcePresentation = presentations.find(item => item.publisherId === args.publisherId)
        ?? presentations.find(item => item.cover?.assetId || item.imageOrder?.length)
      const inherited = []
      const inheritedIds = new Set()
      const addClaim = claim => {
        if (!claim || inheritedIds.has(claim.assetId) || inherited.length >= 20) return false
        inherited.push(claim); inheritedIds.add(claim.assetId); return true
      }
      for (const assetId of [sourcePresentation?.cover?.assetId, ...(sourcePresentation?.imageOrder ?? [])]) {
        if (assetId) addClaim(sourceClaims.get(assetId))
      }
      const bodySources = [...new Set(renderWechatMarkdown(source.markdown).images.map(image => image.source))]
      let ingestedBodyImageCount = 0
      let omittedBodyImageCount = 0
      for (const imageSource of bodySources) {
        const existingAssetId = mediaAssetId(imageSource)
        if (existingAssetId) {
          if (!addClaim(sourceClaims.get(existingAssetId)) && !inheritedIds.has(existingAssetId)) omittedBodyImageCount += 1
          continue
        }
        if (inherited.length >= 20) { omittedBodyImageCount += 1; continue }
        let admitted = false
        for (let attempt = 1; attempt <= 3 && !admitted; attempt += 1) {
          try {
            const response = await (ctx.get?.('prismMediaFetch') ?? productionMediaFetch)(safeHttpsUrl(imageSource), { kind: 'image', signal: execution.signal })
            const claim = await ctx.prismProductionMedia.ingest(Buffer.from(await response.arrayBuffer()))
            if (addClaim(claim)) ingestedBodyImageCount += 1
            admitted = true
          } catch (error) {
            if (execution.signal?.aborted) throw error
          }
        }
        if (!admitted) omittedBodyImageCount += 1
      }
      if (!inherited.length) throw new Error('Source Draft has no inheritable Production Media or admissible HTTPS body images')
      if (omittedBodyImageCount > 0) throw new Error(`Image inheritance omitted ${omittedBodyImageCount} body image(s) after three attempts; no derived Draft was created. Retry the operation.`)
      const draft = await ctx.prismProduction.createApprovedDraftImageRevision(
        args.sourceDraftId, args.expectedVersion, args.expectedSha256, args.publisherId, inherited, 'cover-and-first',
      )
      return { sourceDraftId: args.sourceDraftId, draftId: draft.draftId, requestId: draft.requestId,
        version: draft.version, sha256: draft.sha256, artifactBindingSha256: draft.artifactBindingSha256, status: draft.status,
        imageCount: draft.mediaAssets.length, inheritedImageCount: inherited.length, ingestedBodyImageCount, omittedBodyImageCount }
    },
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
