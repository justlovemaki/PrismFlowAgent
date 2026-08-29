import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { test } from 'node:test'
import { documentFingerprint, normalizePublisherConfig, publisherConfigRevision, publisherDocumentRevision, publisherRowRevision } from '../lib/shared/publisher-profile.js'
import { validatePublisherChangePlan } from '../lib/publisher-profile-cli.js'

const clientPath = new URL('../lib/client.js', import.meta.url)
const packagePath = new URL('../package.json', import.meta.url)
const installerPath = new URL('../scripts/install-dashboard.mjs', import.meta.url)

function childrenOf(node) {
  const children = node?.props?.children
  if (children === undefined) return []
  return Array.isArray(children) ? children : [children]
}

function descendants(node, output = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return output
  if (Array.isArray(node)) { for (const child of node) descendants(child, output); return output }
  output.push(node)
  if (typeof node === 'object') for (const child of childrenOf(node)) descendants(child, output)
  return output
}

function descendantsOutsideDetails(node, output = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return output
  if (Array.isArray(node)) { for (const child of node) descendantsOutsideDetails(child, output); return output }
  output.push(node)
  if (typeof node === 'object' && node.type !== 'details') {
    for (const child of childrenOf(node)) descendantsOutsideDetails(child, output)
  }
  return output
}

async function loadClient(overrides = new Map(), environment = {}) {
  const source = await readFile(clientPath, 'utf8')
  let registration
  const registrations = new Map()
  let appendedStyle
  let hook = 0
  let refHook = 0
  let generatedId = 0
  let animationFrameId = 0
  const stateSlots = []
  const refSlots = []
  const effects = []
  const animationFrames = new Map()
  const fetchCalls = []
  const pendingFetches = []
  const pendingFetchRejects = []
  const eventListeners = new Map()
  const confirmCalls = []
  const promptCalls = []
  const clipboardWrites = []
  const downloads = []
  const objectUrlBlobs = new Map()
  class SandboxURL extends URL {}
  SandboxURL.createObjectURL = blob => { const href = `blob:test-${objectUrlBlobs.size + 1}`; objectUrlBlobs.set(href, blob); return href }
  SandboxURL.revokeObjectURL = () => {}
  let activeElement = environment.activeElement ?? null
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: { ...(props ?? {}), children } } },
    useState(initial) {
      const index = hook++
      if (!(index in stateSlots)) stateSlots[index] = overrides.has(index) ? overrides.get(index) : initial
      return [stateSlots[index], next => { stateSlots[index] = typeof next === 'function' ? next(stateSlots[index]) : next }]
    },
    useRef(initial) {
      const index = refHook++
      if (!(index in refSlots)) refSlots[index] = { current: initial }
      return refSlots[index]
    },
    useId() { generatedId += 1; return `:test-${generatedId}:` },
    useEffect(effect, deps) { effects.push({ effect, deps }) },
    useCallback(callback) { return callback },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
  }
  const sandbox = {
    window: {
      __ModuleLoader__: { load(value) { registration = value } },
      crypto: { subtle: webcrypto.subtle, randomUUID() { return environment.randomUUID ?? '77777777-7777-4777-8777-777777777777' } },
      confirm(message) { confirmCalls.push(message); return environment.confirmResult ?? true },
      prompt(message, initialValue) { promptCalls.push({ message, initialValue }); return environment.promptResult ?? null },
      navigator: { clipboard: { async writeText(value) { clipboardWrites.push(value) } } },
      addEventListener(name, listener) { eventListeners.set(name, listener) },
      removeEventListener(name, listener) { if (eventListeners.get(name) === listener) eventListeners.delete(name) },
      requestAnimationFrame(callback) { animationFrameId += 1; animationFrames.set(animationFrameId, callback); return animationFrameId },
      cancelAnimationFrame(id) { animationFrames.delete(id) },
    },
    document: {
      querySelector() { return null },
      createElement(tag) { return tag === 'a' ? { click() { downloads.push({ href: this.href, download: this.download, blob: objectUrlBlobs.get(this.href) }) } } : { dataset: {}, textContent: '' } },
      getElementById(id) { return environment.elementsById?.get(id) ?? null },
      get activeElement() { return activeElement },
      head: { appendChild(value) { appendedStyle = value } },
    },
    AbortController, URL: SandboxURL, Blob, TextEncoder, console,
    fetch(url, options) {
      fetchCalls.push({ url, ...options })
      return new Promise((resolve, reject) => { pendingFetches.push(resolve); pendingFetchRejects.push(reject) })
    },
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.equal(registration.id, '@prismflow/dsh-dashboard')
  const exports = registration.factory(id => {
    if (id === 'react') return React
    throw new Error(`unexpected client dependency: ${id}`)
  })
  exports.apply({
    slots: {
      inject(name, callback) { assert.ok(['sidebar.footer.action', 'shell.overlay'].includes(name)); return callback() },
      register(options, component) { registrations.set(options.name, { options, component }); return () => {} },
    },
  })
  function renderOverlay(opener) {
    const action = registrations.get('sidebar.footer.action')
    const overlay = registrations.get('shell.overlay')
    const actionTree = action.component({ wide: true, ...action.options.inject() })
    actionTree.props.onClick({ currentTarget: opener })
    hook = 0
    refHook = 0
    return overlay.component(overlay.options.inject())
  }
  function renderDashboard() {
    const overlayTree = renderOverlay()
    const dashboard = descendants(overlayTree).find(node => typeof node?.type === 'function' && node.type.name === 'Dashboard')
    assert.ok(dashboard)
    hook = 0
    refHook = 0
    return dashboard.type(dashboard.props)
  }
  const controller = registrations.get('shell.overlay').options.inject().controller
  return {
    source, exports, registrations, controller, renderDashboard, renderOverlay, appendedStyle, fetchCalls, pendingFetches, pendingFetchRejects, effects,
    eventListeners, confirmCalls, promptCalls, clipboardWrites, downloads, stateSlots,
    runAnimationFrames() { const queued = [...animationFrames.values()]; animationFrames.clear(); for (const callback of queued) callback() },
    setActiveElement(value) { activeElement = value },
  }
}

const status = {
  pluginVersion: '0.19.23',
  services: { sources: true, sourceSettings: true, contentStore: true, publishers: true, receipts: true, production: true, generatorWorkflows: true, toolsets: true, imageGenerationSettings: true, rssOutputs: false },
  counts: { sources: 2, sourceSettings: 1, publishers: 1, generators: 1, generatorWorkflows: 1, rssOutputs: 0 },
}

test('dashboard installer derives its client package version from the publish package', async () => {
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
  const installer = await readFile(installerPath, 'utf8')
  assert.equal(packageJson.version, '0.19.23')
  assert.equal(packageJson.dependencies['prism-flow-agent'], undefined, 'packed DSH package must not depend on its repository parent')
  assert.match(installer, /const packageVersion = JSON\.parse\(readFileSync\(join\(packageRoot, 'package\.json'\), 'utf8'\)\)\.version/)
  assert.match(installer, /version: packageVersion/)
  assert.doesNotMatch(installer, /version: '0\.[45]\.0'/)
})

test('dashboard client is a seven-tab controlled admin, local Profile planning, and trusted publication plane', async () => {
  const client = await loadClient(new Map([[3, status]]))
  assert.equal(client.exports.inject[0], 'slots')
  assert.equal(client.registrations.get('sidebar.footer.action').options.id, 'prismflow')
  assert.equal(client.registrations.get('shell.overlay').options.id, 'prismflow-dashboard')
  assert.doesNotMatch(client.source, /settings\.section/)
  for (const label of ['总览', '数据源配置', '工具集', '图片生成接口', '工作流生成器', '草稿审核与发布', '发布与存储', '发布审计']) assert.match(client.source, new RegExp(label))
  for (const removed of ['采集中心', '内容库', '原始快照发布', '选择素材', '创建生成任务', '兼容提示词', '生成提示词管理']) assert.equal(client.source.includes(removed), false, removed)
  for (const endpoint of ["api('/sources'", "api('/fetch'", "api('/sync'", "api('/content/query'", "api('/content/status'", "api('/publish'", "api('/production/generators'", "api('/generator-prompts'"]) assert.equal(client.source.includes(endpoint), false, endpoint)
  assert.doesNotMatch(client.source, /pf-prompt|promptAdmin|promptEditor|savePrompt|rollbackPrompt/u)
  assert.doesNotMatch(client.source, /credentialRef|apiUrl|baseUrl|webSearchTool|cookieEnv/)
  assert.doesNotMatch(client.source, /dangerouslySetInnerHTML/)
  assert.match(client.source, /activeController\.current\?\.abort\(\)/)
  assert.match(client.source, /发布目标可能已写入，但持久化审计回执失败/)
  for (const provenance of ['草稿版本', 'Artifact SHA-256', 'artifactSha256', 'draftVersion', 'draftId']) assert.ok(client.source.includes(provenance))
  assert.equal(client.appendedStyle.dataset.pluginCss, '@prismflow/dsh-dashboard/dashboard')
  assert.match(client.appendedStyle.textContent, /\.pf-shell\{[^}]*overflow:hidden[^}]*display:flex[^}]*flex-direction:column/u)
  assert.match(client.appendedStyle.textContent, /\.pf-shell-top\{[^}]*flex:none/u)
  assert.match(client.appendedStyle.textContent, /\.pf-shell-content\{[^}]*flex:1[^}]*overflow:auto/u)

  const dashboard = client.renderDashboard()
  const [fixedTop, scrollingContent] = childrenOf(dashboard)
  assert.equal(fixedTop.props.className, 'pf-shell-top')
  assert.equal(scrollingContent.props.className, 'pf-shell-content')
  assert.ok(descendants(fixedTop).some(node => node?.props?.className === 'pf-tabs'))
  assert.ok(descendants(fixedTop).includes('@prismflow/dsh · 0.19.23'))
  assert.equal(descendants(scrollingContent).some(node => node?.props?.className === 'pf-tabs'), false)
  const values = descendants(dashboard)
  const tabs = values.filter(node => node?.type === 'button' && node?.props?.className?.split?.(' ').includes('pf-tab')).map(node => childrenOf(node)[0])
  assert.deepEqual(tabs, ['总览', '工具集', '数据源配置', '发布与存储', '工作流生成器', '草稿审核与发布', '发布审计'])
  assert.match(client.source, /PrismFlowPublisherProfileDocument\/v2/)
  assert.match(client.source, /保存配置并准备重启/)
  assert.match(client.source, /api\('\/publisher-profile\/apply'/)
  assert.ok(values.includes('从可信内容到可审计发布'))
  assert.ok(values.includes('实际工作链路')); assert.ok(values.includes('服务健康')); assert.ok(values.includes('关键安全边界'))
  assert.ok(values.includes('Dashboard 或 Chat 只能将精确批准的 Artifact 发布到 Profile 预配置的 Local、GitHub、R2 或微信目标。'))
  assert.equal(values.includes('并且只能在 Dashboard 发布。'), false)
})

