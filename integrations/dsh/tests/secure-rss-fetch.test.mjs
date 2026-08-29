import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createManagedMediaFetch, createManagedRssFetch, isPublicAddress } from '../lib/secure-rss-fetch.js'

class FakeRequest extends EventEmitter {
  constructor(options) { super(); this.options = options; this.ended = false; this.destroyed = false }
  end() { this.ended = true }
  destroy(error) { this.destroyed = true; if (error) queueMicrotask(() => this.emit('error', error)) }
}

class FakeResponse extends EventEmitter {
  constructor(statusCode, headers = {}, body = []) {
    super()
    this.statusCode = statusCode
    this.statusMessage = statusCode === 200 ? 'OK' : 'Redirect'
    this.headers = headers
    this.body = body
    this.destroyed = false
  }
  destroy() { this.destroyed = true }
  send() {
    for (const chunk of this.body) this.emit('data', chunk)
    this.emit('end')
  }
}

function requester(handler, calls) {
  return (options, callback) => {
    calls.push(options)
    const request = new FakeRequest(options)
    queueMicrotask(() => handler(options, callback, request))
    return request
  }
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

test('managed RSS address policy rejects private, link-local, reserved, multicast, mapped, and non-global IPv6 targets', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '169.254.1.2', '192.0.2.1', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '2001:db8::1', '3ffe::1', '4000::1']) {
    assert.equal(isPublicAddress(address), false, address)
  }
  assert.equal(isPublicAddress('93.184.216.34'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
})

test('managed RSS rejects reserved direct and mixed DNS IPv6 while preserving public IPv6', async () => {
  for (const address of ['3ffe::1', '4000::1']) {
    let requests = 0
    const direct = createManagedRssFetch({
      lookup() { throw new Error('IP literals must not use DNS') },
      httpsRequest() { requests += 1; throw new Error('must not request') },
    })
    await assert.rejects(direct(`https://[${address}]/rss`), /Managed RSS target is not allowed/)
    assert.equal(requests, 0)

    const mixed = createManagedRssFetch({
      lookup: async () => [{ address: '2606:4700:4700::1111', family: 6 }, { address, family: 6 }],
      httpsRequest() { requests += 1; throw new Error('must not request') },
    })
    await assert.rejects(mixed('https://feed.example/rss'), /Managed RSS target is not allowed/)
    assert.equal(requests, 0)
  }

  const calls = []
  const response = new FakeResponse(200, {}, ['feed'])
  const directPublic = createManagedRssFetch({
    lookup() { throw new Error('IP literals must not use DNS') },
    httpsRequest: requester((_options, callback) => { callback(response); response.send() }, calls),
  })
  assert.equal(await (await directPublic('https://[2606:4700:4700::1111]/rss')).text(), 'feed')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].family, 6)
})

test('managed RSS rejects a hostname when any DNS result is non-public before opening a socket', async () => {
  let requests = 0
  const fetchImpl = createManagedRssFetch({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.4', family: 4 }],
    httpsRequest() { requests += 1; throw new Error('must not request') },
  })
  await assert.rejects(fetchImpl('https://feed.example/rss'), error => {
    assert.equal(error.message, 'Managed RSS target is not allowed')
    assert.equal(error.message.includes('10.0.0.4'), false)
    return true
  })
  assert.equal(requests, 0)
})

test('managed RSS sanitizes DNS resolver failures', async () => {
  const fetchImpl = createManagedRssFetch({ lookup: async () => { throw new Error('resolver leaked feed.example and internal details') } })
  await assert.rejects(fetchImpl('https://feed.example/rss'), error => {
    assert.equal(error.message, 'Managed RSS DNS resolution failed')
    assert.equal(error.message.includes('feed.example'), false)
    assert.equal(error.cause, undefined)
    return true
  })
})

