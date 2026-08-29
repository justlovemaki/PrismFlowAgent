import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import YAML from 'yaml'

export const name = 'prismflow-skill-provider'
export const inject = ['skills', 'prismToolsets']
export const Config = Schema.object({ skillRoot: Schema.string().default('') })
const SKILL_NAME = /^prismflow-[a-z0-9]+(?:-[a-z0-9]+)*$/u
const bundledRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')

function parseSkill(source, expectedName, path, sourceName) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u)
  if (!match) throw new Error(`Skill ${expectedName} is missing YAML frontmatter`)
  const data = YAML.parse(match[1])
  if (!data || typeof data !== 'object' || data.name !== expectedName || !SKILL_NAME.test(data.name)
    || typeof data.description !== 'string' || !data.description.trim() || data.description.length > 1024) throw new Error(`Skill ${expectedName} frontmatter is invalid`)
  const disabled = data['disable-model-invocation'] === true
  const userInvocable = data['user-invocable'] !== false
  return { name: data.name, description: data.description.trim(), invocation: { modelInvocable: !disabled, userInvocable },
    source: sourceName, provider: 'prismflow-filesystem', resourceBase: { kind: 'directory', path: dirname(path) }, path,
    ...(data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? { metadata: data.metadata } : {}), content: match[2].trim() }
}
async function discoverRoot(root, sourceName) {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
  const result = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !SKILL_NAME.test(entry.name)) continue
    const path = join(root, entry.name, 'SKILL.md')
    try {
      const info = await stat(path); if (!info.isFile() || info.size > 128 * 1024) continue
      const skill = parseSkill(await readFile(path, 'utf8'), entry.name, path, sourceName)
      result.push({ ...skill, rank: sourceName === 'prismflow-managed' ? 250 : 600, locator: { path, sourceName } })
    } catch { /* malformed skills fail closed from the catalog */ }
  }
  return result
}

export function apply(ctx, config = {}) {
  const toolsets = ctx.get('prismToolsets'); const skills = ctx.get('skills')
  if (!toolsets || !skills || !config.skillRoot) throw new Error('PrismFlow filesystem Skill provider dependencies are unavailable')
  let invalidate = () => {}
  const dispose = skills.registerProvider(control => {
    invalidate = control.invalidate
    return ({
    name: 'prismflow-filesystem',
    async list() {
      const [managed, bundled] = await Promise.all([discoverRoot(config.skillRoot, 'prismflow-managed'), discoverRoot(bundledRoot, 'prismflow-bundled')])
      const selected = new Set(toolsets.getToolset().enabledSkills)
      const winners = new Map()
      for (const candidate of [...managed, ...bundled]) if (selected.has(candidate.name) && !winners.has(candidate.name)) winners.set(candidate.name, candidate)
      return [...winners.values()].map(({ content: _content, ...candidate }) => candidate)
    },
    async get(candidate) {
      if (control.signal.aborted || !candidate?.locator?.path) return undefined
      try { return parseSkill(await readFile(candidate.locator.path, 'utf8'), candidate.name, candidate.locator.path, candidate.locator.sourceName) } catch { control.invalidate(); return undefined }
    },
  }) })
  const unsubscribe = toolsets.subscribe(() => invalidate())
  ctx.effect(() => () => { unsubscribe(); dispose() }, 'prismflow-skills.dispose')
}
