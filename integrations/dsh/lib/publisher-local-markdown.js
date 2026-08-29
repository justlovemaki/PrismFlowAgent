import { createHash } from 'node:crypto'
import { join, parse, relative, resolve, sep } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { renderMarkdownFileName } from './shared/markdown-publisher.js'
import { normalizePublisherConfig, publisherConfigRevision } from './shared/publisher-profile.js'

export const name = 'prismflow-publisher-local-markdown'
export const inject = ['fs', 'prismPublishers']

const MAX_EXISTING_READ_BYTES = 2 * 1024 * 1024

const DestinationConfig = Schema.object({
  id: Schema.string().required(),
  name: Schema.string().required(),
  root: Schema.string().required(),
  fileNamePattern: Schema.string().default('prismflow-{date}.md'),
  artifactFileNamePattern: Schema.string().default('prismflow-draft-{date}.md'),
  title: Schema.string().default('PrismFlow Content'),
  overwrite: Schema.union(['never', 'if-changed']).default('if-changed'),
  maxItems: Schema.number().step(1).min(1).max(100).default(50),
  maxDescriptionChars: Schema.number().step(1).min(1).max(10_000).default(1_000),
  maxBytes: Schema.number().step(1).min(1_024).max(2_000_000).default(1_000_000),
})

export const Config = Schema.object({
  destinations: Schema.array(DestinationConfig).default([]),
})

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error('Markdown publication aborted')
}

function isStaleWrite(error) {
  return error?.code === 'FS_STALE_VERSION' || error?.code === 'FS_NOT_OBSERVED'
}

async function requireSafeDirectory(ctx, absolutePath, signal) {
  const root = parse(absolutePath).root
  let current = root
  const suffix = relative(root, absolutePath)
  for (const segment of suffix.split(sep).filter(Boolean)) {
    current = join(current, segment)
    const pathInfo = await ctx.fs.lstat(current, undefined, signal)
    if (!pathInfo) throw new Error(`Markdown destination directory does not exist: ${absolutePath}`)
    if (pathInfo.type === 'symlink') {
      throw new Error(`Markdown destination path cannot contain symlinks: ${absolutePath}`)
    }
  }

  const target = await ctx.fs.resolve(absolutePath, { signal })
  const info = await ctx.fs.stat(target, signal)
  if (!info || info.type !== 'directory') {
    throw new Error(`Markdown destination root must be an existing directory: ${absolutePath}`)
  }
  return target
}

async function resolveSafeTarget(ctx, root, rootTarget, fileName, signal) {
  throwIfAborted(signal)
  const pathInfo = await ctx.fs.lstat(fileName, { cwd: root }, signal)
  if (pathInfo?.type === 'symlink') {
    throw new Error(`Markdown publication target cannot be a symlink: ${fileName}`)
  }
  const target = await ctx.fs.resolve(fileName, { cwd: root, signal })
  if (!ctx.fs.contains(rootTarget, target)) {
    throw new Error(`Markdown publication escaped its configured root: ${fileName}`)
  }
  return target
}

async function publishFile(ctx, destination, root, rootTarget, fileName, content, signal) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const target = await resolveSafeTarget(ctx, root, rootTarget, fileName, signal)
    const info = await ctx.fs.stat(target, signal)
    if (info && info.type !== 'file') {
      throw new Error(`Markdown publication target is not a regular file: ${fileName}`)
    }
    if (info && destination.overwrite === 'never') {
      return { status: 'skipped', operation: undefined }
    }
    if (info && (info.size ?? MAX_EXISTING_READ_BYTES + 1) <= MAX_EXISTING_READ_BYTES) {
      const existing = await ctx.fs.readText(target, signal)
      if (existing === content) return { status: 'unchanged', operation: undefined }
    }

    const expected = info
      ? { kind: 'replaceIfVersion', version: info.version }
      : { kind: 'createIfAbsent' }
    try {
      const freshTarget = await resolveSafeTarget(ctx, root, rootTarget, fileName, signal)
      const outcome = await ctx.fs.writeText(freshTarget, content, expected, signal)
      return {
        status: outcome.operation === 'create' ? 'created' : 'updated',
        operation: outcome.operation,
      }
    } catch (error) {
      if (attempt === 0 && isStaleWrite(error)) continue
      throw error
    }
  }
  throw new Error(`Markdown publication could not stabilize target: ${fileName}`)
}

export async function apply(ctx, config) {
  const normalizedConfig = normalizePublisherConfig('local-markdown', config)
  const configRevision = publisherConfigRevision('local-markdown', normalizedConfig)
  if (typeof ctx.prismPublishers.registerChannel === 'function') ctx.effect(() => ctx.prismPublishers.registerChannel('local-markdown', configRevision), 'prismflow-publisher-local-markdown:channel')

  for (const destination of normalizedConfig.destinations) {
    const root = resolve(destination.root)
    const rootTarget = await requireSafeDirectory(ctx, root)
    let operationTail = Promise.resolve()
    const shutdownController = new AbortController()
    const publisherId = `local-markdown:${destination.id}`
    const enqueue = operation => {
      const result = operationTail.then(operation)
      operationTail = result.then(() => {}, () => {})
      return result
    }
    const writeReceipt = async (records, content, pattern, execution, artifact) => {
      throwIfAborted(execution.signal)
      if (records.length === 0) throw new Error(`Markdown publisher ${publisherId} received no content`)
      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > destination.maxBytes) throw new Error(`Markdown publication exceeds maxBytes (${bytes} > ${destination.maxBytes})`)
      const publishedAt = new Date()
      const fileName = renderMarkdownFileName(pattern, publishedAt.toISOString().slice(0, 10))
      const write = await publishFile(ctx, destination, root, rootTarget, fileName, content, execution.signal)
      const receipt = {
        publisherId, fileName, status: write.status, itemCount: records.length, truncated: 0, bytes,
        sha256: createHash('sha256').update(content).digest('hex'), contentStoreIds: records.map(record => record.storeId),
        verification: 'verified', publishedAt: publishedAt.toISOString(),
        ...(artifact ? { draftId: artifact.draftId, draftVersion: artifact.draftVersion, artifactSha256: artifact.artifactSha256,
          ...(artifact.artifactBindingSha256 ? { artifactBindingSha256: artifact.artifactBindingSha256 } : {}) } : {}),
      }
      ctx.logger.info(`prismflow publisher: ${receipt.status} ${receipt.itemCount} item(s) at ${publisherId}/${fileName}`)
      return receipt
    }
    const provider = {
      id: publisherId,
      name: destination.name,
      kind: 'local-markdown',
      configRevision,
      description: `Atomically publish an approved PrismFlow draft Artifact as a configured Markdown file.`,
      publishArtifact(artifact, records, execution = {}) {
        const signals = [execution.signal, shutdownController.signal].filter(Boolean)
        const scoped = { ...execution, signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }
        return enqueue(() => writeReceipt(records, artifact.markdown, destination.artifactFileNamePattern, scoped, artifact))
      },
    }

    ctx.effect(() => {
      const unregister = ctx.prismPublishers.register(provider)
      return async () => {
        unregister()
        shutdownController.abort(new Error(`PrismFlow publisher is stopping: ${publisherId}`))
        await operationTail
      }
    }, `prismflow-publisher-local-markdown:${destination.id}`)
  }
}
