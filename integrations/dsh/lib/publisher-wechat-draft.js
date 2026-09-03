import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import sharp from 'sharp'
import { createManagedMediaFetch } from './secure-rss-fetch.js'
import { isPublisherOutcomeError, PublisherOutcomeError } from './shared/publisher-outcome.js'
import { normalizePublisherConfig, publisherConfigRevision } from './shared/publisher-profile.js'
import { resolveFfmpegPath } from './ffmpeg-runtime.js'
import {
  destinationPresentation, orderedNewspicAssetIds, renderNewspicContent, renderWechatMarkdown, replaceWechatImageUrls,
  resolveWechatText, validateWechatContent, validateWechatCrops,
} from './shared/wechat-publisher.js'

export const name = 'prismflow-publisher-wechat-draft'
export const inject = ['credentials', 'prismPublishers', 'prismProduction', 'prismProductionMedia']

const OFFICIAL_ORIGIN = 'https://api.weixin.qq.com'
const TOKEN_EXPIRY_CODES = new Set([40001, 40014, 42001])
const API_PATHS = Object.freeze({
  token: '/cgi-bin/stable_token', bodyImage: '/cgi-bin/media/uploadimg', materialImage: '/cgi-bin/material/add_material', draft: '/cgi-bin/draft/add',
})

const Limits = Schema.object({
  titleChars: Schema.number().step(1).min(1).max(32).default(32),
  authorChars: Schema.number().step(1).min(1).max(16).default(16),
  digestChars: Schema.number().step(1).min(1).max(120).default(120),
  contentChars: Schema.number().step(1).min(1_000).max(1_000_000).default(20_000),
  contentBytes: Schema.number().step(1).min(2_048).max(1_000_000).default(1_000_000),
  maxImages: Schema.number().step(1).min(1).max(20).default(20),
  bodyImageBytes: Schema.number().step(1).min(1_024).max(999_999).default(999_999),
  permanentImageBytes: Schema.number().step(1).min(1_024).max(10 * 1024 * 1024).default(10 * 1024 * 1024),
  maxPixels: Schema.number().step(1).min(1).max(100_000_000).default(25_000_000),
  maxSourceBytes: Schema.number().step(1).min(1_024).max(32 * 1024 * 1024).default(10 * 1024 * 1024),
  fetchTimeoutMs: Schema.number().step(1).min(100).max(120_000).default(15_000),
  requestTimeoutMs: Schema.number().step(1).min(100).max(120_000).default(30_000),
  concurrency: Schema.number().step(1).min(1).max(8).default(1),
})

const Destination = Schema.object({
  id: Schema.string().required(), name: Schema.string().required(), appId: Schema.string().required(),
  appSecretCredential: Schema.string().role('credential-ref').required(), apiOrigin: Schema.string().default(OFFICIAL_ORIGIN),
  allowInsecureHttp: Schema.number().step(1).min(0).max(1).default(0),
  tokenMode: Schema.union(['stable']).default('stable'), articleType: Schema.union(['news', 'newspic']).required(),
  defaultAuthor: Schema.string().default(''),
  digestPolicy: Schema.union(['omit', 'plain-text-excerpt', 'artifact-or-omit', 'artifact-or-plain-text-excerpt']).default('artifact-or-omit'),
  needOpenComment: Schema.number().step(1).min(0).max(1).default(1), onlyFansCanComment: Schema.number().step(1).min(0).max(1).default(0),
  defaultCoverAssetRef: Schema.string().default(''), ffmpegPath: Schema.string(), limits: Limits,
})
export const Config = Schema.object({ destinations: Schema.array(Destination).default([]) })

function throwIfAborted(signal, operation = 'token', mutationState) {
  if (signal?.aborted) throw new PublisherOutcomeError(mutationState?.possible ? 'unknown' : 'not-committed', operation,
    mutationState?.possible ? 'WeChat draft publication was cancelled after a possible network mutation' : 'WeChat draft publication was cancelled before a network mutation')
}

function profile(destination) {
  return {
    articleType: destination.articleType, defaultAuthor: destination.defaultAuthor ?? '', digestPolicy: destination.digestPolicy,
    needOpenComment: destination.needOpenComment, onlyFansCanComment: destination.onlyFansCanComment,
    limits: { titleChars: destination.limits.titleChars, authorChars: destination.limits.authorChars,
      digestChars: destination.limits.digestChars, contentChars: destination.limits.contentChars,
      contentBytes: destination.limits.contentBytes, maxImages: destination.limits.maxImages },
  }
}