test('managed RSS pins the socket while preserving hostname, Host, TLS SNI, and safe headers', async () => {
  const calls = []
  const response = new FakeResponse(200, { 'content-length': '4' }, ['feed'])
  const fetchImpl = createManagedRssFetch({
    lookup: publicLookup,
    httpsRequest: requester((_options, callback) => { callback(response); response.send() }, calls),
  })
  const result = await fetchImpl('https://feed.example:8443/rss?q=1', {
    headers: { Accept: 'application/xml', 'User-Agent': 'test-agent', Authorization: 'must-not-forward', Cookie: 'must-not-forward' },
  })
  assert.equal(await result.text(), 'feed')
  assert.equal(calls.length, 1)
  const options = calls[0]
  assert.equal(options.hostname, 'feed.example')
  assert.equal(options.headers.Host, 'feed.example:8443')
  assert.equal(options.servername, 'feed.example')
  assert.equal(options.rejectUnauthorized, true)
  assert.equal(options.agent, false)
  assert.equal(options.family, 4)
  assert.equal(options.autoSelectFamily, false)
  assert.equal(options.headers.Authorization, undefined)
  assert.equal(options.headers.Cookie, undefined)
  const pinned = await new Promise((resolve, reject) => options.lookup('feed.example', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })))
  assert.deepEqual(pinned, { address: '93.184.216.34', family: 4 })
  const pinnedAll = await new Promise((resolve, reject) => options.lookup('feed.example', { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)))
  assert.deepEqual(pinnedAll, [{ address: '93.184.216.34', family: 4 }])
})

test('managed media fetch supports original Axios-compatible safe request headers without weakening socket pinning', async () => {
  const calls = []
  const fetchMedia = createManagedMediaFetch({ lookup: publicLookup, originReferer: false, userAgent: 'axios/1.13.5',
    accept: 'application/json, text/plain, */*', httpsRequest: requester((_options, callback) => {
      const response = new FakeResponse(200, { 'content-type': 'image/jpeg' }, ['jpg']); callback(response); response.send()
    }, calls) })
  await fetchMedia('https://pbs.twimg.com/media/example.jpg', { kind: 'image' })
  assert.equal(calls[0].headers.Referer, undefined)
  assert.equal(calls[0].headers['User-Agent'], 'axios/1.13.5')
  assert.equal(calls[0].headers.Accept, 'application/json, text/plain, */*')
  const pinned = await new Promise((resolve, reject) => calls[0].lookup('pbs.twimg.com', {}, (error, address) => error ? reject(error) : resolve(address)))
  assert.equal(pinned, '93.184.216.34')
})

test('repeated safe fetches rotate across fully validated public DNS answers while pinning each socket', async () => {
  const calls = []
  const fetchImpl = createManagedMediaFetch({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '1.1.1.1', family: 4 }],
    httpsRequest: requester((_options, callback) => { const response = new FakeResponse(200, { 'content-type': 'image/jpeg' }, ['jpg']); callback(response); response.send() }, calls),
  })
  await fetchImpl('https://pbs.example/media.jpg', { kind: 'image' })
  await fetchImpl('https://pbs.example/media.jpg', { kind: 'image' })
  const pinned = await Promise.all(calls.map(options => new Promise((resolve, reject) => options.lookup('pbs.example', {},
    (error, address) => error ? reject(error) : resolve(address)))))
  assert.deepEqual(pinned, ['93.184.216.34', '1.1.1.1'])
  assert.ok(calls.every(options => options.autoSelectFamily === false && options.agent === false))
})

test('managed RSS validates every redirect target and refuses a redirect resolving private', async () => {
  const calls = []
  const lookups = []
  const fetchImpl = createManagedRssFetch({
    lookup: async hostname => {
      lookups.push(hostname)
      return hostname === 'feed.example' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]
    },
    httpsRequest: requester((_options, callback) => callback(new FakeResponse(302, { location: 'http://private.example/latest' })), calls),
    httpRequest: requester(() => { throw new Error('redirect socket must not open') }, calls),
  })
  await assert.rejects(fetchImpl('https://feed.example/rss'), /Managed RSS target is not allowed/)
  assert.deepEqual(lookups, ['feed.example', 'private.example'])
  assert.equal(calls.length, 1)
})

