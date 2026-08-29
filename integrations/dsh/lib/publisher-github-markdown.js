import { createHash } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import {
  buildGitHubContentsApiUrl,
  buildGitHubPublicationPath,
  normalizeGitHubApiBaseUrl,
  parseGitHubRepository,
  renderGitHubCommitMessage,
  validateGitHubBranch,
  validateGitHubPathPrefix,
} from './shared/github-publisher.js'
import { renderMarkdownFileName } from './shared/markdown-publisher.js'
import { normalizePublisherConfig, publisherConfigRevision } from './shared/publisher-profile.js'

export const name = 'prismflow-publisher-github-markdown'
export const inject = ['credentials', 'prismPublishers']

const MAX_RESPONSE_BYTES = 4_000_000
const GITHUB_API_VERSION = '2022-11-28'

function awaitWithAbort(operation, signal) {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(new Error('GitHub publication aborted'))
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('GitHub publication aborted'))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(operation).then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
}

const DestinationConfig = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().required(),
  repository: Schema.string().required(),
  branch: Schema.string().default('main'),
  pathPrefix: Schema.string().default('daily'),
  fileNamePattern: Schema.string().default('{date}.md'),
  artifactFileNamePattern: Schema.string().default('draft-{date}.md'),
  title: Schema.string().default('PrismFlow Content'),
  overwrite: Schema.union(['never', 'if-changed']).default('if-changed'),
  commitMessage: Schema.string().max(200).default('chore: publish PrismFlow content {date}'),
  artifactCommitMessage: Schema.string().max(200).default('chore: publish approved PrismFlow draft {date}'),
  tokenCredential: Schema.string().role('credential-ref').default('GITHUB_TOKEN'),
  apiBaseUrl: Schema.string().default('https://api.github.com'),
  maxItems: Schema.number().step(1).min(1).max(100).default(50),
  maxDescriptionChars: Schema.number().step(1).min(1).max(10_000).default(1_000),
  maxBytes: Schema.number().step(1).min(1_024).max(1_000_000).default(900_000),
})

export const Config = Schema.object({
  destinations: Schema.array(DestinationConfig).default([]),
})

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error('GitHub publication aborted')
}

function validateCredentialRef(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error('GitHub tokenCredential must be a valid credential reference')
  }
  return value
}

async function readBoundedText(response) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new Error(`GitHub API response exceeded ${MAX_RESPONSE_BYTES} bytes`)
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel('response too large')
      throw new Error(`GitHub API response exceeded ${MAX_RESPONSE_BYTES} bytes`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function safeGitSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value) ? value : undefined
}

