import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/tool-production-media.js'

const ASSET = { assetId: '2'.repeat(64), sha256: '2'.repeat(64), bytes: 256, mime: 'image/png', width: 1200, height: 800 }
const REMOTE_ASSET = { assetId: '3'.repeat(64), sha256: '3'.repeat(64), bytes: 512, mime: 'image/png', width: 800, height: 800 }

test('Chat tool derives an unapproved image-bound Draft from an exact approved or published source', async () => {
  const tools = new Map()
  let observed
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    prismProduction: {
      async createApprovedDraftImageRevision(...args) {
        observed = args
        return { draftId: 'derived-draft', requestId: 'derived-request', version: 1, sha256: 'a'.repeat(64),
          artifactBindingSha256: 'b'.repeat(64), status: 'draft', mediaAssets: [ASSET] }
      },
    },
    prismProductionMedia: { async getClaim(assetId) { assert.equal(assetId, ASSET.assetId); return ASSET } },
  }
  apply(ctx)
  assert.deepEqual([...tools.keys()], [
    'prismflow_ingest_production_image',
    'prismflow_get_production_image_claim',
    'prismflow_inherit_draft_images',
    'prismflow_create_draft_image_revision',
    'prismflow_create_approved_draft_image_revision',
    'prismflow_set_draft_presentation',
  ])
  assert.deepEqual(await tools.get('prismflow_get_production_image_claim').execute({ assetId: ASSET.assetId }, {}), ASSET)
  const args = { sourceDraftId: 'approved-draft', expectedVersion: 3, expectedSha256: 'c'.repeat(64),
    publisherId: 'wechat-draft:newspic', assets: [ASSET], placement: 'cover-and-first' }
  const result = await tools.get('prismflow_create_draft_image_revision').execute(args, {})
  assert.deepEqual(observed, [args.sourceDraftId, args.expectedVersion, args.expectedSha256, args.publisherId, args.assets, args.placement])
  assert.deepEqual(result, { sourceDraftId: 'approved-draft', draftId: 'derived-draft', requestId: 'derived-request',
    version: 1, sha256: 'a'.repeat(64), artifactBindingSha256: 'b'.repeat(64), status: 'draft', imageCount: 1 })
})

test('Chat tool inherits an immutable Draft cover and HTTPS body images into one cover-first WeChat presentation', async () => {
  const tools = new Map(); let observed; let fetchAttempts = 0
  const sourceSha256 = 'c'.repeat(64)
  const source = { draftId: 'source-draft', status: 'published', version: 4, sha256: sourceSha256,
    markdown: `![已有](prismflow-media:${ASSET.assetId})\n\n![远程](https://media.example.test/body.png)`,
    mediaAssets: [ASSET], destinationPresentations: [{ publisherId: 'wechat-draft:old', cover: { assetId: ASSET.assetId }, imageOrder: [ASSET.assetId] }] }
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    get(name) { if (name === 'prismMediaFetch') return async url => {
      fetchAttempts += 1; assert.equal(url, 'https://media.example.test/body.png')
      if (fetchAttempts < 3) throw new Error('transient fetch failure')
      return { async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer } }
    } },
    prismProduction: {
      getDraft(id) { assert.equal(id, source.draftId); return source },
      async createApprovedDraftImageRevision(...args) {
        observed = args
        return { draftId: 'derived-draft', requestId: 'derived-request', version: 1, sha256: sourceSha256,
          artifactBindingSha256: 'b'.repeat(64), status: 'draft', mediaAssets: [ASSET, REMOTE_ASSET] }
      },
    },
    prismProductionMedia: { async ingest(bytes) { assert.deepEqual([...bytes], [1, 2, 3]); return REMOTE_ASSET }, async getClaim() { return ASSET } },
  }
  apply(ctx)
  const result = await tools.get('prismflow_inherit_draft_images').execute({ sourceDraftId: source.draftId, expectedVersion: 4,
    expectedSha256: sourceSha256, publisherId: 'wechat-draft:current' }, { signal: new AbortController().signal })
  assert.equal(fetchAttempts, 3)
  assert.deepEqual(observed, [source.draftId, 4, sourceSha256, 'wechat-draft:current', [ASSET, REMOTE_ASSET], 'cover-and-first'])
  assert.deepEqual(result, { sourceDraftId: source.draftId, draftId: 'derived-draft', requestId: 'derived-request', version: 1,
    sha256: sourceSha256, artifactBindingSha256: 'b'.repeat(64), status: 'draft', imageCount: 2,
    inheritedImageCount: 2, ingestedBodyImageCount: 1, omittedBodyImageCount: 0 })
})

test('image inheritance fails closed without creating a partial Draft after three body-image failures', async () => {
  const tools = new Map(); let fetchAttempts = 0; let revisions = 0
  const sourceSha256 = 'c'.repeat(64)
  const source = { draftId: 'source-draft', status: 'published', version: 4, sha256: sourceSha256,
    markdown: '![远程](https://media.example.test/unavailable.png)', mediaAssets: [ASSET],
    destinationPresentations: [{ publisherId: 'wechat-draft:old', cover: { assetId: ASSET.assetId }, imageOrder: [ASSET.assetId] }] }
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    get(name) { if (name === 'prismMediaFetch') return async () => { fetchAttempts += 1; throw new Error('unavailable') } },
    prismProduction: { getDraft() { return source }, async createApprovedDraftImageRevision() { revisions += 1 } },
    prismProductionMedia: { async ingest() { throw new Error('must not ingest') }, async getClaim() { return ASSET } },
  }
  apply(ctx)
  await assert.rejects(tools.get('prismflow_inherit_draft_images').execute({ sourceDraftId: source.draftId, expectedVersion: 4,
    expectedSha256: sourceSha256, publisherId: 'wechat-draft:current' }, { signal: new AbortController().signal }), /no derived Draft was created/)
  assert.equal(fetchAttempts, 3); assert.equal(revisions, 0)
})