test('managed RSS enforces Content-Length and streamed byte bounds', async () => {
  const lengthCalls = []
  const lengthFetch = createManagedRssFetch({
    lookup: publicLookup,
    maxResponseBytes: 8,
    httpsRequest: requester((_options, callback) => callback(new FakeResponse(200, { 'content-length': '9' })), lengthCalls),
  })
  await assert.rejects(lengthFetch('https://feed.example/rss'), /response is too large/)

  const streamCalls = []
  const response = new FakeResponse(200, {}, [Buffer.from('12345'), Buffer.from('6789')])
  const streamFetch = createManagedRssFetch({
    lookup: publicLookup,
    maxResponseBytes: 8,
    httpsRequest: requester((_options, callback) => { callback(response); response.send() }, streamCalls),
  })
  await assert.rejects(streamFetch('https://feed.example/rss'), /response is too large/)
  assert.equal(response.destroyed, true)
})

test('managed media fetch uses public DNS pinning and rejects private, mixed, credentialed, and private redirects', async () => {
  const calls = []
  const response = new FakeResponse(200, { 'content-type': 'image/png', 'content-length': '3' }, ['png'])
  const fetchMedia = createManagedMediaFetch({
    lookup: publicLookup,
    httpsRequest: requester((_options, callback) => { callback(response); response.send() }, calls),
  })
  const fetched = await fetchMedia('https://media.example/image.png', { kind: 'image' })
  assert.equal(Buffer.from(await fetched.arrayBuffer()).toString(), 'png')
  assert.equal(calls[0].headers.Host, 'media.example')
  assert.equal(calls[0].headers.Referer, 'https://media.example/')
  assert.match(calls[0].headers['User-Agent'], /^Mozilla\/5\.0/u)
  const pinned = await new Promise((resolve, reject) => calls[0].lookup('media.example', {}, (error, address) => error ? reject(error) : resolve(address)))
  assert.equal(pinned, '93.184.216.34')

  for (const lookup of [
    async () => [{ address: '10.0.0.1', family: 4 }],
    async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
  ]) {
    let opened = false
    const blocked = createManagedMediaFetch({ lookup, httpsRequest() { opened = true; throw new Error('must not open') } })
    await assert.rejects(blocked('https://media.example/image.png', { kind: 'image' }), /target is not allowed/)
    assert.equal(opened, false)
  }
  await assert.rejects(fetchMedia('https://user:secret@media.example/image.png', { kind: 'image' }), /target is not allowed/)

  const redirectedCalls = []
  const redirected = createManagedMediaFetch({
    lookup: async hostname => hostname === 'media.example' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }],
    httpsRequest: requester((_options, callback) => callback(new FakeResponse(302, { location: 'http://private.example/image.png' })), redirectedCalls),
    httpRequest() { throw new Error('private redirect socket must not open') },
  })
  await assert.rejects(redirected('https://media.example/image.png', { kind: 'image' }), /target is not allowed/)
  assert.equal(redirectedCalls.length, 1)
})

test('HTTPS-only managed media rejects initial HTTP and every public HTTPS-to-HTTP redirect while RSS keeps HTTP support', async () => {
  let httpCalls = 0
  const httpsOnly = createManagedMediaFetch({
    requireHttps: true, lookup: publicLookup,
    httpsRequest: requester((_options, callback) => callback(new FakeResponse(302, { location: 'http://cdn.example/image.png' })), []),
    httpRequest() { httpCalls += 1; throw new Error('downgrade socket must not open') },
  })
  await assert.rejects(httpsOnly('http://media.example/image.png', { kind: 'image' }), /target is not allowed/)
  await assert.rejects(httpsOnly('https://media.example/image.png', { kind: 'image' }), /target is not allowed/)
  assert.equal(httpCalls, 0)

  const rssCalls = []
  const response = new FakeResponse(200, {}, ['feed'])
  const rss = createManagedRssFetch({
    lookup: publicLookup,
    httpRequest: requester((_options, callback) => { callback(response); response.send() }, rssCalls),
  })
  assert.equal(await (await rss('http://feed.example/rss')).text(), 'feed')
  assert.equal(rssCalls.length, 1)
})