function assertDestination(destination, seen) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(destination.id) || seen.has(destination.id)) throw new Error(`Invalid or duplicate WeChat destination id: ${destination.id}`)
  if (!/^wx[a-zA-Z0-9]{1,126}$/u.test(destination.appId) || typeof destination.appSecretCredential !== 'string' || !destination.appSecretCredential.trim()) {
    throw new Error(`WeChat destination ${destination.id} identity is invalid`)
  }
  let origin
  try { origin = new URL(destination.apiOrigin) } catch { throw new Error(`WeChat destination ${destination.id} API origin is invalid`) }
  const allowedProtocol = origin.protocol === 'https:' || (origin.protocol === 'http:' && destination.allowInsecureHttp === 1)
  if (!allowedProtocol || origin.username || origin.password || origin.search || origin.hash
    || destination.apiOrigin !== `${origin.origin}${origin.pathname.replace(/\/+$/u, '')}`) {
    throw new Error('Production WeChat destinations must use a canonical credential-free HTTP(S) API Base URL; HTTP requires explicit insecure transport opt-in')
  }
  if (typeof destination.defaultAuthor !== 'string' || Array.from(destination.defaultAuthor).length > destination.limits.authorChars
    || /[\u0000-\u001f\u007f]/u.test(destination.defaultAuthor)) throw new Error(`WeChat destination ${destination.id} default author is invalid`)
  if (destination.ffmpegPath !== undefined && (typeof destination.ffmpegPath !== 'string' || destination.ffmpegPath.length > 1_024
    || /[\u0000-\u001f\u007f]/u.test(destination.ffmpegPath))) throw new Error(`WeChat destination ${destination.id} FFmpeg path is invalid`)
  seen.add(destination.id)
}

function presentationCoverAssetId(presentation) { return presentation?.cover?.assetId ?? presentation?.imageOrder?.[0] }
function configuredCoverUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash ? parsed.toString() : undefined
  } catch { return undefined }
}

function credentialValue(credential) {
  return typeof credential?.value === 'string' && credential.value.length > 0 && credential.value.length <= 16 * 1024 ? credential.value : undefined
}

function safeRid(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined
}

export class WechatApiError extends PublisherOutcomeError {
  constructor(outcome, operation, code, rid) {
    super(outcome, operation, `WeChat ${operation} failed${Number.isInteger(code) ? ` (${code})` : ''}`)
    this.name = 'WechatApiError'; this.errcode = code; this.rid = safeRid(rid)
  }
}

function apiError(body, operation, outcome) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const code = Number(body.errcode ?? 0)
  return Number.isInteger(code) && code !== 0 ? new WechatApiError(outcome, operation, code, body.rid) : undefined
}

async function defaultTransport(request) {
  const controller = new AbortController()
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(new Error('WeChat request timeout')), request.timeoutMs)
  try {
    const headers = { ...request.headers, connection: 'close' }
    if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) headers['content-length'] = String(Buffer.byteLength(request.body))
    const response = await fetch(request.url, { method: 'POST', headers, body: request.body, signal, redirect: 'error' })
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > 2 * 1024 * 1024) throw new Error('WeChat response is too large')
    let body
    try { body = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('WeChat returned malformed JSON') }
    return { status: response.status, body }
  } finally { clearTimeout(timer) }
}

async function requestJson(transport, request, operation, mutating, mutationState) {
  throwIfAborted(request.signal, operation, mutationState)
  const priorPossibleMutation = mutationState.possible
  if (mutating) mutationState.possible = true
  let response
  try { response = await transport(request) }
  catch (error) {
    if (error instanceof PublisherOutcomeError) throw error
    throw new PublisherOutcomeError(mutationState.possible ? 'unknown' : 'not-committed', operation,
      mutationState.possible ? `WeChat ${operation} transport outcome is unknown` : `WeChat ${operation} request failed`)
  }
  if (!response || !Number.isInteger(response.status) || !response.body || typeof response.body !== 'object' || Array.isArray(response.body)) {
    throw new PublisherOutcomeError(mutationState.possible ? 'unknown' : 'not-committed', operation, `WeChat ${operation} returned an invalid response`)
  }
  const code = Number(response.body.errcode ?? 0)
  if (Number.isInteger(code) && code !== 0) {
    if (mutating) mutationState.possible = priorPossibleMutation
    throw apiError(response.body, operation, mutationState.possible ? 'unknown' : 'not-committed')
  }
  if (response.status < 200 || response.status >= 300) {
    throw new WechatApiError(mutationState.possible ? 'unknown' : 'not-committed', operation, response.status, response.body.rid)
  }
  if (mutating) mutationState.possible = priorPossibleMutation
  return response.body
}

