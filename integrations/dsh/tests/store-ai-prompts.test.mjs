import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { DEFAULT_AI_PROMPT_SETTINGS, PrismAiPromptsStore, prismAiPromptsDomain } from '../lib/store-ai-prompts.js'

class Table {
  constructor() { this.map = new Map() }
  get(key) { return this.map.get(key) }
  async put(key, value) { this.map.set(key, value); return value }
}

class MemoryDomain {
  constructor() {
    this.tables = new Map()
  }
  table(name) {
    if (!this.tables.has(name)) this.tables.set(name, new Table())
    return this.tables.get(name)
  }
  async close() {}
}

test('PrismAiPromptsStore bootstraps defaults and supports CAS update and reset', async () => {
  const domain = new MemoryDomain()
  const ctx = new Context()
  ctx.storageDomain = {
    async open() {
      return domain
    },
  }

  const store = new PrismAiPromptsStore(ctx)
  await store[Symbol.for('cordis.init')]()

  const initial = store.get()
  assert.equal(initial.version, 1)
  assert.equal(initial.editorialInstruction, DEFAULT_AI_PROMPT_SETTINGS.editorialInstruction)
  assert.equal(initial.clusterInstruction, DEFAULT_AI_PROMPT_SETTINGS.clusterInstruction)
  assert.equal(initial.hotKeywordsPrompt, DEFAULT_AI_PROMPT_SETTINGS.hotKeywordsPrompt)
  assert.equal(initial.hotKeywordsConsolidationPrompt, DEFAULT_AI_PROMPT_SETTINGS.hotKeywordsConsolidationPrompt)

  // Update
  const updated = await store.update({
    editorialInstruction: 'Custom editorial prompt',
    clusterInstruction: 'Custom cluster prompt',
    hotKeywordsPrompt: 'Custom hot keywords prompt',
    hotKeywordsConsolidationPrompt: 'Custom consolidation prompt',
  }, { version: initial.version, sha256: initial.sha256 })

  assert.equal(updated.version, 2)
  assert.equal(updated.editorialInstruction, 'Custom editorial prompt')
  assert.equal(store.get().editorialInstruction, 'Custom editorial prompt')

  // Stale CAS fails
  await assert.rejects(store.update({
    editorialInstruction: 'Conflict',
    clusterInstruction: 'Conflict',
    hotKeywordsPrompt: 'Conflict',
    hotKeywordsConsolidationPrompt: 'Conflict',
  }, { version: initial.version, sha256: initial.sha256 }), error => error?.code === 'conflict')

  // Reset to defaults
  const reset = await store.resetToDefaults({ version: updated.version, sha256: updated.sha256 })
  assert.equal(reset.version, 3)
  assert.equal(reset.editorialInstruction, DEFAULT_AI_PROMPT_SETTINGS.editorialInstruction)
})