test('toolset page exposes write-only image endpoint, model, size, encoding, and API Key controls', async () => {
  const imageSettings = { id: 'current', version: 3, sha256: '7'.repeat(64), imageApiUrl: 'https://images.example/v1/images/generations', imageApiProtocol: 'images-generations', imageModel: 'image-pro', imageSize: '1024x1024', avifQuality: '70', avifEffort: '5', updatedAt: '2026-01-01T00:00:00.000Z' }
  const toolset = { mode: 'complete', version: 3, sha256: '8'.repeat(64), enabledTools: ['prismflow_image_generation', 'prismflow_sources'], enabledSkills: ['prismflow-system', 'prismflow-personal'] }
  const skills = [
    { skillId: 'prismflow-personal', description: 'Personal Skill', enabled: true, origin: 'personal-custom' },
    { skillId: 'prismflow-system', description: 'System Skill', enabled: true, origin: 'system-default' },
  ]
  const tools = [
    { name: 'prismflow_image_generation', origin: 'personal-custom', core: false },
    { name: 'prismflow_sources', origin: 'system-default', core: true },
  ]
  const client = await loadClient(new Map([[0, 'toolsets'], [3, status], [37, toolset], [38, tools], [39, skills], [44, imageSettings], [45, { configured: true, writable: true, allowDashboardWrite: true, source: 'file' }], [46, '']]))
  const values = descendants(client.renderDashboard())
  for (const label of ['图片生成接口', '调用接口 URL', '调用协议', '调用模型', '图片尺寸', 'AVIF 质量', 'AVIF effort', '图片生成 API Key']) assert.ok(values.includes(label) || values.some(node => node?.props?.label === label), label)
  assert.equal(values.includes('OPENAI_IMAGE_API_KEY'), false)
  const password = values.find(node => typeof node?.type === 'function' && node.type.name === 'Field' && node.props.type === 'password')
  assert.ok(password); assert.equal(password.props.value, '')
  assert.match(client.source, /image-generation\/credential\/set/u)
  assert.match(client.source, /当前图片生成接口使用明文 HTTP/u)
  assert.match(client.source, /接受不含凭证、查询参数和片段的 HTTP 或 HTTPS 地址/u)
  assert.match(client.source, /expected: \{ version: current\.version, sha256: current\.sha256 \}/u)
  for (const className of ['pf-toolset-header', 'pf-toolset-stack', 'pf-toolset-section', 'pf-image-settings-grid', 'pf-image-credential-row', 'pf-tool-option']) assert.ok(values.some(node => node?.props?.className?.split?.(' ').includes(className)), className)
  assert.match(client.source, /className: 'pf-skill-card'/u)
  assert.match(client.source, /toolOrigins/u)
  const toolsetHeader = values.find(node => node?.props?.className === 'pf-toolset-header')
  const skillSection = values.find(node => node?.props?.className?.split?.(' ').includes('pf-skill-section'))
  assert.ok(toolsetHeader); assert.ok(skillSection)
  assert.equal(descendants(toolsetHeader).includes('上传 Skill ZIP'), false)
  assert.equal(descendants(toolsetHeader).includes('手动新增 Skill'), false)
  assert.ok(descendants(skillSection).includes('上传 Skill ZIP'))
  assert.ok(descendants(skillSection).includes('手动新增 Skill'))
  assert.ok(descendants(skillSection).includes('系统默认'))
  assert.ok(descendants(skillSection).includes('个人定制'))
  const renderedSkillCards = descendants(skillSection).filter(node => node?.props?.className === 'pf-skill-card')
  assert.equal(descendants(renderedSkillCards[0]).includes('prismflow-system'), true)
  assert.equal(descendants(renderedSkillCards[1]).includes('prismflow-personal'), true)
  const toolsetMode = values.find(node => typeof node?.type === 'function' && node.type.name === 'Field' && node.props.label === '工具集配置')
  assert.ok(toolsetMode)
  assert.equal(toolsetMode.props.options.map(option => option.label).join('|'), '系统默认工具|全部工具（含个人定制）|自定义选择')
  const renderedToolCards = values.filter(node => node?.props?.className === 'pf-tool-option')
  assert.equal(descendants(renderedToolCards[0]).includes('prismflow_sources'), true)
  assert.equal(descendants(renderedToolCards[0]).includes('系统默认'), true)
  assert.equal(descendants(renderedToolCards[1]).includes('prismflow_image_generation'), true)
  assert.equal(descendants(renderedToolCards[1]).includes('个人定制'), true)
  toolsetMode.props.onChange('core')
  const coreToolCards = descendants(client.renderDashboard()).filter(node => node?.props?.className === 'pf-tool-option')
  const systemCoreInput = descendants(coreToolCards[0]).find(node => node?.type === 'input')
  const personalCoreInput = descendants(coreToolCards[1]).find(node => node?.type === 'input')
  assert.equal(systemCoreInput.props.checked, true)
  assert.equal(personalCoreInput.props.checked, false)
  assert.equal(personalCoreInput.props.disabled, true)
  const coreSkillCards = descendants(client.renderDashboard()).filter(node => node?.props?.className === 'pf-skill-card')
  const systemSkillInput = descendants(coreSkillCards[0]).find(node => node?.type === 'input')
  const personalSkillInput = descendants(coreSkillCards[1]).find(node => node?.type === 'input')
  assert.equal(systemSkillInput.props.checked, true)
  assert.equal(personalSkillInput.props.checked, false)
  assert.match(client.appendedStyle.textContent, /\.pf-tool-option\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto/u)
  assert.match(client.appendedStyle.textContent, /\.pf-origin-badge\{white-space:nowrap/u)
  assert.match(client.appendedStyle.textContent, /\.pf-image-settings-grid\{display:grid;grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/u)
  assert.match(client.appendedStyle.textContent, /\.pf-image-credential-row\{display:grid;grid-template-columns:minmax\(260px,1fr\) auto/u)
})

test('dashboard client renders original Adapter + Items source configuration without execution controls', async () => {
  const editor = { type: 'follow', id: '', name: '', category: 'paper', enabled: true, limit: '50', selectorType: 'list', listId: '', feedId: '', fetchDays: '3', fetchPages: '1', view: '0', pageDelayMs: '1500', detailDelayMs: '400', credentialSlotId: '' }
  const client = await loadClient(new Map([
    [0, 'source-settings'], [3, status],
    [7, [{ settingsId: 'rss:news', type: 'rss', id: 'news', name: 'News', category: 'rss', enabled: true, limit: 20, url: 'https://example.com/feed.xml', updatedAt: '2026-01-01T00:00:00.000Z' }]],
    [8, [{ id: 'follow', name: 'Follow Login', usage: 'follow-cookie', configured: false, writable: true, allowDashboardWrite: true }]],
    [9, [{ type: 'github-trending', enabled: true }, { type: 'follow', enabled: false }, { type: 'ai-search', enabled: true }, { type: 'rss', enabled: true }]], [10, editor],
  ]))
  const values = descendants(client.renderDashboard())
  assert.ok(values.includes('数据源配置'))
  assert.ok(values.includes('按 PrismFlow 原有 Adapter + Items 模型配置：Adapter 表示来源类型，下面每一项都是可独立启停的 Item。本页不执行抓取或处理，所有数据操作仍由 DSH Chat Agent 调用。'))
  assert.ok(values.some(node => typeof node?.type === 'function' && node.type.name === 'Field' && node.props.label === '凭证槽位（可选）'))
  for (const label of ['GitHub Trending', 'Follow API (Folo)', 'AI 搜索', 'RSS 订阅']) assert.ok(values.includes(label) || client.source.includes(label))
  for (const constraint of ['https://github.com/trending', 'https://api.folo.is/entries', '当前 DSH Chat Agent → spawn → web_search', '网络由 DSH Host / 部署环境统一控制']) assert.ok(client.source.includes(constraint))
  for (const field of ['抓取上限', '选择器类型', 'RSS 地址 (rssUrl)', '时间范围 (since)', '口语语言']) assert.ok(client.source.includes(field))
  assert.ok(values.includes('新增 Follow API (Folo) Item'))
  assert.ok(values.includes('启用 Adapter'))
  assert.ok(values.includes('Item 已启用 / Adapter 停用') || client.source.includes('Item 已启用 / Adapter 停用'))
  assert.equal(values.includes('仅抓取'), false)
  assert.equal(values.includes('抓取并保存'), false)
  assert.doesNotMatch(client.source, /useProxy|proxyUrl|executorId|credentialRef/)
  assert.match(client.source, /function optionalInteger\(value\) \{ return value === '' \? undefined : Number\(value\) \}/)
  assert.match(client.source, /editingSourceRevision\.current = source\.updatedAt/)
  assert.match(client.source, /expectedUpdatedAt: editingSourceRevision\.current/)
  assert.doesNotMatch(client.source, /sourceSettings\.find\(source => source\.settingsId === editingSourceId\)/)

  const invalidEditor = { ...editor, id: 'papers', name: 'Papers', limit: '', listId: '123' }
  const invalidClient = await loadClient(new Map([[0, 'source-settings'], [3, status], [7, []], [8, []], [9, []], [10, invalidEditor]]))
  const saveButton = descendants(invalidClient.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('新增 Item'))
  assert.equal(saveButton.props.disabled, true)
})

test('form helpers associate unique labels and forward arbitrary standard aria attributes', async () => {
  const client = await loadClient(new Map([[0, 'source-settings'], [3, status]]))
  const componentNodes = descendants(client.renderDashboard())
  const renderedFields = componentNodes.filter(node => typeof node?.type === 'function' && ['Field', 'TextArea'].includes(node.type.name))
    .map(node => node.type(node.props))
  const ids = renderedFields.map(field => descendants(field).find(node => ['input', 'select', 'textarea'].includes(node?.type))?.props.id)
  assert.ok(ids.length > 5)
  assert.equal(new Set(ids).size, ids.length)
  for (const field of renderedFields) {
    const nodes = descendants(field)
    const label = nodes.find(node => node?.type === 'label')
    const control = nodes.find(node => ['input', 'select', 'textarea'].includes(node?.type))
    assert.equal(label.props.htmlFor, control.props.id)
  }

  const buttonComponent = descendants(client.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button')
  const button = buttonComponent.type({ ...buttonComponent.props, 'aria-describedby': 'description-id', 'aria-pressed': true })
  assert.equal(button.props['aria-describedby'], 'description-id')
  assert.equal(button.props['aria-pressed'], true)
})

test('workflow master-detail canvas renders one active editor, inline save footer, separate lifecycle management, and collapsed history', async () => {
  const baseline = { kind: 'workflow-v1', generatorId: 'daily', generatorName: 'Daily', description: '', enabled: true,
    steps: [{ id: 'one', name: 'One', persona: 'Writer', processPrompt: 'Write.' }, { id: 'two', name: 'Two', persona: 'Reviewer', processPrompt: 'Review.' }], version: 2, sha256: 'a'.repeat(64),
    expected: { kind: 'workflow-v1', version: 2, sha256: 'a'.repeat(64) }, deploymentPolicy: { id: 'builder' } }
  const history = [{ ...baseline, version: 1, action: 'create', sha256: 'b'.repeat(64) }]
  const requests = [{ requestId: 'request-1', generatorId: 'daily', status: 'cancelled', attempt: 1 }]
  const focusCounts = new Map()
  const elementsById = new Map([['pf-workflow-step-tab-two', { focus() { focusCounts.set('two', (focusCounts.get('two') ?? 0) + 1) } }]])
  const client = await loadClient(new Map([[0, 'workflows'], [3, status], [15, [baseline]], [16, structuredClone(baseline)], [17, baseline], [18, history], [20, requests]]), { elementsById })
  let values = descendants(client.renderDashboard())
  let tabs = values.filter(node => node?.type === 'button' && node.props.role === 'tab' && node.props.id?.startsWith('pf-workflow-step-tab-'))
  assert.equal(tabs.length, 2)
  assert.deepEqual(tabs.map(node => node.props['aria-selected']), [true, false])
  assert.deepEqual(tabs.map(node => node.props.tabIndex), [0, -1])
  assert.ok(tabs.every(node => node.props['aria-controls'] === 'pf-workflow-active-step-panel'))
  assert.equal(values.find(node => node?.props?.id === 'pf-workflow-active-step-panel').props['aria-labelledby'], 'pf-workflow-step-tab-one')
  assert.equal(values.filter(node => typeof node?.type === 'function' && node.type.name === 'TextArea').length, 2, 'only active Persona and Process Prompt render')
  assert.equal(values.filter(node => typeof node?.type === 'function' && node.type.name === 'TextArea' && String(node.props.label).includes('Persona')).length, 1)
  assert.ok(values.includes('任务说明：已自定义'))
  assert.ok(values.some(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('编辑当前工作流')))
  assert.equal(values.find(node => typeof node?.type === 'function' && node.type.name === 'Field' && node.props.label === '生成器名称').props.id, 'pf-workflow-generator-name')

  const firstPersona = values.find(node => typeof node?.type === 'function' && node.type.name === 'TextArea' && String(node.props.label).includes('Persona'))
  firstPersona.props.onChange('Unsaved writer')
  let prevented = false
  tabs[0].props.onKeyDown({ key: 'ArrowDown', preventDefault() { prevented = true } })
  assert.equal(prevented, true); assert.equal(focusCounts.get('two'), 1); assert.equal(client.stateSlots[21], 'two')
  values = descendants(client.renderDashboard())
  assert.equal(values.find(node => typeof node?.type === 'function' && node.type.name === 'TextArea' && String(node.props.label).includes('Persona')).props.value, 'Reviewer')
  tabs = values.filter(node => node?.type === 'button' && node.props.role === 'tab')
  tabs[0].props.onClick()
  values = descendants(client.renderDashboard())
  assert.equal(values.find(node => typeof node?.type === 'function' && node.type.name === 'TextArea' && String(node.props.label).includes('Persona')).props.value, 'Unsaved writer', 'step selection must preserve inactive unsaved text')

  const toolbarControls = values.filter(node => typeof node?.type === 'function' && node.type.name === 'Button'
    && ['上移', '下移', '复制', '移除'].some(label => childrenOf(node).includes(label)))
  assert.equal(toolbarControls.length, 4, 'mutation controls render once for the selected step')
  assert.equal(new Set(toolbarControls.map(node => node.props['aria-label'])).size, 4)
  const historyToggle = values.find(node => node?.type === 'button' && node.props.className === 'pf-btn pf-workflow-history-toggle')
  assert.equal(historyToggle.props['aria-expanded'], false)
  assert.equal(values.includes('修订 1 · create'), false)
  const canvasIndex = values.findIndex(node => node?.props?.className === 'pf-workflow-canvas')
  const footerIndex = values.findIndex(node => node?.type === 'footer' && node.props.className === 'pf-workflow-actions')
  assert.ok(canvasIndex >= 0 && footerIndex > canvasIndex, 'the save footer follows the complete master-detail canvas in document flow')
  const saveFooter = values[footerIndex]
  assert.ok(descendants(saveFooter).includes('保存工作流修改'))
  assert.ok(descendants(saveFooter).includes('放弃修改'))
  assert.equal(descendants(saveFooter).includes('归档生成器'), false, 'archive is not presented beside save')
  const management = values.find(node => node?.props?.className === 'pf-workflow-management')
  assert.ok(management)
  assert.ok(descendants(management).includes('生成器状态'))
  assert.ok(descendants(management).includes('归档生成器'))
  assert.ok(values.some(node => node?.props?.className?.includes?.('pf-workflow-state-badge') && childrenOf(node).includes('未保存 · 1 项修改')))
  assert.match(client.appendedStyle.textContent, /--pf-workflow-rail-width:clamp\(260px,25vw,320px\)/u)
  const workflowActionsRules = [...client.appendedStyle.textContent.matchAll(/\.pf-workflow-actions[^{]*\{([^}]*)\}/gu)].map(match => match[1])
  assert.ok(workflowActionsRules.length > 1)
  assert.doesNotMatch(workflowActionsRules.join(';'), /position\s*:\s*(?:sticky|fixed)|bottom\s*:|z-index\s*:|box-shadow\s*:|background\s*:/u)
  assert.doesNotMatch(client.appendedStyle.textContent.match(/\.pf-workflow-page\{([^}]*)\}/u)?.[1] ?? '', /padding-bottom\s*:/u)
  assert.match(client.appendedStyle.textContent, /@media\(max-width:820px\)/u)
  assert.match(client.appendedStyle.textContent, /\.pf-workflow-topbar\{grid-template-columns:1fr\}/u)
  assert.doesNotMatch(client.source, /dangerouslySetInnerHTML|\.innerHTML\s*=/)

  historyToggle.props.onClick()
  values = descendants(client.renderDashboard())
  assert.ok(values.some(value => typeof value === 'string' && value.includes('修订 1 · create')))
  values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('预览')).props.onClick()
  values = descendants(client.renderDashboard())
  assert.equal(values.filter(node => typeof node?.type === 'function' && node.type.name === 'TextArea').length, 2, 'historical preview reuses one-active-step canvas')
  assert.ok(values.find(node => node?.props?.id === 'pf-workflow-active-step-panel'))
  const previewFooter = values.find(node => node?.type === 'footer' && node.props.className?.includes?.('pf-workflow-actions-preview'))
  assert.deepEqual(descendants(previewFooter).filter(node => typeof node?.type === 'function' && node.type.name === 'Button').map(node => childrenOf(node)[0]), ['关闭历史预览', '基于此版本编辑'])
  assert.equal(values.some(node => node?.props?.className === 'pf-workflow-management'), false)
  descendants(previewFooter).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('基于此版本编辑')).props.onClick()
  assert.equal(client.stateSlots[19], null)
  assert.equal(JSON.stringify(client.stateSlots[16].steps), JSON.stringify(history[0].steps))
  assert.ok(client.stateSlots[23].includes('载入编辑器'))
})

test('legacy projected generators are clearly marked and migrate through the existing exact CAS save', async () => {
  const legacy = { kind: 'legacy-v1', generatorId: 'daily', generatorName: 'Daily legacy', description: 'Legacy', enabled: true,
    steps: [{ id: 'legacy-stage-1', name: 'Stage 1', persona: 'Writer', processPrompt: 'Fixed wrapper' }],
    expected: { kind: 'legacy-v1', version: 7, sha256: 'a'.repeat(64) }, deploymentPolicy: { id: 'legacy-runtime' } }
  const client = await loadClient(new Map([[0, 'workflows'], [3, status], [15, [legacy]], [16, structuredClone(legacy)], [17, legacy], [18, []], [20, []]]))
  const values = descendants(client.renderDashboard())
  assert.ok(values.includes('旧版生成器 · 尚未迁移'))
  const migrate = values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('迁移为工作流'))
  assert.ok(migrate)
  assert.equal(migrate.props.disabled, false, 'an unchanged projection can be adopted')
  migrate.props.onClick()
  assert.equal(client.fetchCalls.length, 1)
  assert.equal(client.fetchCalls[0].url, '/api/prismflow/generator-workflows')
  assert.equal(client.fetchCalls[0].method, 'PUT')
  assert.deepEqual(JSON.parse(client.fetchCalls[0].body), {
    generatorId: legacy.generatorId, generatorName: legacy.generatorName, description: legacy.description, steps: legacy.steps,
    expected: legacy.expected,
  })
  assert.match(client.source, /if \(value\) await loadWorkflows\(value\.record\.generatorId\)/u, 'successful adoption reloads normal workflow state')
})

