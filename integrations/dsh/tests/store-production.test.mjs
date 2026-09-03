import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

function validatePackedMedia(markdown, materials, stage = 'revision') {
  const rendered = markdown.replace(/<!--[\s\S]*?-->/gu, '')
  const missing = materials.flatMap(material => material.media ?? []).filter(media => {
    if (media.kind === 'image') return !rendered.includes(`](${media.url})`)
    const video = rendered.match(new RegExp(`<video\\s+([^>]*src=["']${media.url.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}["'][^>]*)>`, 'iu'))
    return !video || /\bonerror\s*=|\bdata-/iu.test(video[1])
  }).length
  if (missing > 0) throw new Error(`Production generator ${stage} omitted ${missing} required media resource(s)`)
}
import { PrismProductionService, publicationReconciliationResult } from '../lib/store-production.js'
import { PublisherOutcomeError } from '../lib/shared/publisher-outcome.js'

class Table {
  constructor() { this.map = new Map() }
  get(id) { return this.map.get(id) }
  entries() { return this.map.entries() }
  async put(id, value) { this.map.set(id, structuredClone(value)); return value }
  async delete(id) { this.map.delete(id) }
}

const STORE_ID = 'a'.repeat(64)
const PROMPT_REF = { generatorPromptVersion: 0, generatorPromptSha256: 'f'.repeat(64) }
const record = { storeId: STORE_ID, sourceId: 'fixture', item: { title: 'One', url: '', description: 'Body', source: 'fixture', category: 'test', published_date: '' } }

function fixture(publishArtifact = async (_id, value) => ({ status: 'created', draftId: value.draftId }), validateArtifact = async () => true) {
  const ctx = new Context()
  const records = new Map([[STORE_ID, record]])
  Object.defineProperty(ctx, 'prismContentStore', { value: { get(id) { return records.get(id) } } })
  const storedReceipts = new Map()
  Object.defineProperty(ctx, 'prismPublicationReceipts', { value: {
    inspectArtifactPublication() { return { outcome: 'none' } },
    async append(receipt, context) { const stored = { ...receipt, ...context }; storedReceipts.set(context.receiptId, stored); return stored },
    inspectAttemptPublication(attempt, artifact) {
      const receipt = storedReceipts.get(attempt.receiptId)
      if (!receipt) return { outcome: 'none' }
      const exact = receipt.publisherId === attempt.publisherId && receipt.publicationAttemptId === attempt.attemptId
        && receipt.draftId === artifact.draftId && receipt.draftVersion === artifact.draftVersion
        && receipt.artifactSha256 === artifact.artifactSha256 && receipt.sha256 === artifact.artifactSha256
      return exact ? { outcome: receipt.status === 'skipped' ? 'not-committed' : 'committed', receipt } : { outcome: 'ambiguous' }
    },
  } })
  const calls = []; const preflights = []
  let service
  Object.defineProperty(ctx, 'prismPublishers', { value: {
    list() { return [{ id: 'wechat-draft:news', kind: 'wechat-draft' }] },
    async validateArtifact(id, value) { preflights.push({ id, value }); return validateArtifact(id, value) },
    async publishArtifact(id, value, inputs, execution) {
      service.assertPublicationArtifact(id, value)
      calls.push({ id, value, inputs, execution })
      return publishArtifact(id, value, inputs, execution)
    } } })
  service = new PrismProductionService(ctx)
  service.requests = new Table(); service.drafts = new Table(); service.releaseWriterLock = async () => {}
  service.registerGenerator({ id: 'daily', name: 'Daily', maxOutputChars: 10000,
    async pinPrompt() { return PROMPT_REF }, async resolvePrompt(reference) { assert.deepEqual(reference, PROMPT_REF); return reference },
    async generate(request) { assert.equal(request.generatorPromptSha256, PROMPT_REF.generatorPromptSha256); return { title: 'Daily', markdown: '# Daily' } } })
  return { service, records, calls, preflights, storedReceipts }
}

async function approvedDraft(service) {
  const request = await service.createRequest('daily', [STORE_ID])
  const draft = await service.generate(request.requestId, { agent: {}, signal: new AbortController().signal })
  return service.review(draft.draftId, 'approve', draft.version, draft.sha256)
}

test('draft query filters by status and identity fields with stable totals, counts, and pagination', async () => {
  const { service } = fixture()
  const generated = []
  for (const [title, createdAt] of [['Alpha brief', '2026-01-01T00:00:00.000Z'], ['Beta report', '2026-01-02T00:00:00.000Z'], ['Gamma note', '2026-01-03T00:00:00.000Z']]) {
    const request = await service.createRequest('daily', [STORE_ID])
    const draft = await service.generate(request.requestId, { agent: {}, signal: new AbortController().signal })
    const row = { ...draft, title, createdAt, updatedAt: createdAt }
    await service.drafts.put(draft.draftId, row); generated.push(row)
  }
  const approved = await service.review(generated[1].draftId, 'approve', generated[1].version, generated[1].sha256)
  const first = service.queryDrafts({ offset: 0, limit: 2 })
  assert.equal(first.total, 3); assert.deepEqual(first.records.map(item => item.title), ['Gamma note', 'Beta report'])
  assert.deepEqual(first.statusCounts, { draft: 2, approved: 1 })
  const second = service.queryDrafts({ offset: 2, limit: 2 })
  assert.deepEqual(second.records.map(item => item.title), ['Alpha brief'])
  assert.deepEqual(service.queryDrafts({ status: 'approved', limit: 10 }).records.map(item => item.draftId), [approved.draftId])
  assert.deepEqual(service.queryDrafts({ query: 'beta', limit: 10 }).records.map(item => item.title), ['Beta report'])
  assert.equal(service.queryDrafts({ query: generated[2].requestId.slice(-8), limit: 10 }).records[0].draftId, generated[2].draftId)
})

test('Chat can derive image-bound unapproved Drafts from exact approved or published sources without mutating them', async () => {
  const { service } = fixture()
  const approved = await approvedDraft(service)
  const asset = { assetId: '2'.repeat(64), sha256: '2'.repeat(64), bytes: 256, mime: 'image/png', width: 1200, height: 800 }
  let asserted
  Object.defineProperty(service.ctx, 'prismProductionMedia', { value: {
    async assertClaims(claims) { asserted = structuredClone(claims) },
  } })
  const derived = await service.createApprovedDraftImageRevision(
    approved.draftId, approved.version, approved.sha256, 'wechat-draft:news', [asset], 'cover-and-first',
  )
  assert.notEqual(derived.draftId, approved.draftId)
  assert.notEqual(derived.requestId, approved.requestId)
  assert.equal(derived.status, 'draft'); assert.equal(derived.version, 1); assert.equal(derived.sha256, approved.sha256)
  assert.deepEqual(derived.mediaAssets, [asset]); assert.deepEqual(asserted, [asset])
  assert.deepEqual(derived.destinationPresentations, [{ publisherId: 'wechat-draft:news', cover: { assetId: asset.assetId }, imageOrder: [asset.assetId] }])
  assert.deepEqual(derived.derivation, { kind: 'approved-presentation-revision-v1', sourceRequestId: approved.requestId,
    sourceDraftId: approved.draftId, sourceDraftVersion: approved.version, sourceDraftSha256: approved.sha256, sourceStatus: 'approved' })
  assert.equal(service.getDraft(approved.draftId).status, 'approved')
  const derivedRequest = service.getRequest(derived.requestId)
  assert.equal(derivedRequest.status, 'completed'); assert.equal(derivedRequest.draftId, derived.draftId)
  assert.deepEqual(derivedRequest.derivation, derived.derivation)
  const reviewed = await service.review(derived.draftId, 'approve', derived.version, derived.sha256)
  assert.equal(reviewed.status, 'approved'); assert.equal(reviewed.approvedArtifactBindingSha256, derived.artifactBindingSha256)

  await assert.rejects(service.createApprovedDraftImageRevision(
    approved.draftId, approved.version, '3'.repeat(64), 'wechat-draft:news', [asset], 'append',
  ), /version, hash, or presentation binding changed/)
  await assert.rejects(service.createApprovedDraftImageRevision(
    approved.draftId, approved.version, approved.sha256, 'wechat-draft:missing', [asset], 'append',
  ), /configured WeChat publisher/)

  await service.drafts.put(approved.draftId, { ...approved, status: 'published', publishedAt: '2026-01-02T00:00:00.000Z',
    publishedPublisherIds: ['wechat-draft:news'] })
  const publishedRevision = await service.createApprovedDraftImageRevision(
    approved.draftId, approved.version, approved.sha256, 'wechat-draft:news', [asset], 'cover-only',
  )
  assert.equal(publishedRevision.status, 'draft'); assert.equal(publishedRevision.derivation.sourceStatus, 'published')
  assert.equal(service.getDraft(approved.draftId).status, 'published')
})

test('editing an unapproved image-bound Draft preserves exact media and presentations while recomputing its Artifact binding', async () => {
  const { service } = fixture()
  const approved = await approvedDraft(service)
  const asset = { assetId: '4'.repeat(64), sha256: '4'.repeat(64), bytes: 512, mime: 'image/png', width: 1672, height: 941 }
  const assertions = []
  Object.defineProperty(service.ctx, 'prismProductionMedia', { value: {
    async assertClaims(claims) { assertions.push(structuredClone(claims)) },
  } })
  const derived = await service.createApprovedDraftImageRevision(
    approved.draftId, approved.version, approved.sha256, 'wechat-draft:news', [asset], 'cover-and-first',
  )
  const revised = await service.reviseDraft(derived.draftId, derived.version, derived.sha256, 'Short brief', '# Short brief\n')
  assert.equal(revised.version, 2); assert.equal(revised.status, 'draft')
  assert.notEqual(revised.artifactBindingSha256, derived.artifactBindingSha256)
  assert.deepEqual(revised.mediaAssets, [asset])
  assert.deepEqual(revised.destinationPresentations, derived.destinationPresentations)
  assert.deepEqual(assertions, [[asset], [asset]])
  const reviewed = await service.review(revised.draftId, 'approve', revised.version, revised.sha256)
  assert.equal(reviewed.approvedArtifactBindingSha256, revised.artifactBindingSha256)
})