function multipartImage(media) {
  const boundary = `----WebKitFormBoundary${createHash('sha256').update(media.sha256).digest('hex').slice(0, 16)}`
  const extension = media.mime === 'image/png' ? 'png' : media.mime === 'image/gif' ? 'gif' : 'jpg'
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${media.sha256}.${extension}"\r\nContent-Type: ${media.mime}\r\n\r\n`, 'utf8')
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  return { body: Buffer.concat([head, media.bytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` }
}

const SHARP_IMAGE_MIMES = Object.freeze({ jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heif: 'image/avif' })

async function processFetchedImage(bytes, contentType, destination, operation) {
  const declaredMime = String(contentType ?? '').split(';', 1)[0].trim().toLowerCase()
  let metadata
  try { metadata = await sharp(bytes, { limitInputPixels: destination.limits.maxPixels, animated: true }).metadata() }
  catch { throw new PublisherOutcomeError('not-committed', operation, 'WeChat image could not be decoded safely') }
  const detectedMime = SHARP_IMAGE_MIMES[metadata.format]
  if (!detectedMime || declaredMime !== detectedMime || !metadata.width || !metadata.height
    || metadata.width * metadata.height > destination.limits.maxPixels) {
    throw new PublisherOutcomeError('not-committed', operation, 'WeChat image MIME, dimensions, or bytes are invalid')
  }

  const byteLimit = operation === 'body-upload' ? destination.limits.bodyImageBytes : destination.limits.permanentImageBytes
  const convertToJpeg = ['image/avif', 'image/webp'].includes(detectedMime)
    || detectedMime === 'image/bmp' || bytes.length > byteLimit && detectedMime !== 'image/gif'
  let processed = bytes
  let mime = detectedMime
  if (convertToJpeg) {
    try {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const quality = Math.max(45, 85 - attempt * 7)
        const width = attempt < 5 ? metadata.width : Math.max(320, Math.floor(metadata.width * (0.84 ** (attempt - 4))))
        processed = await sharp(bytes, { limitInputPixels: destination.limits.maxPixels })
          .rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer()
        if (processed.length <= byteLimit) break
      }
      mime = 'image/jpeg'
    } catch { throw new PublisherOutcomeError('not-committed', operation, 'WeChat image conversion failed') }
  }
  if (processed.length > byteLimit) throw new PublisherOutcomeError('not-committed', operation, 'WeChat image exceeds its configured byte limit after conversion')
  const sha256 = createHash('sha256').update(processed).digest('hex')
  return { assetId: sha256, sha256, bytes: processed, mime, width: metadata.width, height: metadata.height }
}

function compatibilityMediaLabel(source, position) {
  let host = 'unknown-host'
  try { host = new URL(source).hostname.toLowerCase().slice(0, 253) } catch { /* renderer already validated the URL */ }
  return `${position ?? 'image'} @ ${host}`
}

async function fetchCompatibilityImage(source, destination, execution, fetchMedia, operation, position) {
  const mediaLabel = compatibilityMediaLabel(source, position)
  let response
  try { response = await fetchMedia(source, { kind: 'image', signal: execution.signal }) }
  catch {
    if (execution.signal?.aborted) throw new PublisherOutcomeError('not-committed', operation, 'WeChat image fetch was cancelled')
    throw new PublisherOutcomeError('not-committed', operation, `Approved compatibility ${operation === 'material-upload' ? 'cover' : 'body'} image could not be fetched safely (${mediaLabel})`)
  }
  try { return await processFetchedImage(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type'), destination, operation) }
  catch (error) {
    if (error instanceof PublisherOutcomeError && error.operation === operation) throw error
    throw new PublisherOutcomeError('not-committed', operation, `Approved compatibility ${operation === 'material-upload' ? 'cover' : 'body'} image is invalid`)
  }
}

async function resolveImage(ctx, artifact, publisherId, image, destination, execution, fetchMedia, position) {
  if (image.assetId) {
    let value
    try { value = await ctx.prismProduction.resolveArtifactMedia(publisherId, artifact, image.assetId) }
    catch { throw new PublisherOutcomeError('not-committed', 'body-upload', 'Approved Production media could not be resolved') }
    if (!value || !Buffer.isBuffer(value.bytes) || createHash('sha256').update(value.bytes).digest('hex') !== image.assetId
      || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width * value.height > destination.limits.maxPixels) {
      throw new PublisherOutcomeError('not-committed', 'body-upload', 'Approved Production media could not be resolved')
    }
    return value
  }
  if (artifact.artifactBindingSha256) throw new PublisherOutcomeError('not-committed', 'body-upload', 'Artifact v2 images must use persisted asset references')
  return fetchCompatibilityImage(image.source, destination, execution, fetchMedia, 'body-upload', position)
}

async function normalizeBodyImage(media, destination) {
  let pipeline
  let metadata
  try {
    pipeline = sharp(media.bytes, { failOn: 'error', limitInputPixels: destination.limits.maxPixels, animated: false })
    metadata = await pipeline.metadata()
  } catch { throw new PublisherOutcomeError('not-committed', 'body-upload', 'WeChat body image decoding failed') }
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height) || metadata.width * metadata.height > destination.limits.maxPixels) {
    throw new PublisherOutcomeError('not-committed', 'body-upload', 'WeChat body image exceeds the configured pixel limit')
  }
  const target = Math.min(destination.limits.bodyImageBytes, 999_999)
  const detectedMime = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'png' ? 'image/png' : undefined
  if (detectedMime === media.mime && media.bytes.length <= target && media.bytes.length < 1_000_000) {
    return { ...media, width: metadata.width, height: metadata.height }
  }
  const attempts = [
    { scale: 1, quality: 88 }, { scale: 1, quality: 76 }, { scale: 0.85, quality: 76 },
    { scale: 0.7, quality: 72 }, { scale: 0.55, quality: 68 }, { scale: 0.4, quality: 64 },
  ]
  for (const attempt of attempts) {
    try {
      const width = Math.max(1, Math.floor(metadata.width * attempt.scale))
      const height = Math.max(1, Math.floor(metadata.height * attempt.scale))
      let image = sharp(media.bytes, { failOn: 'error', limitInputPixels: destination.limits.maxPixels, animated: false }).rotate().resize(width, height, { fit: 'fill' })
      let bytes
      let mime
      if (metadata.hasAlpha && attempt.scale === 1 && attempt.quality === 88) {
        bytes = await image.png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer(); mime = 'image/png'
      } else {
        bytes = await image.flatten({ background: '#ffffff' }).jpeg({ quality: attempt.quality, progressive: false, chromaSubsampling: '4:2:0' }).toBuffer(); mime = 'image/jpeg'
      }
      if (bytes.length <= target && bytes.length < 1_000_000) {
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        return { assetId: sha256, sha256, bytes, mime, width, height }
      }
    } catch { /* try the next deterministic bounded representation */ }
  }
  throw new PublisherOutcomeError('not-committed', 'body-upload', 'WeChat body image could not be normalized under its byte limit')
}

async function uploadImage(api, token, media, operation, destination, execution, returnMaterialUrl = false) {
  const limit = operation === 'body-upload' ? destination.limits.bodyImageBytes : destination.limits.permanentImageBytes
  if (!Buffer.isBuffer(media.bytes) || media.bytes.length >= (operation === 'body-upload' ? 1_000_000 : limit + 1) || media.bytes.length > limit
    || Number.isInteger(media.width) && Number.isInteger(media.height) && media.width * media.height > destination.limits.maxPixels
    || operation === 'body-upload' && !['image/jpeg', 'image/png'].includes(media.mime)) {
    throw new PublisherOutcomeError('not-committed', operation, `WeChat ${operation} image violates its configured format or byte limit`)
  }
  const multipart = multipartImage(media)
  const path = operation === 'body-upload' ? API_PATHS.bodyImage : `${API_PATHS.materialImage}?type=image`
  const joiner = path.includes('?') ? '&' : '?'
  const body = await api({ path: `${path}${joiner}access_token=${encodeURIComponent(token)}`, body: multipart.body,
    headers: { 'content-type': multipart.contentType }, signal: execution.signal,
    timeoutMs: destination.limits.requestTimeoutMs }, operation, true)
  if (operation === 'body-upload') {
    if (typeof body.url !== 'string' || body.url.length > 2_048) throw new PublisherOutcomeError('unknown', operation, 'WeChat body upload returned an invalid success response')
    try { const url = new URL(body.url); if (url.protocol !== 'https:' || url.username || url.password) throw new Error() }
    catch { throw new PublisherOutcomeError('unknown', operation, 'WeChat body upload returned an unsafe URL') }
    return body.url
  }
  if (typeof body.media_id !== 'string' || body.media_id.length < 1 || body.media_id.length > 128 || /[\u0000-\u001f\u007f]/u.test(body.media_id)) {
    throw new PublisherOutcomeError('unknown', operation, 'WeChat material upload returned an invalid success response')
  }
  if (!returnMaterialUrl) return body.media_id
  const candidate = typeof body.url === 'string' ? body.url.replace(/^http:\/\//iu, 'https://') : ''
  let url
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || candidate.length > 2_048) throw new Error()
    url = parsed.toString()
  } catch { throw new PublisherOutcomeError('unknown', operation, 'WeChat material upload returned an invalid media URL') }
  return { mediaId: body.media_id, url }
}

function decodeVideoSource(value) {
  return value.replace(/&#x([0-9a-f]+);/giu, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/gu, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll('&amp;', '&')
}

function prepareWechatVideos(markdown, articleType) {
  const videos = new Map()
  let index = 0
  const prepared = markdown.replace(/<video[^>]*>([\s\S]*?)<\/video>|<video[^>]*\/>/giu, block => {
    if (articleType === 'newspic') return ''
    const source = /(?:src|data-src)=["']([^"']+)["']/iu.exec(block)?.[1]
      ?? /<source[^>]+src=["']([^"']+)["']/iu.exec(block)?.[1]
    if (!source) return block
    const decoded = decodeVideoSource(source)
    const synthetic = `https://prismflow.invalid/wechat-video-${index}-${createHash('sha256').update(decoded).digest('hex').slice(0, 24)}.gif`
    videos.set(synthetic, decoded)
    index += 1
    return `![视频](${synthetic})`
  })
  return { markdown: prepared, videos }
}

function isWechatCdnImage(source) {
  if (typeof source !== 'string') return undefined
  try {
    const parsed = new URL(source)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname.toLowerCase() !== 'mmbiz.qpic.cn'
      || parsed.username || parsed.password || parsed.hash) return undefined
    parsed.protocol = 'https:'
    return parsed.toString()
  } catch { return undefined }
}