test('new workflow footer offers save only because there is no baseline to restore', async () => {
  const workflow = { kind: 'new', generatorId: 'new-daily', generatorName: 'New daily', description: '', enabled: true,
    steps: [{ id: 'step-1', name: 'Write', persona: 'Writer', processPrompt: '' }] }
  const client = await loadClient(new Map([[0, 'workflows'], [3, status], [15, []], [16, workflow], [17, null], [18, []], [20, []]]))
  const values = descendants(client.renderDashboard())
  const footer = values.find(node => node?.type === 'footer' && node.props.className === 'pf-workflow-actions')
  assert.deepEqual(descendants(footer).filter(node => typeof node?.type === 'function' && node.type.name === 'Button').map(node => childrenOf(node)[0]), ['创建工作流'])
  assert.equal(values.some(node => node?.props?.className === 'pf-workflow-management'), false)
})

test('workflow Ctrl/Cmd+S uses the guarded existing CAS save only for an active valid changed or adoptable editor', async () => {
  const baseline = { kind: 'workflow-v1', generatorId: 'daily', generatorName: 'Daily', description: '', enabled: true,
    steps: [{ id: 'one', name: 'One', persona: 'Writer', processPrompt: 'Write.' }], version: 2, sha256: 'a'.repeat(64),
    expected: { kind: 'workflow-v1', version: 2, sha256: 'a'.repeat(64) }, deploymentPolicy: { id: 'builder' } }
  const dirty = { ...baseline, steps: [{ ...baseline.steps[0], persona: 'Edited writer' }] }
  const client = await loadClient(new Map([[0, 'workflows'], [3, status], [15, [baseline]], [16, dirty], [17, baseline], [18, []], [20, []]]))
  client.renderDashboard()
  const shortcutEffect = client.effects.find(item => String(item.effect).includes('saveWorkflowShortcut'))
  assert.equal(typeof shortcutEffect?.effect, 'function')
  shortcutEffect.effect()
  let prevented = false
  client.eventListeners.get('keydown')({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false, preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(client.fetchCalls.length, 1)
  assert.equal(client.fetchCalls[0].url, '/api/prismflow/generator-workflows')
  assert.equal(client.fetchCalls[0].method, 'PUT')
  assert.deepEqual(JSON.parse(client.fetchCalls[0].body), {
    generatorId: dirty.generatorId, generatorName: dirty.generatorName, description: dirty.description, steps: dirty.steps, expected: baseline.expected,
  })

  const legacy = { ...baseline, kind: 'legacy-v1', expected: { kind: 'legacy-v1', version: 7, sha256: 'b'.repeat(64) } }
  const adoptable = await loadClient(new Map([[0, 'workflows'], [3, status], [16, structuredClone(legacy)], [17, legacy]]))
  adoptable.renderDashboard()
  adoptable.effects.find(item => String(item.effect).includes('saveWorkflowShortcut')).effect()
  let adoptionPrevented = false
  adoptable.eventListeners.get('keydown')({ key: 'S', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, repeat: false, preventDefault() { adoptionPrevented = true } })
  assert.equal(adoptionPrevented, true, 'an unchanged legacy projection remains keyboard-adoptable')
  assert.equal(adoptable.fetchCalls[0].url, '/api/prismflow/generator-workflows')
  assert.deepEqual(JSON.parse(adoptable.fetchCalls[0].body).expected, legacy.expected)

  const guardedCases = [
    ['clean', new Map([[0, 'workflows'], [3, status], [16, baseline], [17, baseline]]), true],
    ['invalid', new Map([[0, 'workflows'], [3, status], [16, { ...dirty, steps: [{ ...dirty.steps[0], persona: '' }] }], [17, baseline]]), true],
    ['busy', new Map([[0, 'workflows'], [1, 'workflows:save'], [3, status], [16, dirty], [17, baseline]]), true],
    ['history preview', new Map([[0, 'workflows'], [3, status], [16, dirty], [17, baseline], [19, { ...baseline, version: 1 }]]), true],
    ['inactive tab', new Map([[0, 'overview'], [3, status], [16, dirty], [17, baseline]]), false],
  ]
  for (const [name, overrides, installsListener] of guardedCases) {
    const guarded = await loadClient(overrides)
    guarded.renderDashboard()
    const effect = guarded.effects.find(item => String(item.effect).includes('saveWorkflowShortcut'))
    const cleanup = effect.effect()
    assert.equal(guarded.eventListeners.has('keydown'), installsListener, name)
    if (!installsListener) { assert.equal(cleanup, undefined); continue }
    let browserSavePrevented = false
    guarded.eventListeners.get('keydown')({ key: 's', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, repeat: false, preventDefault() { browserSavePrevented = true } })
    assert.equal(browserSavePrevented, false, name)
    assert.equal(guarded.fetchCalls.length, 0, name)
    cleanup()
  }
})

test('workflow archive and re-enable remain confirmation-gated exact state actions outside the save footer', async () => {
  const baseline = { kind: 'workflow-v1', generatorId: 'daily', generatorName: 'Daily', description: '', enabled: true,
    steps: [{ id: 'one', name: 'One', persona: 'Writer', processPrompt: '' }], version: 2, sha256: 'a'.repeat(64),
    expected: { kind: 'workflow-v1', version: 2, sha256: 'a'.repeat(64) }, deploymentPolicy: { id: 'builder' } }
  for (const enabled of [true, false]) {
    const workflow = { ...baseline, enabled }
    const client = await loadClient(new Map([[0, 'workflows'], [3, status], [15, [workflow]], [16, workflow], [17, workflow], [18, []], [20, []]]))
    const values = descendants(client.renderDashboard())
    const label = enabled ? '归档生成器' : '重新启用'
    const management = values.find(node => node?.props?.className === 'pf-workflow-management')
    const action = descendants(management).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes(label))
    action.props.onClick()
    assert.equal(client.confirmCalls.length, 1)
    assert.match(client.confirmCalls[0], new RegExp(`${enabled ? '归档' : '启用'}生成器 Daily`))
    assert.equal(client.fetchCalls.length, 1)
    assert.equal(client.fetchCalls[0].url, `/api/prismflow/generator-workflows/${enabled ? 'disable' : 'enable'}`)
    assert.deepEqual(JSON.parse(client.fetchCalls[0].body), { generatorId: workflow.generatorId, expected: workflow.expected })
  }
})

test('workflow deletion is offered only for a clean archived native current row and uses a controlled typed-id dialog', async () => {
  const archived = { kind: 'workflow-v1', generatorId: 'daily', generatorName: 'Daily', description: '', enabled: false, lifecycle: 'archived',
    steps: [{ id: 'one', name: 'One', persona: 'Writer', processPrompt: 'Write.' }], version: 3, sha256: 'a'.repeat(64),
    expected: { kind: 'workflow-v1', version: 3, sha256: 'a'.repeat(64) }, deploymentPolicy: { id: 'builder' } }
  const clean = await loadClient(new Map([[0, 'workflows'], [3, status], [15, [archived]], [16, structuredClone(archived)], [17, archived]]))
  let values = descendants(clean.renderDashboard())
  assert.ok(values.some(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('删除生成器')))

  const dirty = await loadClient(new Map([[0, 'workflows'], [3, status], [15, [archived]], [16, { ...structuredClone(archived), generatorName: 'Unsaved' }], [17, archived]]))
  values = descendants(dirty.renderDashboard())
  assert.equal(values.some(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('删除生成器')), false)

  const dialog = { record: archived, typedId: archived.generatorId, preview: { canDelete: true, blockers: { pending: 0, running: 0 } }, error: '', submitting: false, dirty: false }
  const confirmed = await loadClient(new Map([[0, 'workflows'], [3, status], [15, [archived]], [16, structuredClone(archived)], [17, archived], [30, dialog]]))
  values = descendants(confirmed.renderDashboard())
  assert.ok(values.some(node => node?.props?.role === 'dialog' && node.props['aria-modal'] === true))
  for (const copy of ['此 ID 永远不能复用。', 'Builder 与 Chat 的正常发现会隐藏此生成器。', '旧的可重试请求仍可使用其固定快照与原始运行时重试。']) assert.ok(values.includes(copy))
  const permanent = values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('永久删除生成器'))
  assert.equal(permanent.props.disabled, false)
  assert.doesNotMatch(confirmed.source, /confirm\([^)]*删除生成器/u)
})

test('disabled workflow store does not expose or resurrect a legacy prompt editor', async () => {
  const disabledStatus = { ...status, services: { ...status.services, generatorWorkflows: false }, counts: { ...status.counts, generatorWorkflows: 0 } }
  const client = await loadClient(new Map([[0, 'workflows'], [3, disabledStatus]]))
  const values = descendants(client.renderDashboard())
  assert.ok(values.includes('工作流生成器未启用。旧版提示词历史仅作为后端只读数据保留，不提供 Dashboard 编辑入口。请由部署者启用 prismflow-store-generator-workflows 与 Builder Profile 后再迁移。'))
  assert.equal(client.source.includes('/generator-prompts'), false)
})

test('workflow mutations preserve exact-empty fallback content and keep a predictable selected stable step', async () => {
  const baseline = { kind: 'workflow-v1', generatorId: 'daily', generatorName: 'Daily', description: '', enabled: true,
    steps: [{ id: 'one', name: 'One', persona: 'Writer', processPrompt: '' }, { id: 'two', name: 'Two', persona: 'Reviewer', processPrompt: '' }],
    version: 2, sha256: 'a'.repeat(64), expected: { kind: 'workflow-v1', version: 2, sha256: 'a'.repeat(64) }, deploymentPolicy: { id: 'builder' } }
  const editor = { ...baseline, generatorName: 'Daily edited', steps: baseline.steps.map(step => ({ ...step })) }
  const client = await loadClient(new Map([[0, 'workflows'], [3, status], [15, [baseline]], [16, editor], [17, baseline], [18, []], [20, []]]))
  let values = descendants(client.renderDashboard())
  const save = values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('保存工作流修改'))
  assert.equal(save.props.disabled, false)
  assert.equal(values.filter(node => typeof node?.type === 'function' && node.type.name === 'TextArea'
    && String(node.props.label).includes('Process Prompt（可选）')).length, 1)
  assert.equal(values.find(node => typeof node?.type === 'function' && node.type.name === 'TextArea' && String(node.props.label).includes('Process Prompt')).props.help, '精确留空时，固定回退会遵循 Persona 并将原始证据处理为结构化输出。')

  values.filter(node => node?.type === 'button' && node.props.role === 'tab')[1].props.onClick()
  values = descendants(client.renderDashboard())
  assert.equal(values.find(node => typeof node?.type === 'function' && node.type.name === 'TextArea' && String(node.props.label).includes('Process Prompt')).props.help, '精确留空时，固定回退会遵循 Persona，并依据原始证据处理上一步草稿。')
  assert.equal(client.stateSlots[21], 'two')
  values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('复制')).props.onClick()
  const copied = client.stateSlots[16].steps[2]
  assert.equal(copied.processPrompt, '')
  assert.equal(copied.persona, 'Reviewer')
  assert.equal(client.stateSlots[21], copied.id, 'duplicate selects its stable-id copy')

  values = descendants(client.renderDashboard())
  values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('上移')).props.onClick()
  assert.equal(client.stateSlots[21], copied.id)
  assert.equal(client.stateSlots[16].steps[1].id, copied.id, 'reorder keeps the same selected stable step')
  values = descendants(client.renderDashboard())
  values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('移除')).props.onClick()
  assert.equal(client.stateSlots[16].steps.length, 2)
  assert.equal(client.stateSlots[21], 'two', 'remove selects the next step occupying the removed index')
  assert.equal(client.stateSlots[16].steps[0].persona, 'Writer')
  assert.equal(client.stateSlots[16].steps[1].processPrompt, '')

  values = descendants(client.renderDashboard())
  const processEditor = values.find(node => typeof node?.type === 'function' && node.type.name === 'TextArea' && String(node.props.label).includes('Process Prompt'))
  const rendered = descendants(processEditor.type(processEditor.props))
  const textarea = rendered.find(node => node?.type === 'textarea')
  assert.equal(textarea.props['aria-invalid'], false)
  assert.ok(textarea.props['aria-describedby'].includes('pf-workflow-process-prompt-help'))
  assert.ok(textarea.props['aria-describedby'].includes('pf-workflow-process-prompt-counter'))

  values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('添加步骤')).props.onClick()
  const added = client.stateSlots[16].steps.at(-1)
  assert.equal(client.stateSlots[21], added.id, 'add selects the new stable step')
  assert.equal(added.processPrompt, '')
  assert.equal(client.stateSlots[16].steps[0].persona, 'Writer', 'add must preserve existing step content')
})