test('production draft revision is optimistic, preserves provenance, and clears stale review/publication state', async () => {
  const { service } = fixture()
  const request = await service.createRequest('daily', [STORE_ID])
  const generated = await service.generate(request.requestId, { agent: {} })
  const rejected = await service.review(generated.draftId, 'reject', generated.version, generated.sha256)
  const provenance = {
    draftId: rejected.draftId, requestId: rejected.requestId, generatorId: rejected.generatorId,
    generatorPromptVersion: rejected.generatorPromptVersion, generatorPromptSha256: rejected.generatorPromptSha256,
    sourceContentStoreIds: rejected.sourceContentStoreIds, createdAt: rejected.createdAt,
  }
  await service.drafts.put(rejected.draftId, {
    ...rejected, approvedAt: 'stale', approvedVersion: 1, approvedSha256: '1'.repeat(64),
    publishedAt: 'stale', publishedPublisherIds: ['stale-publisher'],
  })
  const revised = await service.reviseDraft(rejected.draftId, rejected.version, rejected.sha256, 'Edited title', '# Edited\n')
  assert.equal(revised.status, 'draft'); assert.equal(revised.version, 2)
  assert.equal(revised.sha256, createHash('sha256').update('# Edited\n').digest('hex'))
  assert.deepEqual({
    draftId: revised.draftId, requestId: revised.requestId, generatorId: revised.generatorId,
    generatorPromptVersion: revised.generatorPromptVersion, generatorPromptSha256: revised.generatorPromptSha256,
    sourceContentStoreIds: revised.sourceContentStoreIds, createdAt: revised.createdAt,
  }, provenance)
  for (const field of ['approvedAt', 'approvedVersion', 'approvedSha256', 'publishedAt', 'publishedPublisherIds']) assert.equal(Object.hasOwn(revised, field), false)
  await assert.rejects(service.reviseDraft(revised.draftId, 1, rejected.sha256, 'Stale', '# Stale'), error => error.name === 'DraftRevisionConflictError')
  assert.equal(service.getDraft(revised.draftId).title, 'Edited title')
})

test('draft deletion appends an exact irreversible tombstone while retaining Request and Draft audit rows', async () => {
  const { service } = fixture()
  const request = await service.createRequest('daily', [STORE_ID])
  const draft = await service.generate(request.requestId, { agent: {} })
  const deleted = await service.deleteDraft(draft.draftId, draft.version, draft.sha256)
  assert.equal(deleted.replay, false); assert.equal(deleted.requestId, request.requestId)
  assert.equal(service.getDraft(draft.draftId), undefined)
  assert.equal(service.listDrafts().some(item => item.draftId === draft.draftId), false)
  assert.equal(service.drafts.get(draft.draftId).markdown, draft.markdown)
  assert.equal(service.requests.get(request.requestId).draftId, draft.draftId)
  assert.equal((await service.deleteDraft(draft.draftId, draft.version, draft.sha256)).replay, true)
  await assert.rejects(service.deleteDraft(draft.draftId, draft.version + 1, draft.sha256), /different version or hash/)
  await assert.rejects(service.reviseDraft(draft.draftId, draft.version, draft.sha256, draft.title, draft.markdown), /Unknown production draft/)
  await assert.rejects(service.review(draft.draftId, 'approve', draft.version, draft.sha256), /Unknown production draft/)

  const request2 = await service.createRequest('daily', [STORE_ID])
  const draft2 = await service.generate(request2.requestId, { agent: {} })
  const approved = await service.review(draft2.draftId, 'approve', draft2.version, draft2.sha256)
  const deletedApproved = await service.deleteDraft(approved.draftId, approved.version, approved.sha256)
  assert.equal(deletedApproved.deletedFromStatus, 'approved'); assert.equal(service.getDraft(approved.draftId), undefined)

  const request3 = await service.createRequest('daily', [STORE_ID])
  const draft3 = await service.generate(request3.requestId, { agent: {} })
  const approved3 = await service.review(draft3.draftId, 'approve', draft3.version, draft3.sha256)
  const published = { ...approved3, status: 'published', publishedAt: '2026-01-01T00:00:00.000Z', publishedPublisherIds: ['wechat-draft:news'] }
  await service.drafts.put(published.draftId, published)
  const deletedPublished = await service.deleteDraft(published.draftId, published.version, published.sha256)
  assert.equal(deletedPublished.deletedFromStatus, 'published'); assert.equal(service.getDraft(published.draftId), undefined)

  const request4 = await service.createRequest('daily', [STORE_ID])
  const draft4 = await service.generate(request4.requestId, { agent: {} })
  const approved4 = await service.review(draft4.draftId, 'approve', draft4.version, draft4.sha256)
  await service.drafts.put(approved4.draftId, { ...approved4, status: 'publishing' })
  await assert.rejects(service.deleteDraft(approved4.draftId, approved4.version, approved4.sha256), /cannot be deleted in status/)
})

test('production draft revision requires exact linked request prompt provenance, including legacy absence', async () => {
  const { service } = fixture()
  const request = await service.createRequest('daily', [STORE_ID])
  const draft = await service.generate(request.requestId, { agent: {} })
  const completed = service.requests.get(request.requestId)

  await service.requests.put(request.requestId, { ...completed, generatorPromptVersion: completed.generatorPromptVersion + 1 })
  await assert.rejects(service.reviseDraft(draft.draftId, draft.version, draft.sha256, 'Mismatch', '# Mismatch'), /provenance is unavailable or inconsistent/)
  await service.requests.put(request.requestId, { ...completed, generatorPromptSha256: '0'.repeat(64) })
  await assert.rejects(service.reviseDraft(draft.draftId, draft.version, draft.sha256, 'Mismatch', '# Mismatch'), /provenance is unavailable or inconsistent/)
  await service.requests.put(request.requestId, { ...completed, generatorPromptVersion: undefined, generatorPromptSha256: undefined })
  await assert.rejects(service.reviseDraft(draft.draftId, draft.version, draft.sha256, 'Mismatch', '# Mismatch'), /provenance is unavailable or inconsistent/)

  await service.drafts.put(draft.draftId, { ...draft, generatorPromptVersion: undefined, generatorPromptSha256: undefined })
  const revised = await service.reviseDraft(draft.draftId, draft.version, draft.sha256, 'Legacy linked', '# Legacy linked')
  assert.equal(revised.title, 'Legacy linked')
  assert.equal(revised.generatorPromptVersion, undefined)
  assert.equal(revised.generatorPromptSha256, undefined)
})

test('production draft revision validates status, bounds, and controls', async () => {
  const { service } = fixture()
  const request = await service.createRequest('daily', [STORE_ID])
  const draft = await service.generate(request.requestId, { agent: {} })
  const invalid = [
    ['', '# Body'], ['x'.repeat(301), '# Body'], ['Bad\nTitle', '# Body'], ['Valid', ''],
    ['Valid', 'x'.repeat(100001)], ['Valid', '# Bad\u0001'], ['Valid', '# Bad \uFFFD text'], ['Valid', '# Bad \uD800 text'],
  ]
  for (const [title, markdown] of invalid) {
    await assert.rejects(service.reviseDraft(draft.draftId, draft.version, draft.sha256, title, markdown), error => error.name === 'DraftRevisionValidationError')
  }
  const approved = await service.review(draft.draftId, 'approve', draft.version, draft.sha256)
  await assert.rejects(service.reviseDraft(approved.draftId, approved.version, approved.sha256, 'No', '# No'), error => error.name === 'DraftRevisionConflictError')
  for (const status of ['publishing', 'published']) {
    await service.drafts.put(approved.draftId, { ...approved, status })
    await assert.rejects(service.reviseDraft(approved.draftId, approved.version, approved.sha256, 'No', '# No'), error => error.name === 'DraftRevisionConflictError')
  }
})

test('packed-media revision uses the registered generator validator and linked persisted request', async () => {
  const { service } = fixture()
  const selection = {
    selectionId: 'selection-revise', selectionSha256: 'b'.repeat(64), contentStoreIds: [STORE_ID],
    sourceContentClaims: [{ storeId: STORE_ID, contentHash: 'c'.repeat(64) }],
    packedMaterials: [{ storeId: STORE_ID, title: 'One', url: '', source: '', author: '', publishedDate: '', category: '', excerpts: [],
      media: [{ kind: 'image', url: 'https://cdn.example.test/required.png' }], materialChars: 10, estimatedTokens: 10, materialSha256: 'd'.repeat(64) }],
  }
  service.registerMaterialProvider({ id: 'ai-selection', async resolve() { return structuredClone(selection) } })
  const original = service.generators.get('daily')
  service.generators.set('daily', {
    ...original,
    async generate() { return { title: 'Packed', markdown: '<br/>![required](https://cdn.example.test/required.png)<br/>' } },
    validateDraft(request, markdown) { validatePackedMedia(markdown, request.packedMaterials, 'revision') },
  })
  const request = await service.createRequestFromAISelection('daily', selection.selectionId)
  const draft = await service.generate(request.requestId, { agent: {} })
  await assert.rejects(service.reviseDraft(draft.draftId, draft.version, draft.sha256, 'Dropped', '# No image'), /omitted 1 required media resource/)
  await assert.rejects(service.reviseDraft(draft.draftId, draft.version, draft.sha256, 'Fake', '<!--\n<br/>![fake](https://cdn.example.test/required.png)<br/>\n-->'), /omitted 1 required media resource/)
  const revised = await service.reviseDraft(draft.draftId, draft.version, draft.sha256, 'Kept', '<br/>![required](https://cdn.example.test/required.png)<br/>\n')
  assert.equal(revised.selectionId, selection.selectionId)
  assert.deepEqual(revised.sourceContentClaims, selection.sourceContentClaims)
  service.generators.set('daily', { ...original, async generate() { return { title: 'Packed', markdown: '<br/>![required](https://cdn.example.test/required.png)<br/>' } } })
  await assert.rejects(service.reviseDraft(revised.draftId, revised.version, revised.sha256, 'Unavailable', revised.markdown), /validator is unavailable/)
})

