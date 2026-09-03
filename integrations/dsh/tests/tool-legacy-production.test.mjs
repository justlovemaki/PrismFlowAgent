import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import test from 'node:test'
import sharp from 'sharp'
import Parser from 'rss-parser'
import { apply, resolveFfmpegPath } from '../lib/tool-legacy-production.js'
import { ffmpegCandidatePaths } from '../lib/ffmpeg-runtime.js'
import { ManagedRssFetchError } from '../lib/secure-rss-fetch.js'

const config = { imageApiKeyCredential: 'IMAGE_API_KEY', imageApiUrl: 'https://images.example/v1/images/generations', imageApiProtocol: 'auto', imageModel: 'fixed-model', imageSize: '2K', avifQuality: 70, avifEffort: 5, ffmpegPath: 'ffmpeg', videoCrf: 28, videoPreset: 'slow', maxVideoBytes: 25 * 1024 * 1024, githubCredential: 'GH', workflowOwner: 'owner', workflowRepository: 'repo', workflowId: 'build.yml', workflowRef: 'main', rssSiteUrl: 'https://example.com/docs/', rssFeedUrl: 'https://feeds.example.com/rss.xml', rssMaxItems: 7 }
function harness(runtimeConfig = config, services = {}) {
  const tools = new Map(); const calls = []
  const draft = { draftId: 'draft-1', version: 2, sha256: 'a'.repeat(64), status: 'approved', title: 'A & B', markdown: '# Safe & sound\n\n**Bold** and [source](https://example.com/a?x=1&y=2).', approvedAt: '2026-01-02T00:00:00.000Z' }
  const history = { draftId: 'draft-0', version: 1, sha256: 'b'.repeat(64), status: 'published', title: 'Historical item', markdown: '# Earlier', approvedAt: '2026-01-01T00:00:00.000Z' }
  const unapproved = { draftId: 'draft-pending', version: 1, sha256: 'c'.repeat(64), status: 'draft', title: 'Pending item', markdown: '# Pending', updatedAt: '2026-01-03T00:00:00.000Z' }
  const drafts = [draft, history, unapproved]
  const toolsets = { isToolEnabled: () => true }
  const persistedRss = []
  const prismRssOutputs = services.prismRssOutputs ?? {
    async save(value) { const record = { ...value, outputId: 'd'.repeat(64), xmlSha256: createHash('sha256').update(value.xml).digest('hex'), generatedAt: '2026-01-02T00:00:01.000Z' }; persistedRss.push(record); return record },
    get(outputId) { return persistedRss.find(item => item.outputId === outputId) },
  }
  const ctx = { get: key => key === 'prismToolsets' ? toolsets : services[key], prismRssOutputs,
    prismImageGenerationSettings: services.prismImageGenerationSettings ?? { runtime() { return { imageApiUrl: runtimeConfig.imageApiUrl, imageApiProtocol: runtimeConfig.imageApiProtocol, imageModel: runtimeConfig.imageModel, imageSize: runtimeConfig.imageSize, avifQuality: runtimeConfig.avifQuality, avifEffort: runtimeConfig.avifEffort, ffmpegPath: runtimeConfig.ffmpegPath } }, async resolveCredential() { return { value: 'secret' } } },
    prismPublishers: { resolveMediaUploaderId() { throw new Error('R2 media destination is not configured') }, list() { return [{ id: 'github-markdown:daily', name: 'GitHub Daily', kind: 'github-markdown', description: 'Daily' }] } }, tools: { register(tool) { tools.set(tool.name, tool); return () => {} } }, credentials: { async resolve() { return { value: 'secret' } } }, prismProductionMedia: { async ingest() { throw new Error('not used') } }, prismProduction: { getDraft: id => drafts.find(item => item.draftId === id), listDrafts: ({ status, limit }) => drafts.filter(item => !status || item.status === status).slice(0, limit), async publish(...args) { calls.push(args); return { status: 'created', receiptId: 'receipt-1' } }, async republishExact(...args) { calls.push(args); return { status: 'created', receiptId: 'receipt-2' } } } }
  apply(ctx, runtimeConfig); return { tools, calls, persistedRss }
}
const execution = { signal: new AbortController().signal }

