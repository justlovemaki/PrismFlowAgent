import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { PrismPublisherRegistry } from '../lib/publisher-core.js'
import { productionArtifactBindingSha256 } from '../lib/shared/content-production.js'
import { apply, writeGitHubFile } from '../lib/publisher-github-markdown.js'

const destination = {
  apiBaseUrl: 'https://api.github.com',
  repository: { owner: 'owner', repo: 'repository' },
  branch: 'main',
}

test('publishes the exact approved artifact to the configured GitHub artifact path', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  let provider
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init })
      if (init.method === 'GET') return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ content: { sha: 'a'.repeat(40) }, commit: { sha: 'b'.repeat(40) } }), { status: 201, headers: { 'content-type': 'application/json' } })
    }
    const ctx = {
      credentials: { async resolve() { return { value: 'token', source: 'test' } } },
      prismPublishers: { register(value) { provider = value; return () => {} } },
      effect(factory) { factory() },
    }
    apply(ctx, { destinations: [{
      id: 'artifact', name: 'Artifact', repository: 'owner/repository', branch: 'main', pathPrefix: 'daily',
      fileNamePattern: '{date}.md', artifactFileNamePattern: 'approved-{date}.md', title: 'Archive', overwrite: 'if-changed',
      commitMessage: 'archive {date}', artifactCommitMessage: 'approved {date}', tokenCredential: 'GITHUB_TOKEN',
      apiBaseUrl: 'https://api.github.com', maxItems: 50, maxDescriptionChars: 1000, maxBytes: 900000,
    }] })
    assert.equal(typeof provider.publish, 'undefined')
    const markdown = '# Approved GitHub\n\nExact.\n'
    const artifactSha256 = createHash('sha256').update(markdown).digest('hex')
    const records = [{ storeId: 'a'.repeat(64) }]
    const artifact = { draftId: 'draft-gh', draftVersion: 1, artifactSha256, title: 'Approved', markdown, sourceContentStoreIds: [records[0].storeId],
      artifactBindingSha256: '', mediaAssets: [], destinationPresentations: [] }
    artifact.artifactBindingSha256 = productionArtifactBindingSha256(artifact)
    const registryCtx = new Context()
    Object.defineProperty(registryCtx, 'prismProduction', { value: { assertPublicationArtifact() {} } })
    const registry = new PrismPublisherRegistry(registryCtx)
    registry.register(provider)
    const receipt = await registry.publishArtifact(provider.id, artifact, records, {})
    assert.match(requests.at(-1).url, /\/daily\/approved-\d{4}-\d{2}-\d{2}\.md$/)
    const body = JSON.parse(requests.at(-1).init.body)
    assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), markdown)
    assert.equal(receipt.sha256, artifactSha256)
    assert.equal(receipt.draftId, 'draft-gh')
    assert.equal(receipt.artifactBindingSha256, artifact.artifactBindingSha256)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('GitHub publisher cleanup aborts and drains an active Artifact request', async () => {
  const originalFetch = globalThis.fetch
  let provider
  let observedSignal
  const cleanups = []
  try {
    globalThis.fetch = async (_url, init) => {
      observedSignal = init.signal
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }
    const ctx = {
      credentials: { async resolve() { return { value: 'token', source: 'test' } } },
      prismPublishers: { register(value) { provider = value; return () => {} } },
      effect(factory) { cleanups.push(factory()) },
    }
    apply(ctx, { destinations: [{
      id: 'artifact', name: 'Artifact', repository: 'owner/repository', branch: 'main', pathPrefix: 'daily',
      artifactFileNamePattern: 'approved-{date}.md', overwrite: 'if-changed', commitMessage: 'archive {date}', artifactCommitMessage: 'approved {date}',
      tokenCredential: 'GITHUB_TOKEN', apiBaseUrl: 'https://api.github.com', maxBytes: 900000,
    }] })
    const records = [{ storeId: 'a'.repeat(64) }]
    const markdown = '# Approved\n'
    const caller = new AbortController()
    const active = provider.publishArtifact({ draftId: 'draft-gh', draftVersion: 1, artifactSha256: createHash('sha256').update(markdown).digest('hex'), title: 'Approved', markdown, sourceContentStoreIds: [records[0].storeId] }, records, { signal: caller.signal })
    while (!observedSignal) await Promise.resolve()
    assert.notEqual(observedSignal, caller.signal)
    const stopping = cleanups[0]()
    await assert.rejects(active, /GitHub publication aborted/)
    await stopping
    assert.equal(observedSignal.aborted, true)
    assert.equal(caller.signal.aborted, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('marks successful GitHub writes with unusable revision metadata as unverified', async () => {
  const originalFetch = globalThis.fetch
  const seen = []
  try {
    globalThis.fetch = async (_url, init) => {
      seen.push(init)
      return new Response(seen.length === 1 ? 'not-json' : JSON.stringify({ content: {}, commit: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const invalidJson = await writeGitHubFile(destination, 'secret-token', 'daily/test.md', 'body', 'message', undefined)
    const missingShas = await writeGitHubFile(destination, 'secret-token', 'daily/test.md', 'body', 'message', undefined)
    assert.equal(invalidJson.ok, true)
    assert.equal(invalidJson.verification, 'unverified')
    assert.equal(missingShas.ok, true)
    assert.equal(missingShas.verification, 'unverified')
    assert.ok(!JSON.stringify({ invalidJson, missingShas }).includes('secret-token'))
    assert.equal(seen[0].redirect, 'error')
  } finally {
    globalThis.fetch = originalFetch
  }
})