test('draft media admission requires the exact kind and URL from its linked persisted Generation Request', async () => {
  const { service } = fixture()
  const imageUrl = 'https://cdn.example.test/admitted.png?size=large'
  const selection = {
    selectionId: 'selection-media-admission', selectionSha256: 'b'.repeat(64), contentStoreIds: [STORE_ID],
    sourceContentClaims: [{ storeId: STORE_ID, contentHash: 'c'.repeat(64) }],
    packedMaterials: [{ storeId: STORE_ID, title: 'One', url: '', source: '', author: '', publishedDate: '', category: '', excerpts: [],
      media: [{ kind: 'image', url: imageUrl }], materialChars: 10, estimatedTokens: 10, materialSha256: 'd'.repeat(64) }],
  }
  service.registerMaterialProvider({ id: 'ai-selection', async resolve() { return structuredClone(selection) } })
  const original = service.generators.get('daily')
  service.generators.set('daily', { ...original, async generate() { return { title: 'Media', markdown: `![media](${imageUrl})` } } })
  const request = await service.createRequestFromAISelection('daily', selection.selectionId)
  const draft = await service.generate(request.requestId, { agent: {} })

  assert.deepEqual(service.resolveDraftMedia(draft.draftId, 'image', imageUrl), { kind: 'image', url: imageUrl })
  for (const [kind, url] of [
    ['video', imageUrl], ['image', 'https://cdn.example.test/admitted.png'],
    ['image', 'https://cdn.example.test/unknown.png'], ['image', 'https://user:secret@cdn.example.test/admitted.png'],
  ]) assert.throws(() => service.resolveDraftMedia(draft.draftId, kind, url), error => error.name === 'DraftMediaAdmissionError')
  assert.throws(() => service.resolveDraftMedia('unknown-draft', 'image', imageUrl), error => error.name === 'DraftMediaAdmissionError')

  const completed = service.requests.get(request.requestId)
  await service.requests.put(request.requestId, { ...completed, draftId: 'another-draft' })
  assert.throws(() => service.resolveDraftMedia(draft.draftId, 'image', imageUrl), /not available/)
})

test('stored-record content_html media is admitted to preview and protected during revision without AI Selection', async () => {
  const { service, records } = fixture()
  const imageUrl = 'https://cdn.example.test/direct-source.jpg'
  records.set(STORE_ID, { ...record, item: { ...record.item, metadata: {
    content_html: `<p>Body</p><img src="${imageUrl}">`,
    arbitrary: '<img src="https://evil.example.test/ignored.jpg">',
  } } })
  const original = service.generators.get('daily')
  service.generators.set('daily', {
    ...original,
    async generate() { return { title: 'Direct media', markdown: `<br/>![source](${imageUrl})<br/>` } },
    validateDraft(request, markdown) { validatePackedMedia(markdown, service.requestMediaClaims(request), 'revision') },
  })
  const request = await service.createRequest('daily', [STORE_ID])
  const draft = await service.generate(request.requestId, { agent: {} })
  assert.deepEqual(service.resolveDraftMedia(draft.draftId, 'image', imageUrl), { kind: 'image', url: imageUrl })
  assert.throws(() => service.resolveDraftMedia(draft.draftId, 'image', 'https://evil.example.test/ignored.jpg'), /not available/)
  await assert.rejects(service.reviseDraft(draft.draftId, 1, draft.sha256, 'Missing', '# Missing'), /omitted 1 required media resource/)
  const revised = await service.reviseDraft(draft.draftId, 1, draft.sha256, 'Kept', `<br/>![source](${imageUrl})<br/>\n`)
  assert.equal(revised.version, 2)
})

test('explicit manual revision may remove source media while default revisions remain fail-closed', async () => {
  const { service, records } = fixture()
  const imageUrl = 'https://cdn.example.test/manual-remove.jpg'
  records.set(STORE_ID, { ...record, item: { ...record.item, metadata: { content_html: `<img src="${imageUrl}">` } } })
  const original = service.generators.get('daily')
  service.generators.set('daily', {
    ...original,
    async generate() { return { title: 'Manual', markdown: `<br/>![source](${imageUrl})<br/>` } },
    validateDraft(request, markdown) { validatePackedMedia(markdown, service.requestMediaClaims(request), 'revision') },
  })
  const request = await service.createRequest('daily', [STORE_ID])
  const draft = await service.generate(request.requestId, { agent: {} })
  await assert.rejects(service.reviseDraft(draft.draftId, 1, draft.sha256, draft.title, '# Removed'), /omitted 1 required media resource/)
  await assert.rejects(service.reviseDraft(draft.draftId, 1, draft.sha256, draft.title, '# Removed', { allowSourceMediaRemoval: false }), /options are invalid/)
  const revised = await service.reviseDraft(draft.draftId, 1, draft.sha256, draft.title, '# Removed', { allowSourceMediaRemoval: true })
  assert.equal(revised.markdown, '# Removed'); assert.equal(revised.version, 2)
})

test('packed-media revision rejects event and unknown video attributes but accepts configured canonical video', async () => {
  const { service } = fixture()
  const videoUrl = 'https://cdn.example.test/required.mp4'
  const selection = {
    selectionId: 'selection-video-revise', selectionSha256: 'b'.repeat(64), contentStoreIds: [STORE_ID],
    sourceContentClaims: [{ storeId: STORE_ID, contentHash: 'c'.repeat(64) }],
    packedMaterials: [{ storeId: STORE_ID, title: 'One', url: '', source: '', author: '', publishedDate: '', category: '', excerpts: [],
      media: [{ kind: 'video', url: videoUrl }], materialChars: 10, estimatedTokens: 10, materialSha256: 'd'.repeat(64) }],
  }
  service.registerMaterialProvider({ id: 'ai-selection', async resolve() { return structuredClone(selection) } })
  const original = service.generators.get('daily')
  service.generators.set('daily', {
    ...original,
    async generate() { return { title: 'Packed video', markdown: `<br/><video src="${videoUrl}" controls="controls" width="100%"></video><br/>` } },
    validateDraft(request, markdown) { validatePackedMedia(markdown, request.packedMaterials, 'revision') },
  })
  const request = await service.createRequestFromAISelection('daily', selection.selectionId)
  const draft = await service.generate(request.requestId, { agent: {} })
  for (const attribute of ['onerror="alert(1)"', 'data-extra="concealed"']) {
    await assert.rejects(
      service.reviseDraft(draft.draftId, draft.version, draft.sha256, 'Rejected video', `<br/><video src="${videoUrl}" controls ${attribute}></video><br/>`),
      /omitted 1 required media resource/,
    )
  }
  const revised = await service.reviseDraft(
    draft.draftId, draft.version, draft.sha256, 'Canonical video',
    `<br/><video src="${videoUrl}" controls="controls" width="100%"></video><br/>`,
  )
  assert.equal(revised.version, draft.version + 1)
})

test('production store preserves ordered selection, requires Agent, and pins approval', async () => {
  const { service } = fixture()
  const request = await service.createRequest('daily', [STORE_ID])
  assert.deepEqual({ generatorPromptVersion: request.generatorPromptVersion, generatorPromptSha256: request.generatorPromptSha256 }, PROMPT_REF)
  await assert.rejects(service.generate(request.requestId, { signal: new AbortController().signal }), /requires a calling DSH Agent/)
  const draft = await service.generate(request.requestId, { agent: {}, signal: new AbortController().signal })
  assert.deepEqual({ generatorPromptVersion: draft.generatorPromptVersion, generatorPromptSha256: draft.generatorPromptSha256 }, PROMPT_REF)
  await assert.rejects(service.review(draft.draftId, 'approve', 2, draft.sha256), /version or hash/)
  const approved = await service.review(draft.draftId, 'approve', draft.version, draft.sha256)
  assert.equal(approved.status, 'approved')
  const approvedArtifact = { draftId: approved.draftId, draftVersion: approved.version, artifactSha256: approved.sha256, title: approved.title, markdown: approved.markdown, sourceContentStoreIds: approved.sourceContentStoreIds }
  assert.throws(() => service.assertPublicationArtifact('local-markdown:daily', approvedArtifact), /active approved draft claim/)
})

test('queued requests and retries retain exact prompt provenance while legacy requests fail closed', async () => {
  const { service } = fixture()
  let current = { generatorPromptVersion: 1, generatorPromptSha256: '1'.repeat(64) }
  const observed = []
  let attempts = 0
  service.generators.set('daily', { ...service.generators.get('daily'),
    async pinPrompt() { return { ...current } },
    async resolvePrompt(reference) { observed.push({ ...reference }); return reference },
    async generate(request) { await this.resolvePrompt(request); if (attempts++ === 0) throw new Error('retry me'); return { title: 'Daily', markdown: '# Daily' } },
  })
  const request = await service.createRequest('daily', [STORE_ID])
  current = { generatorPromptVersion: 2, generatorPromptSha256: '2'.repeat(64) }
  await assert.rejects(service.generate(request.requestId, { agent: {} }), /retry me/)
  const draft = await service.generate(request.requestId, { agent: {} })
  assert.deepEqual(observed.map(item => ({ generatorPromptVersion: item.generatorPromptVersion, generatorPromptSha256: item.generatorPromptSha256 })), [
    { generatorPromptVersion: 1, generatorPromptSha256: '1'.repeat(64) },
    { generatorPromptVersion: 1, generatorPromptSha256: '1'.repeat(64) },
  ])
  assert.equal(draft.generatorPromptVersion, 1); assert.equal(draft.generatorPromptSha256, '1'.repeat(64))

  const legacy = { ...request, requestId: 'legacy-request', generatorPromptVersion: undefined, generatorPromptSha256: undefined, status: 'pending', draftId: undefined, errorCode: undefined }
  await service.requests.put(legacy.requestId, legacy)
  await assert.rejects(service.generate(legacy.requestId, { agent: {} }), /predates prompt provenance/)
  assert.equal(service.requests.get(legacy.requestId).status, 'pending')
})