test('FFmpeg supports cross-system defaults, manual paths, PATH executable names, and deterministic discovery', async () => {
  const windows = ffmpegCandidatePaths('', { platform: 'win32', home: 'C:/Users/person', env: { PATH: 'C:/tools;D:/bin', LOCALAPPDATA: 'C:/Users/person/AppData/Local' } })
  assert.ok(windows.includes('C:\\tools\\ffmpeg.exe')); assert.ok(windows.some(path => path.includes('WinGet'))); assert.ok(windows.some(path => path.includes('scoop')))
  const mac = ffmpegCandidatePaths('', { platform: 'darwin', home: '/Users/person', env: { PATH: '/custom/bin' } })
  assert.ok(mac.includes('/opt/homebrew/bin/ffmpeg')); assert.ok(mac.includes('/opt/local/bin/ffmpeg'))
  const linux = ffmpegCandidatePaths('', { platform: 'linux', home: '/home/person', env: { PATH: '/custom/bin' } })
  assert.ok(linux.includes('/usr/bin/ffmpeg')); assert.ok(linux.includes('/snap/bin/ffmpeg')); assert.ok(linux.includes('/home/person/.nix-profile/bin/ffmpeg'))
  const selected = await resolveFfmpegPath('ffmpeg', { platform: 'linux', env: { PATH: '/custom/bin:/usr/bin' }, home: '/home/person', access: async path => { if (path !== '/usr/bin/ffmpeg') throw new Error('missing') } })
  assert.equal(selected, '/usr/bin/ffmpeg')
  await assert.rejects(resolveFfmpegPath('./relative/ffmpeg', { platform: 'linux', env: {}, home: '/home/person' }), /must be absolute/)
  await assert.rejects(resolveFfmpegPath('/missing/ffmpeg', { platform: 'linux', env: {}, home: '/home/person', access: async () => { throw new Error('missing') } }), error => error.code === 'PRISMFLOW_FFMPEG_CONFIGURATION')
})