test('dirty workflow edits guard refresh, archive, tab switch, close, and browser unload while request controls stay absent', async () => {
  const baseline = { kind: 'workflow-v1', generatorId: 'daily', generatorName: 'Daily', description: '', enabled: true,
    steps: [{ id: 'one', name: 'One', persona: 'Writer', processPrompt: 'Write.' }], version: 2, sha256: 'a'.repeat(64),
    expected: { kind: 'workflow-v1', version: 2, sha256: 'a'.repeat(64) }, deploymentPolicy: { id: 'builder' } }
  const editor = { ...baseline, steps: [{ ...baseline.steps[0], persona: 'Unsaved workflow persona' }] }
  const client = await loadClient(new Map([[0, 'workflows'], [3, status], [15, [baseline]], [16, editor], [17, baseline], [18, []], [20, [
    { requestId: 'pending-request', generatorId: 'daily', status: 'pending', attempt: 1 },
    { requestId: 'cancelled-request', generatorId: 'daily', status: 'cancelled', attempt: 1 },
  ]]]), { confirmResult: false })
  const values = descendants(client.renderDashboard())
  assert.equal(values.includes('生成请求状态与取消'), false)
  assert.equal(values.some(node => typeof node?.type === 'function' && node.type.name === 'Button' && ['取消', '重试'].some(label => childrenOf(node).includes(label))), false)
  for (const label of ['刷新', '归档生成器', '总览']) {
    const button = values.find(node => (node?.type === 'button' || typeof node?.type === 'function') && childrenOf(node).includes(label))
    assert.ok(button, label)
    button.props.onClick()
    assert.deepEqual(client.stateSlots[16], editor)
    assert.equal(client.fetchCalls.length, 0)
  }
  client.effects.find(item => String(item.effect).includes('setCloseGuard')).effect()
  descendants(client.renderOverlay()).find(node => node?.type === 'button' && node.props.className === 'pf-close').props.onClick()
  assert.equal(client.controller.getSnapshot(), true)
  const unloadEffect = client.effects.find(item => String(item.effect).includes('beforeunload'))
  const removeUnload = unloadEffect.effect()
  const event = { returnValue: undefined, preventDefault() { this.prevented = true } }
  client.eventListeners.get('beforeunload')(event)
  assert.equal(event.prevented, true); assert.equal(event.returnValue, '')
  removeUnload()
})

test('dashboard modal focuses inside, traps focus, guards Escape, and restores its opener after close', async () => {
  const opener = { focusCount: 0, focus() { this.focusCount += 1 } }
  const client = await loadClient()
  const overlay = client.renderOverlay(opener)
  const values = descendants(overlay)
  const dialogNode = values.find(node => node?.props?.role === 'dialog')
  const panelNode = values.find(node => node?.type === 'div' && node.props.className === 'pf-panel')
  const closeNode = values.find(node => node?.type === 'button' && node.props.className === 'pf-close')
  const first = { focusCount: 0, focus() { this.focusCount += 1 } }
  const last = { focusCount: 0, focus() { this.focusCount += 1 } }
  const closeElement = { focusCount: 0, focus() { this.focusCount += 1 } }
  const panelElement = {
    querySelectorAll() { return [first, last] },
    contains(element) { return element === first || element === last || element === closeElement },
  }
  panelNode.props.ref.current = panelElement
  closeNode.props.ref.current = closeElement
  const focusEffect = client.effects.find(item => String(item.effect).includes('initialFocusRef'))
  const restoreFocus = focusEffect.effect()
  assert.equal(closeElement.focusCount, 1, 'the close button is the stable initial focus target')

  client.setActiveElement(last)
  let prevented = false
  dialogNode.props.onKeyDown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(first.focusCount, 1)
  client.setActiveElement(first)
  prevented = false
  dialogNode.props.onKeyDown({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(last.focusCount, 1)

  dialogNode.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
  assert.equal(client.controller.getSnapshot(), false)
  restoreFocus()
  assert.equal(opener.focusCount, 1)
  assert.equal(values.find(node => node?.props?.role === 'dialog').props['aria-labelledby'], 'pf-dashboard-dialog-title')
})

test('workflow step mutations schedule post-commit focus by stable target id and announce each change', async () => {
  const steps = [
    { id: 'step-1', name: '研究', persona: '研究素材', processPrompt: '' },
    { id: 'step-2', name: '撰写', persona: '撰写草稿', processPrompt: '' },
  ]
  const workflow = { kind: 'workflow-v1', generatorId: 'daily', generatorName: '每日简报', description: '', enabled: true, steps }
  const focusOrder = []
  const elementsById = new Map()
  for (const id of ['step-1', 'step-2', 'step-2-copy-3', 'step-3']) {
    const targetId = `pf-workflow-step-tab-${id}`
    elementsById.set(targetId, { focus() { focusOrder.push(targetId) } })
  }
  const client = await loadClient(new Map([
    [0, 'workflows'], [3, status], [15, [workflow]], [16, workflow], [17, workflow], [21, 'step-2'],
  ]), { elementsById })

  function button(values, label) {
    return values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes(label))
  }
  function commitScheduledFocus(expectedId, expectedAnnouncement) {
    const focusCountBeforeCommit = focusOrder.length
    client.renderDashboard()
    const focusEffect = [...client.effects].reverse().find(item => String(item.effect).includes('pendingWorkflowStepFocus'))
    assert.equal(typeof focusEffect?.effect, 'function')
    focusEffect.effect()
    assert.equal(focusOrder.length, focusCountBeforeCommit, 'focus waits for the post-commit animation frame')
    client.runAnimationFrames()
    assert.equal(focusOrder.at(-1), expectedId)
    const liveRegion = descendants(client.renderDashboard()).find(node => node?.props?.className?.includes?.('pf-workflow-step-announcement'))
    assert.equal(liveRegion.props.role, 'status')
    assert.equal(liveRegion.props['aria-live'], 'polite')
    assert.equal(liveRegion.props['aria-atomic'], 'true')
    assert.equal(childrenOf(liveRegion)[0], expectedAnnouncement)
  }

  let values = descendants(client.renderDashboard())
  button(values, '复制').props.onClick()
  values = descendants(client.renderDashboard())
  assert.deepEqual(values.filter(node => node?.props?.role === 'tab').map(node => node.props.id), [
    'pf-workflow-step-tab-step-1', 'pf-workflow-step-tab-step-2', 'pf-workflow-step-tab-step-2-copy-3',
  ])
  commitScheduledFocus('pf-workflow-step-tab-step-2-copy-3', '已复制为步骤 3：撰写 副本')

  values = descendants(client.renderDashboard())
  button(values, '移除').props.onClick()
  values = descendants(client.renderDashboard())
  assert.equal(values.some(node => node?.props?.id === 'pf-workflow-step-tab-step-2-copy-3'), false, 'removed tab is gone before focus is restored')
  commitScheduledFocus('pf-workflow-step-tab-step-2', '已移除步骤 3；当前步骤 2：撰写')

  values = descendants(client.renderDashboard())
  button(values, '上移').props.onClick()
  commitScheduledFocus('pf-workflow-step-tab-step-2', '步骤已上移至 1：撰写')

  values = descendants(client.renderDashboard())
  button(values, '添加步骤').props.onClick()
  assert.equal(client.stateSlots[21], 'step-3')
  assert.equal(client.stateSlots[16].steps.at(-1).id, 'step-3')
  commitScheduledFocus('pf-workflow-step-tab-step-3', '已添加步骤 3：步骤 3')
  assert.deepEqual(focusOrder, [
    'pf-workflow-step-tab-step-2-copy-3', 'pf-workflow-step-tab-step-2',
    'pf-workflow-step-tab-step-2', 'pf-workflow-step-tab-step-3',
  ])
})

test('workflow step tabs retain a tokenized offset focus ring, including selected tabs and forced colors', async () => {
  const client = await loadClient()
  assert.match(client.appendedStyle.textContent, /\.pf-step-tab:focus-visible,\.pf-step-tab-on:focus-visible\{border-color:var\(--dsw-alias-brand-primary\);outline:3px solid var\(--dsw-alias-label-primary\);outline-offset:3px\}/u)
  assert.match(client.appendedStyle.textContent, /@media\(forced-colors:active\)\{\.pf-step-tab:focus-visible,\.pf-step-tab-on:focus-visible\{border-color:Highlight;outline-color:Highlight\}\}/u)
  assert.doesNotMatch(client.appendedStyle.textContent, /\.pf-step-tab[^}]*outline:none/u)
})

test('dashboard review shows exact markdown and only version/hash review plus configured-destination publication', async () => {
  const markdown = `# Full draft\n${'x'.repeat(210_000)}`
  const draft = { draftId: 'draft-1', requestId: 'request-1', generatorId: 'brief', generatorPromptVersion: 7, generatorPromptSha256: 'b'.repeat(64), title: 'Full draft', markdown, sha256: 'a'.repeat(64), version: 2, status: 'draft', publishedPublisherIds: [] }
  const client = await loadClient(new Map([
    [0, 'review'], [3, status], [4, [{ id: 'local-markdown:daily', name: 'Daily', description: '' }]], [5, [draft]],
  ]))
  const collapsedValues = descendants(client.renderDashboard())
  const expand = collapsedValues.find(node => node?.type === 'button' && childrenOf(node).includes('展开'))
  assert.ok(expand)
  assert.equal(expand.props['aria-expanded'], false)
  assert.equal(collapsedValues.includes('安全渲染预览（Markdown）'), false)
  assert.equal(collapsedValues.some(node => node?.type === 'input' && node?.props?.maxLength === 300), false)
  assert.equal(collapsedValues.some(node => node?.type === 'textarea' && node?.props?.maxLength === 100000), false)
  assert.ok(collapsedValues.includes(`draft-1 · 修订 2 · SHA-256 ${'a'.repeat(12)}…`))

  expand.props.onClick()
  const values = descendants(client.renderDashboard())
  const collapse = values.find(node => node?.type === 'button' && childrenOf(node).includes('收起'))
  assert.ok(collapse)
  assert.equal(collapse.props['aria-expanded'], true)
  assert.ok(values.includes('批准显示的版本与哈希'))
  assert.ok(values.includes('拒绝显示的版本与哈希'))
  assert.ok(values.includes('安全渲染预览（Markdown）')); assert.ok(values.includes('保存新版本')); assert.ok(values.includes('删除草稿'))
  for (const emphasis of ['待审核', '当前阶段：', '需要确认内容并作出审批决定', '内容编辑', '审核决定']) assert.ok(values.includes(emphasis))
  assert.match(client.appendedStyle.textContent, /\.pf-draft-card\.pf-draft-status-draft\{border-left-color:/u)
  assert.match(client.appendedStyle.textContent, /\.pf-review-summary\{display:grid/u)
  assert.equal(values.includes('源文预览'), false); assert.equal(values.includes('渲染预览'), false)
  assert.equal(values.some(node => node?.type === 'pre'), false)
  assert.doesNotMatch(client.source, /draftPreviewModes|setDraftPreviewModes|pf-preview-raw/)
  const titleEditor = values.find(node => node?.type === 'input' && node?.props?.maxLength === 300)
  const markdownEditor = values.find(node => node?.type === 'textarea' && node?.props?.maxLength === 100000)
  assert.equal(titleEditor.props.value, draft.title); assert.equal(markdownEditor.props.value, markdown)
  assert.match(client.source, /expectedVersion: draft\.version, expectedSha256: draft\.sha256/)
  assert.match(client.source, /production\/draft\?draftId=/)
  assert.ok(client.source.includes('你的修改仍保留在编辑器中'))
  assert.ok(values.includes(`Prompt 修订 7 · ${'b'.repeat(64)}`))
  assert.equal(values.some(value => typeof value === 'string' && value.includes('创建生成任务')), false)

  const approvedClient = await loadClient(new Map([
    [0, 'review'], [3, status], [4, [{ id: 'local-markdown:daily', name: 'Daily', description: '' }]], [5, [{ ...draft, status: 'approved' }]], [14, { [draft.draftId]: true }],
  ]))
  const approvedValues = descendants(approvedClient.renderDashboard())
  assert.ok(approvedValues.includes('首次发布到本地 Markdown')); assert.ok(approvedValues.includes('本地 Markdown')); assert.ok(approvedValues.includes('Daily'))
  assert.ok(approvedValues.includes('未发布')); assert.ok(approvedValues.includes('可用发布目标')); assert.equal(approvedValues.includes('删除草稿'), false)
  assert.match(approvedClient.appendedStyle.textContent, /\.pf-publish-grid\{display:grid/u)
})

test('dashboard review displays locally persisted RSS XML and content-encoded HTML for its bound Draft', async () => {
  const draft = { draftId: 'draft-rss', requestId: 'request-rss', generatorId: 'brief', title: 'RSS Draft', markdown: '# RSS', sha256: 'a'.repeat(64), version: 2, status: 'approved', publishedPublisherIds: [] }
  const output = { outputId: '9'.repeat(64), draftId: draft.draftId, draftVersion: 2, artifactSha256: draft.sha256, title: draft.title,
    xmlSha256: '8'.repeat(64), itemUrl: 'https://example.com/docs/draft-rss/', generatedAt: '2026-01-01T00:00:00.000Z' }
  const detail = { ...output, markdown: '# RSS', htmlContent: '<h1>RSS</h1>', xml: '<?xml version="1.0"?><rss><channel/></rss>' }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, []], [5, [draft]], [14, { [draft.draftId]: true }], [42, [output]], [43, { [output.outputId]: detail }]]))
  const values = descendants(client.renderDashboard())
  assert.ok(values.includes('本地 RSS 生成内容')); assert.ok(values.includes('收起内容'))
  const readonly = values.filter(node => node?.type === 'textarea' && node.props.readOnly === true)
  assert.deepEqual(readonly.map(node => node.props.value), [detail.xml, detail.htmlContent])
  assert.ok(values.some(value => typeof value === 'string' && value.includes(`XML SHA-256 ${output.xmlSha256}`)))
})