async function runFfmpegGif(ffmpegPath, inputPath, outputPath, timeoutMs, signal) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-y', '-t', '5', '-i', inputPath, '-threads', '2', '-vf',
      'fps=8,scale=400:-1:flags=fast_bilinear,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=1',
      '-frames:v', '40', '-f', 'gif', outputPath], { shell: false, windowsHide: true, stdio: 'ignore' })
    let settled = false
    const finish = error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve()
    }
    const abort = () => { child.kill('SIGKILL'); finish(new Error('FFmpeg aborted')) }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('FFmpeg timeout')) }, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', finish)
    child.once('exit', code => finish(code === 0 ? undefined : new Error('FFmpeg failed')))
    if (signal?.aborted) abort()
  })
}

async function convertVideoToGif(source, destination, execution, fetchMedia) {
  if (typeof source !== 'string' || source.startsWith('blob:') || source.includes('mmbiz.qpic.cn')) {
    throw new PublisherOutcomeError('not-committed', 'material-upload', 'WeChat video source is not convertible')
  }
  let response
  try { response = await fetchMedia(source, { kind: 'video', signal: execution.signal }) }
  catch { throw new PublisherOutcomeError('not-committed', 'material-upload', 'WeChat video could not be fetched safely') }
  const directory = await mkdtemp(join(tmpdir(), 'prismflow-wechat-video-'))
  try {
    const input = join(directory, 'input-video')
    const output = join(directory, 'output.gif')
    await writeFile(input, Buffer.from(await response.arrayBuffer()), { flag: 'wx' })
    const configuredFfmpeg = destination.ffmpegPath?.trim() || execution.ffmpegPath || ''
    await runFfmpegGif(await resolveFfmpegPath(configuredFfmpeg), input, output, destination.limits.requestTimeoutMs, execution.signal)
    const bytes = await readFile(output)
    if (!bytes.length || bytes.length > destination.limits.permanentImageBytes) throw new Error('GIF size')
    const metadata = await sharp(bytes, { animated: true, limitInputPixels: destination.limits.maxPixels }).metadata()
    if (metadata.format !== 'gif' || !metadata.width || !metadata.height || metadata.width * metadata.height > destination.limits.maxPixels) throw new Error('GIF format')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return { assetId: sha256, sha256, bytes, mime: 'image/gif', width: metadata.width, height: metadata.height }
  } catch (error) {
    if (execution.signal?.aborted) throw error
    throw new PublisherOutcomeError('not-committed', 'material-upload', 'WeChat video could not be converted to a bounded GIF')
  } finally { await rm(directory, { recursive: true, force: true }).catch(() => {}) }
}