test('compatibility and publication tools are native, and RSS generation converts and locally persists exact-approved HTML', async () => {
  const { tools, persistedRss } = harness()
  assert.deepEqual([...tools.keys()], ['prismflow_process_markdown_media', 'prismflow_image_generation', 'prismflow_trigger_insight_daily_build', 'prismflow_generate_rss_content', 'prismflow_publishers', 'prismflow_publish', 'prismflow_github_push'])
  assert.equal(tools.get('prismflow_github_push').parameters.properties.targets.items.type, 'string')
  assert.equal(tools.get('prismflow_github_push').parameters.properties.targets.items.enum, undefined)
  const rss = await tools.get('prismflow_generate_rss_content').execute({ draftId: 'draft-1', draftVersion: 2, artifactSha256: 'a'.repeat(64) }, execution)
  assert.equal(rss.rssOutputId, 'd'.repeat(64)); assert.equal(persistedRss.length, 1); assert.equal(persistedRss[0].xml, rss.content)
  assert.equal(rss.xmlBytes, Buffer.byteLength(rss.content, 'utf8')); assert.equal(rss.xmlSha256, createHash('sha256').update(rss.content).digest('hex'))
  const rssLines = rss.content.split('\n')
  assert.match(rssLines[0], /^<\?xml version="1\.0" encoding="UTF-8"\?><rss [^>]+>$/u)
  assert.equal(rssLines[1], '    <channel>')
  assert.ok(rssLines.includes('        <item>') && rssLines.includes('        </item>'))
  assert.ok(rssLines.some(line => /^            <content:encoded><!\[CDATA\[/u.test(line)))
  assert.match(rss.content, /AI资讯日报 RSS Feed/u)
  assert.match(rss.content, /xmlns:content="http:\/\/purl\.org\/rss\/1\.0\/modules\/content\/"/u)
  assert.match(rss.content, /<description><!\[CDATA\[# Safe & sound \*\*Bold\*\* and \[source\]/u)
  assert.match(rss.content, /<atom:link href="https:\/\/feeds\.example\.com\/rss\.xml"/u)
  assert.match(rss.content, /<link>https:\/\/example\.com\/docs\/2026-01\/2026-01-02\/<\/link>/u)
  assert.ok(rss.content.includes('<content:encoded><![CDATA[<h1>Safe &amp; sound</h1> <p><strong>Bold</strong> and <a href="https://example.com/a?x=1&y=2">source</a>.</p>]]></content:encoded>'))
  assert.doesNotMatch(rss.content, /<content:encoded># Safe/u)
  const parsed = await new Parser({ customFields: { item: [['content:encoded', 'contentEncoded']] } }).parseString(rss.content)
  assert.equal(parsed.items.length, 2)
  assert.deepEqual(parsed.items.map(item => item.title), ['2026-01-02日刊', '2026-01-01日刊'])
  assert.match(parsed.items[0].contentEncoded, /<h1>Safe &amp; sound<\/h1>/u)
  assert.match(parsed.items[0].contentEncoded, /<strong>Bold<\/strong>/u)
  assert.match(parsed.items[1].contentEncoded, /<h1>Earlier<\/h1>/u)
  assert.doesNotMatch(rss.content, /Pending item/u)
  await assert.rejects(tools.get('prismflow_process_markdown_media').execute({ content: '# no media' }, execution), /R2 media destination is not configured/)
  await assert.rejects(tools.get('prismflow_generate_rss_content').execute({ draftId: 'draft-1', draftVersion: 1, artifactSha256: 'a'.repeat(64) }, execution), /does not match/)
})

test('RSS history limit still includes the exact approved Draft requested by the caller', async () => {
  const { tools } = harness({ ...config, rssMaxItems: 1 })
  const rss = await tools.get('prismflow_generate_rss_content').execute({ draftId: 'draft-0', draftVersion: 1, artifactSha256: 'b'.repeat(64) }, execution)
  const parsed = await new Parser().parseString(rss.content)
  assert.deepEqual(parsed.items.map(item => item.title), ['2026-01-01日刊'])
})

test('prismflow_process_markdown_media ports linked images, HTML images, proxying, blacklists, AVIF conversion, and R2 rewriting', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).png().toBuffer(); const tools = new Map(); const uploads = []
  const claim = { assetId: 'b'.repeat(64), sha256: 'b'.repeat(64), bytes: 10, mime: 'image/png', width: 2, height: 2 }
  const toolsets = { isToolEnabled: () => true }
  const ctx = { get(key) { if (key === 'prismToolsets') return toolsets; if (key === 'prismMediaFetch') return async () => new Response(png, { headers: { 'content-type': 'image/png' } }) }, tools: { register(tool) { tools.set(tool.name, tool); return () => {} } }, credentials: {}, prismProduction: {}, prismProductionMedia: { async ingest() { return claim } }, prismPublishers: { resolveMediaUploaderId() { return 'r2-markdown:media' }, ownsMediaUrl() { return false }, async uploadMedia(_id, bytes, mime) { uploads.push({ bytes, mime }); return { publicUrl: `https://cdn.example/media/${uploads.length}.avif` } } } }
  apply(ctx, config)
  const content = '[![a](https://tvax1.sinaimg.cn/a.jpg)](https://elsewhere.example/x)\n<img src="https://safe.example/b.png"><br>\n![bad](https://qbitai.com/bad.jpg)'
  const result = await tools.get('prismflow_process_markdown_media').execute({ content }, execution)
  assert.match(result.content, /https:\/\/cdn\.example\/media\/1\.avif/); assert.doesNotMatch(result.content, /elsewhere\.example/); assert.match(result.content, /<img src="https:\/\/cdn\.example\/media\/2\.avif">/); assert.doesNotMatch(result.content, /qbitai/)
  assert.equal(uploads.length, 2); assert.ok(uploads.every(item => item.mime === 'image/avif')); assert.equal(result.omitted, 1)
})

test('prismflow_process_markdown_media preserves the original tri-state delete, retain, and rewrite semantics', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).png().toBuffer()
  const tools = new Map(); const toolsets = { isToolEnabled: () => true }
  const fetchMedia = async url => {
    if (url.includes('/403.')) throw new ManagedRssFetchError('generic failure', 'HTTP_STATUS', 403)
    if (url.includes('/429.')) throw new ManagedRssFetchError('generic failure', 'HTTP_STATUS', 429)
    if (url.includes('/large.')) throw new ManagedRssFetchError('generic failure', 'SIZE')
    if (url.includes('/unexpected.')) throw new Error('unexpected transport failure')
    if (url.includes('/invalid.')) return new Response(Buffer.from('not an image'), { headers: { 'content-type': 'image/png' } })
    return new Response(png, { headers: { 'content-type': 'image/png' } })
  }
  const ctx = { get(key) { if (key === 'prismToolsets') return toolsets; if (key === 'prismMediaFetch') return fetchMedia },
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } }, credentials: {}, prismProduction: {},
    prismProductionMedia: { async ingest() { return { assetId: 'b'.repeat(64), sha256: 'b'.repeat(64), bytes: 10, mime: 'image/png', width: 2, height: 2 } } },
    prismPublishers: { resolveMediaUploaderId() { return 'r2-markdown:media' }, ownsMediaUrl() { return false }, async uploadMedia() { throw new Error('temporary R2 upload failure') } } }
  apply(ctx, config)
  const urls = ['https://qbitai.com/blocked.jpg', 'https://safe.example/403.jpg', 'https://safe.example/429.jpg',
    'https://safe.example/large.jpg', 'https://safe.example/unexpected.jpg', 'https://safe.example/invalid.jpg', 'https://safe.example/upload.jpg']
  const result = await tools.get('prismflow_process_markdown_media').execute({ content: urls.map((url, index) => `![${index}](${url})`).join('\n') }, execution)
  assert.equal(result.omitted, 3)
  for (const url of urls.slice(2, 5)) assert.match(result.content, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  assert.match(result.content, /safe\.example\/upload\.jpg/u)
  assert.doesNotMatch(result.content, /qbitai|safe\.example\/403\.jpg|safe\.example\/invalid\.jpg/u)
})

test('prismflow_process_markdown_media decodes Markdown HTML ampersand entities before secure media fetch', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).png().toBuffer()
  const tools = new Map(); const fetched = []; const toolsets = { isToolEnabled: () => true }
  const ctx = { get(key) { if (key === 'prismToolsets') return toolsets; if (key === 'prismMediaFetch') return async url => { fetched.push(url); return new Response(png, { headers: { 'content-type': 'image/png' } }) } },
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } }, credentials: {}, prismProduction: {},
    prismProductionMedia: { async ingest() { return { assetId: 'b'.repeat(64), sha256: 'b'.repeat(64), bytes: 10, mime: 'image/png', width: 2, height: 2 } } },
    prismPublishers: { resolveMediaUploaderId() { return 'r2-markdown:media' }, ownsMediaUrl() { return false }, async uploadMedia() { return { publicUrl: 'https://cdn.example/media/entity.avif' } } } }
  apply(ctx, config)
  const result = await tools.get('prismflow_process_markdown_media').execute({ content: '![entity](https://pbs.twimg.com/media/a.jpg?format=jpg&#x26;name=orig)' }, execution)
  assert.equal(fetched[0], 'https://pbs.twimg.com/media/a.jpg?format=jpg&name=orig')
  assert.match(result.content, /cdn\.example\/media\/entity\.avif/u); assert.equal(result.omitted, 0)
})