test('dashboard disables an unready WeChat news target and explains its missing cover before creating an attempt', async () => {
  const draft = { draftId: 'draft-no-cover', requestId: 'request-1', generatorId: 'brief', title: 'No cover', markdown: '# No cover', sha256: 'a'.repeat(64), version: 1,
    status: 'published', publishedPublisherIds: ['local-markdown:daily'], mediaAssets: [], destinationPresentations: [] }
  const publisher = { id: 'wechat-draft:news', name: 'WeChat News', kind: 'wechat-draft', articleType: 'news', hasDeploymentDefaultCover: false }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, [publisher]], [5, [draft]], [14, { [draft.draftId]: true }]]))
  const values = descendants(client.renderDashboard())
  assert.ok(values.includes('暂不可发布'))
  assert.ok(values.includes('缺少微信必需的封面图片：草稿没有已批准封面或正文图片，目标也未配置部署默认封面。'))
  const button = values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('缺少发布条件'))
  assert.equal(button.props.disabled, true)
  assert.equal(client.fetchCalls.length, 0)
})

test('dashboard blocks newspic when remote Markdown images exist but no exact Production Media presentation is bound', async () => {
  const draft = { draftId: 'draft-newspic-unbound', requestId: 'request-1', generatorId: 'brief', title: 'No bound image',
    markdown: '正文 ![远程图片](https://source.example/image.avif)', sha256: 'a'.repeat(64), version: 2,
    status: 'approved', publishedPublisherIds: [], mediaAssets: [], destinationPresentations: [] }
  const publisher = { id: 'wechat-draft:newspic', name: 'WeChat Newspic', kind: 'wechat-draft', articleType: 'newspic', hasDeploymentDefaultCover: true }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, [publisher]], [5, [draft]], [14, { [draft.draftId]: true }]]))
  const values = descendants(client.renderDashboard())
  assert.ok(values.includes('图文消息至少需要一张精确绑定到当前微信目标且存在于 Artifact 的 Production Media 图片；正文远程图片不能替代该绑定。'))
  const button = values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('缺少发布条件'))
  assert.equal(button.props.disabled, true)
  assert.equal(client.fetchCalls.length, 0)
})

test('dashboard publication reconciliation warning executes without an automatic retry', async () => {
  const draft = { draftId: 'draft-1', requestId: 'request-1', generatorId: 'brief', title: 'Approved', markdown: '# Approved', sha256: 'a'.repeat(64), version: 2, status: 'approved', publishedPublisherIds: [] }
  const publisher = { id: 'local-markdown:daily', name: 'Daily', description: '' }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, [publisher]], [5, [draft]], [14, { [draft.draftId]: true }]]))
  const publish = descendants(client.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('首次发布到本地 Markdown'))
  const active = publish.props.onClick()
  assert.equal(client.fetchCalls.length, 1)
  client.pendingFetches[0]({ ok: false, status: 409, async json() { return { error: 'reconcile', receipt: {
    success: false, status: 'reconciliation-required', receiptPersistence: 'failed', publicationCommitted: true,
    publisherId: publisher.id, draftId: draft.draftId,
  } } } })
  while (client.fetchCalls.length < 3) await Promise.resolve()
  assert.equal(client.fetchCalls.filter(call => call.url === '/api/prismflow/production/publish').length, 1)
  client.pendingFetches[1]({ ok: true, status: 200, async json() { return { records: [draft] } } })
  client.pendingFetches[2]({ ok: true, status: 200, async json() { return [publisher] } })
  await active
  assert.equal(client.fetchCalls.filter(call => call.url === '/api/prismflow/production/publish').length, 1)
  assert.ok(descendants(client.renderDashboard()).includes('发布目标可能已写入，但持久化审计回执失败。必须先由特权操作员修复回执并完成对账，当前禁止再次发布。'))
})

test('dashboard skipped receipt-persistence failure renders only a warning and never success', async () => {
  const draft = { draftId: 'draft-skip', requestId: 'request-1', generatorId: 'brief', title: 'Approved', markdown: '# Approved', sha256: 'a'.repeat(64), version: 2, status: 'approved', publishedPublisherIds: [] }
  const publisher = { id: 'local-markdown:daily', name: 'Daily', description: '' }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, [publisher]], [5, [draft]], [14, { [draft.draftId]: true }]]))
  const publish = descendants(client.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('首次发布到本地 Markdown'))
  const active = publish.props.onClick()
  client.pendingFetches[0]({ ok: true, status: 200, async json() { return { receipt: {
    status: 'skipped', receiptPersistence: 'failed', publicationCommitted: false, publisherId: publisher.id, draftId: draft.draftId,
  } } } })
  while (client.fetchCalls.length < 3) await Promise.resolve()
  client.pendingFetches[1]({ ok: true, status: 200, async json() { return { records: [draft] } } })
  client.pendingFetches[2]({ ok: true, status: 200, async json() { return [publisher] } })
  await active
  const rendered = descendants(client.renderDashboard())
  assert.ok(rendered.includes('发布未产生新的目标写入，但持久化审计回执失败。'))
  assert.equal(rendered.includes('已批准稿件发布完成'), false)
})

test('dashboard persisted reconciliation-required drafts show an explicit warning even before expansion', async () => {
  const attempt = { attemptId: 'attempt-recovery', attemptNumber: 2, receiptId: 'receipt-recovery', publisherId: 'wechat-draft:news', state: 'reconciliation-required', intent: 'initial' }
  const draft = { draftId: 'draft-recovery', requestId: 'request-1', generatorId: 'brief', title: 'Recovered', markdown: '# Recovered', sha256: 'a'.repeat(64), version: 2,
    status: 'publishing', reconciliationRequired: true, publishedPublisherIds: [], publicationAttempts: [attempt] }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, []], [5, [draft]], [14, {}]]))
  const values = descendants(client.renderDashboard())
  assert.ok(values.includes('DSH 未收到可确认的最终响应；本地“需要对账”状态不代表微信公众号创建失败。请登录公众号后台核对本次文章，确认前不要重试。'))
  assert.ok(values.includes('已核对：草稿存在，记录成功')); assert.ok(values.includes('已核对：草稿不存在'))
  assert.match(client.source, /\/production\/reconcile-committed/u)
  assert.match(client.source, /系统将自动绑定当前受阻的精确 Attempt/u)
  assert.doesNotMatch(client.source, /请输入完整 Attempt ID/u)
  assert.equal(values.includes('已批准稿件发布完成'), false)
})

test('draft list exposes a cover-view action and opens the exact bound Production Media preview without expanding', async () => {
  const assetId = '2'.repeat(64)
  const publisher = { id: 'wechat-draft:newspic', name: '微信图文', description: '', kind: 'wechat-draft', articleType: 'newspic', hasDeploymentDefaultCover: false }
  const draft = { draftId: 'draft-cover', requestId: 'request-cover', generatorId: 'brief', title: '带封面的修订稿', markdown: '# Draft',
    sha256: 'a'.repeat(64), artifactBindingSha256: 'b'.repeat(64), version: 1, status: 'draft', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', publishedPublisherIds: [], mediaAssets: [{ assetId, sha256: assetId, bytes: 10, mime: 'image/png', width: 10, height: 10 }],
    destinationPresentations: [{ publisherId: publisher.id, cover: { assetId }, imageOrder: [assetId] }] }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, [publisher]], [5, [draft]], [14, {}]]))
  let tree = client.renderDashboard()
  const coverButton = descendants(tree).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('查看封面'))
  assert.ok(coverButton, 'collapsed Draft list must expose the cover action')
  assert.equal(descendants(tree).includes('已绑定封面'), false)
  coverButton.props.onClick()
  tree = client.renderDashboard()
  const values = descendants(tree)
  assert.ok(values.includes('已绑定封面')); assert.ok(values.includes('带封面的修订稿'))
  const image = values.find(node => node?.type === 'img' && node.props?.className === 'pf-cover-image')
  assert.equal(image.props.src, `/api/prismflow/production/media?draftId=draft-cover&assetId=${assetId}`)
  assert.equal(image.props.referrerPolicy, 'no-referrer')
})

test('dashboard renders unknown external publication as an error and never shows the success notice', async () => {
  const draft = { draftId: 'draft-unknown', requestId: 'request-1', generatorId: 'brief', title: 'Approved', markdown: '# Approved', sha256: 'a'.repeat(64), version: 2, status: 'approved', publishedPublisherIds: [] }
  const publisher = { id: 'wechat-draft:news', name: 'WeChat News', description: '', kind: 'wechat-draft', articleType: 'news', hasDeploymentDefaultCover: true }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, [publisher]], [5, [draft]], [14, { [draft.draftId]: true }]]))
  const publish = descendants(client.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('首次发布到微信公众号草稿'))
  const active = publish.props.onClick()
  client.pendingFetches[0]({ ok: false, status: 409, async json() { return { error: 'reconcile', receipt: {
    success: false, status: 'reconciliation-required', externalOutcome: 'unknown', publisherId: publisher.id, draftId: draft.draftId,
  } } } })
  while (client.fetchCalls.length < 3) await Promise.resolve()
  client.pendingFetches[1]({ ok: true, status: 200, async json() { return { records: [{ ...draft, status: 'publishing', reconciliationRequired: true }] } } })
  client.pendingFetches[2]({ ok: true, status: 200, async json() { return [publisher] } })
  await active
  const rendered = descendants(client.renderDashboard())
  assert.ok(rendered.includes('DSH 未收到可确认的最终响应；本地“需要对账”状态不代表微信公众号创建失败。请登录公众号后台核对本次文章，确认前不要重试。'))
  assert.equal(rendered.includes('已批准稿件发布完成'), false)
  assert.equal(client.fetchCalls.filter(call => call.url === '/api/prismflow/production/publish').length, 1)
})

test('dashboard lost-response repeat reuses one intent and an HTTP failure replay never shows publication success', async () => {
  const draft = { draftId: 'draft-repeat-failure', requestId: 'request-1', generatorId: 'brief', title: 'Published',
    markdown: '# Published', sha256: 'a'.repeat(64), version: 2, status: 'published',
    publishedPublisherIds: ['local-markdown:daily'] }
  const publisher = { id: 'local-markdown:daily', name: 'Daily', description: '' }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, [publisher]], [5, [draft]], [14, { [draft.draftId]: true }]]), {
    randomUUID: '77777777-7777-4777-8777-AAAAAAAAAAAA',
  })
  const repeat = descendants(client.renderDashboard()).find(node => typeof node?.type === 'function'
    && node.type.name === 'Button' && childrenOf(node).includes('再次发布到本地 Markdown'))
  const active = repeat.props.onClick()
  assert.equal(client.fetchCalls.length, 1)
  client.pendingFetchRejects[0](new TypeError('response was lost'))
  while (client.fetchCalls.length < 2) await Promise.resolve()
  assert.deepEqual(JSON.parse(client.fetchCalls[1].body), JSON.parse(client.fetchCalls[0].body))
  assert.equal(JSON.parse(client.fetchCalls[0].body).intentId, '77777777-7777-4777-8777-aaaaaaaaaaaa')
  client.pendingFetches[1]({ ok: false, status: 500, async json() { return { error: 'Publication attempt did not commit' } } })
  while (client.fetchCalls.length < 4) await Promise.resolve()
  client.pendingFetches[2]({ ok: true, status: 200, async json() { return { records: [draft] } } })
  client.pendingFetches[3]({ ok: true, status: 200, async json() { return [publisher] } })
  await active
  const rendered = descendants(client.renderDashboard())
  assert.ok(rendered.includes('发布到本地 Markdown未完成。下方“发布尝试历史”会显示是否已提交；请勿在结果未知时连续点击。'))
  assert.equal(rendered.includes('已批准稿件发布完成'), false)
  assert.equal(client.fetchCalls.length, 4)
})

test('dashboard review submits only the displayed version/hash and refreshes conflicts without retrying', async () => {
  const draft = { draftId: 'draft-1', requestId: 'request-1', generatorId: 'brief', title: 'Displayed', markdown: '# Displayed', sha256: 'a'.repeat(64), version: 4, status: 'draft', publishedPublisherIds: [] }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, []], [5, [draft]], [14, { [draft.draftId]: true }]]))
  const values = descendants(client.renderDashboard())
  const approve = values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('批准显示的版本与哈希'))
  const active = approve.props.onClick()
  assert.equal(client.fetchCalls.length, 1)
  assert.equal(client.fetchCalls[0].url, '/api/prismflow/production/review')
  assert.deepEqual(JSON.parse(client.fetchCalls[0].body), { draftId: draft.draftId, decision: 'approve', version: 4, sha256: 'a'.repeat(64) })
  client.pendingFetches[0]({ ok: false, status: 409, async json() { return { error: 'changed' } } })
  while (client.fetchCalls.length < 2) await Promise.resolve()
  assert.match(client.fetchCalls[1].url, /\/production\/draft\?draftId=draft-1$/u)
  client.pendingFetches[1]({ ok: true, status: 200, async json() { return { draft: { ...draft, title: 'Fresh unseen until conflict', markdown: '# Fresh', version: 5, sha256: 'b'.repeat(64) } } } })
  await active
  assert.equal(client.fetchCalls.length, 2, 'conflict refresh must never auto-submit unseen content')
  assert.ok(client.source.includes('请核对新内容后再次点击审批'))

  const rejectClient = await loadClient(new Map([[0, 'review'], [3, status], [4, []], [5, [draft]], [14, { [draft.draftId]: true }]]))
  const reject = descendants(rejectClient.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('拒绝显示的版本与哈希'))
  const rejecting = reject.props.onClick()
  assert.deepEqual(JSON.parse(rejectClient.fetchCalls[0].body), { draftId: draft.draftId, decision: 'reject', version: 4, sha256: 'a'.repeat(64) })
  rejectClient.pendingFetches[0]({ ok: true, status: 200, async json() { return { draft: { ...draft, status: 'rejected' } } } })
  await rejecting

  const dirtyClient = await loadClient(new Map([
    [0, 'review'], [3, status], [4, []], [5, [draft]], [13, { [draft.draftId]: { title: 'Unsaved', markdown: draft.markdown } }], [14, { [draft.draftId]: true }],
  ]))
  const dirtyValues = descendants(dirtyClient.renderDashboard())
  for (const label of ['批准显示的版本与哈希', '拒绝显示的版本与哈希']) {
    const button = dirtyValues.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes(label))
    assert.equal(button.props.disabled, true)
  }
})