test('managed media fetch enforces kind content types, byte ceiling, and cancellation with generic errors', async () => {
  const wrongTypeResponse = new FakeResponse(200, { 'content-type': 'text/html' }, ['secret body'])
  const wrongType = createManagedMediaFetch({
    lookup: publicLookup,
    httpsRequest: requester((_options, callback) => { callback(wrongTypeResponse); wrongTypeResponse.send() }, []),
  })
  await assert.rejects(wrongType('https://media.example/image', { kind: 'image' }), error => {
    assert.equal(error.message, 'Dashboard media content type is not allowed')
    assert.equal(error.message.includes('media.example'), false)
    return true
  })
  assert.equal(wrongTypeResponse.destroyed, true)

  const tooLarge = createManagedMediaFetch({
    lookup: publicLookup, maxResponseBytes: 4,
    httpsRequest: requester((_options, callback) => callback(new FakeResponse(200, { 'content-type': 'video/mp4', 'content-length': '5' })), []),
  })
  await assert.rejects(tooLarge('https://media.example/video.mp4', { kind: 'video' }), /response is too large/)
  const streamedResponse = new FakeResponse(200, { 'content-type': 'image/png' }, ['123', '45'])
  const streamedTooLarge = createManagedMediaFetch({
    lookup: publicLookup, maxResponseBytes: 4,
    httpsRequest: requester((_options, callback) => { callback(streamedResponse); streamedResponse.send() }, []),
  })
  await assert.rejects(streamedTooLarge('https://media.example/image.png', { kind: 'image' }), /response is too large/)
  assert.equal(streamedResponse.destroyed, true)

  const dnsTimedOut = createManagedMediaFetch({ lookup: () => new Promise(() => {}), requestTimeoutMs: 100 })
  await assert.rejects(dnsTimedOut('https://media.example/video.mp4', { kind: 'video' }), error => error.message === 'Dashboard media request failed')

  const timeoutCalls = []
  const timedOut = createManagedMediaFetch({
    lookup: publicLookup, requestTimeoutMs: 100,
    httpsRequest: requester((_options, _callback, request) => request.emit('timeout'), timeoutCalls),
  })
  await assert.rejects(timedOut('https://media.example/video.mp4', { kind: 'video' }), error => error.message === 'Dashboard media request failed')
  assert.ok(timeoutCalls[0].timeout > 0 && timeoutCalls[0].timeout <= 100)

  const controller = new AbortController()
  const cancelled = createManagedMediaFetch({ lookup: () => new Promise(() => {}) })
  const pending = cancelled('https://media.example/video.mp4', { kind: 'video', signal: controller.signal })
  controller.abort(new Error('sensitive cancellation reason'))
  await assert.rejects(pending, error => {
    assert.equal(error.message, 'Dashboard media request was aborted')
    assert.equal(error.message.includes('sensitive'), false)
    return true
  })
})

test('managed media absolute deadline is not extended by slow response chunks', { timeout: 1_000 }, async () => {
  let interval
  let activeRequest
  const response = new FakeResponse(200, { 'content-type': 'video/mp4' })
  const slowDribble = createManagedMediaFetch({
    lookup: publicLookup,
    requestTimeoutMs: 100,
    httpsRequest: requester((_options, callback, request) => {
      activeRequest = request
      callback(response)
      interval = setInterval(() => response.emit('data', Buffer.from('x')), 20)
    }, []),
  })

  try {
    await assert.rejects(slowDribble('https://media.example/video.mp4', { kind: 'video' }), error => {
      assert.equal(error.message, 'Dashboard media request failed')
      return true
    })
  } finally {
    clearInterval(interval)
  }
  assert.equal(response.destroyed, true)
  assert.equal(activeRequest.destroyed, true)
})

