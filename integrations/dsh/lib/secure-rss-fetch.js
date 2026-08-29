import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { performance } from 'node:perf_hooks'

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_MEDIA_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MEDIA_TYPES = {
  image: new Set(['image/avif', 'image/bmp', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']),
  video: new Set(['video/mp4', 'video/ogg', 'video/quicktime', 'video/webm']),
}

export class ManagedRssFetchError extends Error {
  constructor(message, code = 'REQUEST', status) {
    super(message)
    this.name = 'ManagedRssFetchError'
    this.code = code
    if (Number.isInteger(status)) this.status = status
  }
}

function ipv4Number(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

function inIpv4Cidr(value, base, bits) {
  const baseValue = ipv4Number(base)
  if (value === undefined || baseValue === undefined) return false
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (value & mask) === (baseValue & mask)
}

const UNSAFE_IPV4_CIDRS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

function parseIpv6(address) {
  const value = address.toLowerCase().split('%', 1)[0]
  if (!value || value.includes(':::')) return undefined
  let normalized = value
  const dottedIndex = normalized.lastIndexOf(':')
  if (normalized.includes('.') && dottedIndex >= 0) {
    const ipv4 = ipv4Number(normalized.slice(dottedIndex + 1))
    if (ipv4 === undefined) return undefined
    normalized = `${normalized.slice(0, dottedIndex)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`
  }
  const halves = normalized.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 && left.length !== 8) return undefined
  const missing = 8 - left.length - right.length
  if (missing < (halves.length === 2 ? 1 : 0)) return undefined
  const parts = [...left, ...Array(missing).fill('0'), ...right]
  if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return undefined
  return parts.reduce((result, part) => (result << 16n) | BigInt(Number.parseInt(part, 16)), 0n)
}

function inIpv6Cidr(value, base, bits) {
  const baseValue = parseIpv6(base)
  if (value === undefined || baseValue === undefined) return false
  if (bits === 0) return true
  const shift = BigInt(128 - bits)
  return (value >> shift) === (baseValue >> shift)
}

const UNSAFE_IPV6_CIDRS = [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['2620:4f:8000::', 48], ['3ffe::', 16], ['3fff::', 20], ['4000::', 3], ['5f00::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]

export function isPublicAddress(address) {
  const family = isIP(address)
  if (family === 4) {
    const value = ipv4Number(address)
    return value !== undefined && !UNSAFE_IPV4_CIDRS.some(([base, bits]) => inIpv4Cidr(value, base, bits))
  }
  if (family === 6) {
    const value = parseIpv6(address)
    return value !== undefined && inIpv6Cidr(value, '2000::', 3)
      && !UNSAFE_IPV6_CIDRS.some(([base, bits]) => inIpv6Cidr(value, base, bits))
  }
  return false
}

function errors(label) {
  return {
    aborted: () => new ManagedRssFetchError(`${label} request was aborted`, 'ABORTED'),
    invalid: () => new ManagedRssFetchError(`${label} target is invalid`, 'INVALID'),
    denied: () => new ManagedRssFetchError(`${label} target is not allowed`, 'DENIED'),
    dns: () => new ManagedRssFetchError(`${label} DNS resolution failed`, 'DNS'),
    request: () => new ManagedRssFetchError(`${label} request failed`, 'REQUEST'),
    redirect: () => new ManagedRssFetchError(`${label} redirect was rejected`, 'REDIRECT'),
    size: () => new ManagedRssFetchError(`${label} response is too large`, 'SIZE'),
    type: () => new ManagedRssFetchError(`${label} content type is not allowed`, 'TYPE'),
    status: status => new ManagedRssFetchError(`${label} request failed`, 'HTTP_STATUS', status),
  }
}

function raceAbortTimeout(promise, signal, timeoutMs, failure) {
  if (signal?.aborted) return Promise.reject(failure.aborted())
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(reject, failure.aborted())
    const timer = setTimeout(() => finish(reject, failure.request()), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(value => finish(resolve, value), error => finish(reject, error))
  })
}

function safeUrl(value, failure, rejectFragments = false, requireHttps = false) {
  let url
  try { url = new URL(value) } catch { throw failure.invalid() }
  if (!['http:', 'https:'].includes(url.protocol) || requireHttps && url.protocol !== 'https:'
    || url.username || url.password || rejectFragments && url.hash) throw failure.denied()
  return url
}

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

function responseFacade(status, headers, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Request failed',
    headers: { get(name) { return headerValue(headers, String(name).toLowerCase()) ?? null } },
    async text() { return body.toString('utf8') },
    async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) },
  }
}