test('dashboard deletes an exact clean unapproved Draft and removes its editor state', async () => {
  const draft = { draftId: 'draft-delete', requestId: 'request-1', generatorId: 'brief', title: 'Delete me', markdown: '# Delete', sha256: 'a'.repeat(64), version: 4, status: 'draft', publishedPublisherIds: [] }
  const client = await loadClient(new Map([[0, 'review'], [3, status], [4, []], [5, [draft]], [13, { [draft.draftId]: { title: draft.title, markdown: draft.markdown } }], [14, { [draft.draftId]: true }]]))
  const button = descendants(client.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('删除草稿'))
  const active = button.props.onClick()
  assert.equal(client.confirmCalls.length, 1); assert.match(client.confirmCalls[0], /历史 Generation Request 和审计来源仍会保留/u)
  assert.equal(client.fetchCalls[0].url, '/api/prismflow/production/delete-draft')
  assert.deepEqual(JSON.parse(client.fetchCalls[0].body), { draftId: draft.draftId, expectedVersion: 4, expectedSha256: 'a'.repeat(64) })
  client.pendingFetches[0]({ ok: true, status: 200, async json() { return { deletion: { draftId: draft.draftId, version: 4, sha256: draft.sha256, replay: false } } } })
  await active
  const rendered = descendants(client.renderDashboard())
  assert.equal(rendered.includes('Delete me'), false)
  assert.ok(rendered.includes('草稿已从审核列表中删除；Generation Request 与来源审计仍然保留'))
})

test('dashboard blocks publication when any other draft editor is dirty and preserves every editor', async () => {
  const approved = { draftId: 'draft-approved', requestId: 'request-1', generatorId: 'brief', title: 'Approved', markdown: '# Approved', sha256: 'a'.repeat(64), version: 2, status: 'approved', publishedPublisherIds: [] }
  const dirty = { draftId: 'draft-dirty', requestId: 'request-2', generatorId: 'brief', title: 'Dirty baseline', markdown: '# Dirty baseline', sha256: 'b'.repeat(64), version: 1, status: 'draft', publishedPublisherIds: [] }
  const editors = {
    [approved.draftId]: { title: approved.title, markdown: approved.markdown },
    [dirty.draftId]: { title: 'Unsaved other draft', markdown: '# Unsaved other draft' },
  }
  const client = await loadClient(new Map([
    [0, 'review'], [3, status], [4, [{ id: 'local-markdown:daily', name: 'Daily', description: '' }]],
    [5, [approved, dirty]], [13, editors], [14, { [approved.draftId]: true }],
  ]))
  const values = descendants(client.renderDashboard())
  assert.ok(values.includes('存在未保存的草稿修改；发布已阻止。请先保存或放弃全部草稿修改。'))
  const publish = values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('首次发布到本地 Markdown'))
  await publish.props.onClick()
  assert.equal(client.fetchCalls.length, 0)
  const rerendered = descendants(client.renderDashboard())
  assert.ok(rerendered.includes('存在未保存的草稿修改。为避免丢失任何草稿编辑，请先保存或放弃全部修改，再执行发布。'))
  const dirtyCardEditor = rerendered.find(node => node?.type === 'button' && childrenOf(node).includes('展开'))
  dirtyCardEditor.props.onClick()
  const afterExpand = descendants(client.renderDashboard())
  assert.equal(afterExpand.find(node => node?.type === 'input' && node?.props?.value === 'Unsaved other draft').props.value, 'Unsaved other draft')
  assert.equal(afterExpand.find(node => node?.type === 'textarea' && node?.props?.value === '# Unsaved other draft').props.value, '# Unsaved other draft')
})

test('safe Markdown preview preserves ordered-list numbering across intervening media lines', async () => {
  const client = await loadClient()
  const markdown = [
    '1. First item',
    '![first](https://cdn.example.com/first.png)',
    '1. Second item',
    '<br/>',
    '3. Third item',
    '# New section',
    '1. Reset item',
    '5. Explicit start',
  ].join('\n')
  const lists = client.exports.renderMarkdownPreview(markdown, 'draft-1').filter(node => node?.type === 'ol')
  assert.equal(JSON.stringify(lists.map(node => node.props.start)), JSON.stringify([undefined, 2, 3, undefined]))
  assert.equal(lists[3].props.children.length, 2)
})

test('safe rendered Markdown preview loads eligible React media directly and keeps blocked resources inert', async () => {
  const client = await loadClient()
  const markdown = [
    '# Heading **bold**',
    '1. [safe](https://example.com/path)',
    '2. ![image](http://example.com/image.png)',
    '<br>',
    '<video src="https://cdn.example.com/movie.mp4" controls="controls" width="100%"></video>',
    '<video src="http://[::1]/private.mp4" controls></video>',
    '<video src="https://cdn.example.com/event.mp4" controls onerror="alert(1)"></video>',
    '<video src="https://cdn.example.com/unknown.mp4" controls data-extra="concealed"></video>',
    '[bad](javascript:alert(1)) <script onload="alert(1)">boom</script> <iframe src="https://evil.example"></iframe>',
    '![blocked](http://127.0.0.1/private.png) <img src="https://example.com/raw.png">',
  ].join('\n')
  const values = descendants(client.exports.renderMarkdownPreview(markdown, 'draft-1'))
  assert.ok(values.some(node => node?.type === 'h1'))
  assert.ok(values.some(node => node?.type === 'strong'))
  assert.ok(values.some(node => node?.type === 'ol'))
  const link = values.find(node => node?.type === 'a')
  assert.equal(link.props.href, 'https://example.com/path'); assert.equal(link.props.target, '_blank'); assert.equal(link.props.rel, 'noopener noreferrer')
  assert.equal(link.props.className, 'pf-link pf-preview-link')
  assert.match(client.appendedStyle.textContent, /\.pf-link\.pf-preview-link\{[^}]*text-decoration:underline[^}]*font-weight:600/u)
  assert.match(client.appendedStyle.textContent, /\.pf-link\.pf-preview-link:hover\{/u)
  assert.match(client.appendedStyle.textContent, /\.pf-link\.pf-preview-link:focus-visible\{/u)
  const media = values.filter(node => typeof node?.type === 'function' && node.type.name === 'PreviewMedia')
  assert.equal(media.length, 4)
  const imageMedia = media.find(node => node.props.url === 'http://example.com/image.png')
  const videoMedia = media.find(node => node.props.url === 'https://cdn.example.com/movie.mp4')
  const image = imageMedia.type(imageMedia.props)
  const video = videoMedia.type(videoMedia.props)
  assert.equal(image.type, 'img'); assert.equal(image.props.src, 'http://example.com/image.png')
  assert.equal(video.type, 'video'); assert.equal(video.props.src, 'https://cdn.example.com/movie.mp4')
  assert.equal(image.props.src.includes('/api/prismflow/production/media'), false)
  assert.equal(video.props.src.includes('/api/prismflow/production/media'), false)
  assert.equal(new URL(image.props.src).origin, 'http://example.com')
  assert.equal(new URL(video.props.src).origin, 'https://cdn.example.com')
  assert.equal(image.props.referrerPolicy, 'no-referrer'); assert.equal(video.props.referrerPolicy, 'no-referrer')
  assert.equal(video.props.controls, true); assert.equal(video.props.playsInline, true)
  assert.equal(video.props.preload, 'metadata'); assert.equal(video.props.className, 'pf-preview-video')
  assert.match(client.appendedStyle.textContent, /video\.pf-preview-video\{width:100%;max-width:960px;min-height:180px/u)
  const blockedMediaNodes = media.filter(node => node.props.url.includes('127.0.0.1') || node.props.url.includes('[::1]'))
  assert.equal(blockedMediaNodes.length, 2)
  for (const blockedMedia of blockedMediaNodes) {
    const blocked = descendants(blockedMedia.type(blockedMedia.props))
    assert.ok(blocked.includes(`${blockedMedia.props.kind === 'image' ? '图片' : '视频'}资源已阻止`))
    assert.equal(blocked.some(node => node?.props?.src), false)
  }
  assert.doesNotMatch(client.source, /加载此资源|尚未加载/)
  for (const forbidden of ['script', 'iframe', 'img']) assert.equal(values.some(node => node?.type === forbidden), false)
  const renderedText = values.filter(value => typeof value === 'string').join('')
  for (const literal of [
    'javascript:alert(1)', '<script onload="alert(1)">', '<iframe src="https://evil.example">', '<img src="https://example.com/raw.png">',
    '<video src="https://cdn.example.com/event.mp4" controls onerror="alert(1)"></video>',
    '<video src="https://cdn.example.com/unknown.mp4" controls data-extra="concealed"></video>',
  ]) assert.ok(renderedText.includes(literal), literal)
  assert.doesNotMatch(client.source, /dangerouslySetInnerHTML|\.innerHTML\s*=/)
  assert.equal(client.exports.previewMediaUrl('unknown', 'https://example.com/a.png'), undefined)
  assert.equal(client.exports.previewMediaUrl('image', 'https://user:secret@example.com/a.png'), undefined)
  const exactRemote = 'https://example.com:443/a.png'
  assert.equal(client.exports.previewMediaUrl('image', exactRemote), 'https://example.com/a.png')

  for (const allowed of ['https://example.com/a.png', 'http://8.8.8.8/a.png', 'https://[2606:4700:4700::1111]/a.png']) assert.ok(client.exports.safePreviewResourceUrl(allowed), allowed)
  for (const denied of [
    'file:///tmp/a', 'https://user@example.com/a', 'http://localhost/a', 'http://name.local/a',
    'http://127.0.0.1/a', 'http://10.0.0.1/a', 'http://100.64.0.1/a', 'http://169.254.1.1/a',
    'http://172.16.0.1/a', 'http://192.168.0.1/a', 'http://192.0.2.1/a', 'http://198.51.100.1/a',
    'http://203.0.113.1/a', 'http://224.0.0.1/a', 'http://240.0.0.1/a', 'http://[::1]/a',
    'http://[fc00::1]/a', 'http://[fe80::1]/a', 'http://[ff02::1]/a', 'http://[2001::1]/a',
    'http://[2001:db8::1]/a', 'http://[2002::1]/a', 'http://[3ffe::1]/a',
  ]) assert.equal(client.exports.safePreviewResourceUrl(denied), undefined, denied)
})

test('dashboard review disables editing for approved, publishing, and published states', async () => {
  for (const immutableStatus of ['approved', 'publishing', 'published']) {
    const draft = { draftId: `draft-${immutableStatus}`, requestId: 'request-1', generatorId: 'brief', title: 'Immutable', markdown: '# Immutable', sha256: 'a'.repeat(64), version: 2, status: immutableStatus, publishedPublisherIds: [] }
    const client = await loadClient(new Map([[0, 'review'], [3, status], [4, []], [5, [draft]], [14, { [draft.draftId]: true }]]))
    const values = descendants(client.renderDashboard())
    assert.equal(values.find(node => node?.type === 'input' && node?.props?.maxLength === 300).props.disabled, true)
    assert.equal(values.find(node => node?.type === 'textarea' && node?.props?.maxLength === 100000).props.disabled, true)
    assert.ok(values.includes(`状态 ${immutableStatus} 的稿件不可编辑；如需变更必须创建新的 Generation Request。`))
  }
})

test('dashboard audit renders immutable draft provenance', async () => {
  const receipt = {
    receiptId: 'receipt-1', recordedAt: '2026-01-01T00:00:00.000Z', publisherId: 'local-markdown:daily',
    status: 'created', itemCount: 1, trigger: 'manual', verification: 'verified', fileName: 'brief.md',
    draftId: 'draft-1', draftVersion: 3, artifactSha256: 'f'.repeat(64),
  }
  const client = await loadClient(new Map([[0, 'receipts'], [3, status], [6, [receipt]]]))
  const values = descendants(client.renderDashboard())
  assert.ok(values.includes('draft-1 · 修订 3'))
  assert.ok(values.includes('f'.repeat(64)))
})

test('dashboard aborts a previous review refresh before starting another', async () => {
  const client = await loadClient(new Map([[0, 'review'], [3, status]]))
  const button = descendants(client.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('刷新草稿'))
  assert.ok(button)
  const first = button.props.onClick()
  assert.equal(client.fetchCalls.length, 2)
  const firstSignal = client.fetchCalls[0].signal
  const second = button.props.onClick()
  assert.equal(client.fetchCalls.length, 4)
  assert.equal(firstSignal.aborted, true)
  for (const resolve of client.pendingFetches) resolve({ ok: true, async json() { return { records: [] } } })
  await Promise.all([first, second])
})

function publisherProfileDocumentForBrowser(configOverrides = {}) {
  const definitions = [
    ['prismflow-publisher-local-markdown', 'local-markdown', configOverrides['local-markdown'] ?? { destinations: [{ id: 'daily', name: 'Daily', root: process.cwd(), artifactFileNamePattern: 'draft-{date}.md', overwrite: 'if-changed', maxBytes: 100000 }] }],
    ['prismflow-publisher-github-markdown', 'github-markdown', configOverrides['github-markdown'] ?? { destinations: [] }],
    ['prismflow-publisher-r2-markdown', 'r2-markdown', configOverrides['r2-markdown'] ?? { destinations: [] }],
    ['prismflow-publisher-wechat-draft', 'wechat-draft', configOverrides['wechat-draft'] ?? { destinations: [] }],
  ]
  const rows = definitions.map(([rowId, channelKind, config]) => {
    const normalized = normalizePublisherConfig(channelKind, config)
    const row = { rowId, channelKind, disabled: true, config: normalized, configRevision: publisherConfigRevision(channelKind, normalized) }
    return { ...row, rowRevision: publisherRowRevision(row) }
  })
  const body = { kind: 'PrismFlowPublisherProfileDocument/v2', profile: 'web', profileHash: 'a'.repeat(64),
    documentRevision: publisherDocumentRevision('web', rows), exportedAt: '2026-08-24T00:00:00.000Z', rows }
  return { ...body, fingerprint: documentFingerprint(body) }
}

async function editablePublisherClient(environment = {}) {
  const documentValue = publisherProfileDocumentForBrowser()
  const runtimeChannels = documentValue.rows.map(row => ({ kind: row.channelKind, active: false, disabled: true,
    configured: false, destinations: [], configRevision: row.configRevision }))
  const client = await loadClient(new Map([[0, 'publisher-profile'], [3, status], [24, runtimeChannels]]), environment)
  let values = descendants(client.renderDashboard())
  const input = values.find(node => node?.type === 'input' && node.props.accept === 'application/json,.json')
  await input.props.onChange({ target: { files: [{ size: 1000, async text() { return JSON.stringify(documentValue) } }], value: 'publishers.json' } })
  values = descendants(client.renderDashboard())
  values.find(node => node?.type === 'button' && descendants(node).includes('本地 Markdown 存储')).props.onClick()
  values = descendants(client.renderDashboard())
  const workspaceHead = values.find(node => node?.type === 'header' && node.props.className === 'pf-publisher-workspace-head')
  descendants(workspaceHead).find(node => node?.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } })
  return client
}
function publisherSaveButton(client) {
  return descendants(client.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button'
    && childrenOf(node).includes('验证并应用配置'))
}

