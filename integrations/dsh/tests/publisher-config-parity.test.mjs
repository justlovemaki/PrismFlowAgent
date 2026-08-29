import assert from 'node:assert/strict'
import { relative, resolve } from 'node:path'
import test from 'node:test'
import Schema from '@deepseek-ai/schemastery'
import { Config as LocalConfig, apply as applyLocal } from '../lib/publisher-local-markdown.js'
import { Config as GitHubConfig, apply as applyGitHub } from '../lib/publisher-github-markdown.js'
import { Config as R2Config, applyWithClientFactory as applyR2 } from '../lib/publisher-r2-markdown.js'
import { Config as WeChatConfig, apply as applyWeChat } from '../lib/publisher-wechat-draft.js'
import { normalizePublisherConfig, publisherConfigRevision } from '../lib/shared/publisher-profile.js'

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'

function schemaResolve(schema, input) {
  return Schema.resolve(structuredClone(input), schema)[0]
}

function context(capture, root = process.cwd()) {
  return {
    fs: {
      async lstat(path, options) { return options?.cwd ? undefined : { type: 'directory' } },
      async resolve(path, options = {}) { return options.cwd ? resolve(options.cwd, path) : resolve(path) },
      async stat(path) { return path === resolve(root) ? { type: 'directory' } : undefined },
      contains(parent, child) { const suffix = relative(parent, child); return suffix === '' || !suffix.startsWith('..') },
    },
    credentials: { async resolve() { return { value: 'unused' } } },
    prismPublishers: {
      registerChannel(kind, revision) { capture(kind, revision); return () => {} },
      register() { return () => {} },
    },
    prismProduction: {}, prismProductionMedia: {}, logger: { info() {} },
    effect(factory) { return factory() },
  }
}

test('WeChat App Secret is a native credential reference in the Cordis schema', () => {
  const appSecret = WeChatConfig.dict.destinations.inner.dict.appSecretCredential
  assert.equal(appSecret.meta.role, 'credential-ref')
  assert.equal(appSecret.meta.required, true)
})

test('Cordis Config default resolution and all four runtime channel revisions equal the canonical Profile plan', async () => {
  const root = process.cwd()
  const cases = [
    ['local-markdown', LocalConfig, { destinations: [{ id: 'local', name: 'Local', root }] }],
    ['github-markdown', GitHubConfig, { destinations: [{ id: 'github', name: 'GitHub', repository: 'owner/repository' }] }],
    ['r2-markdown', R2Config, { destinations: [{ id: 'r2', name: 'R2', accountId: ACCOUNT_ID, bucket: 'valid-bucket' }] }],
    ['wechat-draft', WeChatConfig, { destinations: [{ id: 'wechat', name: 'WeChat', appId: 'wx123', appSecretCredential: 'WECHAT_SECRET', articleType: 'news', limits: {} }] }],
  ]
  const resolved = new Map()
  for (const [kind, schema, omittedDefaults] of cases) {
    const runtimeConfig = schemaResolve(schema, omittedDefaults)
    resolved.set(kind, runtimeConfig)
    const profileConfig = normalizePublisherConfig(kind, omittedDefaults)
    assert.deepEqual(normalizePublisherConfig(kind, runtimeConfig), profileConfig, `${kind} Cordis/Profile canonical config`)
    assert.equal(publisherConfigRevision(kind, runtimeConfig), publisherConfigRevision(kind, profileConfig), `${kind} revision`)
  }
  assert.deepEqual({
    fileNamePattern: resolved.get('local-markdown').destinations[0].fileNamePattern,
    title: resolved.get('local-markdown').destinations[0].title,
    maxItems: resolved.get('local-markdown').destinations[0].maxItems,
    maxDescriptionChars: resolved.get('local-markdown').destinations[0].maxDescriptionChars,
  }, { fileNamePattern: 'prismflow-{date}.md', title: 'PrismFlow Content', maxItems: 50, maxDescriptionChars: 1000 })
  assert.equal(resolved.get('wechat-draft').destinations[0].tokenMode, 'stable')

  const captured = new Map()
  const ctx = context((kind, revision) => captured.set(kind, revision), root)
  await applyLocal(ctx, resolved.get('local-markdown'))
  applyGitHub(ctx, resolved.get('github-markdown'))
  applyR2(ctx, resolved.get('r2-markdown'), () => { throw new Error('client must not be created during registration') })
  await applyWeChat(ctx, resolved.get('wechat-draft'))
  for (const [kind, runtimeConfig] of resolved) {
    assert.equal(captured.get(kind), publisherConfigRevision(kind, runtimeConfig), `${kind} registered channel revision`)
  }
})

test('canonical publisher limits reject values above runtime schema ceilings and rendered GitHub messages above 200 characters', () => {
  const local = { destinations: [{ id: 'local', name: 'Local', root: process.cwd(), maxItems: 101 }] }
  assert.throws(() => normalizePublisherConfig('local-markdown', local), /1 to 100/u)
  const github = { destinations: [{ id: 'github', name: 'GitHub', repository: 'owner/repository', maxDescriptionChars: 10001 }] }
  assert.throws(() => normalizePublisherConfig('github-markdown', github), /1 to 10000/u)
  const renderedTooLong = `${'x'.repeat(191)}{date}`
  assert.equal(renderedTooLong.length <= 200, true, 'fixture passes the raw schema string ceiling')
  assert.throws(() => normalizePublisherConfig('github-markdown', { destinations: [{
    id: 'github', name: 'GitHub', repository: 'owner/repository', artifactCommitMessage: renderedTooLong,
  }] }), /at most 200/u)
})