/**
 * Creates a bounded public-network fetch. Every DNS answer is validated, the
 * selected public address is pinned into the socket lookup, and redirects pass
 * through the same validation. Callers can narrow accepted response headers.
 */
export function createPublicNetworkFetch(dependencies = {}, policy = {}) {
  const lookup = dependencies.lookup ?? dnsLookup
  const requestHttp = dependencies.httpRequest ?? httpRequest
  const requestHttps = dependencies.httpsRequest ?? httpsRequest
  const maxResponseBytes = dependencies.maxResponseBytes ?? policy.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const maxRedirects = dependencies.maxRedirects ?? policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const requestTimeoutMs = dependencies.requestTimeoutMs ?? policy.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const monotonicNow = dependencies.now ?? (() => performance.now())
  const failure = errors(policy.label ?? 'Public network')
  let addressCursor = 0
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || !Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10
    || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 120_000) {
    throw new Error('Invalid public network fetch limits')
  }

  const remainingBudget = deadline => deadline - monotonicNow()
  const requireRemainingBudget = deadline => {
    const remaining = remainingBudget(deadline)
    if (!(remaining > 0)) throw failure.request()
    return remaining
  }

  async function resolveTarget(url, signal, deadline) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    const literalFamily = isIP(hostname)
    let resolved
    try {
      resolved = literalFamily
        ? [{ address: hostname, family: literalFamily }]
        : await raceAbortTimeout(Promise.resolve().then(() => lookup(hostname, { all: true, verbatim: true })), signal, requireRemainingBudget(deadline), failure)
    } catch (error) {
      if (error instanceof ManagedRssFetchError) throw error
      if (signal?.aborted) throw failure.aborted()
      requireRemainingBudget(deadline)
      throw failure.dns()
    }
    requireRemainingBudget(deadline)
    if (!Array.isArray(resolved) || resolved.length === 0
      || resolved.some(item => !item || typeof item.address !== 'string' || !isPublicAddress(item.address))) throw failure.denied()
    // Rotate only among the fully validated public answers. This retains socket pinning and
    // all-answer SSRF rejection while matching the original client's resilience when one CDN edge is unavailable.
    const selected = resolved[addressCursor % resolved.length]
    addressCursor = (addressCursor + 1) % Number.MAX_SAFE_INTEGER
    return { address: selected.address, family: Number(selected.family) || isIP(selected.address) }
  }

  async function requestOnce(url, init, redirects, deadline) {
    const signal = init?.signal
    if (signal?.aborted) throw failure.aborted()
    requireRemainingBudget(deadline)
    const target = safeUrl(url, failure, policy.rejectFragments === true, policy.requireHttps === true)
    const pinned = await resolveTarget(target, signal, deadline)
    if (signal?.aborted) throw failure.aborted()

    const headers = {
      Accept: typeof init?.headers?.Accept === 'string' ? init.headers.Accept : (policy.accept ?? '*/*'),
      'User-Agent': typeof init?.headers?.['User-Agent'] === 'string' ? init.headers['User-Agent'] : (policy.userAgent ?? 'PrismFlow-DSH'),
      ...(policy.originReferer === true ? { Referer: `${target.protocol}//${target.host}/` } : {}),
      Host: target.host,
    }
    const requestOptions = {
      protocol: target.protocol,
      hostname: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'GET', headers, signal, timeout: requireRemainingBudget(deadline), agent: false, family: pinned.family, autoSelectFamily: false,
      lookup(_hostname, options, callback) {
        if (options?.all === true) callback(null, [{ address: pinned.address, family: pinned.family }])
        else callback(null, pinned.address, pinned.family)
      },
      ...(target.protocol === 'https:' ? { servername: target.hostname.replace(/^\[|\]$/g, ''), rejectUnauthorized: true } : {}),
    }
    const requester = target.protocol === 'https:' ? requestHttps : requestHttp

    return new Promise((resolve, reject) => {
      let settled = false
      let hopComplete = false
      let request
      let response
      let deadlineTimer
      const clearDeadline = () => {
        clearTimeout(deadlineTimer)
        signal?.removeEventListener('abort', onAbort)
      }
      const finishReject = error => {
        if (settled) return
        settled = true
        clearDeadline()
        if (signal?.aborted) reject(failure.aborted())
        else if (error instanceof ManagedRssFetchError) reject(error)
        else reject(failure.request())
      }
      const finishResolve = value => {
        if (settled) return
        settled = true
        clearDeadline()
        resolve(value)
      }
      const destroyActive = () => {
        try { response?.destroy?.() } catch {}
        try { request?.destroy?.() } catch {}
      }
      const onAbort = () => {
        destroyActive()
        finishReject(failure.aborted())
      }
      const rejectIfExpired = () => {
        if (remainingBudget(deadline) > 0) return false
        destroyActive()
        finishReject(failure.request())
        return true
      }
      if (signal?.aborted) { finishReject(failure.aborted()); return }
      const deadlineDelay = remainingBudget(deadline)
      if (!(deadlineDelay > 0)) { finishReject(failure.request()); return }
      deadlineTimer = setTimeout(() => {
        destroyActive()
        finishReject(failure.request())
      }, deadlineDelay)
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        request = requester(requestOptions, incoming => {
          response = incoming
          if (settled || hopComplete) { response.destroy?.(); return }
          if (rejectIfExpired()) return
          const status = Number(response.statusCode ?? 0)
          if (REDIRECT_STATUSES.has(status)) {
            const location = headerValue(response.headers, 'location')
            response.destroy?.()
            if (redirects >= maxRedirects || typeof location !== 'string' || !location) {
              finishReject(failure.redirect()); return
            }
            let redirected
            try { redirected = new URL(location, target) } catch { finishReject(failure.redirect()); return }
            hopComplete = true
            clearDeadline()
            requestOnce(redirected, init, redirects + 1, deadline).then(finishResolve, finishReject)
            return
          }

          try { policy.validateHeaders?.(status, response.headers, init, failure) } catch (error) {
            response.destroy?.(); finishReject(error); return
          }
          const contentLength = headerValue(response.headers, 'content-length')
          if (contentLength !== undefined) {
            const parsedLength = Number(contentLength)
            if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxResponseBytes) {
              response.destroy?.(); finishReject(failure.size()); return
            }
          }
          const chunks = []
          let received = 0
          response.on('data', chunk => {
            if (settled || rejectIfExpired()) return
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            received += bytes.length
            if (received > maxResponseBytes) {
              response.destroy?.(); finishReject(failure.size()); return
            }
            chunks.push(bytes)
          })
          response.once('error', finishReject)
          response.once('aborted', () => finishReject(failure.request()))
          response.once('end', () => {
            if (!rejectIfExpired()) finishResolve(responseFacade(status, response.headers, Buffer.concat(chunks, received)))
          })
        })
        request.once('error', error => { if (!hopComplete) finishReject(error) })
        request.once('timeout', () => {
          if (hopComplete) return
          destroyActive()
          finishReject(failure.request())
        })
        request.end()
      } catch (error) { finishReject(error) }
    })
  }

  return (url, init = {}) => requestOnce(url, init, 0, monotonicNow() + requestTimeoutMs)
}

export function createManagedRssFetch(dependencies = {}) {
  return createPublicNetworkFetch(dependencies, {
    label: 'Managed RSS',
    accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  })
}

export function createManagedMediaFetch(dependencies = {}) {
  return createPublicNetworkFetch(dependencies, {
    label: 'Dashboard media', maxResponseBytes: DEFAULT_MAX_MEDIA_BYTES, rejectFragments: dependencies.rejectFragments === true,
    requireHttps: dependencies.requireHttps === true, originReferer: dependencies.originReferer !== false,
    userAgent: dependencies.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
    accept: dependencies.accept ?? 'image/avif, image/bmp, image/gif, image/jpeg, image/png, image/webp, video/mp4, video/ogg, video/quicktime, video/webm',
    validateHeaders(status, headers, init, failure) {
      if (status < 200 || status >= 300) throw failure.status(status)
      const kind = init?.kind
      const contentType = String(headerValue(headers, 'content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
      if (!MEDIA_TYPES[kind]?.has(contentType)) throw failure.type()
    },
  })
}

export const managedRssFetch = createManagedRssFetch()
export const managedMediaFetch = createManagedMediaFetch()