test('publisher representation preflight fails before allocating a durable attempt or changing approved Draft state', async () => {
  const fixtureValue = fixture(undefined, async () => { throw new PublisherOutcomeError('not-committed', 'draft-create', 'cannot represent') })
  const draft = await approvedDraft(fixtureValue.service)
  await assert.rejects(fixtureValue.service.publish(draft.draftId, 'wechat-draft:news', {}), /cannot represent/u)
  assert.equal(fixtureValue.calls.length, 0); assert.equal(fixtureValue.preflights.length, 1)
  assert.equal(fixtureValue.service.getDraft(draft.draftId).status, 'approved')
  assert.deepEqual(fixtureValue.service.listPublicationAttempts({ draftId: draft.draftId }), [])
})

test('production publication is exclusive and idempotent per target while allowing different targets', async () => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  let first = true
  const { service, calls } = fixture(async (id, artifact) => {
    if (first) { first = false; await blocked }
    return { status: 'created', draftId: artifact.draftId, target: id }
  })
  const draft = await approvedDraft(service)
  const active = service.publish(draft.draftId, 'local-markdown:daily', {})
  while (calls.length === 0) await Promise.resolve()
  await assert.rejects(service.publish(draft.draftId, 'github-markdown:daily', {}), /already in progress/)
  release()
  await active
  await assert.rejects(service.publish(draft.draftId, 'local-markdown:daily', {}), /already published/)
  await service.publish(draft.draftId, 'github-markdown:daily', {})
  assert.deepEqual(service.getDraft(draft.draftId).publishedPublisherIds, ['local-markdown:daily', 'github-markdown:daily'])
  assert.equal(service.getDraft(draft.draftId).status, 'published')
})

test('explicit exact repeat allocates a new monotonic attempt while normal publish remains first-destination only', async () => {
  let invocation = 0
  const { service, calls } = fixture(async (_id, artifact) => ({ status: invocation++ === 0 ? 'created' : 'unchanged',
    draftId: artifact.draftId, draftVersion: artifact.draftVersion, artifactSha256: artifact.artifactSha256 }))
  const approved = await approvedDraft(service)
  const first = await service.publish(approved.draftId, 'local-markdown:daily', { trigger: 'manual', surface: 'chat' })
  assert.equal(first.publicationAttemptNumber, 1); assert.equal(first.publicationIntent, 'initial')
  await assert.rejects(service.publish(approved.draftId, 'local-markdown:daily', { trigger: 'manual', surface: 'chat' }), /explicit exact repeat/)
  await assert.rejects(service.republishExact(approved.draftId, 'local-markdown:daily', approved.version + 1, approved.sha256,
    '11111111-1111-4111-8111-111111111111', { trigger: 'manual', surface: 'chat' }), /version or hash changed/)
  await assert.rejects(service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    '22222222-2222-4222-8222-222222222222', { trigger: 'manual', surface: 'host' }), /dedicated manual/)
  const repeat = await service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    '33333333-3333-4333-8333-333333333333', { trigger: 'manual', surface: 'chat' })
  assert.equal(repeat.status, 'unchanged'); assert.equal(repeat.publicationAttemptNumber, 2); assert.equal(repeat.publicationIntent, 'repeat')
  assert.notEqual(repeat.publicationAttemptId, first.publicationAttemptId); assert.notEqual(repeat.receiptId, first.receiptId)
  assert.equal(calls.length, 2)
  assert.deepEqual(service.getDraft(approved.draftId).publishedPublisherIds, ['local-markdown:daily'])
  assert.deepEqual(service.listPublicationAttempts({ draftId: approved.draftId }).map(item => [item.attemptNumber, item.intent, item.state]),
    [[2, 'repeat', 'completed'], [1, 'initial', 'completed']])
})

test('repeat intent replay is durable across sequential and concurrent transport calls while a new UUID creates a new attempt', async () => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  let invocation = 0
  const { service, calls } = fixture(async (_id, artifact) => {
    invocation += 1
    if (invocation === 2) await blocked
    return { status: invocation === 1 ? 'created' : 'unchanged', draftId: artifact.draftId,
      draftVersion: artifact.draftVersion, artifactSha256: artifact.artifactSha256 }
  })
  const approved = await approvedDraft(service)
  await service.publish(approved.draftId, 'local-markdown:daily', { trigger: 'manual', surface: 'chat' })
  const intentId = 'a4444444-4444-4444-8444-444444444444'
  const firstCall = service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId, { trigger: 'manual', surface: 'chat' })
  const concurrentReplay = service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId, { trigger: 'manual', surface: 'chat' })
  assert.equal(firstCall, concurrentReplay)
  while (calls.length < 2) await Promise.resolve()
  assert.equal(calls.length, 2)
  release()
  const completed = await firstCall
  const sequentialReplay = await service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId, { trigger: 'manual', surface: 'chat' })
  assert.equal(sequentialReplay.publicationAttemptId, completed.publicationAttemptId)
  assert.equal(sequentialReplay.receiptId, completed.receiptId)
  assert.equal(calls.length, 2)
  await assert.rejects(service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId.toUpperCase(), { trigger: 'manual', surface: 'chat' }), /canonical lowercase UUID/)
  const durable = service.attempts.get(completed.publicationAttemptId)
  await service.attempts.put(completed.publicationAttemptId, { ...durable, intentId: intentId.toUpperCase() })
  await service.recoverInterrupted()
  assert.equal(service.attempts.get(completed.publicationAttemptId).intentId, intentId)
  const legacyCaseReplay = await service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId, { trigger: 'manual', surface: 'chat' })
  assert.equal(legacyCaseReplay.publicationAttemptId, completed.publicationAttemptId)
  assert.equal(calls.length, 2)
  const next = await service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    '55555555-5555-4555-8555-555555555555', { trigger: 'manual', surface: 'chat' })
  assert.notEqual(next.publicationAttemptId, completed.publicationAttemptId)
  assert.equal(calls.length, 3)
  assert.deepEqual(service.listPublicationAttempts({ draftId: approved.draftId }).map(item => item.intentId),
    ['55555555-5555-4555-8555-555555555555', intentId, undefined])
})

test('active repeat coalescing validates complete request authority before sharing the manual result', async () => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  let invocation = 0
  const { service, calls } = fixture(async (_id, artifact) => {
    invocation += 1
    if (invocation === 2) await blocked
    return { status: invocation === 1 ? 'created' : 'unchanged', publisherId: 'local-markdown:daily',
      draftId: artifact.draftId, draftVersion: artifact.draftVersion, artifactSha256: artifact.artifactSha256 }
  })
  const approved = await approvedDraft(service)
  await service.publish(approved.draftId, 'local-markdown:daily', { trigger: 'manual', surface: 'chat' })
  const intentId = '66666666-6666-4666-8666-666666666666'
  const manual = service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId, { trigger: 'manual', surface: 'chat' })
  while (calls.length < 2) await Promise.resolve()
  assert.equal(service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId, { trigger: 'manual', surface: 'chat' }), manual)
  await assert.rejects(service.republishExact(approved.draftId, 'local-markdown:daily', approved.version + 1, approved.sha256,
    intentId, { trigger: 'manual', surface: 'chat' }), /different request authority/)
  await assert.rejects(service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, '0'.repeat(64),
    intentId, { trigger: 'manual', surface: 'chat' }), /different request authority/)
  await assert.rejects(service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId, { trigger: 'manual', surface: 'dashboard' }), /different request authority/)
  for (const execution of [{ trigger: 'scheduler', surface: 'host' }, { trigger: 'host', surface: 'host' }]) {
    await assert.rejects(service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
      intentId, execution), /dedicated manual/)
  }
  assert.equal(calls.length, 2)
  release()
  const result = await manual
  assert.equal(result.status, 'unchanged')
})