test('managed media deadline spans cumulative DNS, redirect, transport, and body delay', async () => {
  let now = 0
  const calls = []
  let finalRequest
  let finalResponse
  const fetchMedia = createManagedMediaFetch({
    now: () => now,
    requestTimeoutMs: 100,
    lookup: async () => {
      now += 20
      return publicLookup()
    },
    httpsRequest: requester((options, callback, request) => {
      now += 20
      if (options.hostname === 'media.example') {
        callback(new FakeResponse(302, { location: 'https://cdn.example/video.mp4' }))
        return
      }
      finalRequest = request
      finalResponse = new FakeResponse(200, { 'content-type': 'video/mp4' }, ['video'])
      callback(finalResponse)
      now += 25
      finalResponse.send()
    }, calls),
  })

  await assert.rejects(fetchMedia('https://media.example/video.mp4', { kind: 'video' }), error => {
    assert.equal(error.message, 'Dashboard media request failed')
    return true
  })
  assert.deepEqual(calls.map(call => call.timeout), [80, 40])
  assert.equal(finalResponse.destroyed, true)
  assert.equal(finalRequest.destroyed, true)
})

test('managed media redirect hops keep the original deadline budget', async () => {
  let now = 500
  const calls = []
  const fetchMedia = createManagedMediaFetch({
    now: () => now,
    requestTimeoutMs: 100,
    lookup: async () => {
      now += 10
      return publicLookup()
    },
    httpsRequest: requester((options, callback) => {
      if (options.hostname === 'media.example') {
        now += 30
        callback(new FakeResponse(302, { location: 'https://cdn.example/image.png' }))
        return
      }
      now += 20
      const response = new FakeResponse(200, { 'content-type': 'image/png' }, ['png'])
      callback(response)
      response.send()
    }, calls),
  })

  assert.equal(Buffer.from(await (await fetchMedia('https://media.example/image.png', { kind: 'image' })).arrayBuffer()).toString(), 'png')
  assert.deepEqual(calls.map(call => call.timeout), [90, 50])
})

test('managed RSS cancellation interrupts DNS waiting and is propagated to requests', async () => {
  const controller = new AbortController()
  let requestCalls = 0
  const fetchImpl = createManagedRssFetch({
    lookup: () => new Promise(() => {}),
    httpsRequest() { requestCalls += 1; throw new Error('must not request') },
  })
  const pending = fetchImpl('https://feed.example/rss', { signal: controller.signal })
  controller.abort(new Error('sensitive abort reason'))
  await assert.rejects(pending, error => {
    assert.equal(error.message, 'Managed RSS request was aborted')
    assert.equal(error.message.includes('sensitive'), false)
    return true
  })
  assert.equal(requestCalls, 0)

  const calls = []
  const activeController = new AbortController()
  const response = new FakeResponse(200, {}, ['ok'])
  const completed = createManagedRssFetch({
    lookup: publicLookup,
    httpsRequest: requester((options, callback) => { assert.equal(options.signal, activeController.signal); callback(response); response.send() }, calls),
  })
  assert.equal(await (await completed('https://feed.example/rss', { signal: activeController.signal })).text(), 'ok')
  assert.equal(calls.length, 1)

  const socketController = new AbortController()
  let notifyStarted
  const started = new Promise(resolve => { notifyStarted = resolve })
  const activeFetch = createManagedRssFetch({
    lookup: publicLookup,
    httpsRequest(options) {
      const request = new FakeRequest(options)
      options.signal.addEventListener('abort', () => request.emit('error', new Error('sensitive transport abort detail')), { once: true })
      notifyStarted()
      return request
    },
  })
  const active = activeFetch('https://feed.example/rss', { signal: socketController.signal })
  await started
  socketController.abort()
  await assert.rejects(active, error => {
    assert.equal(error.message, 'Managed RSS request was aborted')
    assert.equal(error.message.includes('sensitive'), false)
    return true
  })
})