test('prismflow_image_generation streams and persists a multi-megabyte b64_json response instead of returning it through the tool', async () => {
  const png = await sharp(randomBytes(640 * 640 * 3), { raw: { width: 640, height: 640, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer(); const tools = new Map(); let request
  assert.ok(Buffer.byteLength(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] })) > 1024 * 1024)
  const claim = { assetId: 'c'.repeat(64), sha256: 'c'.repeat(64), bytes: 10, mime: 'image/png', width: 2, height: 2 }; const toolsets = { isToolEnabled: () => true }
  const ctx = { get: key => key === 'prismToolsets' ? toolsets : undefined, tools: { register(tool) { tools.set(tool.name, tool); return () => {} } }, credentials: {}, prismImageGenerationSettings: { runtime() { return { imageApiUrl: config.imageApiUrl, imageApiProtocol: config.imageApiProtocol, imageModel: config.imageModel, imageSize: config.imageSize, avifQuality: config.avifQuality, avifEffort: config.avifEffort } }, async resolveCredential() { return { value: 'write-only-secret' } } }, prismProduction: {}, prismProductionMedia: { async ingest() { return claim } }, prismPublishers: { resolveMediaUploaderId() { return 'r2-markdown:media' }, async uploadMedia(_id, bytes, mime) { assert.ok(bytes.length); assert.equal(mime, 'image/avif'); return { publicUrl: 'https://cdn.example/media/generated.avif' } } } }
  apply(ctx, config); const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => { request = { url, init, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } }) }
  try {
    const result = await tools.get('prismflow_image_generation').execute({ prompt: 'a safe prompt' }, execution)
    assert.equal(result.content, '![生成图片](https://cdn.example/media/generated.avif)'); assert.equal(JSON.stringify(result).includes(png.toString('base64').slice(0, 100)), false)
    globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json', 'content-length': String(48 * 1024 * 1024 + 1) } })
    await assert.rejects(tools.get('prismflow_image_generation').execute({ prompt: 'bounded' }, execution), /50331648 byte image API limit/u)
  } finally { globalThis.fetch = originalFetch }
  assert.equal(request.url, config.imageApiUrl); assert.equal(request.body.stream, false); assert.equal(request.body.model, config.imageModel); assert.equal(request.init.headers.authorization, 'Bearer write-only-secret')
})