test('durable repeat lost-response replay preserves committed, not-committed, unknown, and repair-required semantics', async () => {
  const intentIds = {
    committed: '71111111-1111-4111-8111-111111111111',
    failed: '72222222-2222-4222-8222-222222222222',
    unknown: '73333333-3333-4333-8333-333333333333',
    repair: '74444444-4444-4444-8444-444444444444',
  }

  const committedFixture = fixture(async (_id, artifact) => ({ publisherId: 'local-markdown:daily', status: 'unchanged',
    itemCount: 1, truncated: 0, bytes: Buffer.byteLength(artifact.markdown), sha256: artifact.artifactSha256,
    publishedAt: '2026-01-01T00:00:00.000Z', contentStoreIds: [...artifact.sourceContentStoreIds], fileName: 'daily.md',
    draftId: artifact.draftId, draftVersion: artifact.draftVersion, artifactSha256: artifact.artifactSha256 }))
  const committedDraft = await approvedDraft(committedFixture.service)
  await committedFixture.service.publish(committedDraft.draftId, 'local-markdown:daily', { trigger: 'manual', surface: 'chat' })
  const committed = await committedFixture.service.republishExact(committedDraft.draftId, 'local-markdown:daily', committedDraft.version,
    committedDraft.sha256, intentIds.committed, { trigger: 'manual', surface: 'chat' })
  const committedReplay = await committedFixture.service.republishExact(committedDraft.draftId, 'local-markdown:daily', committedDraft.version,
    committedDraft.sha256, intentIds.committed, { trigger: 'manual', surface: 'chat' })
  assert.deepEqual(committedReplay, committed)
  assert.equal(committedFixture.calls.length, 2)

  let failedInvocation = 0
  const failedFixture = fixture(async (_id, artifact) => {
    failedInvocation += 1
    if (failedInvocation === 1) return { status: 'created', draftId: artifact.draftId }
    const error = new PublisherOutcomeError('not-committed', 'draft-create', 'first response may contain provider detail')
    error.errcode = -1; error.rid = 'safe-wechat-request-id'; throw error
  })
  const failedDraft = await approvedDraft(failedFixture.service)
  await failedFixture.service.publish(failedDraft.draftId, 'local-markdown:daily', { trigger: 'manual', surface: 'chat' })
  await assert.rejects(failedFixture.service.republishExact(failedDraft.draftId, 'local-markdown:daily', failedDraft.version,
    failedDraft.sha256, intentIds.failed, { trigger: 'manual', surface: 'chat' }), error => error.outcome === 'not-committed')
  await assert.rejects(failedFixture.service.republishExact(failedDraft.draftId, 'local-markdown:daily', failedDraft.version,
    failedDraft.sha256, intentIds.failed, { trigger: 'manual', surface: 'chat' }), error => error.outcome === 'not-committed'
      && error.operation === 'draft-create' && !error.message.includes('provider detail'))
  assert.equal(failedFixture.calls.length, 2)
  const failedAttempt = failedFixture.service.listPublicationAttempts({ draftId: failedDraft.draftId })[0]
  assert.deepEqual(failedAttempt.terminalFailure, { kind: 'publisher-not-committed', operation: 'draft-create', code: -1, requestId: 'safe-wechat-request-id' })

  let unknownInvocation = 0
  const unknownFixture = fixture(async (_id, artifact) => {
    unknownInvocation += 1
    if (unknownInvocation === 1) return { status: 'created', draftId: artifact.draftId }
    throw new PublisherOutcomeError('unknown', 'draft-create', 'unknown provider detail')
  })
  const unknownDraft = await approvedDraft(unknownFixture.service)
  await unknownFixture.service.publish(unknownDraft.draftId, 'local-markdown:daily', { trigger: 'manual', surface: 'chat' })
  let unknownFirst
  try { await unknownFixture.service.republishExact(unknownDraft.draftId, 'local-markdown:daily', unknownDraft.version,
    unknownDraft.sha256, intentIds.unknown, { trigger: 'manual', surface: 'chat' }) } catch (error) { unknownFirst = publicationReconciliationResult(error) }
  let unknownReplay
  try { await unknownFixture.service.republishExact(unknownDraft.draftId, 'local-markdown:daily', unknownDraft.version,
    unknownDraft.sha256, intentIds.unknown, { trigger: 'manual', surface: 'chat' }) } catch (error) { unknownReplay = publicationReconciliationResult(error) }
  assert.deepEqual(unknownReplay, unknownFirst)
  assert.equal(unknownReplay.externalOutcome, 'unknown')
  assert.equal(unknownFixture.calls.length, 2)

  let repairInvocation = 0
  const repairFixture = fixture(async (_id, artifact) => {
    repairInvocation += 1
    if (repairInvocation === 1) return { status: 'created', draftId: artifact.draftId }
    return { publisherId: 'local-markdown:daily', status: 'created', itemCount: 1, truncated: 0,
      bytes: Buffer.byteLength(artifact.markdown), sha256: artifact.artifactSha256, publishedAt: '2026-01-02T00:00:00.000Z',
      contentStoreIds: [...artifact.sourceContentStoreIds], draftId: artifact.draftId, draftVersion: artifact.draftVersion,
      artifactSha256: artifact.artifactSha256, articleType: 'news', wechatDraftMediaId: 'safe-media-id', operation: 'draft.add',
      verification: 'verified', receiptPersistence: 'failed', publicationCommitted: true, secret: 'must-not-persist' }
  })
  const repairDraft = await approvedDraft(repairFixture.service)
  await repairFixture.service.publish(repairDraft.draftId, 'local-markdown:daily', { trigger: 'manual', surface: 'chat' })
  let repairFirst
  try { await repairFixture.service.republishExact(repairDraft.draftId, 'local-markdown:daily', repairDraft.version,
    repairDraft.sha256, intentIds.repair, { trigger: 'manual', surface: 'chat' }) } catch (error) { repairFirst = publicationReconciliationResult(error) }
  const repairAttempt = repairFixture.service.listPublicationAttempts({ draftId: repairDraft.draftId })[0]
  assert.equal(repairAttempt.reconciliationReason, 'receipt-persistence-failure')
  assert.equal(JSON.stringify(repairAttempt.receiptCandidate).includes('must-not-persist'), false)
  let repairReplay
  try { await repairFixture.service.republishExact(repairDraft.draftId, 'local-markdown:daily', repairDraft.version,
    repairDraft.sha256, intentIds.repair, { trigger: 'manual', surface: 'chat' }) } catch (error) { repairReplay = publicationReconciliationResult(error) }
  assert.deepEqual(repairReplay, repairFirst)
  assert.equal(repairReplay.receiptPersistence, 'failed')
  assert.equal(repairReplay.publicationCommitted, true)
  assert.equal(repairFixture.calls.length, 2)
})

test('attempt numbering scans complete durable history and is independent of wall-clock ordering', async () => {
  const { service } = fixture()
  const approved = await approvedDraft(service)
  for (let index = 1; index <= 151; index += 1) {
    const hex = index.toString(16).padStart(12, '0')
    const attemptId = `00000000-0000-4000-8000-${hex}`
    await service.attempts.put(attemptId, { attemptId, receiptId: `10000000-0000-4000-8000-${hex}`,
      attemptNumber: index, draftId: approved.draftId, draftVersion: approved.version, artifactSha256: approved.sha256,
      publisherId: 'local-markdown:daily', intent: 'initial', trigger: 'host', surface: 'host', state: 'not-committed',
      createdAt: index % 2 ? '2030-01-01T00:00:00.000Z' : '2000-01-01T00:00:00.000Z', updatedAt: '1999-01-01T00:00:00.000Z', completedAt: '1999-01-01T00:00:00.000Z' })
  }
  const receipt = await service.publish(approved.draftId, 'local-markdown:daily')
  assert.equal(receipt.publicationAttemptNumber, 152)
  assert.equal(new Set(service.completePublicationAttempts().map(item => item.attemptNumber)).size, 152)
})

test('active publication claim is bound to exact unforgeable Artifact identity and destination', async () => {
  let service
  const fixtureValue = fixture(async (publisherId, artifact) => {
    assert.throws(() => service.assertPublicationArtifact('github-markdown:other', artifact), /active approved draft claim/)
    assert.throws(() => service.assertPublicationArtifact(publisherId, { ...artifact }), /active approved draft claim/)
    return { status: 'created', draftId: artifact.draftId }
  })
  service = fixtureValue.service
  const draft = await approvedDraft(service)
  await service.publish(draft.draftId, 'local-markdown:daily', {})
  assert.equal(service.publicationClaims.size, 0)
})

test('missing sources and skipped publications do not strand or consume approval', async () => {
  const missing = fixture()
  const missingDraft = await approvedDraft(missing.service)
  missing.records.delete(STORE_ID)
  await assert.rejects(missing.service.publish(missingDraft.draftId, 'local-markdown:daily', {}), /source content is no longer available/)
  assert.equal(missing.service.getDraft(missingDraft.draftId).status, 'approved')

  const skipped = fixture(async () => ({ status: 'skipped' }))
  const skippedDraft = await approvedDraft(skipped.service)
  await skipped.service.publish(skippedDraft.draftId, 'local-markdown:daily', {})
  assert.equal(skipped.service.getDraft(skippedDraft.draftId).status, 'approved')
  assert.deepEqual(skipped.service.getDraft(skippedDraft.draftId).publishedPublisherIds ?? [], [])
})

test('direct workflow input supports input-only and explicitly mixed Selection requests with immutable hashes', async () => {
  const { service } = fixture()
  let observed
  service.generators.set('daily', { ...service.generators.get('daily'), async generate(request, records) {
    observed = { request: structuredClone(request), recordCount: records.length }
    return { title: 'Direct', markdown: '# Direct' }
  } })
  const inputOnly = await service.createRequestFromDirectInput('daily', { format: 'markdown', content: '# 用户直接材料' })
  assert.deepEqual(inputOnly.contentStoreIds, [])
  assert.equal(inputOnly.workflowInput.format, 'markdown')
  assert.match(inputOnly.workflowInputSha256, /^[a-f0-9]{64}$/u)
  const directDraft = await service.generate(inputOnly.requestId, { agent: {}, signal: new AbortController().signal })
  assert.equal(observed.recordCount, 0)
  assert.deepEqual(observed.request.workflowInput, { format: 'markdown', content: '# 用户直接材料' })
  assert.equal(directDraft.workflowInputSha256, inputOnly.workflowInputSha256)
  assert.match(directDraft.artifactBindingSha256, /^[a-f0-9]{64}$/u)

  const selection = {
    selectionId: 'selection-mixed', selectionSha256: 'b'.repeat(64), contentStoreIds: [STORE_ID],
    sourceContentClaims: [{ storeId: STORE_ID, contentHash: 'c'.repeat(64) }],
    packedMaterials: [{ storeId: STORE_ID, title: 'One', url: '', source: 'fixture', author: '', publishedDate: '', category: 'test', excerpts: [], materialChars: 10, estimatedTokens: 10, materialSha256: 'd'.repeat(64) }],
  }
  service.registerMaterialProvider({ id: 'ai-selection', async resolve(id) { assert.equal(id, selection.selectionId); return structuredClone(selection) } })
  const mixed = await service.createRequestFromDirectInput('daily', { format: 'json', content: '{"focus":"agent"}' }, selection.selectionId)
  assert.deepEqual(mixed.contentStoreIds, [STORE_ID]); assert.equal(mixed.selectionId, selection.selectionId)
  const mixedDraft = await service.generate(mixed.requestId, { agent: {}, signal: new AbortController().signal })
  assert.equal(observed.recordCount, 1); assert.equal(observed.request.workflowInput.format, 'json')
  assert.equal(mixedDraft.workflowInputSha256, mixed.workflowInputSha256)

  const tampered = await service.createRequestFromDirectInput('daily', { format: 'text', content: 'original' })
  await service.requests.put(tampered.requestId, { ...tampered, workflowInput: { format: 'text', content: 'changed' } })
  await assert.rejects(service.generate(tampered.requestId, { agent: {}, signal: new AbortController().signal }), /workflowInput provenance/u)
})

