import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import sharp from 'sharp'
import { apply, createWechatDraftProvider } from '../lib/publisher-wechat-draft.js'
import { productionArtifactBindingSha256 } from '../lib/shared/content-production.js'
import { normalizePublicationReceipt } from '../lib/shared/publication-receipt.js'
import { normalizePublisherConfig } from '../lib/shared/publisher-profile.js'
import { renderWechatMarkdown, replaceWechatImageUrls } from '../lib/shared/wechat-publisher.js'

const STORE_ID = 'b'.repeat(64)
const limits = { titleChars: 32, authorChars: 16, digestChars: 120, contentChars: 20_000, contentBytes: 1_000_000, maxImages: 20,
  bodyImageBytes: 999_999, permanentImageBytes: 10 * 1024 * 1024, maxPixels: 25_000_000,
  maxSourceBytes: 10 * 1024 * 1024, fetchTimeoutMs: 15_000, requestTimeoutMs: 30_000, concurrency: 1 }

function media(seed, mime = 'image/png') {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const bytes = Buffer.concat([pixel, Buffer.from(seed)])
  const assetId = createHash('sha256').update(bytes).digest('hex')
  return { claim: { assetId, sha256: assetId, bytes: bytes.length, mime, width: 10, height: 10 }, bytes }
}

function artifact(markdown, assets, presentations) {
  const value = { draftId: 'draft-1', draftVersion: 2, artifactSha256: createHash('sha256').update(markdown).digest('hex'),
    title: '精确标题', markdown, sourceContentStoreIds: [STORE_ID], artifactBindingSha256: '',
    mediaAssets: assets.map(item => item.claim), ...(presentations ? { destinationPresentations: presentations } : {}) }
  value.artifactBindingSha256 = productionArtifactBindingSha256(value)
  return value
}

function destination(articleType) {
  return { id: `account-${articleType}`, name: `WeChat ${articleType}`, appId: 'wxfixture', appSecretCredential: 'WECHAT_SECRET',
    apiOrigin: 'https://api.weixin.qq.com', ffmpegPath: 'ffmpeg', tokenMode: 'stable', articleType, defaultAuthor: '流光', digestPolicy: 'artifact-or-omit',
    needOpenComment: 1, onlyFansCanComment: 0, defaultCoverAssetRef: '', limits }
}

function fixture(articleType, value, assets, responseOverride, destinationOverride = {}, providerDependencies = {}) {
  let credentialResolutions = 0
  const requests = []
  const byId = new Map(assets.map(item => [item.claim.assetId, item]))
  const ctx = {
    credentials: { async resolve(ref) { credentialResolutions += 1; assert.equal(ref, 'WECHAT_SECRET'); return { value: 'app-secret-value' } } },
    prismProduction: { async resolveArtifactMedia(_publisherId, approved, assetId) {
      assert.equal(approved, value); const item = byId.get(assetId); return { ...item.claim, bytes: item.bytes }
    } },
  }
  const baseDestination = destination(articleType)
  const provider = createWechatDraftProvider(ctx, { ...baseDestination, ...destinationOverride,
    limits: { ...baseDestination.limits, ...(destinationOverride.limits ?? {}) } }, { ...providerDependencies, transport: async request => {
    requests.push(request)
    if (responseOverride) { const response = await responseOverride(request, requests); if (response) return response }
    if (request.url.endsWith('/cgi-bin/stable_token')) return { status: 200, body: { access_token: 'memory-token', expires_in: 7200 } }
    if (request.url.includes('/media/uploadimg')) return { status: 200, body: { url: `https://mmbiz.qpic.cn/body-${requests.length}` } }
    if (request.url.includes('/material/add_material')) return { status: 200, body: { media_id: `material-${requests.length}` } }
    return { status: 200, body: { media_id: 'draft-media-id' } }
  } })
  return { provider, requests, credentialResolutions: () => credentialResolutions }
}

function defaultTransportFixture(articleType, value, assets) {
  const byId = new Map(assets.map(item => [item.claim.assetId, item]))
  const ctx = {
    credentials: { async resolve(ref) { assert.equal(ref, 'WECHAT_SECRET'); return { value: 'app-secret-value' } } },
    prismProduction: { async resolveArtifactMedia(_publisherId, approved, assetId) {
      assert.equal(approved, value); const item = byId.get(assetId); return { ...item.claim, bytes: item.bytes }
    } },
  }
  return createWechatDraftProvider(ctx, destination(articleType))
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function withMockFetch(fetchImpl, callback) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  try { return await callback() } finally { globalThis.fetch = originalFetch }
}