function omitFailedBodyImages(rendered, urls) {
  if (urls.length !== rendered.images.length) throw new Error('WeChat body image omission result count is invalid')
  let html = rendered.html
  const successfulImages = []
  const successfulUrls = []
  for (const [index, image] of rendered.images.entries()) {
    const url = urls[index]
    if (typeof url === 'string') { successfulImages.push(image); successfulUrls.push(url); continue }
    const escaped = image.placeholder.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const pattern = new RegExp(`<img\\b[^>]*src="${escaped}"[^>]*\\/?>`, 'u')
    const matches = html.match(pattern)
    if (!matches || matches.length !== 1) throw new Error('WeChat failed body image placeholder is missing or duplicated')
    html = html.replace(pattern, '')
  }
  html = html.replace(/<p\b[^>]*>\s*(?:<br\s*\/?>\s*)*<\/p>/giu, '')
  return replaceWechatImageUrls({ ...rendered, html, images: successfulImages }, successfulUrls)
}

function receipt(publisherId, artifact, records, destination, mediaId, uploads, omittedMedia = 0) {
  return {
    publisherId, status: 'created', itemCount: records.length, truncated: 0, omittedMedia,
    bytes: Buffer.byteLength(artifact.markdown, 'utf8'), sha256: artifact.artifactSha256,
    contentStoreIds: [...artifact.sourceContentStoreIds], draftId: artifact.draftId, draftVersion: artifact.draftVersion,
    artifactSha256: artifact.artifactSha256, ...(artifact.artifactBindingSha256 ? { artifactBindingSha256: artifact.artifactBindingSha256 } : {}),
    articleType: destination.articleType, wechatDraftMediaId: mediaId, operation: 'draft.add', verification: 'verified',
    publishedAt: new Date().toISOString(),
  }
}