test('trusted AI selection requests pin packed material and revalidate selection before generation and publication', async () => {
  const { service } = fixture()
  const selection = {
    selectionId: 'selection-1', selectionSha256: 'b'.repeat(64), contentStoreIds: [STORE_ID],
    sourceContentClaims: [{ storeId: STORE_ID, contentHash: 'c'.repeat(64) }],
    packedMaterials: [{
      storeId: STORE_ID, title: 'One', url: '', source: 'fixture', author: '', publishedDate: '', category: 'test',
      aiSummary: '**模型发布。** 摘要', aiScore: 85, scoreReason: '综合评分为85分。',
      excerpts: [{ field: 'description', start: 0, end: 4, text: 'Body', sha256: 'd'.repeat(64) }],
      media: [{ kind: 'image', url: 'https://cdn.example.test/model.png' }],
      materialChars: 200, estimatedTokens: 50, materialSha256: 'e'.repeat(64),
    }],
  }
  let current = structuredClone(selection)
  service.registerMaterialProvider({ id: 'ai-selection', async resolve(id) { assert.equal(id, 'selection-1'); return structuredClone(current) } })
  let observed
  service.generators.set('daily', { ...service.generators.get('daily'), id: 'daily', name: 'Daily', maxOutputChars: 10000, async generate(request) { observed = request; return { title: 'Daily', markdown: '# Daily' } } })
  const request = await service.createRequestFromAISelection('daily', 'selection-1')
  assert.equal(request.selectionSha256, selection.selectionSha256)
  assert.equal(request.packedMaterials[0].excerpts[0].text, 'Body')
  assert.equal(request.packedMaterials[0].aiScore, 85)
  assert.equal(request.packedMaterials[0].aiSummary, '**模型发布。** 摘要')
  assert.deepEqual(request.packedMaterials[0].media, [{ kind: 'image', url: 'https://cdn.example.test/model.png' }])
  const draft = await service.generate(request.requestId, { agent: {}, signal: new AbortController().signal })
  assert.equal(observed.selectionId, 'selection-1')
  assert.equal(draft.selectionSha256, selection.selectionSha256)
  const approved = await service.review(draft.draftId, 'approve', draft.version, draft.sha256)
  current = { ...current, selectionSha256: 'f'.repeat(64) }
  await assert.rejects(service.publish(approved.draftId, 'local-markdown:daily', {}), /selection claims|no longer valid/)
})

test('production selection request fails closed when persisted material changes before generation', async () => {
  const { service } = fixture()
  const base = {
    selectionId: 'selection-2', selectionSha256: 'b'.repeat(64), contentStoreIds: [STORE_ID],
    sourceContentClaims: [{ storeId: STORE_ID, contentHash: 'c'.repeat(64) }],
    packedMaterials: [{ storeId: STORE_ID, title: 'One', url: '', source: '', author: '', publishedDate: '', category: '', excerpts: [], materialChars: 10, estimatedTokens: 10, materialSha256: 'd'.repeat(64) }],
  }
  let current = structuredClone(base)
  service.registerMaterialProvider({ id: 'ai-selection', async resolve() { return structuredClone(current) } })
  const request = await service.createRequestFromAISelection('daily', 'selection-2')
  current.packedMaterials[0].title = 'changed'
  await assert.rejects(service.generate(request.requestId, { agent: {}, signal: new AbortController().signal }), /no longer matches/)
  assert.equal(service.listRequests({ limit: 1 })[0].status, 'failed')
})

test('production request rejects duplicate or unknown stored ids', async () => {
  const { service } = fixture()
  await assert.rejects(service.createRequest('daily', [STORE_ID, STORE_ID]), /duplicates/)
  await assert.rejects(service.createRequest('daily', ['b'.repeat(64)]), /Unknown stored content/)
})

test('maintenance drain is non-aborting, waits for active work, and closes generation/publication admission', async () => {
  const { service } = fixture()
  let release
  const blocker = new Promise(resolve => { release = resolve })
  service.inFlight.add(blocker); blocker.finally(() => service.inFlight.delete(blocker))
  const caller = new AbortController()
  let drained = false
  const draining = service.beginMaintenanceDrain().then(() => { drained = true })
  await Promise.resolve(); assert.equal(drained, false); assert.equal(caller.signal.aborted, false)
  await assert.rejects(service.generate('request', { agent: {}, signal: caller.signal }), /maintenance drain/u)
  await assert.rejects(service.publish('draft', 'local-markdown:daily', {}), /maintenance drain/u)
  release(); await draining
  assert.deepEqual(service.maintenanceStatus(), { draining: true, active: 0, restartAllowed: true })
  assert.equal(caller.signal.aborted, false)
})

test('production shutdown aborts and drains active generation with the caller signal preserved', async () => {
  const { service } = fixture()
  let observedSignal
  service.generators.set('daily', {
    ...service.generators.get('daily'), id: 'daily', name: 'Daily', maxOutputChars: 10000,
    generate(_request, _records, execution) {
      observedSignal = execution.signal
      return new Promise((resolve, reject) => execution.signal.addEventListener('abort', () => reject(execution.signal.reason), { once: true }))
    },
  })
  const request = await service.createRequest('daily', [STORE_ID])
  const caller = new AbortController()
  const active = service.generate(request.requestId, { agent: {}, signal: caller.signal })
  while (!observedSignal) await Promise.resolve()
  assert.notEqual(observedSignal, caller.signal)
  const stopping = service.shutdown()
  await assert.rejects(active)
  await stopping
  assert.equal(observedSignal.aborted, true)
  assert.equal(caller.signal.aborted, false)
  assert.equal(service.listRequests({ limit: 1 })[0].status, 'cancelled')
})

test('definite provider failures restore approval while unknown outcomes stay blocked for privileged reconciliation', async () => {
  const definite = fixture(async () => { throw new PublisherOutcomeError('not-committed', 'draft-create') })
  const approved = await approvedDraft(definite.service)
  await assert.rejects(definite.service.publish(approved.draftId, 'wechat-draft:news', {}), error => error.outcome === 'not-committed')
  assert.equal(definite.service.getDraft(approved.draftId).status, 'approved')

  const unknown = fixture(async () => { throw new PublisherOutcomeError('unknown', 'draft-create') })
  const uncertain = await approvedDraft(unknown.service)
  await assert.rejects(unknown.service.publish(uncertain.draftId, 'wechat-draft:news', {}), /reconciliation/i)
  assert.equal(unknown.service.getDraft(uncertain.draftId).publishingOutcome, 'unknown')
  const blocked = unknown.service.getDraft(uncertain.draftId)
  assert.equal(unknown.service.listPublicationAttempts({ draftId: uncertain.draftId })[0].reconciliationOperation, 'draft-create')
  await unknown.service.reconcilePublication(uncertain.draftId, 'wechat-draft:news', blocked.publishingAttemptId, 'not-committed')
  assert.equal(unknown.service.getDraft(uncertain.draftId).status, 'approved')
  assert.equal(unknown.service.listPublicationAttempts({ draftId: uncertain.draftId })[0].reconciliationOperation, undefined)
})

test('operator-confirmed WeChat success persists an exact unverified Receipt before completing the blocked Draft', async () => {
  const value = fixture(async () => { throw new PublisherOutcomeError('unknown', 'draft-create') })
  const draft = await approvedDraft(value.service)
  await assert.rejects(value.service.publish(draft.draftId, 'wechat-draft:news', {}), /reconciliation/i)
  const blocked = value.service.getDraft(draft.draftId)
  const completed = await value.service.confirmCommittedPublication(draft.draftId, 'wechat-draft:news', blocked.publishingAttemptId)
  assert.equal(completed.status, 'published'); assert.ok(completed.publishedPublisherIds.includes('wechat-draft:news'))
  const attempt = value.service.listPublicationAttempts({ draftId: draft.draftId })[0]
  assert.equal(attempt.state, 'completed'); assert.equal(attempt.publicationStatus, 'created')
  const receipt = value.storedReceipts.get(attempt.receiptId)
  assert.equal(receipt.operation, 'draft.add.operator-confirmed'); assert.equal(receipt.verification, 'unverified')
  assert.equal(receipt.publicationAttemptId, attempt.attemptId); assert.equal(receipt.sha256, draft.sha256)

  const retrospective = fixture(async () => { throw new PublisherOutcomeError('unknown', 'draft-create') })
  const prior = await approvedDraft(retrospective.service)
  await assert.rejects(retrospective.service.publish(prior.draftId, 'wechat-draft:news', {}), /reconciliation/i)
  const uncertain = retrospective.service.getDraft(prior.draftId)
  await retrospective.service.allowUnknownPublicationRetry(prior.draftId, 'wechat-draft:news', uncertain.publishingAttemptId)
  const releasedAttempt = retrospective.service.listPublicationAttempts({ draftId: prior.draftId })[0]
  const repaired = await retrospective.service.confirmCommittedPublication(prior.draftId, 'wechat-draft:news', releasedAttempt.attemptId)
  assert.equal(repaired.status, 'published'); assert.ok(repaired.publishedPublisherIds.includes('wechat-draft:news'))
  assert.equal(retrospective.service.listPublicationAttempts({ draftId: prior.draftId })[0].state, 'completed')
})

test('duplicate-risk policy unblocks an unknown attempt without falsifying its external outcome audit', async () => {
  const value = fixture(async () => { throw new PublisherOutcomeError('unknown', 'draft-create') })
  const draft = await approvedDraft(value.service)
  await assert.rejects(value.service.publish(draft.draftId, 'wechat-draft:news', {}), /reconciliation/i)
  const blocked = value.service.getDraft(draft.draftId)
  await value.service.allowUnknownPublicationRetry(draft.draftId, 'wechat-draft:news', blocked.publishingAttemptId)
  const attempt = value.service.listPublicationAttempts({ draftId: draft.draftId })[0]
  assert.equal(value.service.getDraft(draft.draftId).status, 'approved')
  assert.equal(attempt.state, 'not-committed')
  assert.deepEqual(attempt.terminalFailure, { kind: 'publisher-not-committed', operation: 'draft-create', externalOutcome: 'unknown' })
})

