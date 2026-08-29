import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/tool-production-media.js'

const ASSET = { assetId: '2'.repeat(64), sha256: '2'.repeat(64), bytes: 256, mime: 'image/png', width: 1200, height: 800 }

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