test('prismflow_image_generation supports an explicitly configured HTTP Chat Completions endpoint and Markdown image response', async () => {
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#654321' } }).png().toBuffer(); const tools = new Map(); let request
  const chatConfig = { ...config, imageApiUrl: 'http://images.example/v1/chat/completions', imageApiProtocol: 'auto' }; const claim = { assetId: 'd'.repeat(64), sha256: 'd'.repeat(64), bytes: 10, mime: 'image/png', width: 2, height: 2 }; const toolsets = { isToolEnabled: () => true }
  const ctx = { get(key) { if (key === 'prismToolsets') return toolsets; if (key === 'prismMediaFetch') return async () => new Response(png, { headers: { 'content-type': 'image/png' } }) }, tools: { register(tool) { tools.set(tool.name, tool); return () => {} } }, credentials: {}, prismImageGenerationSettings: { runtime() { return { imageApiUrl: chatConfig.imageApiUrl, imageApiProtocol: chatConfig.imageApiProtocol, imageModel: chatConfig.imageModel, imageSize: chatConfig.imageSize, avifQuality: chatConfig.avifQuality, avifEffort: chatConfig.avifEffort } }, async resolveCredential() { return { value: 'secret' } } }, prismProduction: {}, prismProductionMedia: { async ingest() { return claim } }, prismPublishers: { resolveMediaUploaderId() { return 'r2-markdown:media' }, async uploadMedia() { return { publicUrl: 'https://cdn.example/media/chat.avif' } } } }
  apply(ctx, chatConfig); const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => { request = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ choices: [{ message: { content: '![generated](https://source.example/image.png)' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }) }
  try { const result = await tools.get('prismflow_image_generation').execute({ prompt: 'draw' }, execution); assert.equal(result.content, '![生成图片](https://cdn.example/media/chat.avif)') } finally { globalThis.fetch = originalFetch }
  assert.equal(request.url, chatConfig.imageApiUrl); assert.equal(request.body.stream, false); assert.deepEqual(request.body.messages, [{ role: 'user', content: 'draw' }]); assert.equal(request.body.prompt, undefined)
})

test('generic Chat publication lists only configured destinations and enforces exact approved Artifact plus explicit intent', async () => {
  const { tools, calls } = harness(); const publishers = await tools.get('prismflow_publishers').execute({}, execution)
  assert.deepEqual(publishers.map(item => item.id), ['github-markdown:daily'])
  const publish = tools.get('prismflow_publish')
  const receipt = await publish.execute({ draftId: 'draft-1', draftVersion: 2, artifactSha256: 'a'.repeat(64), publisherId: 'github-markdown:daily', intent: 'initial', publicationIntent: 'explicit-user-approved-publication' }, execution)
  assert.equal(receipt.receiptId, 'receipt-1'); assert.equal(calls[0][1], 'github-markdown:daily')
  await assert.rejects(publish.execute({ draftId: 'draft-1', draftVersion: 2, artifactSha256: 'a'.repeat(64), publisherId: 'wechat-draft:unknown', intent: 'initial', publicationIntent: 'explicit-user-approved-publication' }, execution), /Unknown configured/)
})

test('prismflow_github_push extracts missing metadata once for a multi-target push', async () => {
  let starts = 0; let disposals = 0
  const subagents = { async start(_provider, options) {
    starts += 1; assert.deepEqual(options.toolFilter, { allow: [] })
    return { result: Promise.resolve({ stopReason: 'completed', structured: { title: 'Generated title', description: 'Generated description', tags: ['generated'], slug: 'generated-slug' } }), async dispose() { disposals += 1 } }
  } }
  const { tools } = harness(config, { subagents }); const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => init.method === 'GET' ? new Response('', { status: 404 })
    : new Response(JSON.stringify({ commit: { sha: '3'.repeat(40) }, content: { sha: '4'.repeat(40) } }), { status: 201 })
  try {
    const result = await tools.get('prismflow_github_push').execute({ content: 'metadata source', date: '2026-03-07', targets: [
      'justlovemaki/Hex2077-Site:content/blog/weekly', 'justlovemaki/Hex2077-Site:content/blog',
    ] }, { ...execution, agent: {} })
    assert.equal(starts, 1); assert.equal(disposals, 1); assert.equal(result.details.length, 2)
    assert.ok(result.details.every(item => item.path.endsWith('/2026-03-07-generated-slug.md')))
  } finally { globalThis.fetch = originalFetch }
})

test('prismflow_github_push publishes rss.xml from either a persisted RSS output or direct raw XML without Markdown rewriting', async () => {
  const { tools } = harness(); const tool = tools.get('prismflow_github_push'); const requests = []
  const generated = await tools.get('prismflow_generate_rss_content').execute({ draftId: 'draft-1', draftVersion: 2, artifactSha256: 'a'.repeat(64) }, execution)
  const xml = generated.content
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    if (init.method === 'GET') return new Response('', { status: 404 })
    return new Response(JSON.stringify({ commit: { sha: '5'.repeat(40) }, content: { sha: '6'.repeat(40) } }), { status: 201 })
  }
  try {
    const result = await tool.execute({ targets: ['justlovemaki/Hex2077-Site:rss.xml'], rssOutputId: generated.rssOutputId, filename: 'rss.xml', branch: 'book', message: 'Update rss.xml' }, execution)
    assert.equal(result.success, true); assert.equal(result.details[0].repo, 'justlovemaki/Hex2077-Site')
    assert.equal(result.details[0].branch, 'book'); assert.equal(result.details[0].path, 'rss.xml')
    assert.match(result.details[0].url, /Hex2077-Site\/blob\/book\/rss\.xml$/u)
    const body = JSON.parse(requests[1].init.body)
    assert.equal(body.branch, 'book'); assert.equal(body.message, 'Update rss.xml')
    assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), xml)
    assert.doesNotMatch(Buffer.from(body.content, 'base64').toString('utf8'), /^---/u)
    const directXml = xml.replace('AI资讯日报 RSS Feed', 'Direct RSS Feed')
    const directResult = await tool.execute({ targets: ['justlovemaki/Hex2077-Site:rss.xml'], content: directXml, branch: 'book', filename: 'rss.xml' }, execution)
    assert.equal(directResult.success, true)
    const directBody = JSON.parse(requests.at(-1).init.body)
    assert.equal(Buffer.from(directBody.content, 'base64').toString('utf8'), directXml)
    assert.doesNotMatch(Buffer.from(directBody.content, 'base64').toString('utf8'), /^---/u)
    await assert.rejects(tool.execute({ targets: ['justlovemaki/Hex2077-Site:rss.xml'], rssOutputId: generated.rssOutputId, branch: 'main' }, execution), /requires branch book/u)
    await assert.rejects(tool.execute({ targets: ['justlovemaki/Hex2077-Site:rss.xml'], content: directXml, rssOutputId: generated.rssOutputId }, execution), /exactly one of content or rssOutputId/u)
    await assert.rejects(tool.execute({ targets: ['justlovemaki/Hex2077-Site:rss.xml'], content: '<not-rss />' }, execution), /requires an RSS 2\.0 XML document/u)
    await assert.rejects(tool.execute({ targets: ['justlovemaki/Hex2077-Site:rss.xml'], rssOutputId: 'f'.repeat(64) }, execution), /Unknown persisted RSS output/u)
  } finally { globalThis.fetch = originalFetch }
})