function parseJson(text, context) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${context}`)
  }
}

function githubApiError(response, _text) {
  const rawRequestId = response.headers.get('x-github-request-id')
  const requestId = rawRequestId && /^[A-Za-z0-9:-]{1,100}$/.test(rawRequestId) ? rawRequestId : undefined
  const rateRemaining = response.headers.get('x-ratelimit-remaining')
  const details = [
    requestId ? `request ${requestId}` : '',
    rateRemaining === '0' ? 'rate limit exhausted' : '',
  ].filter(Boolean).join('; ')
  return new Error(`GitHub API ${response.status}${details ? `: ${details}` : ''}`)
}

function requestHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'PrismFlow-DSH/0.6.0',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  }
}

async function githubRequest(url, init, signal) {
  let response
  try {
    response = await fetch(url, { ...init, signal, redirect: 'error' })
  } catch {
    if (signal?.aborted) throw new Error('GitHub publication aborted')
    throw new Error('GitHub API request failed')
  }
  try {
    return { response, text: await readBoundedText(response) }
  } catch (error) {
    if (signal?.aborted) throw new Error('GitHub publication aborted')
    throw error
  }
}

async function observeGitHubFile(destination, token, path, signal) {
  const url = buildGitHubContentsApiUrl(
    destination.apiBaseUrl,
    destination.repository,
    path,
    destination.branch,
  )
  const { response, text } = await githubRequest(url, {
    method: 'GET',
    headers: requestHeaders(token),
  }, signal)
  if (response.status === 404) return undefined
  if (!response.ok) throw githubApiError(response, text)

  const data = parseJson(text, 'content observation')
  const sha = safeGitSha(data?.sha)
  if (!data || data.type !== 'file' || sha === undefined) {
    throw new Error(`GitHub path is not a regular file: ${path}`)
  }
  if (data.encoding !== 'base64' || typeof data.content !== 'string') {
    throw new Error(`GitHub file content is unavailable for comparison: ${path}`)
  }
  const compact = data.content.replace(/\s+/g, '')
  if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new Error(`GitHub returned invalid base64 content for: ${path}`)
  }
  return {
    sha,
    content: Buffer.from(compact, 'base64').toString('utf8'),
  }
}

export async function writeGitHubFile(destination, token, path, content, message, sha, signal) {
  const url = buildGitHubContentsApiUrl(
    destination.apiBaseUrl,
    destination.repository,
    path,
  )
  const { response, text } = await githubRequest(url, {
    method: 'PUT',
    headers: requestHeaders(token),
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: destination.branch,
      ...(sha === undefined ? {} : { sha }),
    }),
  }, signal)
  if (!response.ok) return { ok: false, response, text }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: true, verification: 'unverified' }
  }
  const commitSha = safeGitSha(data?.commit?.sha)
  const contentSha = safeGitSha(data?.content?.sha)
  if (!commitSha || !contentSha) return { ok: true, verification: 'unverified' }
  return { ok: true, commitSha, contentSha, verification: 'verified' }
}

export async function publishGitHubFile(destination, token, path, content, message, signal) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfAborted(signal)
    const existing = await observeGitHubFile(destination, token, path, signal)
    if (existing && destination.overwrite === 'never') {
      return { status: 'skipped', commitSha: undefined, contentSha: existing.sha }
    }
    if (existing?.content === content) {
      return { status: 'unchanged', commitSha: undefined, contentSha: existing.sha }
    }

    const written = await writeGitHubFile(
      destination,
      token,
      path,
      content,
      message,
      existing?.sha,
      signal,
    )
    if (written.ok) {
      return {
        status: existing ? 'updated' : 'created',
        commitSha: written.commitSha,
        contentSha: written.contentSha,
        verification: written.verification,
      }
    }
    if (attempt === 0 && written.response.status === 409) continue
    if (attempt === 0 && written.response.status === 422) {
      const raced = await observeGitHubFile(destination, token, path, signal)
      if (raced) continue
    }
    throw githubApiError(written.response, written.text)
  }
  throw new Error(`GitHub publication could not stabilize target: ${path}`)
}

export function apply(ctx, config) {
  const normalizedConfig = normalizePublisherConfig('github-markdown', config)
  const configRevision = publisherConfigRevision('github-markdown', normalizedConfig)
  if (typeof ctx.prismPublishers.registerChannel === 'function') ctx.effect(() => ctx.prismPublishers.registerChannel('github-markdown', configRevision), 'prismflow-publisher-github-markdown:channel')

  for (const configured of normalizedConfig.destinations) {
    const destination = { ...configured, repository: parseGitHubRepository(configured.repository) }

    let operationTail = Promise.resolve()
    const shutdownController = new AbortController()
    const publisherId = `github-markdown:${destination.id}`
    const enqueue = operation => {
      const result = operationTail.then(operation)
      operationTail = result.then(() => {}, () => {})
      return result
    }
    const publishContent = async (records, content, filePattern, messagePattern, execution, artifact, truncated = 0) => {
      throwIfAborted(execution.signal)
      if (!records.length) throw new Error(`GitHub publisher ${publisherId} received no content`)
      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > destination.maxBytes) throw new Error(`GitHub publication exceeds maxBytes (${bytes} > ${destination.maxBytes})`)
      const credential = await awaitWithAbort(ctx.credentials.resolve(destination.tokenCredential), execution.signal)
      if (!credential) throw new Error(`GitHub credential is not configured for destination: ${destination.id}`)
      const publishedAt = new Date()
      const date = publishedAt.toISOString().slice(0, 10)
      const fileName = renderMarkdownFileName(filePattern, date)
      const path = buildGitHubPublicationPath(destination.pathPrefix, fileName)
      const write = await publishGitHubFile(destination, credential.value, path, content, renderGitHubCommitMessage(messagePattern, date), execution.signal)
      return {
        publisherId, fileName, path, repository: configured.repository, branch: destination.branch, status: write.status,
        itemCount: records.length, truncated, bytes, sha256: createHash('sha256').update(content).digest('hex'),
        contentStoreIds: records.map(record => record.storeId), verification: write.verification ?? 'verified',
        ...(write.commitSha === undefined ? {} : { commitSha: write.commitSha }),
        ...(write.contentSha === undefined ? {} : { contentSha: write.contentSha }),
        ...(artifact ? { draftId: artifact.draftId, draftVersion: artifact.draftVersion, artifactSha256: artifact.artifactSha256,
          ...(artifact.artifactBindingSha256 ? { artifactBindingSha256: artifact.artifactBindingSha256 } : {}) } : {}),
        publishedAt: publishedAt.toISOString(),
      }
    }
    const provider = {
      id: publisherId, name: destination.name, kind: 'github-markdown', configRevision,
      description: `Publish an approved PrismFlow draft Artifact to the configured GitHub destination.`,
      publishArtifact(artifact, records, execution = {}) {
        const signals = [execution.signal, shutdownController.signal].filter(Boolean)
        const scoped = { ...execution, signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }
        return enqueue(() => publishContent(records, artifact.markdown, destination.artifactFileNamePattern, destination.artifactCommitMessage, scoped, artifact))
      },
    }

    ctx.effect(() => {
      const unregister = ctx.prismPublishers.register(provider)
      return async () => {
        unregister()
        shutdownController.abort(new Error(`PrismFlow publisher is stopping: ${publisherId}`))
        await operationTail
      }
    }, `prismflow-publisher-github-markdown:${destination.id}`)
  }
}