test('renderer escapes raw HTML, preserves code whitespace, decodes URL entities, and derives media-free plain text', () => {
  const rendered = renderWechatMarkdown('## A & B\n\n<script>alert(1)</script>\n\n| 列一 | 列二 |\n| --- | --- |\n| A | B |\n\n```\n  x & <y>\n```\n\n![图](https://cdn.example.test/a.png?format=jpg&#x26;name=orig)')
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(rendered.html, /<script>/)
  assert.match(rendered.html, /background-color:#07C160/u)
  assert.match(rendered.html, /<table[^>]*>.*<th[^>]*>列一<\/th>.*<td[^>]*>A<\/td>.*<\/table>/u)
  assert.match(rendered.html, /<pre[^>]*><code>  x &amp; &lt;y&gt;<\/code><\/pre>/)
  assert.equal(rendered.images.length, 1)
  assert.equal(rendered.images[0].source, 'https://cdn.example.test/a.png?format=jpg&name=orig')
  assert.doesNotMatch(rendered.plainText, /cdn|<script>|!\[/)
})

test('source media and link labels retain original HTTP compatibility without emitting clickable source hrefs', () => {
  const source = 'http://img2.jintiankansha.me/get?src=http://mmbiz.qpic.cn/mmbiz_png/example/640?wx_fmt=png&#x26;from=appmsg'
  const rendered = renderWechatMarkdown(`![来源图片](${source})\n\n[来源链接](http://example.test/page)`)
  assert.equal(rendered.images[0].source, source.replace('&#x26;', '&'))
  assert.match(rendered.html, /<span[^>]*>来源链接<\/span>/u); assert.doesNotMatch(rendered.html, /href=/u)
})

test('original fail-open behavior tries each source image download once, silently removes a failure, and publishes later images', async () => {
  const failedSource = 'https://media.example.test/image.png?private=query-value'
  const goodSource = 'https://media.example.test/good.png'
  const markdown = `失败图 ![失败](${failedSource})\n\n成功图 ![成功](${goodSource})`
  const value = { draftId: 'draft-fetch-failure', draftVersion: 1, artifactSha256: createHash('sha256').update(markdown).digest('hex'),
    title: '抓取诊断', markdown, sourceContentStoreIds: [STORE_ID] }
  const good = media('later-image-succeeds')
  let attempts = 0
  let draftBody
  const provider = createWechatDraftProvider({ credentials: { async resolve() { return { value: 'secret' } } }, prismProduction: {} }, destination('news'), {
    fetchMedia: async url => {
      if (url === failedSource) { attempts += 1; throw new Error('network detail') }
      return { headers: { get: () => good.claim.mime }, async arrayBuffer() { return good.bytes } }
    },
    transport: async request => {
      if (request.url.endsWith('/cgi-bin/stable_token')) return { status: 200, body: { access_token: 'token', expires_in: 7200 } }
      if (request.url.includes('/media/uploadimg')) return { status: 200, body: { url: 'https://mmbiz.qpic.cn/good' } }
      if (request.url.includes('/material/add_material')) return { status: 200, body: { media_id: 'good-cover' } }
      draftBody = JSON.parse(request.body); return { status: 200, body: { media_id: 'draft-id' } }
    },
  })
  const receipt = await provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  assert.equal(receipt.status, 'created'); assert.equal(receipt.truncated, 0); assert.equal(receipt.omittedMedia, 1); assert.equal(attempts, 1)
  const normalized = normalizePublicationReceipt(receipt, provider.id, [{ storeId: STORE_ID }])
  assert.equal(normalized.omittedMedia, 1); assert.equal(normalized.contentStoreIds.length, 1)
  assert.doesNotMatch(draftBody.articles[0].content, /private|query-value|PF_WECHAT_IMAGE_0|<p\b[^>]*>\s*<\/p>/u)
  assert.match(draftBody.articles[0].content, /https:\/\/mmbiz\.qpic\.cn\/good/u)
})

test('original body-image compatibility converts fetched WebP to a bounded WeChat JPEG before upload', async () => {
  const source = 'http://media.example.test/source.webp'
  const webp = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#07c160' } }).webp().toBuffer()
  const markdown = `![WebP](${source})`
  const value = { draftId: 'draft-webp', draftVersion: 1, artifactSha256: createHash('sha256').update(markdown).digest('hex'),
    title: 'WebP 兼容', markdown, sourceContentStoreIds: [STORE_ID] }
  const requests = []; let fetchAttempts = 0
  const provider = createWechatDraftProvider({ credentials: { async resolve() { return { value: 'secret' } } }, prismProduction: {} }, destination('news'), {
    fetchMedia: async () => {
      fetchAttempts += 1
      return { headers: { get: () => 'image/webp' }, async arrayBuffer() { return webp } }
    },
    transport: async request => {
      requests.push(request)
      if (request.url.endsWith('/cgi-bin/stable_token')) return { status: 200, body: { access_token: 'token', expires_in: 7200 } }
      if (request.url.includes('/media/uploadimg')) return { status: 200, body: { url: 'https://mmbiz.qpic.cn/body.jpg' } }
      if (request.url.includes('/material/add_material')) return { status: 200, body: { media_id: 'cover' } }
      return { status: 200, body: { media_id: 'draft' } }
    },
  })
  await provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  const body = requests.find(request => request.url.includes('/media/uploadimg')).body.toString('latin1')
  assert.equal(fetchAttempts, 1)
  assert.match(body, /Content-Type: image\/jpeg/u); assert.doesNotMatch(body, /Content-Type: image\/webp/u)
})

test('news separates body URL uploads from permanent cover ids and returns an exact verified receipt', async () => {
  const image = media('news')
  const markdown = `正文 ![图](prismflow-media:${image.claim.assetId})\n`
  const value = artifact(markdown, [image])
  const run = fixture('news', value, [image])
  const receipt = await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  const draftRequest = run.requests.find(request => request.url.includes('/draft/add'))
  const payload = JSON.parse(draftRequest.body)
  assert.equal(Object.hasOwn(payload.articles[0], 'article_type'), false, 'original news payload omits article_type; only newspic sends it')
  assert.match(payload.articles[0].content, /https:\/\/mmbiz\.qpic\.cn\/body-/)
  assert.equal(payload.articles[0].thumb_media_id.startsWith('material-'), true)
  assert.equal(payload.articles[0].content.includes(payload.articles[0].thumb_media_id), false)
  assert.equal(receipt.wechatDraftMediaId, 'draft-media-id')
  assert.equal(receipt.articleType, 'news')
  assert.equal(receipt.sha256, value.artifactSha256)
  assert.equal(receipt.artifactBindingSha256, value.artifactBindingSha256)
  assert.equal(receipt.bytes, Buffer.byteLength(markdown))
  assert.equal(receipt.operation, 'draft.add')
})

test('newspic applies approved cover-first ordered dedup and emits only permanent media ids', async () => {
  const one = media('one'), two = media('two'), cover = media('cover')
  const publisherId = 'wechat-draft:account-newspic'
  const markdown = `![一](prismflow-media:${one.claim.assetId})\n\n正文\n\n![二](prismflow-media:${two.claim.assetId})\n`
  const presentation = { publisherId, cover: { assetId: cover.claim.assetId }, imageOrder: [two.claim.assetId, one.claim.assetId] }
  const value = artifact(markdown, [one, two, cover], [presentation])
  const run = fixture('newspic', value, [one, two, cover])
  const receipt = await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  const payload = JSON.parse(run.requests.find(request => request.url.includes('/draft/add')).body)
  const article = payload.articles[0]
  assert.equal(article.article_type, 'newspic')
  assert.equal(article.content.includes('<'), false)
  assert.equal('digest' in article, false)
  assert.deepEqual(article.image_info.image_list.map(item => item.image_media_id), ['material-2', 'material-3', 'material-4'])
  assert.equal(run.requests.some(request => request.url.includes('/media/uploadimg')), false)
  assert.equal(receipt.articleType, 'newspic')
})

test('newspic pure-text payload preserves paragraph breaks, ordered numbering, bullets, and intentional spaces', async () => {
  const cover = media('newspic-text-layout')
  const publisherId = 'wechat-draft:account-newspic'
  const markdown = '## 今日摘要\n\n1. 第一条  保留双空格\n2. 第二条\n\n- 补充内容\n'
  const presentation = { publisherId, cover: { assetId: cover.claim.assetId }, imageOrder: [cover.claim.assetId] }
  const value = artifact(markdown, [cover], [presentation])
  const run = fixture('newspic', value, [cover])
  await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  const payload = JSON.parse(run.requests.find(request => request.url.includes('/draft/add')).body)
  assert.equal(payload.articles[0].content, '今日摘要\n\n1. 第一条  保留双空格\n2. 第二条\n\n• 补充内容')
  assert.equal(payload.articles[0].content.includes('<'), false)
})

test('newspic exact approved presentation ignores unrelated remote Markdown images rendered only as plain text', async () => {
  const cover = media('newspic-bound-cover')
  const publisherId = 'wechat-draft:account-newspic'
  const presentation = { publisherId, cover: { assetId: cover.claim.assetId }, imageOrder: [cover.claim.assetId] }
  const value = artifact('正文 ![来源图片](https://source.example/unbound.avif)\n', [cover], [presentation])
  const run = fixture('newspic', value, [cover])
  assert.equal(run.provider.validateArtifact(value), true)
  const receipt = await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  const payload = JSON.parse(run.requests.find(request => request.url.includes('/draft/add')).body)
  assert.deepEqual(payload.articles[0].image_info.image_list.map(item => item.image_media_id), ['material-2'])
  assert.equal(run.requests.some(request => request.url.includes('/media/uploadimg')), false)
  assert.equal(receipt.articleType, 'newspic')
})

test('resolves the AppSecret every operation while reusing only an isolated early-refresh token cache', async () => {
  const image = media('token')
  const value = artifact(`![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const run = fixture('news', value, [image])
  await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  assert.equal(run.credentialResolutions(), 2)
  assert.equal(run.requests.filter(request => request.url.endsWith('/cgi-bin/stable_token')).length, 1)
  assert.equal(JSON.stringify(run.requests).includes('app-secret-value'), true)
  assert.equal(run.provider.description.includes('secret'), false)
})

test('fallback cover readiness follows original HTTPS URL behavior or a deployment-resolvable asset alias', () => {
  const base = { credentials: {}, prismProduction: {} }
  assert.equal(createWechatDraftProvider(base, { ...destination('news'), defaultCoverAssetRef: 'https://source.hex2077.dev/logo/hex2077.ai.png' }).hasDeploymentDefaultCover, true)
  assert.equal(createWechatDraftProvider(base, { ...destination('news'), defaultCoverAssetRef: 'http://unsafe.example/cover.png' }).hasDeploymentDefaultCover, false)
  const configured = { ...destination('news'), defaultCoverAssetRef: 'cover-main' }
  assert.equal(createWechatDraftProvider(base, configured).hasDeploymentDefaultCover, false)
  assert.equal(createWechatDraftProvider({ ...base, prismProductionMedia: { hasDeploymentAsset: ref => ref === 'cover-main' } }, configured).hasDeploymentDefaultCover, true)
})

test('news falls back to the original HTTPS logo URL when the body has no image', async () => {
  const fallbackUrl = 'https://source.hex2077.dev/logo/hex2077.ai.png'
  const image = media('fallback-cover-url')
  const value = artifact('正文没有图片。\n', [])
  const requests = []; const fetched = []
  const ctx = { credentials: { async resolve() { return { value: 'app-secret-value' } } }, prismProduction: {} }
  const provider = createWechatDraftProvider(ctx, { ...destination('news'), defaultCoverAssetRef: fallbackUrl }, {
    fetchMedia: async url => { fetched.push(url); return { headers: { get: () => image.claim.mime }, async arrayBuffer() { return image.bytes } } },
    transport: async request => {
      requests.push(request)
      if (request.url.endsWith('/cgi-bin/stable_token')) return { status: 200, body: { access_token: 'memory-token', expires_in: 7200 } }
      if (request.url.includes('/material/add_material')) return { status: 200, body: { media_id: 'fallback-material' } }
      return { status: 200, body: { media_id: 'draft-media-id' } }
    },
  })
  await provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  assert.deepEqual(fetched, [fallbackUrl])
  assert.equal(requests.some(request => request.url.includes('/media/uploadimg')), false)
  const article = JSON.parse(requests.find(request => request.url.includes('/draft/add')).body).articles[0]
  assert.equal(article.thumb_media_id, 'fallback-material'); assert.equal(Object.hasOwn(article, 'article_type'), false)
})

test('already compliant bounded JPEG/PNG body media is uploaded byte-for-byte without size-increasing re-encoding', async () => {
  const image = media('preserve-compatible-png')
  const value = artifact(`![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const run = fixture('news', value, [image])
  await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  const upload = run.requests.find(request => request.url.includes('/media/uploadimg'))
  assert.ok(upload.body.includes(image.bytes))
  assert.match(upload.headers['content-type'], /boundary=----WebKitFormBoundary/u)
})

test('news converts a video to a bounded GIF material, replaces the video with its HTTPS image URL, and keeps a normal image as cover', async () => {
  const image = media('video-cover')
  const gif = media('converted-gif', 'image/gif')
  const value = artifact(`![封面](prismflow-media:${image.claim.assetId})\n\n<video src="https://video.example.test/demo.mp4"></video>`, [image])
  let convertedSource
  let draftBody
  const run = fixture('news', value, [image], request => {
    if (request.url.includes('/material/add_material') && request.body.includes(Buffer.from('Content-Type: image/gif'))) {
      return { status: 200, body: { media_id: 'gif-material', url: 'http://mmbiz.qpic.cn/video.gif' } }
    }
    if (request.url.includes('/draft/add')) { draftBody = JSON.parse(request.body); return { status: 200, body: { media_id: 'draft-video' } } }
    return undefined
  }, {}, { async convertVideoToGif(source) { convertedSource = source; return { ...gif.claim, bytes: gif.bytes } } })
  const receipt = await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  assert.equal(convertedSource, 'https://video.example.test/demo.mp4')
  assert.equal(receipt.status, 'created'); assert.equal(receipt.truncated, 0)
  assert.match(draftBody.articles[0].content, /https:\/\/mmbiz\.qpic\.cn\/video\.gif/u)
  assert.doesNotMatch(draftBody.articles[0].content, /video\.example|&lt;video|<video/iu)
})

test('failed news video conversion silently removes the video while later image publication continues', async () => {
  const image = media('video-failure-cover')
  const value = artifact(`<video src="https://video.example.test/fail.mp4"></video>\n\n![封面](prismflow-media:${image.claim.assetId})`, [image])
  let draftBody
  const run = fixture('news', value, [image], request => {
    if (request.url.includes('/draft/add')) { draftBody = JSON.parse(request.body); return { status: 200, body: { media_id: 'draft-without-video' } } }
    return undefined
  }, {}, { async convertVideoToGif() { throw new Error('ffmpeg detail') } })
  const receipt = await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  assert.equal(receipt.truncated, 0); assert.equal(receipt.omittedMedia, 1)
  assert.doesNotMatch(draftBody.articles[0].content, /video\.example|PF_WECHAT_IMAGE_0|ffmpeg detail/u)
})

test('existing mmbiz.qpic.cn images are retained without CDN re-upload and an uploaded later image supplies the cover', async () => {
  const image = media('mmbiz-cover')
  const existing = 'http://mmbiz.qpic.cn/mmbiz_png/example/640?wx_fmt=png'
  const value = artifact(`![已有](${existing})\n\n![封面](prismflow-media:${image.claim.assetId})`, [image])
  let draftBody
  const run = fixture('news', value, [image], request => {
    if (request.url.includes('/draft/add')) { draftBody = JSON.parse(request.body); return { status: 200, body: { media_id: 'draft-mmbiz' } } }
    return undefined
  })
  await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  assert.equal(run.requests.filter(request => request.url.includes('/media/uploadimg')).length, 1)
  assert.match(draftBody.articles[0].content, /https:\/\/mmbiz\.qpic\.cn\/mmbiz_png\/example\/640\?wx_fmt=png/u)
})

test('configured canonical HTTPS API Base URL owns every WeChat API request path', async () => {
  const image = media('custom-api-base')
  const value = artifact(`![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const run = fixture('news', value, [image], undefined, { apiOrigin: 'https://wechat-gateway.example.test/v1' })
  await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  assert.ok(run.requests.length > 0)
  assert.ok(run.requests.every(request => request.url.startsWith('https://wechat-gateway.example.test/v1/cgi-bin/')))
})

test('HTTP WeChat compatibility gateway requires explicit insecure opt-in and owns every API request path', async () => {
  const apiOrigin = 'http://h3.justlikemaki.vip:3000/https/api.weixin.qq.com'
  const image = media('insecure-custom-api-base')
  const value = artifact(`![图](prismflow-media:${image.claim.assetId})\n`, [image])
  assert.throws(() => normalizePublisherConfig('wechat-draft', { destinations: [{ ...destination('news'), apiOrigin }] }), /HTTP requires allowInsecureHttp=1/u)
  const run = fixture('news', value, [image], undefined, { apiOrigin, allowInsecureHttp: 1 })
  await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  assert.ok(run.requests.length > 0)
  assert.ok(run.requests.every(request => request.url.startsWith(`${apiOrigin}/cgi-bin/`)))
})

test('default transport disables redirects for token, body image, material, and draft requests', async () => {
  const image = media('default-redirect-options')
  const value = artifact(`正文 ![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const provider = defaultTransportFixture('news', value, [image])
  const requests = []
  await withMockFetch(async (url, options) => {
    requests.push({ url: String(url), options })
    if (String(url).endsWith('/cgi-bin/stable_token')) return jsonResponse({ access_token: 'memory-token', expires_in: 7200 })
    if (String(url).includes('/media/uploadimg')) return jsonResponse({ url: 'https://mmbiz.qpic.cn/body-default' })
    if (String(url).includes('/material/add_material')) return jsonResponse({ media_id: 'material-default' })
    return jsonResponse({ media_id: 'draft-media-id' })
  }, () => provider.publishArtifact(value, [{ storeId: STORE_ID }], {}))

  for (const endpoint of ['/stable_token', '/uploadimg', '/add_material', '/draft/add']) {
    const request = requests.find(item => item.url.includes(endpoint))
    assert.ok(request, endpoint)
    assert.equal(request.options.method, 'POST')
    assert.equal(request.options.redirect, 'error')
    assert.equal(request.options.headers.connection, 'close')
    assert.equal(request.options.headers['content-length'], String(Buffer.byteLength(request.options.body)))
  }
})

test('default transport token redirect rejection is not committed and does not expose its URL or credential body', async () => {
  const image = media('default-token-redirect')
  const value = artifact(`![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const provider = defaultTransportFixture('news', value, [image])
  await withMockFetch(async (url, options) => {
    assert.equal(options.redirect, 'error')
    throw new Error(`redirect rejected for ${url}: ${options.body}`)
  }, async () => {
    await assert.rejects(provider.publishArtifact(value, [{ storeId: STORE_ID }], {}), error => {
      assert.equal(error.outcome, 'not-committed')
      assert.equal(error.operation, 'token')
      const exposed = [error.message, error.stack, error.cause?.message, JSON.stringify(error)].filter(Boolean).join('\n')
      assert.doesNotMatch(exposed, /api\.weixin\.qq\.com|stable_token|wxfixture|app-secret-value|redirect rejected/u)
      return true
    })
  })
})

test('deployment retry policy permits an unknown draft result without exposing its token URL or article body', async () => {
  const image = media('default-draft-redirect')
  const value = artifact(`敏感正文 ![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const provider = defaultTransportFixture('news', value, [image])
  await withMockFetch(async (url, options) => {
    const target = String(url)
    assert.equal(options.redirect, 'error')
    if (target.endsWith('/cgi-bin/stable_token')) return jsonResponse({ access_token: 'sensitive-access-token', expires_in: 7200 })
    if (target.includes('/media/uploadimg')) return jsonResponse({ url: 'https://mmbiz.qpic.cn/body-default' })
    if (target.includes('/material/add_material')) return jsonResponse({ media_id: 'material-default' })
    throw new Error(`redirect rejected for ${target}: ${options.body}`)
  }, async () => {
    await assert.rejects(provider.publishArtifact(value, [{ storeId: STORE_ID }], {}), error => {
      assert.equal(error.outcome, 'not-committed')
      assert.equal(error.operation, 'draft-create')
      assert.equal(error.externalOutcomeUnknown, true)
      const exposed = [error.message, error.stack, error.cause?.message, JSON.stringify(error)].filter(Boolean).join('\n')
      assert.doesNotMatch(exposed, /api\.weixin\.qq\.com|draft\/add|sensitive-access-token|敏感正文|精确标题|redirect rejected/u)
      return true
    })
  })
})

test('malformed draft success preserves unknown audit metadata while all deployment-policy failures allow retry', async () => {
  const image = media('outcome')
  const value = artifact(`![图](prismflow-media:${image.claim.assetId})\n`, [image])
  for (const [draftBody, externalOutcomeUnknown] of [[{}, true], [{ errcode: 45009, errmsg: 'secret backend detail', rid: 'safe-rid' }, false]]) {
    const run = fixture('news', value, [image], request => request.url.includes('/draft/add') ? { status: 200, body: draftBody } : undefined)
    await assert.rejects(run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {}), error => {
      assert.equal(error.outcome, 'not-committed'); assert.equal(error.operation, 'draft-create')
      assert.equal(error.externalOutcomeUnknown, externalOutcomeUnknown)
      assert.equal(error.message.includes('secret backend detail'), false)
      return true
    })
  }
})


test('intermediate image uncertainty is definitely not a draft commit while final draft uncertainty remains fail closed', async () => {
  const image = media('truth')
  const value = artifact(`![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const cases = [
    ['token-http', 'not-committed', request => request.url.endsWith('/stable_token') ? { status: 503, body: {} } : undefined],
    ['first-semantic', 'not-committed', request => request.url.includes('/uploadimg') ? { status: 200, body: { errcode: 40009, errmsg: 'too large' } } : undefined],
    ['first-http', 'not-committed', request => request.url.includes('/uploadimg') ? { status: 503, body: {} } : undefined],
    ['first-invalid', 'not-committed', request => request.url.includes('/uploadimg') ? { status: 200, body: null } : undefined],
    ['first-transport', 'not-committed', request => { if (request.url.includes('/uploadimg')) throw new Error('socket secret'); }],
  ]
  for (const [label, outcome, override] of cases) {
    const run = fixture('news', value, [image], override)
    await assert.rejects(run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {}), error => {
      assert.equal(error.outcome, outcome, label)
      assert.equal(error.message.includes('socket secret'), false)
      return true
    })
  }
})

test('40001, 40014, and 42001 refresh once for body upload, material upload, and draft add', async () => {
  const image = media('refresh')
  const value = artifact(`正文 ![图](prismflow-media:${image.claim.assetId})\n`, [image])
  for (const [code, endpoint] of [[40001, '/uploadimg'], [40014, '/add_material'], [42001, '/draft/add']]) {
    let rejected = false
    const run = fixture('news', value, [image], request => {
      if (request.url.includes(endpoint) && !rejected) { rejected = true; return { status: 200, body: { errcode: code, errmsg: 'token invalid' } } }
      return undefined
    })
    const receipt = await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
    assert.equal(receipt.status, 'created')
    assert.equal(run.requests.filter(request => request.url.endsWith('/stable_token')).length, 2, `${code} token calls`)
    assert.equal(run.requests.filter(request => request.url.includes(endpoint)).length, 2, `${code} operation calls`)
  }
})

test('unknown intermediate media transport retries three times through the same Profile API without retrying draft/add', async () => {
  const image = media('unknown-media-retry')
  const value = artifact(`正文 ![图](prismflow-media:${image.claim.assetId})\n`, [image])
  let failures = 0
  const apiOrigin = 'http://h3.justlikemaki.vip:3000/https/api.weixin.qq.com'
  const run = fixture('news', value, [image], request => {
    if (request.url.includes('/uploadimg') && failures < 3) { failures += 1; throw new Error('gateway timeout') }
    return undefined
  }, { apiOrigin, allowInsecureHttp: 1, limits: { requestTimeoutMs: 90_000 } })
  const receipt = await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  assert.equal(receipt.status, 'created')
  const uploads = run.requests.filter(request => request.url.includes('/uploadimg'))
  assert.equal(uploads.length, 4)
  assert.ok(uploads.every(request => request.timeoutMs === 90_000))
  assert.ok(run.requests.every(request => request.url.startsWith(`${apiOrigin}/cgi-bin/`)))
  assert.equal(run.requests.filter(request => request.url.includes('/draft/add')).length, 1)
})

test('explicit WeChat system-busy errcode -1 retries twice without refreshing the token', async () => {
  const image = media('system-busy')
  const value = artifact(`正文 ![图](prismflow-media:${image.claim.assetId})\n`, [image])
  let busy = 0
  const run = fixture('news', value, [image], request => {
    if (request.url.includes('/uploadimg') && busy < 2) { busy += 1; return { status: 200, body: { errcode: -1, errmsg: 'system busy' } } }
    return undefined
  })
  const receipt = await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
  assert.equal(receipt.status, 'created'); assert.equal(run.requests.filter(request => request.url.includes('/uploadimg')).length, 3)
  assert.equal(run.requests.filter(request => request.url.endsWith('/stable_token')).length, 1)
})

test('token refresh retry is bounded while acknowledged prior uploads do not taint a later definite rejection as unknown', async () => {
  const image = media('bounded-refresh')
  const value = artifact(`正文 ![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const run = fixture('news', value, [image], request => request.url.includes('/add_material')
    ? { status: 200, body: { errcode: 40014, errmsg: 'still invalid' } } : undefined)
  await assert.rejects(run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {}), error => error.outcome === 'not-committed'
    && error.operation === 'material-upload' && /no successfully uploaded cover/u.test(error.message))
  assert.equal(run.requests.filter(request => request.url.includes('/add_material')).length, 2)
  assert.equal(run.requests.filter(request => request.url.endsWith('/stable_token')).length, 2)
})

test('final substituted news content enforces character and UTF-8 byte limits after body upload', async () => {
  const image = media('final-limit')
  const value = artifact(`![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const run = fixture('news', value, [image], request => request.url.includes('/uploadimg')
    ? { status: 200, body: { url: `https://mmbiz.qpic.cn/${'x'.repeat(500)}` } } : undefined,
  { limits: { contentChars: 200, contentBytes: 400 } })
  await assert.rejects(run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {}), error => {
    assert.equal(error.outcome, 'not-committed')
    assert.equal(error.operation, 'draft-create')
    return true
  })
  assert.equal(run.requests.some(request => request.url.includes('/draft/add')), false)
  assert.equal(run.requests.some(request => request.url.includes('/add_material')), false)
})

test('final substituted news content independently enforces its UTF-8 byte ceiling after upload', async () => {
  const image = media('final-byte-limit')
  const value = artifact(`${'汉'.repeat(800)} ![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const run = fixture('news', value, [image], undefined, { limits: { contentChars: 10_000, contentBytes: 2_048 } })
  await assert.rejects(run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {}), error => error.outcome === 'not-committed' && error.operation === 'draft-create')
  assert.equal(run.requests.some(request => request.url.includes('/uploadimg')), true)
  assert.equal(run.requests.some(request => request.url.includes('/draft/add')), false)
  assert.equal(run.requests.some(request => request.url.includes('/add_material')), false)
})

test('newspic image-only content is deterministic, nonempty, escaped, and entity-decoded tag payloads remain text', async () => {
  const image = media('newspic-text')
  const publisherId = 'wechat-draft:account-newspic'
  for (const [markdown, expected] of [
    [`![图](prismflow-media:${image.claim.assetId})\n`, '精确标题\napproved digest'],
    [`&#60;img src=x onerror=alert(1)&#62;\n\n![图](prismflow-media:${image.claim.assetId})\n`, '&lt;img src=x onerror=alert(1)&gt;'],
    [`&lt;script&gt;alert(1)&lt;/script&gt;\n\n![图](prismflow-media:${image.claim.assetId})\n`, '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ]) {
    const value = artifact(markdown, [image], [{ publisherId, digest: 'approved digest' }])
    const run = fixture('newspic', value, [image])
    await run.provider.publishArtifact(value, [{ storeId: STORE_ID }], {})
    const content = JSON.parse(run.requests.find(request => request.url.includes('/draft/add')).body).articles[0].content
    assert.equal(content, expected)
    assert.ok(content.length > 0)
    assert.doesNotMatch(content, /<\/?(?:img|script)\b/iu)
  }
})

test('image URL replacement targets only the exact generated img src marker despite a literal token collision before the image', () => {
  const source = 'https://cdn.example.test/a.png'
  const sourceHash = createHash('sha256').update(`0\u0000${source}`).digest('hex')
  const literal = `PF_WECHAT_IMAGE_0_${sourceHash}_PLACEHOLDER`
  const rendered = renderWechatMarkdown(`${literal}\n\n![图](${source})`)
  assert.equal(rendered.images[0].placeholder, literal)
  const html = replaceWechatImageUrls(rendered, ['https://mmbiz.qpic.cn/safe'])
  assert.match(html, new RegExp(`<p[^>]*>${literal}</p>`))
  assert.match(html, /<img src="https:\/\/mmbiz\.qpic\.cn\/safe"/)
})

test('apply registers fixed article-type UI labels and unload unregisters and closes the provider', async () => {
  let registered
  let unregistered = false
  let cleanup
  const ctx = {
    prismPublishers: { register(provider) { registered = provider; return () => { unregistered = true } } },
    effect(setup, label) { assert.equal(label, 'prismflow-publisher-wechat-draft:account-news'); cleanup = setup() },
  }
  await apply(ctx, { destinations: [destination('news')] })
  assert.equal(registered.id, 'wechat-draft:account-news')
  assert.equal(registered.articleType, 'news')
  assert.match(registered.description, /news item.*draft box/i)
  await cleanup()
  assert.equal(unregistered, true)
})

test('cancellation after an acknowledged intermediate upload is definitely not committed and provider close drains safely', async () => {
  const image = media('cancel')
  const value = artifact(`![图](prismflow-media:${image.claim.assetId})\n`, [image])
  const controller = new AbortController()
  const run = fixture('news', value, [image], request => {
    if (request.url.includes('/uploadimg')) {
      controller.abort(new Error('sensitive cancellation'))
      return { status: 200, body: { url: 'https://mmbiz.qpic.cn/uploaded' } }
    }
    return undefined
  })
  await assert.rejects(run.provider.publishArtifact(value, [{ storeId: STORE_ID }], { signal: controller.signal }), error => {
    assert.equal(error.outcome, 'not-committed')
    assert.equal(error.message.includes('sensitive'), false)
    return true
  })
  await run.provider.close()
})