test('prismflow_github_push Profile opt-in admits arbitrary repositories, exact raw files, and exact Markdown files', async () => {
  const locked = harness().tools.get('prismflow_github_push')
  await assert.rejects(locked.execute({ targets: ['other-owner/other-repo:data/config.json'], content: '{"safe":true}' }, execution), /Unsupported GitHub push target/u)
  await assert.rejects(locked.execute({ targets: ['justlovemaki/Hex2077-Site:content/blog'], targetType: 'raw-file', content: 'unsafe override' }, execution), /requires targetType markdown-directory/u)
  const { tools } = harness({ ...config, githubAllowArbitraryTargets: true }); const tool = tools.get('prismflow_github_push'); const requests = []
  const generated = await tools.get('prismflow_generate_rss_content').execute({ draftId: 'draft-1', draftVersion: 2, artifactSha256: 'a'.repeat(64) }, execution)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    if (init.method === 'GET') return new Response('', { status: 404 })
    return new Response(JSON.stringify({ commit: { sha: '7'.repeat(40) }, content: { sha: '8'.repeat(40) } }), { status: 201 })
  }
  try {
    const raw = await tool.execute({ targets: ['other-owner/other-repo:data/config.json'], content: '{"safe":true}\n', branch: 'release', message: 'Update config' }, execution)
    assert.equal(raw.details[0].repo, 'other-owner/other-repo'); assert.equal(raw.details[0].branch, 'release'); assert.equal(raw.details[0].path, 'data/config.json')
    let body = JSON.parse(requests.at(-1).init.body)
    assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), '{"safe":true}\n')
    const extensionless = await tool.execute({ targets: ['other-owner/other-repo:CNAME'], targetType: 'raw-file', content: 'docs.example.com\n', branch: 'release' }, execution)
    assert.equal(extensionless.details[0].path, 'CNAME')
    body = JSON.parse(requests.at(-1).init.body)
    assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), 'docs.example.com\n')
    const markdown = await tool.execute({ targets: ['other-owner/other-repo:docs/guide.md'], content: '# Guide', branch: 'docs', title: 'Guide', description: 'Guide description', slug: 'guide', tags: ['docs'], date: '2026-03-08' }, execution)
    assert.equal(markdown.details[0].branch, 'docs'); assert.equal(markdown.details[0].path, 'docs/guide.md')
    body = JSON.parse(requests.at(-1).init.body)
    const markdownBody = Buffer.from(body.content, 'base64').toString('utf8')
    assert.match(markdownBody, /^---\ntitle: Guide\nslug: guide/u); assert.match(markdownBody, /\n---\n\n# Guide$/u)
    assert.equal(markdown.details[0].url, 'https://github.com/other-owner/other-repo/blob/docs/docs/guide.md')
    const rss = await tool.execute({ targets: ['other-owner/other-repo:feeds/custom.xml'], rssOutputId: generated.rssOutputId, branch: 'syndication' }, execution)
    assert.equal(rss.details[0].branch, 'syndication'); assert.equal(rss.details[0].path, 'feeds/custom.xml')
    body = JSON.parse(requests.at(-1).init.body)
    assert.equal(Buffer.from(body.content, 'base64').toString('utf8'), generated.content)
  } finally { globalThis.fetch = originalFetch }
})