test('browser publisher normalization has shared roundtrip parity including empty prefixes and WeChat concurrency', async () => {
  const client = await loadClient()
  const configs = {
    'local-markdown': { destinations: [{ id: 'local', name: 'Local', root: process.cwd() }] },
    'github-markdown': { destinations: [{ id: 'github', name: 'GitHub', repository: 'owner/repo' }] },
    'r2-markdown': { destinations: [{ id: 'r2', name: 'R2', accountId: 'A'.repeat(32), bucket: 'valid-bucket' }] },
    'wechat-draft': { destinations: [{ id: 'wechat', name: 'WeChat', appId: 'wx123', appSecretCredential: 'WECHAT_SECRET', articleType: 'news', limits: {} }] },
  }
  for (const [kind, config] of Object.entries(configs)) {
    const browser = client.exports.normalizePublisherConfigBrowser(kind, config)
    const shared = normalizePublisherConfig(kind, config)
    assert.deepEqual(JSON.parse(JSON.stringify(browser)), JSON.parse(JSON.stringify(shared)), kind)
    assert.deepEqual(JSON.parse(JSON.stringify(client.exports.normalizePublisherConfigBrowser(kind, browser))), JSON.parse(JSON.stringify(shared)), `${kind} roundtrip`)
  }
  assert.equal(client.exports.normalizePublisherConfigBrowser('wechat-draft', configs['wechat-draft']).destinations[0].tokenMode, 'stable')
  assert.throws(() => client.exports.normalizePublisherConfigBrowser('local-markdown', { destinations: [{ id: 'x', name: 'X', root: process.cwd(), maxItems: 101 }] }), /1 到 100/u)
  assert.throws(() => client.exports.normalizePublisherConfigBrowser('r2-markdown', { destinations: [{ id: 'x', name: 'X', accountId: 'a'.repeat(32), bucket: 'valid-bucket', maxDescriptionChars: 10001 }] }), /1 到 10000/u)
  const pastedR2 = client.exports.normalizePublisherConfigBrowser('r2-markdown', { destinations: [{
    id: 'r2-pasted', name: 'R2 pasted', accountId: `  ${'A'.repeat(32)}  `, bucket: '  VALID-BUCKET  ', pathPrefix: '/media/', publicUrlPrefix: 'pub-example.r2.dev/',
  }] }).destinations[0]
  assert.equal(pastedR2.accountId, 'a'.repeat(32)); assert.equal(pastedR2.bucket, 'valid-bucket'); assert.equal(pastedR2.pathPrefix, 'media')
  assert.equal(pastedR2.publicUrlPrefix, 'https://pub-example.r2.dev')
  const customWechat = { destinations: [{ id: 'wechat-gateway', name: 'Gateway', appId: 'wx123', appSecretCredential: 'WECHAT_SECRET', articleType: 'news', apiOrigin: 'https://wechat-gateway.example.test/api/' }] }
  assert.equal(client.exports.normalizePublisherConfigBrowser('wechat-draft', customWechat).destinations[0].apiOrigin, 'https://wechat-gateway.example.test/api')
  for (const apiOrigin of ['http://wechat.example.test', 'https://user:pass@wechat.example.test', 'https://wechat.example.test?token=x', 'https://wechat.example.test#fragment']) {
    assert.throws(() => client.exports.normalizePublisherConfigBrowser('wechat-draft', { destinations: [{ ...customWechat.destinations[0], apiOrigin }] }), /apiOrigin/u)
  }
  const tooLongRenderedCommit = `${'x'.repeat(191)}{date}`
  assert.throws(() => client.exports.normalizePublisherConfigBrowser('github-markdown', { destinations: [{ id: 'x', name: 'X', repository: 'owner/repo', artifactCommitMessage: tooLongRenderedCommit }] }), /artifactCommitMessage 无效/u)
})

test('publisher manager uses a channel rail, one-target editor, collapsed security/limits, overflow diagnostics, and non-floating apply area', async () => {
  const documentValue = publisherProfileDocumentForBrowser({
    'local-markdown': { destinations: [{ id: 'local', name: 'Local', root: process.cwd(), overwrite: 'never' }] },
    'github-markdown': { destinations: [{ id: 'github', name: 'GitHub', repository: 'owner/repo' }] },
    'r2-markdown': { destinations: [{ id: 'r2', name: 'R2', accountId: 'a'.repeat(32), bucket: 'valid-bucket' }] },
    'wechat-draft': { destinations: [{ id: 'wechat', name: 'WeChat', appId: 'wx123', appSecretCredential: 'WECHAT_SECRET', articleType: 'news', limits: {} }] },
  })
  const rows = structuredClone(documentValue.rows)
  const runtimeChannels = rows.map(row => ({ kind: row.channelKind, active: false, disabled: true, configured: true, destinations: [], configRevision: row.configRevision }))
  const client = await loadClient(new Map([[0, 'publisher-profile'], [3, status], [24, runtimeChannels], [25, documentValue], [26, rows], [27, rows]]))
  let values = descendants(client.renderDashboard())
  assert.ok(values.includes('发布与存储'))
  const rail = values.find(node => node?.type === 'nav' && node.props['aria-label'] === '发布与存储目标')
  for (const label of ['GitHub Archive', '微信公众号', '本地 Markdown 存储', 'Cloudflare R2 存储']) assert.ok(descendants(rail).includes(label), label)
  assert.equal(values.includes('尚未原生支持'), false); assert.equal(values.includes('RSS Feed'), false); assert.equal(values.includes('小红书'), false)
  assert.equal(values.includes('+ 新建目标'), false); assert.equal(values.includes('新建同类目标'), false)
  assert.equal(values.filter(node => node?.type === 'article' && node.props.className === 'pf-publisher-editor').length, 1)
  assert.ok(values.some(node => node?.type === 'details' && descendants(node).includes('网络与容量限制')))
  assert.ok(values.some(node => node?.type === 'details' && descendants(node).includes('安全凭证')))
  assert.ok(values.some(node => node?.type === 'details' && descendants(node).includes('危险操作')))
  const overflow = values.find(node => node?.type === 'details' && descendants(node).includes('更多'))
  assert.ok(overflow); assert.ok(descendants(overflow).includes('运行诊断'))
  assert.ok(descendants(overflow).some(node => node?.type === 'input' && node.props.accept === 'application/json,.json'))
  const footer = values.find(node => node?.type === 'footer' && String(node.props.className).includes('pf-publisher-changebar'))
  assert.ok(footer); assert.ok(descendants(footer).includes('没有未保存更改'))
  const apply = descendants(footer).find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('验证并应用配置'))
  assert.equal(apply.props.disabled, true); assert.equal(apply.props.primary, true)

  const labels = new Set()
  for (const label of ['本地 Markdown 存储', 'GitHub Archive', 'Cloudflare R2 存储', '微信公众号']) {
    values = descendants(client.renderDashboard())
    values.find(node => node?.type === 'button' && descendants(node).includes(label)).props.onClick()
    for (const field of descendants(client.renderDashboard()).filter(node => typeof node?.type === 'function' && node.type.name === 'Field')) labels.add(field.props.label)
  }
  for (const label of ['仓库 (Owner/Repo)', 'Branch', 'Path Prefix', 'API Base URL', 'App ID', '文章作者', 'Local 根目录', 'R2 Account ID', 'Bucket Name', 'Public URL Prefix', '备用封面']) assert.ok(labels.has(label), label)
  for (const hiddenRef of ['Token 凭证引用', 'App Secret 凭证引用', 'Access Key ID 凭证引用', 'Secret Access Key 凭证引用']) assert.equal(labels.has(hiddenRef), false)
  assert.match(client.source, /App Secret、Access Token、文章和媒体会通过明文 HTTP 传输/u)
  assert.match(client.appendedStyle.textContent, /pf-publisher-layout\{display:grid;grid-template-columns:260px minmax\(0,1fr\)/u)
  assert.match(client.appendedStyle.textContent, /pf-publisher-save-footer\.pf-publisher-changebar\{position:static/u)
  assert.doesNotMatch(client.appendedStyle.textContent, /pf-publisher-save-footer\.pf-publisher-changebar\{position:sticky/u)
})

test('publisher target card accepts a write-only real credential and refreshes only redacted status', async () => {
  const documentValue = publisherProfileDocumentForBrowser({
    'github-markdown': { destinations: [{ id: 'archive', name: 'GitHub Archive', repository: 'owner/repo', tokenCredential: 'PRISMFLOW_GITHUB_TOKEN' }] },
  })
  const rows = structuredClone(documentValue.rows)
  const github = rows.find(row => row.channelKind === 'github-markdown')
  const slot = { rowId: github.rowId, channelKind: github.channelKind, destinationId: 'archive', destinationName: 'GitHub Archive',
    field: 'tokenCredential', label: 'GitHub Token', configRevision: github.configRevision, configured: false, writable: true }
  const runtimeChannels = rows.map(row => ({ kind: row.channelKind, active: false, disabled: true, configured: false, destinations: [], configRevision: row.configRevision }))
  const client = await loadClient(new Map([[0, 'publisher-profile'], [3, status], [24, runtimeChannels], [25, documentValue], [26, rows], [27, structuredClone(rows)], [31, [slot]]]))
  let values = descendants(client.renderDashboard())
  values.find(node => node?.type === 'button' && descendants(node).includes('GitHub Archive')).props.onClick()
  values = descendants(client.renderDashboard())
  const secretInput = values.find(node => node?.type === 'input' && node.props.type === 'password' && node.props.placeholder === '在此粘贴真实凭证')
  assert.ok(secretInput); assert.equal(secretInput.props.value, ''); assert.equal(secretInput.props.autoComplete, 'new-password')
  secretInput.props.onChange({ target: { value: 'write-only-real-token' } })
  values = descendants(client.renderDashboard())
  const save = values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('保存凭证'))
  const active = save.props.onClick()
  assert.equal(client.fetchCalls[0].url, '/api/prismflow/publisher-profile/credential/set')
  assert.deepEqual(JSON.parse(client.fetchCalls[0].body), { rowId: slot.rowId, destinationId: slot.destinationId, field: slot.field,
    expectedConfigRevision: slot.configRevision, value: 'write-only-real-token' })
  client.pendingFetches[0]({ ok: true, status: 200, async json() { return { updated: true } } })
  while (client.fetchCalls.length < 2) await Promise.resolve()
  assert.equal(client.fetchCalls[1].url, '/api/prismflow/publisher-profile/credentials')
  client.pendingFetches[1]({ ok: true, status: 200, async json() { return { slots: [{ ...slot, configured: true }] } } })
  await active
  const rendered = descendants(client.renderDashboard())
  assert.ok(rendered.includes('已安全存储')); assert.equal(rendered.includes('write-only-real-token'), false)
})

test('publisher save footer exposes dirty and restart states and confirms before discarding edits', async () => {
  const documentValue = publisherProfileDocumentForBrowser()
  const rows = JSON.parse(JSON.stringify(documentValue.rows))
  const runtimeChannels = rows.map(row => ({ kind: row.channelKind, active: false, disabled: true, configured: true, destinations: [], configRevision: row.configRevision }))
  const environment = { confirmResult: false }
  const client = await loadClient(new Map([[0, 'publisher-profile'], [3, status], [24, runtimeChannels], [25, documentValue], [26, rows], [27, structuredClone(rows)]]), environment)
  let values = descendants(client.renderDashboard())
  values.find(node => node?.type === 'button' && descendants(node).includes('本地 Markdown 存储')).props.onClick()
  values = descendants(client.renderDashboard())
  const workspaceHead = values.find(node => node?.type === 'header' && node.props.className === 'pf-publisher-workspace-head')
  descendants(workspaceHead).find(node => node?.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } })

  values = descendants(client.renderDashboard())
  const footer = values.find(node => node?.type === 'footer' && String(node.props.className).includes('pf-publisher-changebar'))
  assert.ok(descendants(footer).includes('1 个渠道有未保存更改'))
  const save = descendants(footer).find(node => typeof node?.type === 'function' && node.type.name === 'Button'
    && childrenOf(node).includes('验证并应用配置'))
  assert.equal(save.props.disabled, false)
  assert.equal(save.props.primary, true)
  assert.equal(save.props.danger, undefined, 'normal save must not use destructive styling')
  const reload = descendants(footer).find(node => typeof node?.type === 'function' && node.type.name === 'Button'
    && childrenOf(node).includes('放弃修改'))
  reload.props.onClick()
  assert.deepEqual(client.confirmCalls, ['放弃未保存的发布配置修改并重新加载服务器配置？'])
  assert.equal(client.fetchCalls.length, 0, 'declining discard keeps local edits and does not reload')
  assert.equal(client.stateSlots[26][0].disabled, false)

  const restartClient = await loadClient(new Map([[0, 'publisher-profile'], [3, status], [24, runtimeChannels], [25, documentValue], [26, rows], [27, structuredClone(rows)],
    [28, { entered: true, drained: true, timedOut: false, activeAttempts: 0, restartRequired: true }]]))
  assert.ok(descendants(restartClient.renderDashboard()).includes('需要重启'))
})