export function createWechatDraftProvider(ctx, destination, dependencies = {}) {
  const publisherId = `wechat-draft:${destination.id}`
  const transport = dependencies.transport ?? defaultTransport
  const fetchMedia = dependencies.fetchMedia ?? createManagedMediaFetch({ maxResponseBytes: destination.limits.maxSourceBytes,
    requestTimeoutMs: destination.limits.fetchTimeoutMs, rejectFragments: true, requireHttps: false,
    // Match the original Axios source download request semantics while retaining DNS validation and socket pinning.
    originReferer: false, userAgent: 'axios/1.13.5', accept: 'application/json, text/plain, */*' })
  const videoConverter = (source, execution) => {
    const ffmpegPath = ctx.get?.('prismImageGenerationSettings')?.runtime?.().ffmpegPath ?? ''
    const effectiveExecution = { ...execution, ffmpegPath }
    return dependencies.convertVideoToGif
      ? dependencies.convertVideoToGif(source, effectiveExecution)
      : convertVideoToGif(source, destination, effectiveExecution, fetchMedia)
  }
  const tokenCache = new Map()
  let tail = Promise.resolve()
  const shutdownController = new AbortController()
  const enqueue = operation => { const result = tail.then(operation); tail = result.then(() => {}, () => {}); return result }

  function representArtifact(artifact) {
    let rendered
    let text
    let newspicAssetIds
    let videos
    try {
      const prepared = prepareWechatVideos(artifact.markdown, destination.articleType)
      videos = prepared.videos
      rendered = renderWechatMarkdown(prepared.markdown)
      text = resolveWechatText(profile(destination), artifact, publisherId, rendered)
      validateWechatCrops(destination.articleType, text.presentation)
      if (destination.articleType === 'newspic') newspicAssetIds = orderedNewspicAssetIds(rendered, text.presentation, destination.limits.maxImages)
    } catch (error) {
      if (error instanceof PublisherOutcomeError) throw error
      throw new PublisherOutcomeError('not-committed', 'draft-create', 'Approved Artifact cannot be represented by this WeChat Profile')
    }
    if (text.presentation?.cover?.crops?.length) throw new PublisherOutcomeError('not-committed', 'draft-create', 'WeChat cover crops are not enabled until the official payload is attested')
    if (destination.articleType === 'news') {
      const coverId = presentationCoverAssetId(text.presentation)
      const claimedCover = coverId && artifact.mediaAssets?.some(asset => asset.assetId === coverId)
      const deploymentCover = configuredCoverUrl(destination.defaultCoverAssetRef)
        || destination.defaultCoverAssetRef && ctx.prismProductionMedia?.hasDeploymentAsset?.(destination.defaultCoverAssetRef)
      if (!claimedCover && rendered.images.length === 0 && !deploymentCover) {
        throw new PublisherOutcomeError('not-committed', 'material-upload', 'WeChat news requires an approved body image, approved cover, or configured fallback cover')
      }
    }
    return { rendered, text, newspicAssetIds, videos }
  }

  async function operationInner(artifact, records, execution, mutationState) {
    throwIfAborted(execution.signal, 'token', mutationState)
    if (records.length !== artifact.sourceContentStoreIds.length || records.length === 0 && !artifact.workflowInputSha256) throw new PublisherOutcomeError('not-committed', 'token', 'WeChat publisher received invalid approved records or direct-input provenance')
    let credential
    try { credential = await ctx.credentials.resolve(destination.appSecretCredential) }
    catch { throw new PublisherOutcomeError('not-committed', 'token', 'WeChat credential resolution failed') }
    const secret = credentialValue(credential)
    if (!secret) throw new PublisherOutcomeError('not-committed', 'token', 'WeChat credential is not configured')
    const secretIdentity = createHash('sha256').update(secret).digest('hex')
    const cacheKey = `${destination.appId}:${secretIdentity}`
    for (const key of tokenCache.keys()) if (key.startsWith(`${destination.appId}:`) && key !== cacheKey) tokenCache.delete(key)
    const api = (request, apiOperation, mutating) => requestJson(transport, {
      url: `${destination.apiOrigin}${request.path}`, method: 'POST', headers: request.headers ?? { 'content-type': 'application/json; charset=utf-8' },
      body: request.body, signal: request.signal, timeoutMs: request.timeoutMs ?? destination.limits.requestTimeoutMs,
    }, apiOperation, mutating, mutationState)
    const getToken = async force => {
      const cached = tokenCache.get(cacheKey)
      if (!force && cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token
      const body = await api({ path: API_PATHS.token, body: JSON.stringify({ grant_type: 'client_credential', appid: destination.appId, secret }), signal: execution.signal }, 'token', false)
      if (typeof body.access_token !== 'string' || body.access_token.length < 1 || body.access_token.length > 2_048
        || !Number.isInteger(body.expires_in) || body.expires_in < 300 || body.expires_in > 86_400) throw new WechatApiError('not-committed', 'token', undefined, body.rid)
      tokenCache.set(cacheKey, { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1_000 })
      return body.access_token
    }
    const withTokenRetry = async callback => {
      let token = await getToken(false)
      let tokenRefreshed = false
      let transientRetries = 0
      let unknownMediaRetries = 0
      while (true) {
        try { return await callback(token) }
        catch (error) {
          if (error instanceof WechatApiError && TOKEN_EXPIRY_CODES.has(error.errcode) && !tokenRefreshed) {
            tokenCache.delete(cacheKey); token = await getToken(true); tokenRefreshed = true; continue
          }
          if (error instanceof PublisherOutcomeError && error.outcome === 'unknown'
            && ['body-upload', 'material-upload'].includes(error.operation) && unknownMediaRetries < 3) {
            // A media upload cannot create a draft. Retrying an uncertain upload can only leave an orphaned
            // WeChat media object, so clear this request's uncertainty and retry through the same Profile API.
            mutationState.possible = false
            unknownMediaRetries += 1
            await new Promise(resolve => setTimeout(resolve, 500 * (2 ** (unknownMediaRetries - 1))))
            throwIfAborted(execution.signal, error.operation, mutationState)
            continue
          }
          // A definite errcode -1 is WeChat's documented "system busy" rejection, not an unknown submission.
          if (error instanceof WechatApiError && error.outcome === 'not-committed' && error.errcode === -1 && transientRetries < 2) {
            transientRetries += 1
            await new Promise(resolve => setTimeout(resolve, 500 * (2 ** (transientRetries - 1))))
            throwIfAborted(execution.signal, error.operation, mutationState)
            continue
          }
          throw error
        }
      }
    }

    const { rendered, text, newspicAssetIds, videos } = representArtifact(artifact)

    let article
    let uploadCount = 0
    let omittedMedia = 0
    const omitMediaFailure = error => {
      if (execution.signal?.aborted || isPublisherOutcomeError(error) && error.operation === 'token') throw error
      // This intentionally restores the original publisher's fail-open behavior. Unknown media writes can
      // leave orphaned objects, but cannot create a draft, so they do not taint the later draft/add boundary.
      mutationState.possible = false
      omittedMedia += 1
    }
    if (destination.articleType === 'news') {
      const coverId = presentationCoverAssetId(text.presentation)
      let thumbMediaId
      const resolvedByDigest = new Map()
      const bodyUrls = Array(rendered.images.length)
      const bodyMedia = Array(rendered.images.length)
      for (const [index, image] of rendered.images.entries()) {
        try {
          const videoSource = videos.get(image.source)
          if (videoSource) {
            const gif = await videoConverter(videoSource, execution)
            const uploaded = await withTokenRetry(token => uploadImage(api, token, gif, 'material-upload', destination, execution, true))
            bodyUrls[index] = uploaded.url; uploadCount += 1
            continue
          }
          const existingWechatUrl = isWechatCdnImage(image.source)
          if (existingWechatUrl) { bodyUrls[index] = existingWechatUrl; continue }
          const media = await resolveImage(ctx, artifact, publisherId, image, destination, execution, fetchMedia,
            `body-image-${index + 1}-of-${rendered.images.length}`)
          let url = resolvedByDigest.get(media.sha256)
          if (!url) {
            const normalized = await normalizeBodyImage(media, destination)
            url = await withTokenRetry(token => uploadImage(api, token, normalized, 'body-upload', destination, execution))
            resolvedByDigest.set(media.sha256, url); uploadCount += 1
          }
          bodyUrls[index] = url
          bodyMedia[index] = media
        } catch (error) { omitMediaFailure(error) }
      }
      let content = omitFailedBodyImages(rendered, bodyUrls)
      try { validateWechatContent(profile(destination), content) }
      catch { throw new PublisherOutcomeError('not-committed', 'draft-create', 'Final WeChat article content exceeds its configured limit') }
      if (coverId) {
        try {
          const cover = await ctx.prismProduction.resolveArtifactMedia(publisherId, artifact, coverId)
          thumbMediaId = await withTokenRetry(token => uploadImage(api, token, cover, 'material-upload', destination, execution)); uploadCount += 1
        } catch (error) { omitMediaFailure(error) }
      }
      if (!thumbMediaId) {
        for (const [index, media] of bodyMedia.entries()) {
          if (!media || typeof bodyUrls[index] !== 'string') continue
          try {
            thumbMediaId = await withTokenRetry(token => uploadImage(api, token, media, 'material-upload', destination, execution)); uploadCount += 1; break
          } catch (error) {
            omitMediaFailure(error)
            bodyUrls[index] = undefined
          }
        }
      }
      if (!thumbMediaId && destination.defaultCoverAssetRef) {
        try {
          const coverUrl = configuredCoverUrl(destination.defaultCoverAssetRef)
          let cover
          if (coverUrl) cover = await fetchCompatibilityImage(coverUrl, destination, execution, fetchMedia, 'material-upload', 'fallback-cover')
          else if (typeof ctx.prismProductionMedia?.resolveDeploymentAsset === 'function') {
            cover = await ctx.prismProductionMedia.resolveDeploymentAsset(destination.defaultCoverAssetRef)
          }
          if (cover) { thumbMediaId = await withTokenRetry(token => uploadImage(api, token, cover, 'material-upload', destination, execution)); uploadCount += 1 }
        } catch (error) { omitMediaFailure(error) }
      }
      if (!thumbMediaId) throw new PublisherOutcomeError('not-committed', 'material-upload', 'WeChat news has no successfully uploaded cover after failed media were omitted')
      content = omitFailedBodyImages(rendered, bodyUrls)
      try { validateWechatContent(profile(destination), content) }
      catch { throw new PublisherOutcomeError('not-committed', 'draft-create', 'Final WeChat article content exceeds its configured limit') }
      article = { title: artifact.title, ...(text.author ? { author: text.author } : {}), ...(text.digest !== undefined ? { digest: text.digest } : {}),
        content, thumb_media_id: thumbMediaId,
        need_open_comment: destination.needOpenComment, only_fans_can_comment: destination.onlyFansCanComment }
    } else {
      const content = renderNewspicContent(artifact, text.digest, rendered)
      try { validateWechatContent(profile(destination), content) }
      catch { throw new PublisherOutcomeError('not-committed', 'draft-create', 'Final WeChat newspic content exceeds its configured limit') }
      const mediaIds = []
      for (const assetId of newspicAssetIds) {
        try {
          const media = await ctx.prismProduction.resolveArtifactMedia(publisherId, artifact, assetId)
          mediaIds.push(await withTokenRetry(token => uploadImage(api, token, media, 'material-upload', destination, execution))); uploadCount += 1
        } catch (error) { omitMediaFailure(error) }
      }
      if (!mediaIds.length) throw new PublisherOutcomeError('not-committed', 'material-upload', 'WeChat newspic has no successfully uploaded image after failed media were omitted')
      article = { article_type: 'newspic', title: artifact.title, ...(text.author ? { author: text.author } : {}), content,
        image_info: { image_list: mediaIds.map(image_media_id => ({ image_media_id })) },
        need_open_comment: destination.needOpenComment, only_fans_can_comment: destination.onlyFansCanComment }
    }
    const draftBody = JSON.stringify({ articles: [article] })
    if (Buffer.byteLength(draftBody, 'utf8') > 1_000_000) throw new PublisherOutcomeError('not-committed', 'draft-create', 'WeChat draft request exceeds the fixed transport ceiling')
    const result = await withTokenRetry(token => api({ path: `${API_PATHS.draft}?access_token=${encodeURIComponent(token)}`,
      body: draftBody, signal: execution.signal }, 'draft-create', true))
    if (typeof result.media_id !== 'string' || result.media_id.length < 1 || result.media_id.length > 128 || /[\u0000-\u001f\u007f]/u.test(result.media_id)) {
      throw new PublisherOutcomeError('unknown', 'draft-create', 'WeChat draft creation returned a malformed success response')
    }
    return receipt(publisherId, artifact, records, destination, result.media_id, uploadCount, omittedMedia)
  }

  async function operation(artifact, records, execution) {
    const mutationState = { possible: false }
    try { return await operationInner(artifact, records, execution, mutationState) }
    catch (error) {
      if (isPublisherOutcomeError(error) && error.outcome === 'unknown') {
        const beforeDraft = error.operation === 'body-upload' || error.operation === 'material-upload'
        throw new PublisherOutcomeError('not-committed', error.operation, beforeDraft
          ? `WeChat ${error.operation} did not complete before draft creation`
          : 'WeChat draft creation result is unknown; retry is allowed by deployment policy and may create a duplicate draft',
        { externalOutcomeUnknown: true })
      }
      if (!mutationState.possible) throw error
      const operationName = isPublisherOutcomeError(error) ? error.operation : 'draft-create'
      throw new PublisherOutcomeError('unknown', operationName, `WeChat ${operationName} failed after a possible network mutation`)
    }
  }

  return {
    id: publisherId, name: destination.name, kind: 'wechat-draft', configRevision: dependencies.configRevision,
    articleType: destination.articleType, hasDeploymentDefaultCover: Boolean(configuredCoverUrl(destination.defaultCoverAssetRef)
      || destination.defaultCoverAssetRef && ctx.prismProductionMedia?.hasDeploymentAsset?.(destination.defaultCoverAssetRef)),
    description: `Create a ${destination.articleType} item in the configured WeChat draft box from an approved Production Artifact.`,
    validateArtifact(artifact) { representArtifact(artifact); return true },
    publishArtifact(artifact, records, execution = {}) {
      const signals = [execution.signal, shutdownController.signal].filter(Boolean)
      return enqueue(() => operation(artifact, records, { ...execution, signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }))
    },
    async close() {
      shutdownController.abort(new Error(`WeChat publisher is stopping: ${publisherId}`))
      try { await tail } finally { tokenCache.clear() }
    },
  }
}

export async function apply(ctx, config) {
  // Existing deployments may contain pre-visual arbitrary reference names. They remain bootable,
  // while the native Profile CLI uses strict reference syntax and blocks re-import until corrected.
  const compatibility = { allowLegacyCredentialRefs: true }
  const normalizedConfig = normalizePublisherConfig('wechat-draft', config, compatibility)
  const configRevision = publisherConfigRevision('wechat-draft', normalizedConfig, compatibility)
  if (typeof ctx.prismPublishers.registerChannel === 'function') ctx.effect(() => ctx.prismPublishers.registerChannel('wechat-draft', configRevision), 'prismflow-publisher-wechat-draft:channel')
  for (const destination of normalizedConfig.destinations) {
    const provider = createWechatDraftProvider(ctx, destination, { configRevision })
    ctx.effect(() => {
      const unregister = ctx.prismPublishers.register(provider)
      return async () => { unregister(); await provider.close() }
    }, `prismflow-publisher-wechat-draft:${destination.id}`)
  }
}