test('prismflow_github_push accepts arbitrary text and restores target, filename, branch, message, and Frontmatter behavior', async () => {
  const { tools } = harness(); const tool = tools.get('prismflow_github_push'); const requests = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init })
    if (init.method === 'GET') return new Response('', { status: 404 })
    return new Response(JSON.stringify({ commit: { sha: '1'.repeat(40) }, content: { sha: '2'.repeat(40) } }), { status: 201 })
  }
  try {
    const result = await tool.execute({
      targets: ['justlovemaki/Hex2077-Site:content/blog'], content: '<rss>arbitrary text</rss>', filename: 'feed.md', branch: 'book',
      message: 'Update arbitrary text', title: 'Feed title', description: 'Feed description', slug: 'feed-slug', tags: ['rss'], date: '2026-03-07',
    }, execution)
    assert.equal(result.success, true); assert.equal(result.allSuccess, true)
    assert.equal(result.details[0].path, 'content/blog/2026-03-07-feed.md')
    assert.match(result.details[0].url, /Hex2077-Site\/blob\/book\/content\/blog\/2026-03-07-feed\.md$/u)
    assert.equal(requests.length, 2); assert.equal(requests[0].init.method, 'GET'); assert.equal(requests[1].init.method, 'PUT')
    const body = JSON.parse(requests[1].init.body); const pushed = Buffer.from(body.content, 'base64').toString('utf8')
    assert.equal(body.branch, 'book'); assert.equal(body.message, 'Update arbitrary text')
    assert.match(pushed, /^---\ntitle: Feed title\nslug: feed-slug\ndescription: Feed description\ndate: .+ \+0800\ndraft: false\ncomments: true\ntags:\n  - rss\n---\n\n<rss>arbitrary text<\/rss>$/u)
  } finally { globalThis.fetch = originalFetch }
})