test('production shutdown aborts and drains active publication into fail-closed reconciliation state', async () => {
  let observedSignal
  const { service } = fixture((_id, _artifact, _inputs, execution) => {
    observedSignal = execution.signal
    return new Promise((resolve, reject) => execution.signal.addEventListener('abort', () => reject(execution.signal.reason), { once: true }))
  })
  const draft = await approvedDraft(service)
  const caller = new AbortController()
  const active = service.publish(draft.draftId, 'local-markdown:daily', { signal: caller.signal })
  while (!observedSignal) await Promise.resolve()
  const stopping = service.shutdown()
  await assert.rejects(active)
  await stopping
  assert.equal(observedSignal.aborted, true)
  assert.equal(caller.signal.aborted, false)
  assert.equal(service.getDraft(draft.draftId).status, 'publishing')
  assert.equal(service.getDraft(draft.draftId).publishingPhase, 'reconciliation-required')
  assert.equal(service.getDraft(draft.draftId).publishingOutcome, 'unknown')
})

function selectionFixture(id = 'selection-failure') {
  return {
    selectionId: id, selectionSha256: 'b'.repeat(64), contentStoreIds: [STORE_ID],
    sourceContentClaims: [{ storeId: STORE_ID, contentHash: 'c'.repeat(64) }],
    packedMaterials: [{ storeId: STORE_ID, title: 'One', url: '', source: '', author: '', publishedDate: '', category: '', excerpts: [], materialChars: 10, estimatedTokens: 10, materialSha256: 'd'.repeat(64) }],
  }
}

test('provider resolution and unavailable or malformed generators never strand running requests', async () => {
  const rejected = fixture()
  const selection = selectionFixture()
  let resolves = 0
  rejected.service.registerMaterialProvider({ id: 'ai-selection', async resolve() { if (resolves++ > 0) throw new Error('provider unavailable'); return structuredClone(selection) } })
  const selectionRequest = await rejected.service.createRequestFromAISelection('daily', selection.selectionId)
  await assert.rejects(rejected.service.generate(selectionRequest.requestId, { agent: {} }), /provider unavailable/)
  assert.equal(rejected.service.listRequests({ limit: 1 })[0].status, 'failed')

  const unavailable = fixture()
  const request = await unavailable.service.createRequest('daily', [STORE_ID])
  unavailable.service.generators.delete('daily')
  await assert.rejects(unavailable.service.generate(request.requestId, { agent: {} }), /generator is unavailable/)
  assert.equal(unavailable.service.listRequests({ limit: 1 })[0].status, 'failed')

  const malformed = fixture()
  const malformedRequest = await malformed.service.createRequest('daily', [STORE_ID])
  malformed.service.generators.set('daily', { ...malformed.service.generators.get('daily'), id: 'daily', name: 'Daily', maxOutputChars: 10000, async generate() { return { title: 'Missing markdown' } } })
  await assert.rejects(malformed.service.generate(malformedRequest.requestId, { agent: {} }), /Generated markdown/)
  assert.equal(malformed.service.listRequests({ limit: 1 })[0].status, 'failed')
})

test('cancellation observed after material resolution prevents generator invocation', async () => {
  const { service } = fixture()
  const selection = selectionFixture('selection-cancel')
  const controller = new AbortController(); let resolves = 0; let generated = false
  service.registerMaterialProvider({ id: 'ai-selection', async resolve() {
    if (resolves++ > 0) controller.abort(new Error('cancel after resolve'))
    return structuredClone(selection)
  } })
  const request = await service.createRequestFromAISelection('daily', selection.selectionId)
  service.generators.set('daily', { ...service.generators.get('daily'), id: 'daily', name: 'Daily', maxOutputChars: 10000, async generate() { generated = true; return { title: 'Daily', markdown: '# Daily' } } })
  await assert.rejects(service.generate(request.requestId, { agent: {}, signal: controller.signal }), /cancel after resolve/)
  assert.equal(generated, false)
  assert.equal(service.listRequests({ limit: 1 })[0].status, 'cancelled')
})

test('abort observed after either final persistence put rolls back the attempted draft and request link', async () => {
  for (const seam of ['drafts', 'requests']) {
    const { service } = fixture()
    const request = await service.createRequest('daily', [STORE_ID])
    const controller = new AbortController()
    const table = service[seam]
    const originalPut = table.put.bind(table)
    table.put = async (id, value) => {
      const result = await originalPut(id, value)
      if (seam === 'drafts' || value.status === 'completed') controller.abort(new Error(`abort after ${seam}.put`))
      return result
    }
    await assert.rejects(service.generate(request.requestId, { agent: {}, signal: controller.signal }), new RegExp(`abort after ${seam}\\.put`))
    assert.equal(service.listDrafts().length, 0)
    const persisted = service.getRequest(request.requestId)
    assert.equal(persisted.status, 'cancelled')
    assert.equal(persisted.draftId, undefined)
  }
})

test('restart recovery removes orphan and mismatched drafts before reconciling interrupted requests', async () => {
  const { service } = fixture()
  const request = await service.createRequest('daily', [STORE_ID])
  const draft = await service.generate(request.requestId, { agent: {} })
  await service.drafts.put('orphan-draft', { ...draft, draftId: 'orphan-draft', requestId: 'missing-request' })
  await service.requests.put(request.requestId, { ...service.getRequest(request.requestId), status: 'running', draftId: draft.draftId })
  await service.recoverInterrupted()
  assert.equal(service.listDrafts().length, 0)
  assert.equal(service.getRequest(request.requestId).status, 'failed')
  assert.equal(service.getRequest(request.requestId).errorCode, 'host-restarted')
  assert.equal(service.getRequest(request.requestId).draftId, undefined)
})

test('publication crash recovery restores only pre-destination claims and keeps every post-destination ambiguity fail closed', async () => {
  for (const [phase, outcome, expectedStatus] of [
    ['claimed', 'none', 'approved'],
    ['destination-started', 'committed', 'publishing'],
    ['destination-started', 'not-committed', 'publishing'],
  ]) {
    const { service } = fixture()
    const approved = await approvedDraft(service)
    service.ctx.prismPublicationReceipts.inspectArtifactPublication = () => ({ outcome })
    await service.drafts.put(approved.draftId, { ...approved, status: 'publishing',
      publishingPublisherId: 'local-markdown:daily', publishingPreviousStatus: 'approved', publishingPhase: phase })
    await service.recoverInterrupted()
    const recovered = service.getDraft(approved.draftId)
    assert.equal(recovered.status, expectedStatus)
    if (expectedStatus === 'publishing') {
      assert.equal(recovered.publishingPhase, 'reconciliation-required')
      const attempt = service.listPublicationAttempts({ draftId: approved.draftId })[0]
      assert.equal(attempt.legacyClaim, true)
      await service.reconcilePublication(approved.draftId, 'local-markdown:daily', attempt.attemptId,
        outcome === 'committed' ? 'committed' : 'not-committed')
      assert.equal(service.getDraft(approved.draftId).status, outcome === 'committed' ? 'published' : 'approved')
    } else assert.equal(recovered.publishingPhase, undefined)
  }

  for (const receiptInspection of ['throws', 'ambiguous']) {
    const { service } = fixture()
    const approved = await approvedDraft(service)
    service.ctx.prismPublicationReceipts.inspectArtifactPublication = receiptInspection === 'throws'
      ? () => { throw new Error('receipt inspection unavailable after crash') }
      : () => ({ outcome: 'ambiguous' })
    await service.drafts.put(approved.draftId, { ...approved, status: 'publishing',
      publishingPublisherId: 'wechat-draft:news', publishingPreviousStatus: 'approved', publishingPhase: 'destination-started' })
    await service.recoverInterrupted()
    const recovered = service.getDraft(approved.draftId)
    assert.equal(recovered.status, 'publishing')
    assert.equal(recovered.publishingPhase, 'reconciliation-required')
    assert.equal(recovered.publishingOutcome, 'unknown')
    const [attempt] = service.listPublicationAttempts({ draftId: approved.draftId })
    assert.equal(attempt.state, 'reconciliation-required')
    assert.equal(attempt.reconciliationReason, 'external-unknown')
  }
})

test('legacy attempt migration adopts an identical row after a crash between attempt and draft persistence', async () => {
  const { service } = fixture()
  const approved = await approvedDraft(service)
  await service.drafts.put(approved.draftId, { ...approved, status: 'publishing',
    publishingPublisherId: 'wechat-draft:news', publishingPreviousStatus: 'approved', publishingPhase: 'destination-started' })
  const originalPut = service.drafts.put.bind(service.drafts)
  let injected = false
  service.drafts.put = async (id, value) => {
    if (!injected && id === approved.draftId && value.publishingAttemptId) {
      injected = true
      throw new Error('injected crash after attempt insert')
    }
    return originalPut(id, value)
  }
  await assert.rejects(service.recoverInterrupted(), /injected crash after attempt insert/)
  assert.equal(service.listPublicationAttempts({ draftId: approved.draftId }).length, 1)
  assert.equal(service.getDraft(approved.draftId).publishingAttemptId, undefined)

  await service.recoverInterrupted()
  const migrated = service.getDraft(approved.draftId)
  const [attempt] = service.listPublicationAttempts({ draftId: approved.draftId })
  assert.equal(migrated.status, 'publishing')
  assert.equal(migrated.publishingAttemptId, attempt.attemptId)
  assert.equal(migrated.publishingOutcome, 'unknown')
  assert.equal(attempt.legacyClaim, true)
  assert.equal(attempt.state, 'reconciliation-required')
  assert.equal(attempt.reconciliationReason, 'external-unknown')
})

test('legacy attempt migration rejects a divergent deterministic row left by a partial write', async () => {
  const { service } = fixture()
  const approved = await approvedDraft(service)
  await service.drafts.put(approved.draftId, { ...approved, status: 'publishing',
    publishingPublisherId: 'wechat-draft:news', publishingPreviousStatus: 'approved', publishingPhase: 'destination-started' })
  const originalPut = service.drafts.put.bind(service.drafts)
  let injected = false
  service.drafts.put = async (id, value) => {
    if (!injected && value.publishingAttemptId) { injected = true; throw new Error('injected migration interruption') }
    return originalPut(id, value)
  }
  await assert.rejects(service.recoverInterrupted(), /injected migration interruption/)
  const [attempt] = service.listPublicationAttempts({ draftId: approved.draftId })
  await service.attempts.put(attempt.attemptId, { ...attempt, receiptId: '75555555-5555-4555-8555-555555555555' })
  await assert.rejects(service.recoverInterrupted(), /migration identity conflicts with durable history/)
  assert.equal(service.getDraft(approved.draftId).publishingAttemptId, undefined)
})