test('publisher visual workflow imports, edits, toggles, adds without enabling, replaces/removes, and submits the current direct plan', async () => {
  const documentValue = publisherProfileDocumentForBrowser()
  const runtimeChannels = documentValue.rows.map(row => ({ kind: row.channelKind, active: false, disabled: true, configured: false, destinations: [], configRevision: row.configRevision }))
  const client = await loadClient(new Map([[0, 'publisher-profile'], [3, status], [24, runtimeChannels]]))
  let values = descendants(client.renderDashboard())
  const input = values.find(node => node?.type === 'input' && node.props.accept === 'application/json,.json')
  const target = { files: [{ size: 1000, async text() { return JSON.stringify(documentValue) } }], value: 'publishers.json' }
  await input.props.onChange({ target })
  assert.equal(target.value, '')
  assert.equal(client.stateSlots[26].length, 4)

  values = descendants(client.renderDashboard())
  values.find(node => node?.type === 'button' && descendants(node).includes('本地 Markdown 存储')).props.onClick()
  values = descendants(client.renderDashboard())
  const localWorkspace = values.find(node => node?.type === 'main' && node.props.className === 'pf-publisher-workspace')
  const toggle = descendants(localWorkspace).find(node => node?.type === 'input' && node.props.type === 'checkbox')
  assert.equal(toggle.props.checked, false)
  toggle.props.onChange({ target: { checked: true } })
  assert.equal(client.stateSlots[26].find(row => row.channelKind === 'local-markdown').disabled, false)

  values = descendants(client.renderDashboard())
  const saveButton = values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('验证并应用配置'))
  const save = saveButton.props.onClick()
  while (client.fetchCalls.length === 0) await new Promise(resolve => setImmediate(resolve))
  assert.equal(client.confirmCalls.length, 1)
  assert.match(client.confirmCalls[0], /^保存发布配置\n\n/u)
  assert.match(client.confirmCalls[0], /不可逆地暂停新的生成和发布任务/u)
  assert.match(client.confirmCalls[0], /必须重启 DSH/u)
  assert.equal(client.fetchCalls.length, 1)
  assert.equal(client.fetchCalls[0].url, '/api/prismflow/publisher-profile/apply')
  const request = JSON.parse(client.fetchCalls[0].body)
  assert.equal(request.confirmPauseUntilRestart, true)
  assert.equal(request.plan.kind, 'PrismFlowPublisherChangePlan/v2')
  assert.equal(request.plan.changes[0].expectedRowRevision, documentValue.rows[0].rowRevision)
  assert.equal(validatePublisherChangePlan(request.plan, documentValue, { requireV2: true }).changes.length, 1)
  client.pendingFetches[0]({ ok: true, status: 202, async json() { return { operation: { operationId: request.operationId, status: 'pending', restartRequired: true }, maintenance: true, drained: false, timedOut: true, activeAttempts: 1, restartAllowed: false } } })
  await save

  values = descendants(client.renderDashboard())
  values.find(node => node?.type === 'button' && descendants(node).includes('GitHub Archive')).props.onClick()
  values = descendants(client.renderDashboard())
  values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('创建第一个目标')).props.onClick()
  const githubRow = client.stateSlots[26].find(row => row.channelKind === 'github-markdown')
  assert.equal(githubRow.disabled, true, 'adding a destination must preserve disabled state')
  assert.equal(githubRow.config.destinations.length, 1)
  assert.match(githubRow.config.destinations[0].tokenCredential, /^PRISMFLOW_GITHUB_TOKEN_[A-F0-9]{12}$/u)
  values = descendants(client.renderDashboard())
  assert.equal(values.find(node => typeof node?.type === 'function' && node.type.name === 'Field' && node.props.label === 'Artifact Commit Message 模板').props.maxLength, 200)

  values.find(node => node?.type === 'button' && descendants(node).includes('本地 Markdown 存储')).props.onClick()
  values = descendants(client.renderDashboard())
  values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('复制为新目标')).props.onClick()
  assert.match(client.stateSlots[26].find(row => row.channelKind === 'local-markdown').config.destinations[0].id, /^daily-replacement-/u)
  values = descendants(client.renderDashboard())
  values.find(node => typeof node?.type === 'function' && node.type.name === 'Button' && childrenOf(node).includes('退役目标')).props.onClick()
  assert.equal(client.stateSlots[26].find(row => row.channelKind === 'local-markdown').config.destinations.length, 0)
})

test('cancelling confirmation preserves an existing unknown direct request and its operation binding', async () => {
  const environment = { confirmResult: true, randomUUID: '95959595-9595-4595-8595-959595959595' }
  const client = await editablePublisherClient(environment)
  const first = publisherSaveButton(client).props.onClick()
  while (client.fetchCalls.length < 1) await new Promise(resolve => setImmediate(resolve))
  const original = JSON.parse(client.fetchCalls[0].body)
  client.pendingFetchRejects[0](new Error('response lost'))
  await first

  environment.confirmResult = false
  await publisherSaveButton(client).props.onClick()
  assert.equal(client.fetchCalls.length, 1, 'declining a destructive retry must not discard or send the unknown request')

  environment.confirmResult = true
  const retry = publisherSaveButton(client).props.onClick()
  while (client.fetchCalls.length < 2) await new Promise(resolve => setImmediate(resolve))
  const retried = JSON.parse(client.fetchCalls[1].body)
  assert.equal(retried.operationId, original.operationId)
  assert.deepEqual(retried.plan, original.plan)
  client.pendingFetchRejects[1](new Error('stop retry'))
  await retry
})

test('baseline conflict rebases and preserves unsaved publisher input instead of losing it on reload', async () => {
  const client = await editablePublisherClient({ confirmResult: true, randomUUID: '94949494-9494-4494-8494-949494949494' })
  const originalDocument = structuredClone(client.stateSlots[25])
  const save = publisherSaveButton(client).props.onClick()
  while (client.fetchCalls.length < 1) await new Promise(resolve => setImmediate(resolve))
  client.pendingFetches[0]({ ok: false, status: 409, async json() { return { error: 'Publisher Profile baseline changed; reload before saving' } } })
  while (client.fetchCalls.length < 4) await new Promise(resolve => setImmediate(resolve))
  const latestDocument = { ...originalDocument, profileHash: 'f'.repeat(64), documentRevision: 'e'.repeat(64) }
  client.pendingFetches[1]({ ok: true, status: 200, async json() { return { document: latestDocument, credentialSlots: [] } } })
  client.pendingFetches[2]({ ok: true, status: 200, async json() { return { channels: [] } } })
  client.pendingFetches[3]({ ok: true, status: 200, async json() { return { operation: null } } })
  await save
  assert.equal(client.stateSlots[25].profileHash, 'f'.repeat(64))
  assert.equal(client.stateSlots[26][0].disabled, false, 'local unsaved edit remains in the editor')
  assert.equal(client.stateSlots[27][0].disabled, true, 'latest server row remains the new baseline')
  assert.ok(descendants(client.renderDashboard()).some(value => typeof value === 'string' && value.includes('当前未保存输入已经保留')))

  const retry = publisherSaveButton(client).props.onClick()
  while (client.fetchCalls.length < 5) await new Promise(resolve => setImmediate(resolve))
  assert.equal(JSON.parse(client.fetchCalls[4].body).plan.expectedProfileHash, 'f'.repeat(64))
  client.pendingFetchRejects[4](new Error('stop retry'))
  await retry
})

test('a committed direct save records restart success before refresh and retains its operation after refresh failure', async () => {
  const environment = { confirmResult: true, randomUUID: '96969696-9696-4696-8696-969696969696' }
  const client = await editablePublisherClient(environment)
  const save = publisherSaveButton(client).props.onClick()
  while (client.fetchCalls.length < 1) await new Promise(resolve => setImmediate(resolve))
  const original = JSON.parse(client.fetchCalls[0].body)
  client.pendingFetches[0]({ ok: true, status: 200, async json() { return { operation: {
    operationId: original.operationId, status: 'completed', restartRequired: true,
  }, maintenance: true, drained: true, timedOut: false, activeAttempts: 0, restartAllowed: true } } })
  while (client.fetchCalls.length < 4) await new Promise(resolve => setImmediate(resolve))
  assert.equal(client.stateSlots[28].entered, true, 'commit success is recorded before refresh settles')
  assert.equal(client.stateSlots[28].restartRequired, true)
  client.pendingFetchRejects[1](new Error('post-commit Profile GET failed'))
  client.pendingFetches[2]({ ok: true, status: 200, async json() { return { channels: [] } } })
  client.pendingFetches[3]({ ok: true, status: 200, async json() { return { operation: null } } })
  await save
  assert.equal(client.stateSlots[28].restartRequired, true)
  assert.ok(descendants(client.renderDashboard()).includes('配置已写入，新的生成和发布任务会继续暂停；必须重启 DSH。写入后重新加载配置失败；成功结果与操作标识已保留，请使用完全相同的更改重试核对，勿创建新的保存请求。'))

  const retry = publisherSaveButton(client).props.onClick()
  while (client.fetchCalls.length < 5) await new Promise(resolve => setImmediate(resolve))
  assert.equal(JSON.parse(client.fetchCalls[4].body).operationId, original.operationId, 'post-commit refresh failure preserves durable operation identity')
  client.pendingFetchRejects[4](new Error('stop replay'))
  await retry
})

test('successful pending resume sends the displayed ID, marks restart first, and refreshes every publisher baseline', async () => {
  const documentValue = publisherProfileDocumentForBrowser()
  const rows = JSON.parse(JSON.stringify(documentValue.rows))
  const operationId = 'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7'
  const pending = { operationId, status: 'pending', phase: 'draining', restartRequired: true, canResume: true, canCancel: false }
  const runtimeChannels = rows.map(row => ({ kind: row.channelKind, active: false, disabled: true, configured: false, destinations: [], configRevision: row.configRevision }))
  const client = await loadClient(new Map([[0, 'publisher-profile'], [3, status], [24, runtimeChannels], [25, documentValue], [26, rows], [27, rows], [29, pending]]))
  const resumeButton = descendants(client.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button'
    && childrenOf(node).includes('继续保存配置'))
  const resume = resumeButton.props.onClick()
  while (client.fetchCalls.length < 1) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(client.fetchCalls[0].body), { action: 'resume', operationId })
  client.pendingFetches[0]({ ok: true, status: 200, async json() { return { operation: { operationId, status: 'completed', restartRequired: true },
    maintenance: true, drained: true, timedOut: false, activeAttempts: 0, restartAllowed: true } } })
  while (client.fetchCalls.length < 4) await new Promise(resolve => setImmediate(resolve))
  assert.equal(client.stateSlots[28].entered, true, 'restart-required state is committed before refresh settles')
  assert.equal(client.stateSlots[28].restartRequired, true)
  client.pendingFetches[1]({ ok: true, status: 200, async json() { return { document: documentValue } } })
  client.pendingFetches[2]({ ok: true, status: 200, async json() { return { channels: runtimeChannels } } })
  client.pendingFetches[3]({ ok: true, status: 200, async json() { return { operation: null } } })
  await resume
  assert.equal(client.stateSlots[25].documentRevision, documentValue.documentRevision)
  assert.equal(client.stateSlots[26].length, 4); assert.equal(client.stateSlots[27].length, 4)
  assert.equal(client.stateSlots[24].length, 4); assert.equal(client.stateSlots[29], null)
})

test('completed pending resume preserves its operation identity and clears a stale editor when refresh fails', async () => {
  const documentValue = publisherProfileDocumentForBrowser()
  const rows = JSON.parse(JSON.stringify(documentValue.rows))
  const operationId = 'a8a8a8a8-a8a8-48a8-88a8-a8a8a8a8a8a8'
  const pending = { operationId, status: 'pending', phase: 'draining', restartRequired: true, canResume: true, canCancel: false }
  const client = await loadClient(new Map([[0, 'publisher-profile'], [3, status], [24, []], [25, documentValue], [26, rows], [27, rows], [29, pending]]))
  const resumeButton = descendants(client.renderDashboard()).find(node => typeof node?.type === 'function' && node.type.name === 'Button'
    && childrenOf(node).includes('继续保存配置'))
  const resume = resumeButton.props.onClick()
  while (client.fetchCalls.length < 1) await new Promise(resolve => setImmediate(resolve))
  client.pendingFetches[0]({ ok: true, status: 200, async json() { return { operation: { operationId, status: 'completed', restartRequired: true },
    maintenance: true, drained: true, timedOut: false, activeAttempts: 0, restartAllowed: true } } })
  while (client.fetchCalls.length < 4) await new Promise(resolve => setImmediate(resolve))
  client.pendingFetchRejects[1](new Error('post-resume Profile refresh failed'))
  await resume
  assert.equal(client.stateSlots[28].restartRequired, true)
  assert.equal(client.stateSlots[25], null); assert.equal(client.stateSlots[26].length, 0); assert.equal(client.stateSlots[27].length, 0)
  const rendered = descendants(client.renderDashboard())
  assert.ok(rendered.some(value => typeof value === 'string' && value.includes(operationId) && value.includes('编辑器已清空')))
})

test('publisher direct save owns validation, confirmation, request ceiling, drain, and restart messaging', async () => {
  const client = await loadClient()
  assert.match(client.source, /new TextEncoder\(\)\.encode\(JSON\.stringify\(request\)\)\.byteLength/u)
  assert.match(client.source, /requestBytes > 32 \* 1024/u)
  assert.match(client.source, /保存配置并准备重启/u)
  assert.match(client.source, /系统会先校验配置，然后不可逆地暂停新的生成和发布任务/u)
  assert.match(client.source, /必须重启 DSH/u)
  assert.doesNotMatch(client.source, /api\('\/maintenance\/drain'/u)
})

test('publisher applied status uses runtime activity for disabled rows and activity plus exact revision for enabled rows', async () => {
  const { exports } = await loadClient()
  const revision = 'a'.repeat(64)
  const disabled = { disabled: true, configRevision: revision }
  const enabled = { disabled: false, configRevision: revision }
  assert.equal(exports.publisherRuntimeApplied(disabled, { active: true, configRevision: revision }), false, 'old active provider plus disabled plan requires restart')
  assert.equal(exports.publisherRuntimeApplied(disabled, { active: false, configRevision: '' }), true, 'disabled rows are applied when the plugin config is intentionally not loaded')
  assert.equal(exports.publisherRuntimeApplied(disabled, { active: false, configRevision: revision }), true)
  assert.equal(exports.publisherRuntimeApplied(enabled, { active: true, destinations: [], configRevision: revision }), true, 'enabled empty channel is applied with exact revision')
  assert.equal(exports.publisherRuntimeApplied(enabled, { active: true, configRevision: 'b'.repeat(64) }), false)
  assert.equal(exports.publisherRuntimeApplied(enabled, { active: false, configRevision: revision }), false)
})