test('receipt persistence failure after destination commit leaves publication fail closed for operator reconciliation', async () => {
  const { service } = fixture(async () => ({ status: 'created', receiptPersistence: 'failed', publicationCommitted: true }))
  const approved = await approvedDraft(service)
  await assert.rejects(service.publish(approved.draftId, 'local-markdown:daily'), /receipt persistence failed/)
  const stranded = service.getDraft(approved.draftId)
  assert.equal(stranded.status, 'publishing'); assert.equal(stranded.publishingPhase, 'reconciliation-required')
  assert.equal(stranded.publishingOutcome, 'unknown')
})

test('receipt repair reason and candidate survive the exact draft-write failure seam, startup, replay, and repair', async () => {
  let invocation = 0
  const { service, calls } = fixture(async (_id, artifact) => {
    invocation += 1
    if (invocation === 1) return { status: 'created', draftId: artifact.draftId }
    return {
      publisherId: 'local-markdown:daily', status: 'created', itemCount: 1, truncated: 0,
      bytes: Buffer.byteLength(artifact.markdown), sha256: artifact.artifactSha256,
      publishedAt: '2026-08-24T00:00:00.000Z', contentStoreIds: [...artifact.sourceContentStoreIds],
      draftId: artifact.draftId, draftVersion: artifact.draftVersion, artifactSha256: artifact.artifactSha256,
      receiptPersistence: 'failed', publicationCommitted: true,
    }
  })
  const approved = await approvedDraft(service)
  await service.publish(approved.draftId, 'local-markdown:daily', { trigger: 'manual', surface: 'chat' })

  const originalPut = service.drafts.put.bind(service.drafts)
  let injected = false
  service.drafts.put = async (id, value) => {
    if (!injected && id === approved.draftId && value.publishingPhase === 'reconciliation-required') {
      injected = true
      throw new Error('injected one-shot reconciliation draft write failure')
    }
    return originalPut(id, value)
  }
  const intentId = '76666666-6666-4666-8666-666666666666'
  await assert.rejects(service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId, { trigger: 'manual', surface: 'chat' }), error => {
    const result = publicationReconciliationResult(error)
    return result?.receiptPersistence === 'failed' && result.publicationCommitted === true
  })
  assert.equal(injected, true)
  let [attempt] = service.listPublicationAttempts({ draftId: approved.draftId })
  assert.equal(attempt.reconciliationReason, 'receipt-persistence-failure')
  assert.equal(attempt.receiptCandidate.publicationCommitted, true)

  let repairedReceipt
  let inspections = 0
  service.ctx.prismPublicationReceipts.append = async (candidate, context) => {
    repairedReceipt = { ...candidate, ...context, recordedAt: '2026-08-24T00:01:00.000Z' }
    return repairedReceipt
  }
  service.ctx.prismPublicationReceipts.get = receiptId => repairedReceipt?.receiptId === receiptId ? repairedReceipt : undefined
  service.ctx.prismPublicationReceipts.inspectAttemptPublication = async () => {
    inspections += 1
    if (!repairedReceipt) throw new Error('Receipt repair has not run')
    return { outcome: 'committed', receipt: repairedReceipt }
  }

  await service.recoverInterrupted()
  assert.equal(inspections, 0, 'startup must not bypass the durable repair candidate')
  attempt = service.listPublicationAttempts({ draftId: approved.draftId })[0]
  assert.equal(attempt.reconciliationReason, 'receipt-persistence-failure')
  assert.ok(attempt.receiptCandidate)
  assert.equal(service.getDraft(approved.draftId).publishingPhase, 'reconciliation-required')
  await assert.rejects(service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId, { trigger: 'manual', surface: 'chat' }), error => publicationReconciliationResult(error)?.receiptPersistence === 'failed')
  assert.equal(calls.length, 2)
  await assert.rejects(service.reconcilePublication(approved.draftId, 'local-markdown:daily', attempt.attemptId, 'committed'),
    /must be repaired from its durable candidate/)

  const repaired = await service.repairPublicationReceipt(approved.draftId, 'local-markdown:daily', attempt.attemptId)
  assert.equal(repaired.receiptId, attempt.receiptId)
  assert.equal(inspections, 1)
  assert.equal(service.getDraft(approved.draftId).status, 'published')
  const replay = await service.republishExact(approved.draftId, 'local-markdown:daily', approved.version, approved.sha256,
    intentId, { trigger: 'manual', surface: 'chat' })
  assert.equal(replay.receiptId, attempt.receiptId)
  assert.equal(calls.length, 2)
})

test('recovery rejects wrong request/draft keys and malformed rows before deleting any durable data', async () => {
  for (const corrupt of ['request-key', 'draft-key', 'request-row', 'draft-row']) {
    const { service } = fixture()
    const request = await service.createRequest('daily', [STORE_ID])
    const draft = await service.generate(request.requestId, { agent: {} })
    let deletes = 0
    const originalDelete = service.drafts.delete.bind(service.drafts)
    service.drafts.delete = async key => { deletes += 1; return originalDelete(key) }
    if (corrupt === 'request-key') { service.requests.map.delete(request.requestId); service.requests.map.set('wrong-request-key', service.getRequest(request.requestId) ?? request) }
    if (corrupt === 'draft-key') { service.drafts.map.delete(draft.draftId); service.drafts.map.set('wrong-draft-key', draft) }
    if (corrupt === 'request-row') service.requests.map.set(request.requestId, { ...service.getRequest(request.requestId), hidden: true })
    if (corrupt === 'draft-row') service.drafts.map.set(draft.draftId, { ...draft, hidden: true })
    await assert.rejects(service.recoverInterrupted(), /malformed key or row/)
    assert.equal(deletes, 0)
  }
})

test('recovery rejects unknown nested persisted fields before any recovery write', async () => {
  for (const seam of ['claim', 'material', 'excerpt', 'media']) {
    const { service } = fixture()
    const selection = selectionFixture(`nested-${seam}`)
    selection.packedMaterials[0].excerpts = [{ field: 'description', start: 0, end: 1, text: 'x', sha256: 'e'.repeat(64) }]
    selection.packedMaterials[0].media = [{ kind: 'image', url: 'https://example.com/image.png' }]
    service.registerMaterialProvider({ id: 'ai-selection', async resolve() { return structuredClone(selection) } })
    const request = await service.createRequestFromAISelection('daily', selection.selectionId)
    const raw = structuredClone(service.getRequest(request.requestId))
    if (seam === 'claim') raw.sourceContentClaims[0].hidden = true
    if (seam === 'material') raw.packedMaterials[0].hidden = true
    if (seam === 'excerpt') raw.packedMaterials[0].excerpts[0].hidden = true
    if (seam === 'media') raw.packedMaterials[0].media[0].hidden = true
    raw.status = 'running'
    service.requests.map.set(request.requestId, raw)
    let writes = 0
    const requestPut = service.requests.put.bind(service.requests)
    const draftDelete = service.drafts.delete.bind(service.drafts)
    service.requests.put = async (...args) => { writes += 1; return requestPut(...args) }
    service.drafts.delete = async (...args) => { writes += 1; return draftDelete(...args) }
    await assert.rejects(service.recoverInterrupted(), /malformed key or row/)
    assert.equal(writes, 0)
    assert.equal(service.requests.map.get(request.requestId).status, 'running')
  }
})

test('production initialization releases its lease and closes domains on open, table, recovery, and effect failures', async () => {
  for (const seam of ['open', 'table', 'recovery', 'effect']) {
    const directory = await mkdtemp(join(tmpdir(), `prismflow-production-${seam}-`))
    const lockPath = join(directory, 'production.lock'); let closed = 0
    try {
      const requests = new Table(); const drafts = new Table()
      if (seam === 'recovery') requests.map.set('wrong-key', { requestId: 'different' })
      const domain = { table(name) { if (seam === 'table') throw new Error('table failed'); return name === 'requests' ? requests : drafts }, async close() { closed += 1 } }
      const store = new PrismProductionService(new Context(), { writerLockPath: lockPath })
      store.ctx = {
        storageDomain: { async open() { if (seam === 'open') throw new Error('open failed'); return domain } },
        prismPublicationReceipts: { inspectArtifactPublication() { return { outcome: 'none' } } },
        effect() { if (seam === 'effect') throw new Error('effect failed') },
      }
      await assert.rejects(store[Service.init]())
      assert.equal(closed, seam === 'open' ? 0 : seam === 'table' ? 1 : 2)
      await assert.rejects(readFile(lockPath), error => error.code === 'ENOENT')
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
})

test('production mutations fail closed without the deployment writer lease', async () => {
  const { service } = fixture(); service.releaseWriterLock = undefined
  await assert.rejects(service.createRequest('daily', [STORE_ID]), /writerLockPath/)
})

test('review and publication require the exact completed request-to-draft link', async () => {
  const { service } = fixture()
  const request = await service.createRequest('daily', [STORE_ID])
  const draft = await service.generate(request.requestId, { agent: {} })
  const completed = service.getRequest(request.requestId)
  await service.requests.put(request.requestId, { ...completed, draftId: 'mismatch' })
  await assert.rejects(service.review(draft.draftId, 'approve', draft.version, draft.sha256), /unavailable or inconsistent/)
  await service.requests.put(request.requestId, completed)
  const approved = await service.review(draft.draftId, 'approve', draft.version, draft.sha256)
  await service.requests.put(request.requestId, { ...completed, status: 'failed' })
  await assert.rejects(service.publish(approved.draftId, 'local-markdown:daily'), /unavailable or inconsistent/)
})
