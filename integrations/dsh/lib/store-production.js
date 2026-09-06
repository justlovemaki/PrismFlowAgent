import { createHash, randomUUID } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import {
  approveDraft, approvedArtifact, artifactSha256, bindGenerationRequestWorkflowInput, createGenerationRequest, createGenerationRequestFromMaterials,
  generatorWorkflowSha256, hasInvalidGeneratedUnicode, normalizeGeneratedContent, normalizeGeneratedDraft, normalizeProductionArtifactV2, normalizeProductionWorkflowInput, normalizeWorkflowSnapshot, pinGenerationRequestPrompt,
  productionWorkflowInputSha256,
  productionArtifactBindingSha256,
  pinGenerationRequestWorkflow, sameGenerationProvenance, storedRecordMedia,
} from './shared/content-production.js'
import { isPublisherOutcomeError, PublisherOutcomeError } from './shared/publisher-outcome.js'
import { COVER_ASSET_GENERATOR_ID, COVER_ASSET_PROMPT_SHA256, COVER_ASSET_PROMPT_VERSION } from './cover-asset-generation.js'
import { acquireWriterLease, WriterLeaseConflictError, WriterLeaseValidationError } from './writer-lease-lock.js'

export const name = 'prismflow-store-production'
export const inject = ['storageDomain', 'prismContentStore', 'prismPublishers', 'prismPublicationReceipts']
export const Config = Schema.object({ writerLockPath: Schema.string().default('') })

class DraftRevisionError extends Error {
  constructor(name, message) { super(message); this.name = name }
}

function revisionValidation(message) { throw new DraftRevisionError('DraftRevisionValidationError', message) }
function revisionConflict(message) { throw new DraftRevisionError('DraftRevisionConflictError', message) }
function reviewConflict(message) { throw new DraftRevisionError('DraftReviewConflictError', message) }
function mediaAdmission(message) { throw new DraftRevisionError('DraftMediaAdmissionError', message) }

export class ProductionWorkflowDeletionError extends Error {
  constructor(message, code, status = 409, details) {
    super(message); this.name = 'ProductionWorkflowDeletionError'; this.code = code; this.status = status; this.details = details
  }
}

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const canonicalIntentIdSchema = z.string().uuid().transform(value => value.toLowerCase())
function validCanonicalUuid(value) { return typeof value === 'string' && CANONICAL_UUID_PATTERN.test(value) }
function deterministicUuid(namespace, value) {
  const bytes = Buffer.from(createHash('sha256').update(`${namespace}\0${value}`).digest().subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function exactRequestDraftLink(request, draft) {
  return !!request && !!draft && request.status === 'completed' && request.outputKind === undefined
    && request.requestId === draft.requestId && request.draftId === draft.draftId
    && JSON.stringify(request.derivation) === JSON.stringify(draft.derivation)
    && sameGenerationProvenance(request, draft)
    && JSON.stringify(request.contentStoreIds) === JSON.stringify(draft.sourceContentStoreIds)
    && request.selectionId === draft.selectionId && request.selectionSha256 === draft.selectionSha256
    && request.workflowInputSha256 === draft.workflowInputSha256
    && (request.workflowInput === undefined
      ? request.workflowInputSha256 === undefined
      : productionWorkflowInputSha256(request.workflowInput) === request.workflowInputSha256)
    && JSON.stringify(request.sourceContentClaims) === JSON.stringify(draft.sourceContentClaims)
}

function validateRevisionInput(draftId, expectedVersion, expectedSha256, title, markdown) {
  if (typeof draftId !== 'string' || draftId.length < 1 || draftId.length > 128 || /[\u0000-\u001f\u007f]/u.test(draftId)) revisionValidation('draftId is invalid')
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > 1_000_000_000) revisionValidation('expectedVersion is invalid')
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSha256)) revisionValidation('expectedSha256 is invalid')
  if (typeof title !== 'string' || title.trim() === '' || title.length > 300 || /[\u0000-\u001f\u007f]/u.test(title)) revisionValidation('title must be non-empty, control-free, and at most 300 characters')
  if (typeof markdown !== 'string' || markdown.trim() === '' || markdown.length > 100_000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(markdown)) {
    revisionValidation('markdown must be non-empty, control-free, and at most 100000 characters')
  }
  if (hasInvalidGeneratedUnicode(title) || hasInvalidGeneratedUnicode(markdown)) {
    revisionValidation('title and markdown must not contain Unicode replacement characters or unpaired surrogates')
  }
}

function boundedCoverInline(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${name} is invalid`)
  return value.trim()
}

function parseCoverAssetBinding(workflowInput) {
  if (!workflowInput || workflowInput.format !== 'json' || typeof workflowInput.content !== 'string') throw new Error('Cover asset request input is invalid')
  let value
  try { value = JSON.parse(workflowInput.content) } catch { throw new Error('Cover asset request input is invalid JSON') }
  const fields = ['kind', 'sourceDraft', 'selectedParagraph', 'mainTitle', 'subtitle', 'aspectRatio']
  const sourceFields = ['draftId', 'version', 'sha256', 'title']
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))
    || value.kind !== 'PrismFlowDraftCoverAssetInput/v1' || !value.sourceDraft || typeof value.sourceDraft !== 'object' || Array.isArray(value.sourceDraft)
    || Object.keys(value.sourceDraft).length !== sourceFields.length || sourceFields.some(field => !Object.hasOwn(value.sourceDraft, field))
    || typeof value.sourceDraft.draftId !== 'string' || value.sourceDraft.draftId.length < 1 || value.sourceDraft.draftId.length > 128
    || !Number.isInteger(value.sourceDraft.version) || value.sourceDraft.version < 1 || !/^[a-f0-9]{64}$/u.test(value.sourceDraft.sha256 ?? '')
    || typeof value.sourceDraft.title !== 'string' || value.sourceDraft.title.length > 300
    || typeof value.selectedParagraph !== 'string' || !value.selectedParagraph.trim() || value.selectedParagraph.length > 3_000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.selectedParagraph)
    || value.mainTitle !== boundedCoverInline(value.mainTitle, 'mainTitle', 100)
    || value.subtitle !== boundedCoverInline(value.subtitle, 'subtitle', 200) || value.aspectRatio !== '2:3') {
    throw new Error('Cover asset request input fields are invalid')
  }
  return value
}

const workflowInputSchema = z.object({ format: z.enum(['text', 'markdown', 'json']), content: z.string().min(1).max(100000) }).strict()
const contentClaimSchema = z.object({ storeId: z.string(), contentHash: z.string() }).strict()
const materialExcerptSchema = z.object({ field: z.enum(['description', 'content']), start: z.number().int(), end: z.number().int(), text: z.string(), sha256: z.string() }).strict()
const materialMediaSchema = z.object({ kind: z.enum(['image', 'video']), url: z.string().url().max(2048).regex(/^https?:\/\/[^\u0000-\u001f\u007f]+$/iu) }).strict()
const packedMaterialSchema = z.object({
  storeId: z.string(), title: z.string(), url: z.string(), source: z.string(), author: z.string(), publishedDate: z.string(), category: z.string(),
  aiSummary: z.string().min(1).max(4000).optional(), aiScore: z.number().int().min(0).max(100).optional(), scoreReason: z.string().min(1).max(2000).optional(),
  excerpts: z.array(materialExcerptSchema).max(32), media: z.array(materialMediaSchema).max(64).optional(),
  materialChars: z.number().int(), estimatedTokens: z.number().int(), materialSha256: z.string(),
}).strict().superRefine((value, ctx) => {
  const editorial = [value.aiSummary, value.aiScore, value.scoreReason]
  if (editorial.some(item => item !== undefined) && editorial.some(item => item === undefined)) ctx.addIssue({ code: 'custom', message: 'Packed editorial fields must be complete' })
})
const promptVersionSchema = z.number().int().min(0).max(1_000_000_000)
const promptShaSchema = z.string().regex(/^[a-f0-9]{64}$/u)
const workflowStepSchema = z.object({
  id: z.string(), name: z.string(), persona: z.string(), processPrompt: z.string(),
}).strict()
const workflowToolPolicySchema = z.object({ allow: z.array(z.string()) }).strict()
const workflowCeilingsSchema = z.object({
  maxSteps: z.number().int(), maxInputChars: z.number().int(), maxCombinedInputChars: z.number().int(),
  maxIntermediateOutputChars: z.number().int(), maxFinalOutputChars: z.number().int(), maxPromptAggregateChars: z.number().int(),
}).strict()
const workflowExecutionProfileSchema = z.object({
  format: z.literal('spawn-profile-v1'), id: z.string(), version: z.number().int(), sha256: promptShaSchema,
  runnerPolicyVersion: z.enum(['serial-workflow-v1', 'serial-workflow-v2']), providerRef: z.string(),
  toolPolicy: workflowToolPolicySchema, ceilings: workflowCeilingsSchema,
}).strict()
const workflowSnapshotSchema = z.object({
  format: z.literal('workflow-v1'), generatorId: z.string(), generatorName: z.string(), description: z.string(),
  enabled: z.boolean(), saveAsDraft: z.boolean().optional(), steps: z.array(workflowStepSchema), executionProfile: workflowExecutionProfileSchema,
}).strict().superRefine((value, ctx) => {
  try { normalizeWorkflowSnapshot(value) }
  catch { ctx.addIssue({ code: 'custom', message: 'Invalid workflow snapshot' }) }
})
const presentationDerivationSchema = z.object({
  kind: z.literal('approved-presentation-revision-v1'), sourceRequestId: z.string().min(1).max(128),
  sourceDraftId: z.string().min(1).max(128), sourceDraftVersion: z.number().int().min(1).max(1_000_000_000),
  sourceDraftSha256: promptShaSchema, sourceArtifactBindingSha256: promptShaSchema.optional(),
  sourceStatus: z.enum(['approved', 'published']).optional(),
}).strict()
const requestAssetClaimSchema = z.object({
  assetId: promptShaSchema, sha256: promptShaSchema, bytes: z.number().int().min(1).max(32 * 1024 * 1024),
  mime: z.enum(['image/jpeg', 'image/png', 'image/gif']), width: z.number().int().min(1).max(100_000), height: z.number().int().min(1).max(100_000),
}).strict()
function workflowResultSha256(output) {
  return createHash('sha256').update(JSON.stringify([output.title, output.markdown, output.sha256, output.mediaAssets])).digest('hex')
}
const workflowResultSchema = z.object({
  title: z.string().min(1).max(300), markdown: z.string().min(1).max(500_001), sha256: promptShaSchema,
  mediaAssets: z.array(requestAssetClaimSchema).max(20),
}).strict()
const requestSchema = z.object({
  requestId: z.string(), generatorId: z.string(), generatorPromptVersion: promptVersionSchema.optional(), generatorPromptSha256: promptShaSchema.optional(),
  executionKind: z.literal('workflow-v1').optional(), generatorWorkflowVersion: z.number().int().min(1).max(1_000_000_000).optional(),
  generatorWorkflowSha256: promptShaSchema.optional(), generatorWorkflowSnapshot: workflowSnapshotSchema.optional(), attempt: z.number().int().min(0).max(1_000_000_000).optional(),
  contentStoreIds: z.array(z.string()),
  selectionId: z.string().optional(), selectionSha256: z.string().optional(), sourceContentClaims: z.array(contentClaimSchema).max(100).optional(),
  packedMaterials: z.array(packedMaterialSchema).max(100).optional(),
  workflowInput: workflowInputSchema.optional(), workflowInputSha256: promptShaSchema.optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  createdAt: z.string(), updatedAt: z.string(), draftId: z.string().optional(), errorCode: z.string().optional(),
  outputKind: z.enum(['cover-asset-v1', 'workflow-result-v1']).optional(), outputAsset: requestAssetClaimSchema.optional(),
  outputResult: workflowResultSchema.optional(), outputResultSha256: promptShaSchema.optional(),
  derivation: presentationDerivationSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const workflowFields = [value.executionKind, value.generatorWorkflowVersion, value.generatorWorkflowSha256, value.generatorWorkflowSnapshot]
  if (workflowFields.some(item => item !== undefined)) {
    if (workflowFields.some(item => item === undefined) || value.generatorPromptVersion !== undefined || value.generatorPromptSha256 !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Workflow request provenance is incomplete' }); return
    }
    try {
      if (value.generatorWorkflowSnapshot.generatorId !== value.generatorId
        || generatorWorkflowSha256(value.generatorWorkflowSnapshot) !== value.generatorWorkflowSha256) ctx.addIssue({ code: 'custom', message: 'Workflow request provenance hash is invalid' })
    } catch { ctx.addIssue({ code: 'custom', message: 'Workflow request snapshot is invalid' }) }
  } else if ((value.generatorPromptVersion === undefined) !== (value.generatorPromptSha256 === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Legacy request prompt provenance is incomplete' })
  }
  if (value.outputKind === 'cover-asset-v1') {
    if (value.generatorId !== COVER_ASSET_GENERATOR_ID || value.generatorPromptVersion !== COVER_ASSET_PROMPT_VERSION
      || value.generatorPromptSha256 !== COVER_ASSET_PROMPT_SHA256 || value.draftId !== undefined
      || (value.status === 'completed') !== (value.outputAsset !== undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Cover asset request output provenance is invalid' })
    }
  } else if (value.outputAsset !== undefined) ctx.addIssue({ code: 'custom', message: 'Draft request cannot contain an asset output' })
  const resultOnly = value.executionKind === 'workflow-v1' && value.generatorWorkflowSnapshot?.saveAsDraft === false
  if (value.outputKind === 'workflow-result-v1') {
    if (!resultOnly || value.status !== 'completed' || value.draftId !== undefined || !value.outputResult
      || artifactSha256(value.outputResult.markdown) !== value.outputResult.sha256
      || workflowResultSha256(value.outputResult) !== value.outputResultSha256
      || value.outputResult.markdown.length > value.generatorWorkflowSnapshot.executionProfile.ceilings.maxFinalOutputChars + 1) {
      ctx.addIssue({ code: 'custom', message: 'Workflow result provenance is invalid' })
    }
  } else if (value.outputResult !== undefined || value.outputResultSha256 !== undefined || resultOnly && (value.status === 'completed' || value.draftId !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Workflow result output is missing or unexpected' })
  }
  if ((value.workflowInput === undefined) !== (value.workflowInputSha256 === undefined)
    || value.contentStoreIds.length === 0 && value.workflowInput === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Request input provenance is incomplete' })
  } else if (value.workflowInput) {
    try {
      normalizeProductionWorkflowInput(value.workflowInput)
      if (productionWorkflowInputSha256(value.workflowInput) !== value.workflowInputSha256) ctx.addIssue({ code: 'custom', message: 'Request workflowInput hash is invalid' })
    } catch { ctx.addIssue({ code: 'custom', message: 'Request workflowInput is invalid' }) }
  }
})
const mediaAssetClaimSchema = requestAssetClaimSchema
const cropSchema = z.object({ ratio: z.enum(['2.35_1', '1_1', '16_9']), x1: z.number().min(0).max(1), y1: z.number().min(0).max(1), x2: z.number().min(0).max(1), y2: z.number().min(0).max(1) }).strict()
const presentationSchema = z.object({
  publisherId: z.string().regex(/^wechat-draft:[a-zA-Z0-9_-]{1,128}$/u), author: z.string().max(64).optional(), digest: z.string().max(512).optional(),
  cover: z.object({ assetId: promptShaSchema, crops: z.array(cropSchema).max(3).optional() }).strict().optional(), imageOrder: z.array(promptShaSchema).max(20).optional(),
}).strict()
const draftSchema = z.object({
  draftId: z.string(), requestId: z.string(), generatorId: z.string(), generatorPromptVersion: promptVersionSchema.optional(), generatorPromptSha256: promptShaSchema.optional(),
  executionKind: z.literal('workflow-v1').optional(), generatorWorkflowVersion: z.number().int().min(1).max(1_000_000_000).optional(), generatorWorkflowSha256: promptShaSchema.optional(),
  title: z.string(), markdown: z.string().max(500_001),
  sha256: z.string(), version: z.number().int(), status: z.enum(['draft', 'approved', 'rejected', 'publishing', 'published']),
  sourceContentStoreIds: z.array(z.string()), createdAt: z.string(), updatedAt: z.string(), approvedAt: z.string().optional(),
  approvedVersion: z.number().int().optional(), approvedSha256: z.string().optional(), publishedAt: z.string().optional(),
  publishedPublisherIds: z.array(z.string()).max(50).optional(),
  publishingPublisherId: z.string().min(1).max(256).optional(), publishingPreviousStatus: z.enum(['approved', 'published']).optional(),
  publishingPhase: z.enum(['claimed', 'destination-started', 'reconciliation-required']).optional(),
  publishingOutcome: z.literal('unknown').optional(),
  publishingAttemptId: z.string().uuid().optional(), publishingAttemptNumber: z.number().int().positive().optional(),
  publishingReceiptId: z.string().uuid().optional(), publishingIntent: z.enum(['initial', 'repeat']).optional(),
  publishingIntentId: canonicalIntentIdSchema.optional(),
  artifactBindingSha256: promptShaSchema.optional(), approvedArtifactBindingSha256: promptShaSchema.optional(),
  mediaAssets: z.array(mediaAssetClaimSchema).max(100).optional(), destinationPresentations: z.array(presentationSchema).max(50).optional(),
  selectionId: z.string().optional(), selectionSha256: z.string().optional(), sourceContentClaims: z.array(contentClaimSchema).max(100).optional(),
  workflowInputSha256: promptShaSchema.optional(),
  derivation: presentationDerivationSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const workflowFields = [value.executionKind, value.generatorWorkflowVersion, value.generatorWorkflowSha256]
  if (workflowFields.some(item => item !== undefined)) {
    if (workflowFields.some(item => item === undefined) || value.generatorPromptVersion !== undefined || value.generatorPromptSha256 !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Workflow draft provenance is incomplete' })
    }
  } else if ((value.generatorPromptVersion === undefined) !== (value.generatorPromptSha256 === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Legacy draft prompt provenance is incomplete' })
  }
  if (value.sourceContentStoreIds.length === 0 && value.workflowInputSha256 === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Draft input provenance is incomplete' })
  }
  const presentationFields = [value.artifactBindingSha256, value.mediaAssets, value.destinationPresentations]
  if (presentationFields.some(item => item !== undefined)) {
    if (value.artifactBindingSha256 === undefined) ctx.addIssue({ code: 'custom', message: 'Draft presentation binding is incomplete' })
    else {
      try { normalizeProductionArtifactV2({ draftId: value.draftId, draftVersion: value.version, artifactSha256: value.sha256,
        title: value.title, markdown: value.markdown, sourceContentStoreIds: value.sourceContentStoreIds,
        ...(value.workflowInputSha256 ? { workflowInputSha256: value.workflowInputSha256 } : {}), artifactBindingSha256: value.artifactBindingSha256, mediaAssets: value.mediaAssets, destinationPresentations: value.destinationPresentations }) }
      catch { ctx.addIssue({ code: 'custom', message: 'Draft presentation binding is invalid' }) }
    }
  }
  if (value.approvedArtifactBindingSha256 !== undefined && value.approvedArtifactBindingSha256 !== value.artifactBindingSha256) {
    ctx.addIssue({ code: 'custom', message: 'Approved presentation binding is invalid' })
  }
  const publicationFields = [value.publishingPublisherId, value.publishingPreviousStatus, value.publishingPhase]
  const attemptFields = [value.publishingAttemptId, value.publishingAttemptNumber, value.publishingReceiptId, value.publishingIntent]
  if (value.status === 'publishing' ? publicationFields.some(item => item === undefined) : publicationFields.some(item => item !== undefined) || value.publishingOutcome !== undefined || attemptFields.some(item => item !== undefined) || value.publishingIntentId !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Draft publication recovery provenance is incomplete' })
  }
  if (attemptFields.some(item => item !== undefined) && attemptFields.some(item => item === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Draft publication attempt provenance is incomplete' })
  }
  if (value.publishingIntentId !== undefined && value.publishingIntent !== 'repeat') {
    ctx.addIssue({ code: 'custom', message: 'Draft repeat publication intent provenance is invalid' })
  }
  if (value.publishingPhase === 'reconciliation-required' && value.publishingOutcome !== 'unknown') {
    ctx.addIssue({ code: 'custom', message: 'Draft publication recovery provenance is incomplete' })
  }
})

export class PublicationReconciliationError extends Error {
  constructor(receipt, externalOutcome) {
    super(externalOutcome === 'unknown'
      ? 'External publication outcome is unknown; operator reconciliation is required'
      : 'Publication receipt persistence failed; operator reconciliation is required')
    this.name = 'PublicationReconciliationError'
    this.receipt = receipt
    this.externalOutcome = externalOutcome
    this.publicationCommitted = receipt?.publicationCommitted === true
  }
}

const RECEIPT_CANDIDATE_FIELDS = [
  'publisherId', 'status', 'itemCount', 'truncated', 'omittedMedia', 'bytes', 'sha256', 'publishedAt', 'contentStoreIds',
  'fileName', 'path', 'key', 'repository', 'branch', 'bucket', 'publicUrl', 'operation', 'commitSha', 'contentSha',
  'etag', 'versionId', 'verification', 'draftId', 'draftVersion', 'artifactSha256', 'artifactBindingSha256',
  'articleType', 'wechatDraftMediaId', 'recordedAt', 'trigger', 'jobId', 'workflowId', 'publicationCommitted',
]
const receiptReplayMetadataSchema = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  if (Object.keys(value).some(field => !RECEIPT_CANDIDATE_FIELDS.includes(field))
    || Buffer.byteLength(JSON.stringify(value), 'utf8') > 32 * 1024) {
    ctx.addIssue({ code: 'custom', message: 'Publication Receipt replay metadata is invalid' })
  }
})
function normalizedReceiptCandidate(value) {
  const candidate = {}
  for (const field of RECEIPT_CANDIDATE_FIELDS) if (value?.[field] !== undefined) candidate[field] = structuredClone(value[field])
  return candidate
}

function safeResultString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined
}

export function publicationReconciliationResult(error) {
  if (!(error instanceof PublicationReconciliationError)) return undefined
  const receipt = error.receipt && typeof error.receipt === 'object' && !Array.isArray(error.receipt) ? error.receipt : {}
  const result = {
    success: false,
    status: 'reconciliation-required',
    ...(error.externalOutcome === 'unknown' ? { externalOutcome: 'unknown' } : {
      receiptPersistence: 'failed', publicationCommitted: error.publicationCommitted === true,
    }),
  }
  const publisherId = safeResultString(receipt.publisherId, 256)
  const draftId = safeResultString(receipt.draftId, 128)
  if (publisherId !== undefined) result.publisherId = publisherId
  if (draftId !== undefined) result.draftId = draftId
  for (const field of ['itemCount', 'truncated', 'omittedMedia', 'bytes']) {
    if (Number.isSafeInteger(receipt[field]) && receipt[field] >= 0) result[field] = receipt[field]
  }
  if (Number.isInteger(receipt.draftVersion) && receipt.draftVersion >= 1) result.draftVersion = receipt.draftVersion
  if (typeof receipt.artifactSha256 === 'string' && /^[a-f0-9]{64}$/u.test(receipt.artifactSha256)) result.artifactSha256 = receipt.artifactSha256
  if (typeof receipt.artifactBindingSha256 === 'string' && /^[a-f0-9]{64}$/u.test(receipt.artifactBindingSha256)) result.artifactBindingSha256 = receipt.artifactBindingSha256
  if (typeof receipt.status === 'string' && ['created', 'updated', 'unchanged', 'skipped'].includes(receipt.status)) result.publicationStatus = receipt.status
  const publicationAttemptId = safeResultString(receipt.publicationAttemptId, 128)
  const receiptId = safeResultString(receipt.receiptId, 128)
  if (publicationAttemptId !== undefined) result.publicationAttemptId = publicationAttemptId
  if (receiptId !== undefined) result.receiptId = receiptId
  if (Number.isInteger(receipt.publicationAttemptNumber) && receipt.publicationAttemptNumber > 0) result.publicationAttemptNumber = receipt.publicationAttemptNumber
  if (receipt.publicationIntent === 'initial' || receipt.publicationIntent === 'repeat') result.publicationIntent = receipt.publicationIntent
  if (receipt.articleType === 'news' || receipt.articleType === 'newspic') result.articleType = receipt.articleType
  const wechatDraftMediaId = safeResultString(receipt.wechatDraftMediaId, 128)
  if (wechatDraftMediaId !== undefined) result.wechatDraftMediaId = wechatDraftMediaId
  const operation = safeResultString(receipt.operation, 64)
  if (operation !== undefined) result.operation = operation
  if (receipt.verification === 'verified' || receipt.verification === 'unverified') result.verification = receipt.verification
  return result
}

const draftDeletionSchema = z.object({
  draftId: z.string().min(1).max(128), requestId: z.string().min(1).max(128),
  version: z.number().int().min(1).max(1_000_000_000), sha256: promptShaSchema,
  deletedAt: z.string(), deletedFromStatus: z.enum(['draft', 'rejected', 'approved', 'published']).optional(),
}).strict()

export const prismProductionDomain = defineDomain({
  name: 'prismflow_production', version: 1,
  tables: { requests: domainTable(requestSchema), drafts: domainTable(draftSchema), draft_deletions: domainTable(draftDeletionSchema) },
})

const terminalFailureSchema = z.object({
  kind: z.enum(['publisher-not-committed', 'publication-not-committed']),
  operation: z.enum(['token', 'body-upload', 'material-upload', 'draft-create']).optional(),
  externalOutcome: z.literal('unknown').optional(),
  code: z.number().int().min(-1).max(1_000_000_000).refine(value => value !== 0).optional(), requestId: z.string().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/u).optional(),
}).strict().superRefine((value, ctx) => {
  const publisherFailure = value.kind === 'publisher-not-committed'
  if (publisherFailure !== (value.operation !== undefined) || !publisherFailure && (value.code !== undefined || value.requestId !== undefined || value.externalOutcome !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Publication terminal failure metadata is incomplete' })
  }
})

const attemptSchema = z.object({
  attemptId: z.string().uuid(), receiptId: z.string().uuid(), attemptNumber: z.number().int().positive(),
  draftId: z.string().min(1).max(128), draftVersion: z.number().int().positive(), artifactSha256: promptShaSchema,
  artifactBindingSha256: promptShaSchema.optional(), publisherId: z.string().min(1).max(256), intent: z.enum(['initial', 'repeat']),
  intentId: canonicalIntentIdSchema.optional(), legacyClaim: z.boolean().optional(),
  trigger: z.enum(['manual', 'scheduler', 'workflow', 'host']), surface: z.enum(['dashboard', 'chat', 'host']),
  state: z.enum(['claimed', 'destination-started', 'completed', 'skipped', 'not-committed', 'reconciliation-required']),
  publicationStatus: z.enum(['created', 'updated', 'unchanged', 'skipped']).optional(),
  reconciliationReason: z.enum(['external-unknown', 'receipt-persistence-failure']).optional(),
  reconciliationOperation: z.enum(['token', 'body-upload', 'material-upload', 'draft-create']).optional(),
  receiptCandidate: receiptReplayMetadataSchema.optional(), terminalReceipt: receiptReplayMetadataSchema.optional(),
  terminalFailure: terminalFailureSchema.optional(),
  createdAt: z.string(), updatedAt: z.string(), destinationStartedAt: z.string().optional(), completedAt: z.string().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.intentId !== undefined && value.intent !== 'repeat') ctx.addIssue({ code: 'custom', message: 'Only repeat attempts have caller intent ids' })
  if (value.reconciliationOperation !== undefined && (value.state !== 'reconciliation-required' || value.reconciliationReason !== 'external-unknown')) {
    ctx.addIssue({ code: 'custom', message: 'Only externally unknown attempts have a reconciliation operation' })
  }
})

export const prismPublicationAttemptDomain = defineDomain({
  name: 'prismflow_publication_attempts', version: 1,
  tables: { attempts: domainTable(attemptSchema) },
})

export class PrismProductionService extends Service {
  static inject = inject
  constructor(ctx, config = {}) {
    super(ctx, 'prismProduction')
    this.requests = undefined
    this.drafts = undefined
    // Replaced by the durable domain during init; retained for direct service unit harnesses.
    const volatileAttempts = new Map()
    this.attempts = { get: id => volatileAttempts.get(id), entries: () => volatileAttempts.entries(),
      put: async (id, value) => { volatileAttempts.set(id, structuredClone(value)); return value } }
    const volatileDraftDeletions = new Map()
    this.draftDeletions = { get: id => volatileDraftDeletions.get(id), entries: () => volatileDraftDeletions.entries(),
      put: async (id, value) => { volatileDraftDeletions.set(id, structuredClone(value)); return value } }
    this.generators = new Map()
    this.workflowRunners = new Map()
    this.materialProviders = new Map()
    this.tail = Promise.resolve()
    this.inFlight = new Set()
    this.activeRuns = new Map()
    this.stopping = false
    this.maintenanceDraining = false
    this.shutdownController = new AbortController()
    this.publicationClaims = new Map()
    this.repeatOperations = new Map()
    this.writerLockPath = config.writerLockPath ?? ''
    this.releaseWriterLock = undefined
  }

  async [Service.init]() {
    let domain
    let attemptDomain
    try {
      if (!this.writerLockPath) throw new Error('Production Store requires a deployment-configured writerLockPath')
      try { this.releaseWriterLock = await acquireWriterLease(this.writerLockPath) }
      catch (error) {
        if (error instanceof WriterLeaseValidationError || error instanceof WriterLeaseConflictError) throw new Error(`Production writer lock: ${error.message}`)
        throw error
      }
      attemptDomain = await this.ctx.storageDomain.open(prismPublicationAttemptDomain)
      this.attempts = attemptDomain.table('attempts')
      domain = await this.ctx.storageDomain.open(prismProductionDomain)
      this.requests = domain.table('requests')
      this.drafts = domain.table('drafts')
      this.draftDeletions = domain.table('draft_deletions')
      await this.recoverInterrupted()
      this.ctx.effect(() => async () => {
        try { await this.shutdown(); await domain.close(); await attemptDomain.close() }
        finally { await this.releaseWriterLock?.(); this.releaseWriterLock = undefined; this.requests = undefined; this.drafts = undefined; this.draftDeletions = undefined; this.attempts = undefined }
      }, 'prismflow-production.domainClose')
    } catch (error) {
      this.requests = undefined
      this.drafts = undefined
      this.draftDeletions = undefined
      if (domain) await domain.close().catch(() => {})
      if (attemptDomain) await attemptDomain.close().catch(() => {})
      await this.releaseWriterLock?.().catch(() => {})
      this.releaseWriterLock = undefined
      throw error
    }
  }

  registerGenerator(provider) {
    if (!provider?.id || typeof provider.generate !== 'function' || typeof provider.pinPrompt !== 'function' || typeof provider.resolvePrompt !== 'function') {
      throw new Error('A production generator requires id, pinPrompt(), resolvePrompt(), and generate()')
    }
    if (this.generators.has(provider.id)) throw new Error(`Production generator already registered: ${provider.id}`)
    this.generators.set(provider.id, provider)
    return () => { if (this.generators.get(provider.id) === provider) this.generators.delete(provider.id) }
  }

  registerWorkflowRunner(profile, runner) {
    if (!profile?.id || !Number.isInteger(profile.version) || !/^[a-f0-9]{64}$/u.test(profile.sha256 ?? '')
      || typeof runner?.generate !== 'function') throw new Error('A workflow runner requires an immutable profile and generate()')
    const key = `${profile.id}:${profile.version}:${profile.sha256}`
    if (this.workflowRunners.has(key)) throw new Error(`Workflow runner already registered: ${profile.id}`)
    const registration = { profile: structuredClone(profile), ...runner }
    this.workflowRunners.set(key, registration)
    return () => {
      if (this.workflowRunners.get(key) !== registration) return
      const retained = this.requests && Array.from(this.requireRequests().entries(), ([, request]) => request)
        .some(request => ['pending', 'running', 'failed', 'cancelled'].includes(request.status)
          && request.executionKind === 'workflow-v1'
          && (this.currentWorkflow(request.generatorId)?.enabled === false || this.currentWorkflow(request.generatorId)?.action === 'delete')
          && request.generatorWorkflowSnapshot?.executionProfile?.id === profile.id
          && request.generatorWorkflowSnapshot.executionProfile.version === profile.version
          && request.generatorWorkflowSnapshot.executionProfile.sha256 === profile.sha256)
      if (!retained) this.workflowRunners.delete(key)
    }
  }

  workflowStore() { return this.ctx.get?.('prismGeneratorWorkflows') }
  workflowRunner(profile) { return this.workflowRunners.get(`${profile.id}:${profile.version}:${profile.sha256}`) }
  currentWorkflow(generatorId) { return this.workflowStore()?.currentSync(generatorId) }
  workflowReference(row) {
    const snapshot = normalizeWorkflowSnapshot({ format: row.format, generatorId: row.generatorId, generatorName: row.generatorName,
      description: row.description, enabled: row.enabled, steps: row.steps, executionProfile: row.executionProfile,
      ...(row.saveAsDraft !== undefined ? { saveAsDraft: row.saveAsDraft } : {}) })
    const sha256 = generatorWorkflowSha256(snapshot)
    if (sha256 !== row.sha256) throw new Error('Current generator workflow hash is invalid')
    return { executionKind: 'workflow-v1', generatorWorkflowVersion: row.version,
      generatorWorkflowSha256: row.sha256, generatorWorkflowSnapshot: snapshot }
  }

  registerMaterialProvider(provider) {
    if (!provider?.id || typeof provider.resolve !== 'function'
      || provider.revalidateClaims !== undefined && typeof provider.revalidateClaims !== 'function') {
      throw new Error('A production material provider requires id, resolve(), and an optional valid revalidateClaims()')
    }
    if (this.materialProviders.has(provider.id)) throw new Error(`Production material provider already registered: ${provider.id}`)
    this.materialProviders.set(provider.id, provider)
    return () => { if (this.materialProviders.get(provider.id) === provider) this.materialProviders.delete(provider.id) }
  }

  listGenerators() {
    const workflows = this.workflowStore()?.listCurrent?.() ?? []
    const adopted = new Set(workflows.map(item => item.generatorId))
    const merged = workflows.filter(item => item.action !== 'delete' && item.enabled && this.workflowRunner(item.executionProfile))
      .map(item => ({ id: item.generatorId, name: item.generatorName, description: item.description, ...(item.saveAsDraft !== undefined ? { saveAsDraft: item.saveAsDraft } : {}) }))
    for (const generator of this.generators.values()) {
      if (!adopted.has(generator.id)) merged.push({ id: generator.id, name: generator.name, description: generator.description ?? '' })
    }
    return merged.sort((a, b) => a.id.localeCompare(b.id))
  }

  pinNewRequest(request) {
    const workflow = this.currentWorkflow(request.generatorId)
    if (workflow) {
      if (workflow.action === 'delete') throw new ProductionWorkflowDeletionError(`Production generator is permanently deleted: ${request.generatorId}`, 'workflow_deleted', 410)
      if (!workflow.enabled) throw new Error(`Production generator is disabled: ${request.generatorId}`)
      if (!this.workflowRunner(workflow.executionProfile)) throw new Error('Pinned workflow execution profile is unavailable')
      return pinGenerationRequestWorkflow(request, this.workflowReference(workflow))
    }
    const generator = this.generators.get(request.generatorId)
    if (!generator) throw new Error(`Unknown production generator: ${request.generatorId}`)
    return Promise.resolve(generator.pinPrompt()).then(reference => pinGenerationRequestPrompt(request, reference))
  }

  async createRequestFromAISelection(generatorId, selectionId) {
    if (typeof selectionId !== 'string' || selectionId.length < 1 || selectionId.length > 128) throw new Error('selectionId is invalid')
    const provider = this.materialProviders.get('ai-selection')
    if (!provider) throw new Error('AI selection material provider is unavailable')
    const selection = await provider.resolve(selectionId)
    const candidate = createGenerationRequestFromMaterials(generatorId, selection)
    return this.mutate(async () => {
      const request = await this.pinNewRequest(candidate)
      await this.requireRequests().put(request.requestId, request)
      return request
    })
  }

  async createRequestFromDirectInput(generatorId, workflowInput, selectionId) {
    let candidate
    if (selectionId !== undefined) {
      if (typeof selectionId !== 'string' || selectionId.length < 1 || selectionId.length > 128) throw new Error('selectionId is invalid')
      const provider = this.materialProviders.get('ai-selection')
      if (!provider) throw new Error('AI selection material provider is unavailable')
      candidate = bindGenerationRequestWorkflowInput(createGenerationRequestFromMaterials(generatorId, await provider.resolve(selectionId)), workflowInput)
    } else {
      candidate = createGenerationRequest(generatorId, [], new Date(), workflowInput)
    }
    return this.mutate(async () => {
      const request = await this.pinNewRequest(candidate)
      await this.requireRequests().put(request.requestId, request)
      return request
    })
  }

  createCoverAssetRequestFromDraft(input) {
    const source = this.getDraft(input?.sourceDraftId)
    if (!source || !['approved', 'published'].includes(source.status)) throw new Error('Cover asset generation requires a stable approved or published source Draft')
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || !/^[a-f0-9]{64}$/u.test(input.expectedSha256 ?? '')
      || source.version !== input.expectedVersion || source.sha256 !== input.expectedSha256) {
      throw new Error('Source Draft version or SHA-256 changed before cover asset generation')
    }
    if (typeof input.selectedParagraph !== 'string' || !input.selectedParagraph.trim() || input.selectedParagraph.length > 3_000
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.selectedParagraph)
      || !source.markdown.includes(input.selectedParagraph)) throw new Error('selectedParagraph must be copied verbatim from the exact source Draft')
    const binding = {
      kind: 'PrismFlowDraftCoverAssetInput/v1',
      sourceDraft: { draftId: source.draftId, version: source.version, sha256: source.sha256, title: source.title },
      selectedParagraph: input.selectedParagraph,
      mainTitle: boundedCoverInline(input.mainTitle, 'mainTitle', 100),
      subtitle: boundedCoverInline(input.subtitle, 'subtitle', 200),
      aspectRatio: input.aspectRatio,
    }
    parseCoverAssetBinding({ format: 'json', content: JSON.stringify(binding) })
    const candidate = createGenerationRequest(COVER_ASSET_GENERATOR_ID, [], new Date(), { format: 'json', content: JSON.stringify(binding) })
    const request = { ...candidate, generatorPromptVersion: COVER_ASSET_PROMPT_VERSION,
      generatorPromptSha256: COVER_ASSET_PROMPT_SHA256, outputKind: 'cover-asset-v1' }
    return this.mutate(async () => {
      await this.requireRequests().put(request.requestId, request)
      return request
    })
  }

  assertCoverAssetBinding(binding) {
    const source = this.getDraft(binding.sourceDraft.draftId)
    if (!source || !['approved', 'published'].includes(source.status) || source.version !== binding.sourceDraft.version
      || source.sha256 !== binding.sourceDraft.sha256 || source.title !== binding.sourceDraft.title
      || !source.markdown.includes(binding.selectedParagraph)) throw new Error('Source Draft changed before cover asset generation completed')
    return source
  }

  async createRequest(generatorId, contentStoreIds) {
    const candidate = createGenerationRequest(generatorId, contentStoreIds)
    return this.mutate(async () => {
      const request = await this.pinNewRequest(candidate)
      for (const storeId of request.contentStoreIds) {
        if (!this.ctx.prismContentStore.get(storeId)) throw new Error(`Unknown stored content: ${storeId}`)
      }
      await this.requireRequests().put(request.requestId, request)
      return request
    })
  }

  workflowDeletionBlockers(generatorId) {
    const counts = { pending: 0, running: 0 }
    for (const [requestId, raw] of this.requireRequests().entries()) {
      const parsed = requestSchema.safeParse(raw)
      if (typeof requestId !== 'string' || !parsed.success || parsed.data.requestId !== requestId
        || Object.keys(parsed.data).length !== Object.keys(raw).length) {
        throw new ProductionWorkflowDeletionError('Production request reference check is unavailable because durable storage is invalid', 'production_reference_check_unavailable', 503)
      }
      if (parsed.data.generatorId === generatorId && (parsed.data.status === 'pending' || parsed.data.status === 'running')) counts[parsed.data.status] += 1
    }
    return counts
  }

  previewGeneratorWorkflowDeletion(input) {
    if (!this.requests || !this.releaseWriterLock) {
      return Promise.reject(new ProductionWorkflowDeletionError('Production Request reference checks are unavailable', 'production_reference_check_unavailable', 503))
    }
    return this.mutate(async () => {
      const workflows = this.workflowStore()
      if (!workflows?.previewDelete) throw new ProductionWorkflowDeletionError('Generator Workflow Store deletion is unavailable', 'production_reference_check_unavailable', 503)
      const checked = await workflows.previewDelete(input)
      if (checked.replay) return { ...checked, blockers: { pending: 0, running: 0 }, canDelete: true }
      const blockers = this.workflowDeletionBlockers(input.generatorId)
      return { ...checked, blockers, canDelete: blockers.pending === 0 && blockers.running === 0 }
    })
  }

  deleteGeneratorWorkflow(input) {
    if (!this.requests || !this.releaseWriterLock) {
      return Promise.reject(new ProductionWorkflowDeletionError('Production Request reference checks are unavailable', 'production_reference_check_unavailable', 503))
    }
    return this.mutate(async () => {
      const workflows = this.workflowStore()
      if (!workflows?.delete) throw new ProductionWorkflowDeletionError('Generator Workflow Store deletion is unavailable', 'production_reference_check_unavailable', 503)
      const replay = workflows.deletionReplaySync?.(input)
      if (replay) return { record: await workflows.delete(input), replay: true, blockers: { pending: 0, running: 0 } }
      if (this.currentWorkflow(input.generatorId)?.action === 'delete') await workflows.delete(input)
      const blockers = this.workflowDeletionBlockers(input.generatorId)
      if (blockers.pending || blockers.running) {
        throw new ProductionWorkflowDeletionError('Pending or running Generation Requests block workflow deletion', 'workflow_active_requests', 409, { blockers })
      }
      return { record: await workflows.delete(input), replay: false, blockers }
    })
  }

  listRequests({ status, limit = 50 } = {}) {
    return Array.from(this.requireRequests().entries(), ([, value]) => value)
      .filter(item => !status || item.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
  }

  draftDeletionSync(draftId) {
    const raw = this.requireDraftDeletions().get(draftId)
    if (raw === undefined) return undefined
    const parsed = draftDeletionSchema.safeParse(raw)
    if (!parsed.success || parsed.data.draftId !== draftId || Object.keys(parsed.data).length !== Object.keys(raw).length) {
      throw new Error('Production draft deletion storage contains a malformed key or row')
    }
    return parsed.data
  }

  queryDrafts({ status, query = '', offset = 0, limit = 50 } = {}) {
    const normalizedQuery = typeof query === 'string' ? query.trim().toLowerCase() : ''
    const searchable = Array.from(this.requireDrafts().entries(), ([draftId, value]) => ({ draftId, value }))
      .filter(item => !this.draftDeletionSync(item.draftId))
      .map(item => item.value)
      .filter(item => !normalizedQuery || [item.draftId, item.title, item.generatorId, item.requestId]
        .some(value => typeof value === 'string' && value.toLowerCase().includes(normalizedQuery)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const statusCounts = searchable.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), {})
    const filtered = searchable.filter(item => !status || item.status === status)
    return { records: filtered.slice(offset, offset + limit), total: filtered.length, statusCounts }
  }

  listDrafts({ status, limit = 50 } = {}) { return this.queryDrafts({ status, limit }).records }

  publishedContentEntries() {
    const publishedDrafts = []
    for (const [draftId, raw] of this.requireDrafts().entries()) {
      const parsed = draftSchema.safeParse(raw)
      if (typeof draftId !== 'string' || !parsed.success || parsed.data.draftId !== draftId
        || Object.keys(parsed.data).length !== Object.keys(raw).length) {
        throw new Error('Production draft publication history is invalid')
      }
      const draft = parsed.data
      const hasPublished = draft.status === 'published'
        || draft.status === 'publishing' && draft.publishingPreviousStatus === 'published'
        || (draft.publishedPublisherIds?.length ?? 0) > 0
      if (hasPublished) publishedDrafts.push(draft)
    }
    publishedDrafts.sort((left, right) => (right.publishedAt ?? right.createdAt).localeCompare(left.publishedAt ?? left.createdAt)
      || left.draftId.localeCompare(right.draftId))
    const entries = new Map()
    for (const draft of publishedDrafts) {
      const rawRequest = this.requireRequests().get(draft.requestId)
      const parsedRequest = requestSchema.safeParse(rawRequest)
      if (!parsedRequest.success || Object.keys(parsedRequest.data).length !== Object.keys(rawRequest ?? {}).length
        || !exactRequestDraftLink(parsedRequest.data, draft)) {
        throw new Error('Published Draft generation provenance is invalid')
      }
      for (const storeId of draft.sourceContentStoreIds) {
        if (entries.has(storeId)) continue
        const material = parsedRequest.data.packedMaterials?.find(item => item.storeId === storeId)
        const record = this.ctx.prismContentStore.get(storeId)
        const item = record?.item ?? {}
        const title = material?.title ?? (typeof item.title === 'string' ? item.title : '')
        const summary = material?.aiSummary
          ?? material?.excerpts?.map(excerpt => excerpt.text).join(' ')
          ?? (typeof item.content === 'string' && item.content.trim() ? item.content : item.description)
          ?? title
        const publishedDateSource = [material?.publishedDate, item.published_date, draft.publishedAt, draft.createdAt]
          .find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))
        if (typeof title !== 'string' || typeof summary !== 'string' || !title.trim() || !summary.trim() || !publishedDateSource) {
          throw new Error(`Published Draft semantic source is unavailable: ${storeId}`)
        }
        entries.set(storeId, { storeId, title, summary, eventPublishedAt: new Date(Date.parse(publishedDateSource)).toISOString() })
      }
    }
    return [...entries.values()].sort((left, right) => left.storeId.localeCompare(right.storeId))
  }

  publishedContentStoreIds() { return new Set(this.publishedContentEntries().map(item => item.storeId)) }

  getDraft(draftId) { return this.draftDeletionSync(draftId) ? undefined : this.requireDrafts().get(draftId) }

  deleteDraft(draftId, expectedVersion, expectedSha256) {
    if (typeof draftId !== 'string' || draftId.length < 1 || draftId.length > 128 || /[\u0000-\u001f\u007f]/u.test(draftId)
      || !Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > 1_000_000_000
      || typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
      return Promise.reject(new DraftRevisionError('DraftRevisionValidationError', 'Draft deletion identity is invalid'))
    }
    return this.mutate(async () => {
      const existing = this.draftDeletionSync(draftId)
      if (existing) {
        if (existing.version === expectedVersion && existing.sha256 === expectedSha256) return { ...existing, replay: true }
        revisionConflict('Draft was already deleted with a different version or hash')
      }
      const draft = this.requireDrafts().get(draftId)
      if (!draft) revisionValidation(`Unknown production draft: ${draftId}`)
      if (!['draft', 'rejected', 'approved', 'published'].includes(draft.status)) revisionConflict(`Production draft cannot be deleted in status: ${draft.status}`)
      if (draft.version !== expectedVersion || draft.sha256 !== expectedSha256) revisionConflict('Draft version or hash changed before deletion')
      const request = this.requireRequests().get(draft.requestId)
      if (!exactRequestDraftLink(request, draft)) revisionConflict('Draft generation request provenance is unavailable or inconsistent')
      const tombstone = { draftId, requestId: draft.requestId, version: draft.version, sha256: draft.sha256,
        deletedAt: new Date().toISOString(), deletedFromStatus: draft.status }
      await this.requireDraftDeletions().put(draftId, tombstone)
      const verified = this.draftDeletionSync(draftId)
      if (!verified || verified.version !== draft.version || verified.sha256 !== draft.sha256) throw new Error('Draft deletion tombstone could not be verified')
      return { ...verified, replay: false }
    })
  }

  requestMediaClaims(request) {
    if (request?.packedMaterials) return request.packedMaterials
    if (!Array.isArray(request?.contentStoreIds) || request.contentStoreIds.length < 1) throw new Error('Generation request source media provenance is invalid')
    const records = request.contentStoreIds.map(id => this.ctx.prismContentStore.get(id))
    if (records.some(record => !record)) throw new Error('Generation source content is no longer available')
    return storedRecordMedia(records)
  }

  resolveDraftMedia(draftId, kind, url) {
    if (typeof draftId !== 'string' || draftId.length < 1 || draftId.length > 128 || /[\u0000-\u001f\u007f]/u.test(draftId)) mediaAdmission('Draft media reference is invalid')
    if (!['image', 'video'].includes(kind) || typeof url !== 'string' || url.length < 1 || url.length > 2_048 || /[\u0000-\u001f\u007f]/u.test(url)) {
      mediaAdmission('Draft media reference is invalid')
    }
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) mediaAdmission('Draft media reference is invalid')
    } catch (error) {
      if (error?.name === 'DraftMediaAdmissionError') throw error
      mediaAdmission('Draft media reference is invalid')
    }
    const draft = this.getDraft(draftId)
    const request = draft ? this.requireRequests().get(draft.requestId) : undefined
    if (!exactRequestDraftLink(request, draft)) {
      mediaAdmission('Draft media is not available')
    }
    let mediaClaims
    try { mediaClaims = this.requestMediaClaims(request) }
    catch { mediaAdmission('Draft media is not available') }
    const admitted = mediaClaims.some(material => material.media?.some(media => media.kind === kind && media.url === url)) === true
    if (!admitted) mediaAdmission('Draft media is not available')
    return { kind, url }
  }

  async reviseDraft(draftId, expectedVersion, expectedSha256, title, markdown, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).some(key => key !== 'allowSourceMediaRemoval')
      || options.allowSourceMediaRemoval !== undefined && options.allowSourceMediaRemoval !== true) {
      revisionValidation('Draft revision options are invalid')
    }
    validateRevisionInput(draftId, expectedVersion, expectedSha256, title, markdown)
    return this.mutate(async () => {
      const draft = this.getDraft(draftId)
      if (!draft) revisionValidation(`Unknown production draft: ${draftId}`)
      if (!['draft', 'rejected'].includes(draft.status)) revisionConflict(`Production draft is immutable in status: ${draft.status}`)
      if (draft.version !== expectedVersion || draft.sha256 !== expectedSha256) {
        revisionConflict('Draft version or hash changed before revision')
      }
      const request = this.requireRequests().get(draft.requestId)
      if (!exactRequestDraftLink(request, draft)) {
        revisionConflict('Draft generation request provenance is unavailable or inconsistent')
      }
      let mediaClaims
      try { mediaClaims = this.requestMediaClaims(request) }
      catch { revisionConflict('Draft source media provenance is unavailable') }
      const hasRequiredMedia = mediaClaims.some(material => (material.media?.length ?? 0) > 0)
      if (hasRequiredMedia && options.allowSourceMediaRemoval !== true) {
        const generator = request.executionKind === 'workflow-v1'
          ? this.workflowRunner(request.generatorWorkflowSnapshot?.executionProfile) : this.generators.get(draft.generatorId)
        if (!generator || typeof generator.validateDraft !== 'function') {
          revisionConflict('Draft generator structural validator is unavailable')
        }
        try { await generator.validateDraft(request, markdown) }
        catch (error) { revisionValidation(error instanceof Error ? error.message : 'Draft structural validation failed') }
      }
      const {
        approvedAt: _approvedAt, approvedVersion: _approvedVersion, approvedSha256: _approvedSha256,
        approvedArtifactBindingSha256: _approvedBinding, artifactBindingSha256: _binding,
        mediaAssets: _mediaAssets, destinationPresentations: _presentations,
        publishedAt: _publishedAt, publishedPublisherIds: _publishedPublisherIds, ...provenance
      } = draft
      const at = new Date().toISOString()
      const nextVersion = draft.version + 1
      const nextSha256 = artifactSha256(markdown)
      let presentationBinding
      if (draft.artifactBindingSha256 !== undefined) {
        const candidate = {
          draftId, draftVersion: nextVersion, artifactSha256: nextSha256, title, markdown,
          sourceContentStoreIds: draft.sourceContentStoreIds,
          ...(draft.workflowInputSha256 ? { workflowInputSha256: draft.workflowInputSha256 } : {}), artifactBindingSha256: '',
          mediaAssets: draft.mediaAssets, destinationPresentations: draft.destinationPresentations,
        }
        candidate.artifactBindingSha256 = productionArtifactBindingSha256(candidate)
        const normalized = normalizeProductionArtifactV2(candidate)
        const mediaStore = this.ctx.get?.('prismProductionMedia') ?? this.ctx.prismProductionMedia
        if (!mediaStore || typeof mediaStore.assertClaims !== 'function') throw new Error('Production media store is unavailable')
        await mediaStore.assertClaims(normalized.mediaAssets ?? [])
        presentationBinding = { artifactBindingSha256: normalized.artifactBindingSha256,
          ...(normalized.mediaAssets ? { mediaAssets: normalized.mediaAssets } : {}),
          ...(normalized.destinationPresentations ? { destinationPresentations: normalized.destinationPresentations } : {}) }
      }
      const next = {
        ...provenance, title, markdown, sha256: nextSha256, version: nextVersion,
        status: 'draft', updatedAt: at, ...presentationBinding,
      }
      await this.requireDrafts().put(draftId, next)
      return next
    })
  }

  listPublicationAttempts({ draftId, publisherId, limit = 20, offset = 0 } = {}) {
    if (draftId !== undefined && (typeof draftId !== 'string' || draftId.length < 1 || draftId.length > 128)) throw new Error('Publication attempt draftId is invalid')
    if (publisherId !== undefined && (typeof publisherId !== 'string' || publisherId.length < 1 || publisherId.length > 256)) throw new Error('Publication attempt publisherId is invalid')
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error('Publication attempt pagination is invalid')
    return Array.from(this.requireAttempts().entries(), ([key, raw]) => {
      const parsed = attemptSchema.safeParse(raw)
      if (!parsed.success || key !== parsed.data.attemptId || Object.keys(parsed.data).length !== Object.keys(raw).length) throw new Error('Publication attempt storage contains a malformed key or row')
      return parsed.data
    }).filter(item => !draftId || item.draftId === draftId).filter(item => !publisherId || item.publisherId === publisherId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.attemptNumber - a.attemptNumber)
      .slice(offset, offset + limit).map(item => structuredClone(item))
  }

  /** Privileged operator-only seam. Dashboard exposes only exact, confirmed-absent WeChat resolution; Chat has no access. */
  async reconcilePublication(draftId, publisherId, attemptId, outcome) {
    if (typeof attemptId !== 'string' || !['committed', 'not-committed'].includes(outcome)) throw new Error('Operator reconciliation attempt and outcome are required')
    return this.mutate(async () => {
      const draft = this.requireDrafts().get(draftId)
      const attempt = this.requireAttempts().get(attemptId)
      if (!draft || draft.status !== 'publishing' || draft.publishingPublisherId !== publisherId
        || draft.publishingAttemptId !== attemptId || draft.publishingOutcome !== 'unknown'
        || !attempt || attempt.publisherId !== publisherId || attempt.draftId !== draftId || attempt.state !== 'reconciliation-required') {
        throw new Error('Production draft does not require reconciliation for this exact attempt')
      }
      if (attempt.reconciliationReason === 'receipt-persistence-failure') {
        throw new Error('Receipt persistence failure must be repaired from its durable candidate before reconciliation')
      }
      if (outcome === 'committed') {
        const artifact = approvedArtifact({ ...draft, status: draft.publishingPreviousStatus })
        const inspection = attempt.legacyClaim
          ? await this.ctx.prismPublicationReceipts.inspectArtifactPublication(publisherId, artifact)
          : await this.ctx.prismPublicationReceipts.inspectAttemptPublication(attempt, artifact)
        if (inspection.outcome !== 'committed') throw new Error('Exact publication attempt Receipt must be persisted before committed reconciliation')
        await this.completeAttemptAndDraft(draft, attempt, inspection.receipt)
      } else {
        await this.updateAttempt(attemptId, { state: 'not-committed', reconciliationReason: undefined, reconciliationOperation: undefined, receiptCandidate: undefined, completedAt: new Date().toISOString() })
        await this.restorePublicationDraft(draft, attempt)
      }
      return this.requireDrafts().get(draftId)
    })
  }

  /** Privileged operator attestation for an externally verified WeChat draft whose create response was lost. */
  async confirmCommittedPublication(draftId, publisherId, attemptId) {
    return this.mutate(async () => {
      const draft = this.requireDrafts().get(draftId)
      const attempt = this.requireAttempts().get(attemptId)
      const active = !!draft && draft.status === 'publishing' && draft.publishingPublisherId === publisherId
        && draft.publishingAttemptId === attemptId && draft.publishingOutcome === 'unknown'
        && attempt?.state === 'reconciliation-required' && attempt.reconciliationReason === 'external-unknown'
      const retrospective = !!draft && ['approved', 'published'].includes(draft.status) && attempt?.state === 'not-committed'
        && attempt.terminalFailure?.externalOutcome === 'unknown'
      if (!attempt || attempt.publisherId !== publisherId || attempt.draftId !== draftId || (!active && !retrospective)) {
        throw new Error('Production draft does not have an exact operator-confirmable publication attempt')
      }
      if (!publisherId.startsWith('wechat-draft:')) throw new Error('Operator committed attestation is restricted to WeChat draft publishers')
      if (Array.from(this.requireAttempts().entries(), ([, row]) => row).some(row => row.draftId === draftId && row.publisherId === publisherId && row.attemptNumber > attempt.attemptNumber)) {
        throw new Error('A later publication attempt prevents retrospective committed attestation')
      }
      const artifact = approvedArtifact(active ? { ...draft, status: draft.publishingPreviousStatus } : draft)
      if (artifact.draftVersion !== attempt.draftVersion || artifact.artifactSha256 !== attempt.artifactSha256
        || artifact.artifactBindingSha256 !== attempt.artifactBindingSha256 || !artifact.sourceContentStoreIds.length) {
        throw new Error('Operator committed attestation does not match the exact attempted Artifact')
      }
      const receipt = await this.ctx.prismPublicationReceipts.append({
        publisherId, status: 'created', itemCount: artifact.sourceContentStoreIds.length, truncated: 0,
        bytes: Buffer.byteLength(artifact.markdown, 'utf8'), sha256: artifact.artifactSha256,
        publishedAt: new Date().toISOString(), contentStoreIds: artifact.sourceContentStoreIds,
        operation: 'draft.add.operator-confirmed', verification: 'unverified',
        draftId: artifact.draftId, draftVersion: artifact.draftVersion, artifactSha256: artifact.artifactSha256,
        ...(artifact.artifactBindingSha256 ? { artifactBindingSha256: artifact.artifactBindingSha256 } : {}),
      }, { receiptId: attempt.receiptId, publicationAttemptId: attempt.attemptId, publicationAttemptNumber: attempt.attemptNumber,
        publicationIntent: attempt.intent, trigger: attempt.trigger })
      const inspection = await this.ctx.prismPublicationReceipts.inspectAttemptPublication(attempt, artifact)
      if (inspection.outcome !== 'committed') throw new Error('Operator-confirmed publication Receipt could not be verified')
      if (active) await this.completeAttemptAndDraft(draft, attempt, inspection.receipt ?? receipt)
      else {
        const at = new Date().toISOString()
        await this.updateAttempt(attemptId, { state: 'completed', publicationStatus: (inspection.receipt ?? receipt).status,
          reconciliationReason: undefined, reconciliationOperation: undefined, receiptCandidate: undefined, terminalFailure: undefined,
          terminalReceipt: normalizedReceiptCandidate(inspection.receipt ?? receipt), completedAt: at })
        await this.requireDrafts().put(draftId, { ...draft, status: 'published', publishedAt: draft.publishedAt ?? at,
          publishedPublisherIds: [...new Set([...(draft.publishedPublisherIds ?? []), publisherId])], updatedAt: at })
      }
      return this.requireDrafts().get(draftId)
    })
  }

  /** Explicit duplicate-risk policy seam: preserve unknown external truth while unblocking a new attempt. */
  async allowUnknownPublicationRetry(draftId, publisherId, attemptId) {
    return this.mutate(async () => {
      const draft = this.requireDrafts().get(draftId)
      const attempt = this.requireAttempts().get(attemptId)
      if (!draft || draft.status !== 'publishing' || draft.publishingPublisherId !== publisherId
        || draft.publishingAttemptId !== attemptId || draft.publishingOutcome !== 'unknown'
        || !attempt || attempt.publisherId !== publisherId || attempt.draftId !== draftId
        || attempt.state !== 'reconciliation-required' || attempt.reconciliationReason !== 'external-unknown') {
        throw new Error('Production draft does not have an exact retry-eligible unknown attempt')
      }
      await this.updateAttempt(attemptId, { state: 'not-committed', reconciliationReason: undefined, reconciliationOperation: undefined,
        terminalFailure: { kind: 'publisher-not-committed', operation: attempt.reconciliationOperation ?? 'draft-create', externalOutcome: 'unknown' },
        receiptCandidate: undefined, completedAt: new Date().toISOString() })
      await this.restorePublicationDraft(draft, attempt)
      return this.requireDrafts().get(draftId)
    })
  }

  /** Privileged repair for a committed result whose normalized Receipt failed to persist. */
  async repairPublicationReceipt(draftId, publisherId, attemptId) {
    return this.mutate(async () => {
      const draft = this.requireDrafts().get(draftId)
      const attempt = this.requireAttempts().get(attemptId)
      if (!draft || draft.status !== 'publishing' || draft.publishingAttemptId !== attemptId
        || draft.publishingPublisherId !== publisherId || !attempt || attempt.reconciliationReason !== 'receipt-persistence-failure'
        || !attempt.receiptCandidate) throw new Error('Publication attempt has no repairable Receipt candidate')
      await this.ctx.prismPublicationReceipts.append(attempt.receiptCandidate, {
        receiptId: attempt.receiptId, publicationAttemptId: attempt.attemptId, publicationAttemptNumber: attempt.attemptNumber,
        publicationIntent: attempt.intent, trigger: attempt.trigger,
      })
      const artifact = approvedArtifact({ ...draft, status: draft.publishingPreviousStatus })
      const inspection = await this.ctx.prismPublicationReceipts.inspectAttemptPublication(attempt, artifact)
      if (inspection.outcome === 'none' || inspection.outcome === 'ambiguous') throw new Error('Exact publication attempt Receipt repair could not be verified')
      if (inspection.outcome === 'committed') await this.completeAttemptAndDraft(draft, attempt, inspection.receipt)
      else { await this.updateAttempt(attemptId, { state: 'skipped', reconciliationReason: undefined, receiptCandidate: undefined, completedAt: new Date().toISOString() }); await this.restorePublicationDraft(draft, attempt) }
      return inspection.receipt
    })
  }

  async resolveDraftAsset(draftId, assetId) {
    const draft = this.getDraft(draftId)
    const claim = draft?.mediaAssets?.find(item => item.assetId === assetId)
    if (!claim) mediaAdmission('Draft media asset is not available')
    const mediaStore = this.ctx.get?.('prismProductionMedia') ?? this.ctx.prismProductionMedia
    if (!mediaStore || typeof mediaStore.resolve !== 'function') throw new Error('Production media store is unavailable')
    return mediaStore.resolve(claim)
  }

  async createApprovedDraftImageRevision(sourceDraftId, expectedVersion, expectedSha256, publisherId, newAssets, placement) {
    return this.mutate(async () => {
      const source = this.getDraft(sourceDraftId)
      const sourceRequest = source ? this.requireRequests().get(source.requestId) : undefined
      if (!source || !['approved', 'published'].includes(source.status) || !exactRequestDraftLink(sourceRequest, source)) {
        revisionConflict('Only an exact approved or published Draft can create a presentation revision')
      }
      if (source.version !== expectedVersion || source.sha256 !== expectedSha256
        || source.approvedVersion !== source.version || source.approvedSha256 !== source.sha256
        || source.approvedArtifactBindingSha256 !== source.artifactBindingSha256) {
        revisionConflict('Approved Draft version, hash, or presentation binding changed before revision')
      }
      const publisher = this.ctx.prismPublishers.list().find(item => item.id === publisherId)
      if (!publisher || publisher.kind !== 'wechat-draft') revisionValidation('publisherId must identify a configured WeChat publisher')
      if (!Array.isArray(newAssets) || newAssets.length < 1 || newAssets.length > 20
        || !['cover-and-first', 'append', 'cover-only'].includes(placement)) {
        revisionValidation('Approved Draft image revision arguments are invalid')
      }
      const existingAssets = source.mediaAssets ?? []
      const byId = new Map(existingAssets.map(asset => [asset.assetId, asset]))
      for (const asset of newAssets) {
        const parsed = mediaAssetClaimSchema.safeParse(asset)
        if (!parsed.success) mediaAdmission('Approved Draft image revision contains an invalid media claim')
        const existing = byId.get(parsed.data.assetId)
        if (existing && JSON.stringify(existing) !== JSON.stringify(parsed.data)) mediaAdmission('Approved Draft image claim conflicts with an existing claim')
        byId.set(parsed.data.assetId, parsed.data)
      }
      const mediaAssets = Array.from(byId.values())
      const newAssetIds = newAssets.map(asset => asset.assetId)
      const presentations = [...(source.destinationPresentations ?? [])]
      const presentationIndex = presentations.findIndex(item => item.publisherId === publisherId)
      const previous = presentationIndex >= 0 ? presentations[presentationIndex] : { publisherId }
      const oldOrder = previous.imageOrder ?? []
      const imageOrder = placement === 'append'
        ? [...new Set([...oldOrder, ...newAssetIds])]
        : placement === 'cover-and-first'
          ? [...new Set([...newAssetIds, ...oldOrder])]
          : oldOrder
      const nextPresentation = {
        ...previous,
        ...(placement === 'cover-only' || placement === 'cover-and-first' ? { cover: { assetId: newAssetIds[0] } } : {}),
        ...(imageOrder.length ? { imageOrder } : {}),
      }
      if (presentationIndex >= 0) presentations[presentationIndex] = nextPresentation
      else presentations.push(nextPresentation)

      const requestId = randomUUID()
      const draftId = randomUUID()
      const at = new Date().toISOString()
      const derivation = {
        kind: 'approved-presentation-revision-v1', sourceRequestId: source.requestId, sourceDraftId,
        sourceDraftVersion: source.version, sourceDraftSha256: source.sha256, sourceStatus: source.status,
        ...(source.artifactBindingSha256 ? { sourceArtifactBindingSha256: source.artifactBindingSha256 } : {}),
      }
      const candidate = {
        draftId, draftVersion: 1, artifactSha256: source.sha256, title: source.title, markdown: source.markdown,
        sourceContentStoreIds: source.sourceContentStoreIds,
        ...(source.workflowInputSha256 ? { workflowInputSha256: source.workflowInputSha256 } : {}), artifactBindingSha256: '', mediaAssets, destinationPresentations: presentations,
      }
      candidate.artifactBindingSha256 = productionArtifactBindingSha256(candidate)
      const normalized = normalizeProductionArtifactV2(candidate)
      const mediaStore = this.ctx.get?.('prismProductionMedia') ?? this.ctx.prismProductionMedia
      if (!mediaStore || typeof mediaStore.assertClaims !== 'function') throw new Error('Production media store is unavailable')
      await mediaStore.assertClaims(normalized.mediaAssets ?? [])

      const { requestId: _oldRequestId, draftId: _oldRequestDraftId, status: _oldRequestStatus,
        createdAt: _oldRequestCreatedAt, updatedAt: _oldRequestUpdatedAt, errorCode: _oldRequestError,
        derivation: _oldRequestDerivation, ...requestProvenance } = sourceRequest
      const request = { ...requestProvenance, requestId, status: 'completed', draftId, createdAt: at, updatedAt: at, derivation }
      const draft = {
        draftId, requestId, generatorId: source.generatorId,
        ...(source.generatorPromptVersion !== undefined ? { generatorPromptVersion: source.generatorPromptVersion, generatorPromptSha256: source.generatorPromptSha256 } : {}),
        ...(source.executionKind === 'workflow-v1' ? { executionKind: source.executionKind, generatorWorkflowVersion: source.generatorWorkflowVersion,
          generatorWorkflowSha256: source.generatorWorkflowSha256 } : {}),
        title: source.title, markdown: source.markdown, sha256: source.sha256, version: 1, status: 'draft',
        sourceContentStoreIds: [...source.sourceContentStoreIds],
        ...(source.workflowInputSha256 ? { workflowInputSha256: source.workflowInputSha256 } : {}), createdAt: at, updatedAt: at,
        ...(source.selectionId ? { selectionId: source.selectionId, selectionSha256: source.selectionSha256 } : {}),
        ...(source.sourceContentClaims ? { sourceContentClaims: structuredClone(source.sourceContentClaims) } : {}),
        artifactBindingSha256: normalized.artifactBindingSha256, mediaAssets: normalized.mediaAssets,
        destinationPresentations: normalized.destinationPresentations, derivation,
      }
      const parsedRequest = requestSchema.safeParse(request)
      const parsedDraft = draftSchema.safeParse(draft)
      if (!parsedRequest.success || !parsedDraft.success || !exactRequestDraftLink(parsedRequest.data, parsedDraft.data)) {
        throw new Error('Approved Draft presentation revision could not preserve exact generation provenance')
      }
      await this.requireRequests().put(requestId, parsedRequest.data)
      try { await this.requireDrafts().put(draftId, parsedDraft.data) }
      catch (error) { await this.requireRequests().delete(requestId).catch(() => {}); throw error }
      return parsedDraft.data
    })
  }

  async setDraftPresentation(draftId, expectedVersion, expectedSha256, mediaAssets, destinationPresentations) {
    return this.mutate(async () => {
      const draft = this.getDraft(draftId)
      if (!draft || !['draft', 'rejected'].includes(draft.status)) revisionConflict('Production draft cannot accept presentation metadata')
      if (!exactRequestDraftLink(this.requireRequests().get(draft.requestId), draft)) revisionConflict('Draft generation request provenance is unavailable or inconsistent')
      if (draft.version !== expectedVersion || draft.sha256 !== expectedSha256) revisionConflict('Draft version or hash changed before presentation update')
      const nextVersion = draft.version + 1
      const candidate = {
        draftId, draftVersion: nextVersion, artifactSha256: draft.sha256, title: draft.title, markdown: draft.markdown,
        sourceContentStoreIds: draft.sourceContentStoreIds,
        ...(draft.workflowInputSha256 ? { workflowInputSha256: draft.workflowInputSha256 } : {}), artifactBindingSha256: '', mediaAssets, destinationPresentations,
      }
      candidate.artifactBindingSha256 = productionArtifactBindingSha256(candidate)
      const normalized = normalizeProductionArtifactV2(candidate)
      const mediaStore = this.ctx.get?.('prismProductionMedia') ?? this.ctx.prismProductionMedia
      if (!mediaStore || typeof mediaStore.assertClaims !== 'function') throw new Error('Production media store is unavailable')
      await mediaStore.assertClaims(normalized.mediaAssets ?? [])
      const {
        approvedAt: _approvedAt, approvedVersion: _approvedVersion, approvedSha256: _approvedSha256,
        approvedArtifactBindingSha256: _approvedBinding, publishedAt: _publishedAt,
        publishedPublisherIds: _publishedPublisherIds, ...rest
      } = draft
      const next = { ...rest, version: nextVersion, status: 'draft', artifactBindingSha256: normalized.artifactBindingSha256,
        mediaAssets: normalized.mediaAssets, destinationPresentations: normalized.destinationPresentations, updatedAt: new Date().toISOString() }
      await this.requireDrafts().put(draftId, next)
      return next
    })
  }

  async resolveArtifactMedia(publisherId, artifact, assetId) {
    this.assertPublicationArtifact(publisherId, artifact)
    const claim = artifact.mediaAssets?.find(item => item.assetId === assetId)
    if (!claim) mediaAdmission('Artifact media is not claimed')
    const mediaStore = this.ctx.get?.('prismProductionMedia') ?? this.ctx.prismProductionMedia
    if (!mediaStore || typeof mediaStore.resolve !== 'function') throw new Error('Production media store is unavailable')
    return mediaStore.resolve(claim)
  }

  assertPublicationArtifact(publisherId, artifact) {
    const claim = this.publicationClaims.get(artifact?.draftId)
    const draft = this.requireDrafts().get(artifact?.draftId)
    const durableAttempt = claim ? this.requireAttempts().get(claim.attemptId) : undefined
    const request = draft ? this.requireRequests().get(draft.requestId) : undefined
    if (!claim || claim.publisherId !== publisherId || claim.artifact !== artifact
      || !durableAttempt || durableAttempt.attemptId !== claim.attemptId || durableAttempt.receiptId !== claim.receiptId
      || durableAttempt.attemptNumber !== claim.attemptNumber || durableAttempt.intent !== claim.intent
      || durableAttempt.intentId !== claim.intentId || durableAttempt.publisherId !== publisherId || durableAttempt.state !== 'destination-started'
      || !draft || draft.status !== 'publishing'
      || draft.publishingAttemptId !== claim.attemptId || draft.publishingAttemptNumber !== claim.attemptNumber
      || draft.publishingReceiptId !== claim.receiptId || draft.publishingIntent !== claim.intent
      || draft.publishingIntentId !== claim.intentId || !exactRequestDraftLink(request, draft)
      || draft.approvedVersion !== artifact.draftVersion
      || draft.approvedSha256 !== artifact.artifactSha256
      || draft.version !== artifact.draftVersion
      || draft.sha256 !== artifact.artifactSha256
      || draft.title !== artifact.title
      || draft.markdown !== artifact.markdown
      || draft.artifactBindingSha256 !== artifact.artifactBindingSha256
      || JSON.stringify(draft.mediaAssets) !== JSON.stringify(artifact.mediaAssets)
      || JSON.stringify(draft.destinationPresentations) !== JSON.stringify(artifact.destinationPresentations)
      || !Array.isArray(artifact.sourceContentStoreIds)
      || draft.sourceContentStoreIds.length !== artifact.sourceContentStoreIds.length
      || draft.sourceContentStoreIds.some((id, index) => id !== artifact.sourceContentStoreIds[index])) {
      throw new Error('Publication artifact does not match the active approved draft claim')
    }
    return true
  }

  publicationExecutionClaim(publisherId, artifact) {
    this.assertPublicationArtifact(publisherId, artifact)
    const claim = this.publicationClaims.get(artifact.draftId)
    return { attemptId: claim.attemptId, attemptNumber: claim.attemptNumber, receiptId: claim.receiptId,
      intent: claim.intent, trigger: claim.trigger }
  }

  async beginMaintenanceDrain() {
    this.maintenanceDraining = true
    await Promise.allSettled([...this.inFlight])
    await this.tail
    return { drained: true, active: this.inFlight.size, restartAllowed: this.inFlight.size === 0 }
  }

  maintenanceStatus() {
    return { draining: this.maintenanceDraining, active: this.inFlight.size,
      restartAllowed: this.maintenanceDraining && this.inFlight.size === 0 }
  }

  async shutdown() {
    if (!this.stopping) {
      this.stopping = true
      this.shutdownController.abort(new Error('PrismFlow production store is stopping'))
    }
    await Promise.allSettled([...this.inFlight])
    await this.tail
  }

  executionWithShutdown(execution = {}) {
    const signals = [execution.signal, this.shutdownController.signal].filter(Boolean)
    return { ...execution, signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }
  }

  getRequest(requestId) { return this.requireRequests().get(requestId) }

  generateCoverAsset(requestId, execution, render) {
    if (!execution?.agent) return Promise.reject(new Error('PrismFlow cover asset generation requires a calling DSH Agent'))
    if (typeof render !== 'function') return Promise.reject(new Error('PrismFlow cover asset renderer is unavailable'))
    if (this.stopping) return Promise.reject(new Error('PrismFlow production store is stopping'))
    if (this.maintenanceDraining) return Promise.reject(new Error('PrismFlow production admission is paused for maintenance drain'))
    const operation = this.generateCoverAssetInner(requestId, this.executionWithShutdown(execution), render)
    this.inFlight.add(operation)
    operation.finally(() => this.inFlight.delete(operation)).catch(() => {})
    return operation
  }

  async generateCoverAssetInner(requestId, execution, render) {
    const controller = new AbortController()
    const abort = () => controller.abort(execution.signal?.reason ?? new Error('Cover asset generation aborted'))
    if (execution.signal?.aborted) abort()
    else execution.signal?.addEventListener('abort', abort, { once: true })
    let claimed
    try {
      claimed = await this.mutate(async () => {
        const request = this.requireRequests().get(requestId)
        if (!request) throw new Error(`Unknown generation request: ${requestId}`)
        if (request.outputKind !== 'cover-asset-v1') throw new Error('Generation request is not a cover asset request')
        if (request.status !== 'pending' && request.status !== 'failed') throw new Error(`Generation request is not runnable: ${request.status}`)
        if (request.generatorId !== COVER_ASSET_GENERATOR_ID || request.generatorPromptVersion !== COVER_ASSET_PROMPT_VERSION
          || request.generatorPromptSha256 !== COVER_ASSET_PROMPT_SHA256 || !request.workflowInput
          || productionWorkflowInputSha256(request.workflowInput) !== request.workflowInputSha256) {
          throw new Error('Cover asset request provenance is invalid')
        }
        const binding = parseCoverAssetBinding(request.workflowInput)
        this.assertCoverAssetBinding(binding)
        const attempt = (request.attempt ?? 0) + 1
        const next = { ...request, status: 'running', attempt, outputAsset: undefined, errorCode: undefined, updatedAt: new Date().toISOString() }
        await this.requireRequests().put(requestId, next)
        this.activeRuns.set(requestId, { attempt, controller })
        return next
      })
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Cover asset generation aborted')
      const binding = parseCoverAssetBinding(claimed.workflowInput)
      const output = await render(structuredClone(binding), { ...execution, signal: controller.signal })
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Cover asset generation aborted')
      if (!output?.asset) throw new Error('Generated cover asset Claim is required')
      this.assertCoverAssetBinding(binding)
      const mediaStore = this.ctx.get?.('prismProductionMedia') ?? this.ctx.prismProductionMedia
      if (!mediaStore?.assertClaims) throw new Error('Production media claim validation is unavailable')
      await mediaStore.assertClaims([output.asset])
      const completed = await this.mutate(async () => {
        const current = this.requireRequests().get(requestId)
        if (current?.status !== 'running' || current.attempt !== claimed.attempt) throw new Error('Cover asset request state changed during generation')
        const next = { ...current, status: 'completed', outputAsset: structuredClone(output.asset), updatedAt: new Date().toISOString() }
        await this.requireRequests().put(requestId, next)
        const committed = this.requireRequests().get(requestId)
        if (committed?.status !== 'completed' || committed.outputKind !== 'cover-asset-v1'
          || JSON.stringify(committed.outputAsset) !== JSON.stringify(output.asset)) throw new Error('Cover asset generation commit could not be verified')
        return committed
      }, true)
      return { request: completed, binding, ...output }
    } catch (error) {
      if (claimed) await this.failRequest(requestId, claimed.attempt, controller.signal.aborted ? 'cancelled' : 'generation-failed')
      throw error
    } finally {
      execution.signal?.removeEventListener('abort', abort)
      const active = this.activeRuns.get(requestId)
      if (claimed && active?.attempt === claimed.attempt) this.activeRuns.delete(requestId)
    }
  }

  generate(requestId, execution) {
    if (!execution?.agent) return Promise.reject(new Error('PrismFlow draft generation requires a calling DSH Agent'))
    if (this.stopping) return Promise.reject(new Error('PrismFlow production store is stopping'))
    if (this.maintenanceDraining) return Promise.reject(new Error('PrismFlow production admission is paused for maintenance drain'))
    const operation = this.generateInner(requestId, this.executionWithShutdown(execution))
    this.inFlight.add(operation)
    operation.finally(() => this.inFlight.delete(operation)).catch(() => {})
    return operation
  }

  async generateInner(requestId, execution) {
    const controller = new AbortController()
    const abort = () => controller.abort(execution.signal?.reason ?? new Error('Generation aborted'))
    if (execution.signal?.aborted) abort()
    else execution.signal?.addEventListener('abort', abort, { once: true })
    let claimed
    try {
      claimed = await this.mutate(async () => {
        const request = this.requireRequests().get(requestId)
        if (!request) throw new Error(`Unknown generation request: ${requestId}`)
        if (request.outputKind !== undefined) throw new Error('Cover asset requests must be run by prismflow_generate_cover_asset_from_draft')
        if (request.status !== 'pending' && request.status !== 'failed') throw new Error(`Generation request is not runnable: ${request.status}`)
        if (request.executionKind === 'workflow-v1') {
          if (!Number.isInteger(request.generatorWorkflowVersion) || !/^[a-f0-9]{64}$/u.test(request.generatorWorkflowSha256 ?? '')
            || !request.generatorWorkflowSnapshot || generatorWorkflowSha256(request.generatorWorkflowSnapshot) !== request.generatorWorkflowSha256) {
            throw new Error('Generation request workflow provenance is invalid')
          }
        } else if (!Number.isInteger(request.generatorPromptVersion) || request.generatorPromptVersion < 0
          || !/^[a-f0-9]{64}$/u.test(request.generatorPromptSha256 ?? '')) {
          throw new Error('Generation request predates prompt provenance and cannot be run; create a new request')
        }
        const attempt = (request.attempt ?? 0) + 1
        const next = { ...request, status: 'running', attempt, updatedAt: new Date().toISOString(), errorCode: undefined }
        await this.requireRequests().put(requestId, next)
        this.activeRuns.set(requestId, { attempt, controller })
        return next
      })
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Generation aborted')
      const generator = claimed.executionKind === 'workflow-v1'
        ? this.workflowRunner(claimed.generatorWorkflowSnapshot.executionProfile) : this.generators.get(claimed.generatorId)
      if (!generator) throw new Error(claimed.executionKind === 'workflow-v1'
        ? 'Pinned workflow execution profile is unavailable' : `Production generator is unavailable: ${claimed.generatorId}`)
      if (claimed.selectionId) {
        const provider = this.materialProviders.get('ai-selection')
        if (!provider) throw new Error('AI selection material provider is unavailable')
        const current = await provider.resolve(claimed.selectionId)
        if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Generation aborted')
        if (current.selectionSha256 !== claimed.selectionSha256
          || JSON.stringify(current.contentStoreIds) !== JSON.stringify(claimed.contentStoreIds)
          || JSON.stringify(current.sourceContentClaims) !== JSON.stringify(claimed.sourceContentClaims)
          || JSON.stringify(current.packedMaterials) !== JSON.stringify(claimed.packedMaterials)) {
          throw new Error('AI selection material no longer matches the generation request')
        }
      }
      if ((claimed.workflowInput === undefined) !== (claimed.workflowInputSha256 === undefined)
        || claimed.workflowInput && productionWorkflowInputSha256(claimed.workflowInput) !== claimed.workflowInputSha256
        || claimed.contentStoreIds.length === 0 && !claimed.workflowInput) {
        throw new Error('Generation workflowInput provenance is invalid')
      }
      const records = claimed.contentStoreIds.map(id => this.ctx.prismContentStore.get(id))
      if (records.some(record => !record)) throw new Error('Generation source content is no longer available')
      const runExecution = { ...execution, signal: controller.signal }
      const output = claimed.executionKind === 'workflow-v1'
        ? await generator.generate(claimed.generatorWorkflowSnapshot, claimed, records, runExecution)
        : await generator.generate(claimed, records, runExecution)
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Generation aborted')
      const maxOutputChars = claimed.executionKind === 'workflow-v1'
        ? claimed.generatorWorkflowSnapshot.executionProfile.ceilings.maxFinalOutputChars : generator.maxOutputChars
      if (claimed.generatorWorkflowSnapshot?.saveAsDraft === false) {
        const result = workflowResultSchema.parse({ ...normalizeGeneratedContent(output, maxOutputChars), mediaAssets: output.mediaAssets ?? [] })
        const media = this.ctx.get?.('prismProductionMedia') ?? this.ctx.prismProductionMedia
        if (result.mediaAssets.length) {
          if (!media?.assertClaims) throw new Error('Production media claim validation is unavailable')
          await media.assertClaims(result.mediaAssets)
        }
        await this.mutate(async () => {
          if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Generation aborted')
          const current = this.requireRequests().get(requestId)
          if (current?.status !== 'running' || current.attempt !== claimed.attempt) throw new Error('Generation request state changed during generation')
          const completed = requestSchema.parse({ ...current, status: 'completed', outputKind: 'workflow-result-v1',
            outputResult: result, outputResultSha256: workflowResultSha256(result), updatedAt: new Date().toISOString() })
          try {
            await this.requireRequests().put(requestId, completed)
            if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Generation aborted')
            const committed = requestSchema.parse(this.requireRequests().get(requestId))
            if (committed.status !== 'completed' || committed.outputResultSha256 !== completed.outputResultSha256) throw new Error('Workflow result commit could not be verified')
          } catch (error) {
            await this.requireRequests().put(requestId, current)
            throw error
          }
        }, true)
        return this.getWorkflowResult(requestId)
      }
      const draft = normalizeGeneratedDraft(claimed, output, maxOutputChars)
      await this.mutate(async () => {
        if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Generation aborted')
        const current = this.requireRequests().get(requestId)
        if (current?.status !== 'running' || current.attempt !== claimed.attempt) throw new Error('Generation request state changed during generation')
        let attemptedDraft = false
        try {
          attemptedDraft = true
          await this.requireDrafts().put(draft.draftId, draft)
          if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Generation aborted')
          await this.requireRequests().put(requestId, { ...current, status: 'completed', draftId: draft.draftId, updatedAt: new Date().toISOString() })
          if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Generation aborted')
          const committedRequest = this.requireRequests().get(requestId)
          const committedDraft = this.requireDrafts().get(draft.draftId)
          if (!exactRequestDraftLink(committedRequest, committedDraft)) {
            throw new Error('Generation final commit could not be verified')
          }
        } catch (error) {
          const rollbackErrors = []
          if (attemptedDraft) {
            try {
              if (typeof this.requireDrafts().delete !== 'function') throw new Error('Draft table cannot roll back a partial generation commit')
              await this.requireDrafts().delete(draft.draftId)
            } catch (rollbackError) { rollbackErrors.push(rollbackError) }
          }
          try {
            const persisted = this.requireRequests().get(requestId)
            if (persisted?.attempt === claimed.attempt && persisted.draftId === draft.draftId) {
              await this.requireRequests().put(requestId, { ...persisted, status: 'running', draftId: undefined, errorCode: undefined, updatedAt: new Date().toISOString() })
            }
          } catch (rollbackError) { rollbackErrors.push(rollbackError) }
          if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Generation commit and rollback failed')
          throw error
        }
      }, true)
      return draft
    } catch (error) {
      if (claimed) await this.failRequest(requestId, claimed.attempt, controller.signal.aborted ? 'cancelled' : 'generation-failed')
      throw error
    } finally {
      execution.signal?.removeEventListener('abort', abort)
      const active = this.activeRuns.get(requestId)
      if (claimed && active?.attempt === claimed.attempt) this.activeRuns.delete(requestId)
    }
  }

  async getWorkflowResult(requestId) {
    const request = requestSchema.parse(this.requireRequests().get(requestId))
    if (request.status !== 'completed' || request.outputKind !== 'workflow-result-v1') throw new Error('Request has no completed workflow result')
    if (request.outputResult.mediaAssets.length) {
      const media = this.ctx.get?.('prismProductionMedia') ?? this.ctx.prismProductionMedia
      if (!media?.assertClaims) throw new Error('Production media claim validation is unavailable')
      await media.assertClaims(request.outputResult.mediaAssets)
    }
    return { requestId, generatorId: request.generatorId, generatorWorkflowVersion: request.generatorWorkflowVersion,
      generatorWorkflowSha256: request.generatorWorkflowSha256, status: 'completed', draftCreated: false,
      outputKind: request.outputKind, outputResultSha256: request.outputResultSha256, ...structuredClone(request.outputResult) }
  }

  async cancel(requestId) {
    let active
    const request = await this.mutate(async () => {
      const current = this.requireRequests().get(requestId)
      if (!current) throw new Error(`Unknown generation request: ${requestId}`)
      if (!['pending', 'failed', 'running'].includes(current.status)) throw new Error(`Generation request is not cancellable: ${current.status}`)
      const next = { ...current, status: 'cancelled', errorCode: 'cancelled', updatedAt: new Date().toISOString() }
      await this.requireRequests().put(requestId, next)
      if (current.status === 'running') {
        const candidate = this.activeRuns.get(requestId)
        if (candidate?.attempt === current.attempt) active = candidate
      }
      return next
    })
    active?.controller.abort(new Error('Generation request cancelled'))
    return request
  }

  retry(requestId) {
    return this.mutate(async () => {
      const current = this.requireRequests().get(requestId)
      if (!current) throw new Error(`Unknown generation request: ${requestId}`)
      if (!['failed', 'cancelled'].includes(current.status)) throw new Error(`Generation request is not retryable: ${current.status}`)
      if (current.outputKind === 'cover-asset-v1') throw new Error('Cover asset requests must be recreated from the exact source Draft inputs')
      const next = { ...current, status: 'pending', errorCode: undefined, draftId: undefined, updatedAt: new Date().toISOString() }
      await this.requireRequests().put(requestId, next)
      return next
    })
  }

  review(draftId, decision, version, sha256) {
    return this.mutate(async () => {
      const draft = this.getDraft(draftId)
      if (!draft) throw new Error(`Unknown production draft: ${draftId}`)
      const request = this.requireRequests().get(draft.requestId)
      if (!exactRequestDraftLink(request, draft)) {
        reviewConflict('Draft generation request is unavailable or inconsistent')
      }
      if (draft.version !== version || draft.sha256 !== sha256) reviewConflict('Draft version or hash changed before review')
      if (draft.status !== 'draft') reviewConflict(`Production draft is not reviewable in status: ${draft.status}`)
      let next
      if (decision === 'approve') next = approveDraft(draft, version, sha256)
      else if (decision === 'reject') next = { ...draft, status: 'rejected', updatedAt: new Date().toISOString() }
      else throw new Error('Unsupported draft review decision')
      await this.requireDrafts().put(draftId, next)
      return next
    })
  }

  completePublicationAttempts() {
    const attempts = Array.from(this.requireAttempts().entries(), ([key, raw]) => {
      const parsed = attemptSchema.safeParse(raw)
      if (!parsed.success || key !== parsed.data.attemptId || Object.keys(parsed.data).length !== Object.keys(raw).length) {
        throw new Error('Publication attempt storage contains a malformed key or row')
      }
      return parsed.data
    })
    const numbers = new Set()
    const intents = new Set()
    for (const attempt of attempts) {
      const numberKey = JSON.stringify([attempt.draftId, attempt.publisherId, attempt.attemptNumber])
      if (numbers.has(numberKey)) throw new Error('Publication attempt storage contains a duplicate draft/publisher attempt number')
      numbers.add(numberKey)
      if (attempt.intentId) {
        const intentKey = JSON.stringify([attempt.draftId, attempt.publisherId, attempt.intentId])
        if (intents.has(intentKey)) throw new Error('Publication attempt storage contains a duplicate caller intent id')
        intents.add(intentKey)
      }
    }
    return attempts
  }

  nextPublicationAttemptNumber(draft, publisherId) {
    const knownMax = this.completePublicationAttempts()
      .filter(item => item.draftId === draft.draftId && item.publisherId === publisherId)
      .reduce((max, item) => Math.max(max, item.attemptNumber), 0)
    const receiptSeed = typeof this.ctx.prismPublicationReceipts?.attemptNumberSeed === 'function'
      ? this.ctx.prismPublicationReceipts.attemptNumberSeed(publisherId, {
        draftId: draft.draftId, draftVersion: draft.version, artifactSha256: draft.sha256,
        artifactBindingSha256: draft.artifactBindingSha256,
      }) : 0
    return Math.max(knownMax, receiptSeed) + 1
  }

  replayPublicationAttempt(attempt) {
    const receipt = this.ctx.prismPublicationReceipts?.get?.(attempt.receiptId)
    if (receipt) return receipt
    const stored = attempt.terminalReceipt ?? {}
    const status = stored.status ?? attempt.publicationStatus ?? (attempt.state === 'skipped' ? 'skipped' : attempt.state)
    return { ...structuredClone(stored), status, publisherId: attempt.publisherId, draftId: attempt.draftId,
      draftVersion: attempt.draftVersion, artifactSha256: attempt.artifactSha256,
      ...(attempt.artifactBindingSha256 ? { artifactBindingSha256: attempt.artifactBindingSha256 } : {}),
      receiptId: attempt.receiptId, publicationAttemptId: attempt.attemptId, publicationAttemptNumber: attempt.attemptNumber,
      publicationIntent: attempt.intent }
  }

  replayReceiptPersistenceFailure(attempt) {
    const candidate = attempt.receiptCandidate ?? {}
    return { ...structuredClone(candidate), publisherId: attempt.publisherId, draftId: attempt.draftId,
      draftVersion: attempt.draftVersion, artifactSha256: attempt.artifactSha256,
      ...(attempt.artifactBindingSha256 ? { artifactBindingSha256: attempt.artifactBindingSha256 } : {}),
      receiptId: attempt.receiptId, publicationAttemptId: attempt.attemptId, publicationAttemptNumber: attempt.attemptNumber,
      publicationIntent: attempt.intent, receiptPersistence: 'failed',
      publicationCommitted: candidate.publicationCommitted === true }
  }

  throwReplayedNotCommitted(attempt) {
    if (attempt.terminalFailure?.kind === 'publisher-not-committed') {
      throw new PublisherOutcomeError('not-committed', attempt.terminalFailure.operation,
        `Publication ${attempt.terminalFailure.operation} did not commit`)
    }
    throw new Error('Publication attempt did not commit')
  }

  updateAttempt(attemptId, changes) {
    const current = this.requireAttempts().get(attemptId)
    if (!current) throw new Error('Publication attempt is unavailable')
    const next = { ...current, ...changes, updatedAt: new Date().toISOString() }
    return this.requireAttempts().put(attemptId, next).then(() => next)
  }

  publicationDraftWithoutClaim(draft) {
    const { publishingPublisherId: _publisher, publishingPreviousStatus: _previous, publishingPhase: _phase,
      publishingOutcome: _outcome, publishingAttemptId: _attempt, publishingAttemptNumber: _number,
      publishingReceiptId: _receipt, publishingIntent: _intent, publishingIntentId: _intentId, ...rest } = draft
    return rest
  }

  async restorePublicationDraft(draft, attempt) {
    const current = this.requireDrafts().get(draft.draftId)
    if (current?.status !== 'publishing' || current.publishingAttemptId !== attempt.attemptId) throw new Error('Draft changed during publication recovery')
    await this.requireDrafts().put(draft.draftId, { ...this.publicationDraftWithoutClaim(current), status: current.publishingPreviousStatus, updatedAt: new Date().toISOString() })
  }

  async completeAttemptAndDraft(draft, attempt, receipt) {
    const current = this.requireDrafts().get(draft.draftId)
    if (!current || current.status !== 'publishing' || current.publishingAttemptId !== attempt.attemptId
      || current.publishingReceiptId !== attempt.receiptId) throw new Error('Draft changed during publication completion')
    await this.updateAttempt(attempt.attemptId, { state: 'completed', publicationStatus: receipt?.status,
      reconciliationReason: undefined, reconciliationOperation: undefined, receiptCandidate: undefined, terminalReceipt: normalizedReceiptCandidate(receipt),
      terminalFailure: undefined, completedAt: receipt?.recordedAt ?? new Date().toISOString() })
    const at = new Date().toISOString()
    await this.requireDrafts().put(draft.draftId, { ...this.publicationDraftWithoutClaim(current), status: 'published', publishedAt: at,
      publishedPublisherIds: [...new Set([...(current.publishedPublisherIds ?? []), attempt.publisherId])], updatedAt: at })
  }

  publish(draftId, publisherId, execution = {}) {
    return this.runPublication(draftId, publisherId, 'initial', undefined, undefined, undefined, execution)
  }

  republishExact(draftId, publisherId, expectedVersion, expectedSha256, intentId, execution = {}) {
    return this.runPublication(draftId, publisherId, 'repeat', expectedVersion, expectedSha256, intentId, execution)
  }

  runPublication(draftId, publisherId, intent, expectedVersion, expectedSha256, intentId, execution = {}) {
    if (this.stopping) return Promise.reject(new Error('PrismFlow production store is stopping'))
    if (this.maintenanceDraining) return Promise.reject(new Error('PrismFlow production admission is paused for maintenance drain'))
    if (typeof draftId !== 'string' || draftId.length < 1 || draftId.length > 128 || /[\u0000-\u001f\u007f]/u.test(draftId)) {
      return Promise.reject(new Error('Production draft id is invalid'))
    }
    if (typeof publisherId !== 'string' || publisherId.length < 1 || publisherId.length > 256 || /[\u0000-\u001f\u007f]/u.test(publisherId)) {
      return Promise.reject(new Error('Production publisher id is invalid'))
    }
    if (intent === 'repeat' && (!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > 1_000_000_000
      || !/^[a-f0-9]{64}$/u.test(expectedSha256 ?? '') || !validCanonicalUuid(intentId)
      || execution.trigger !== 'manual' || !['dashboard', 'chat'].includes(execution.surface))) {
      return Promise.reject(new Error('Exact repeat publication requires version/hash CAS, a canonical lowercase UUID intentId, and a dedicated manual Dashboard or Chat surface'))
    }
    const repeatKey = intent === 'repeat' ? JSON.stringify([draftId, publisherId, intentId]) : undefined
    const authority = repeatKey ? JSON.stringify({ draftId, publisherId, intent, intentId, expectedVersion, expectedSha256,
      trigger: execution.trigger, surface: execution.surface }) : undefined
    const active = repeatKey ? this.repeatOperations.get(repeatKey) : undefined
    if (active) {
      if (active.authority !== authority) return Promise.reject(new Error('Active repeat publication intent is bound to different request authority'))
      return active.operation
    }
    const operation = this.publishInner(draftId, publisherId, intent, expectedVersion, expectedSha256, intentId, this.executionWithShutdown(execution))
    if (repeatKey) this.repeatOperations.set(repeatKey, { authority, operation })
    this.inFlight.add(operation)
    operation.finally(() => {
      this.inFlight.delete(operation)
      if (repeatKey && this.repeatOperations.get(repeatKey)?.operation === operation) this.repeatOperations.delete(repeatKey)
    }).catch(() => {})
    return operation
  }

  async publishInner(draftId, publisherId, intent, expectedVersion, expectedSha256, intentId, execution) {
    if (typeof publisherId !== 'string' || publisherId.length < 1 || publisherId.length > 256) throw new Error('Production publisher id is invalid')
    if (intent === 'repeat' && (!Number.isInteger(expectedVersion) || !/^[a-f0-9]{64}$/u.test(expectedSha256 ?? '') || !validCanonicalUuid(intentId)
      || execution.trigger !== 'manual' || !['dashboard', 'chat'].includes(execution.surface))) {
      throw new Error('Exact repeat publication requires version/hash CAS, a canonical lowercase UUID intentId, and a dedicated manual Dashboard or Chat surface')
    }
    if (intent === 'repeat') {
      const replay = await this.mutate(async () => {
        const matches = this.completePublicationAttempts().filter(item => item.draftId === draftId
          && item.publisherId === publisherId && item.intentId === intentId)
        if (matches.length > 1) throw new Error('Publication attempt storage contains a duplicate caller intent id')
        return matches[0]
      })
      if (replay) {
        if (replay.draftVersion !== expectedVersion || replay.artifactSha256 !== expectedSha256
          || replay.trigger !== execution.trigger || replay.surface !== execution.surface || replay.intent !== intent) {
          throw new Error('Caller repeat intentId is already bound to different request authority')
        }
        if (['claimed', 'destination-started'].includes(replay.state)) {
          throw new Error(`Publication attempt is still in progress: ${replay.attemptId}`)
        }
        if (replay.state === 'not-committed') this.throwReplayedNotCommitted(replay)
        if (replay.state === 'reconciliation-required') {
          if (replay.reconciliationReason === 'receipt-persistence-failure') {
            throw new PublicationReconciliationError(this.replayReceiptPersistenceFailure(replay))
          }
          throw new PublicationReconciliationError(this.replayPublicationAttempt(replay), 'unknown')
        }
        return this.replayPublicationAttempt(replay)
      }
    }
    const before = this.getDraft(draftId)
    if (!before) throw new Error(`Unknown production draft: ${draftId}`)
    const linkedRequest = this.requireRequests().get(before.requestId)
    if (!exactRequestDraftLink(linkedRequest, before)) throw new Error('Approved draft generation request is unavailable or inconsistent')
    if (before.selectionId) {
      const provider = this.materialProviders.get('ai-selection')
      if (!provider || typeof provider.revalidateClaims !== 'function') throw new Error('AI selection claim validator is unavailable')
      if (!Array.isArray(before.sourceContentClaims)
        || before.sourceContentClaims.length !== before.sourceContentStoreIds.length
        || before.sourceContentClaims.some((claim, index) => claim.storeId !== before.sourceContentStoreIds[index])) {
        throw new Error('Approved draft source selection claims are invalid')
      }
      await provider.revalidateClaims(before.sourceContentClaims)
    }
    if (before.status === 'publishing') throw new Error('Production draft publication is already in progress or requires reconciliation')
    const records = before.sourceContentStoreIds.map(id => this.ctx.prismContentStore.get(id))
    if (records.some(record => !record)) throw new Error('Approved draft source content is no longer available')
    const preflightArtifact = approvedArtifact(before)
    if (typeof this.ctx.prismPublishers.validateArtifact === 'function') await this.ctx.prismPublishers.validateArtifact(publisherId, preflightArtifact)

    const claim = await this.mutate(async () => {
      const draft = this.getDraft(draftId)
      if (!draft || !exactRequestDraftLink(this.requireRequests().get(draft.requestId), draft)) throw new Error('Approved draft generation request is unavailable or inconsistent')
      if (draft.status === 'publishing') throw new Error('Production draft publication is already in progress or requires reconciliation')
      const used = (draft.publishedPublisherIds ?? []).includes(publisherId)
      const durableHistory = this.completePublicationAttempts().filter(item => item.draftId === draftId && item.publisherId === publisherId)
      const unresolved = durableHistory.find(item => item.draftVersion === draft.version && item.artifactSha256 === draft.sha256
        && item.artifactBindingSha256 === draft.artifactBindingSha256
        && ['claimed', 'destination-started', 'reconciliation-required'].includes(item.state))
      if (unresolved) throw new Error(`Publication attempt requires resolution before another publication: ${unresolved.attemptId}`)
      if (intent === 'initial' && used) throw new Error(`Production draft was already published to: ${publisherId}; use explicit exact repeat publication`)
      if (intent === 'repeat' && (!used || draft.status !== 'published')) throw new Error(used
        ? 'Exact repeat publication requires Draft status published' : 'Destination has not been used; use first publication')
      if (intent === 'repeat' && (draft.version !== expectedVersion || draft.sha256 !== expectedSha256)) throw new Error('Draft version or hash changed before exact repeat publication')
      if (!used && (draft.publishedPublisherIds ?? []).length >= 50) throw new Error('Production draft publisher history limit is reached')
      const artifact = approvedArtifact(draft)
      const at = new Date().toISOString()
      const attempt = { attemptId: randomUUID(), receiptId: randomUUID(), attemptNumber: this.nextPublicationAttemptNumber(draft, publisherId),
        draftId, draftVersion: draft.version, artifactSha256: draft.sha256,
        ...(draft.artifactBindingSha256 ? { artifactBindingSha256: draft.artifactBindingSha256 } : {}), publisherId, intent,
        ...(intent === 'repeat' ? { intentId } : {}),
        trigger: ['manual', 'scheduler', 'workflow', 'host'].includes(execution.trigger) ? execution.trigger : 'host', surface: ['dashboard', 'chat'].includes(execution.surface) ? execution.surface : 'host',
        state: 'claimed', createdAt: at, updatedAt: at }
      if (durableHistory.some(item => item.attemptNumber === attempt.attemptNumber)
        || intentId && durableHistory.some(item => item.intentId === intentId)) {
        throw new Error('Publication attempt number or caller intent id is already in durable use')
      }
      await this.requireAttempts().put(attempt.attemptId, attempt)
      try {
        await this.requireDrafts().put(draftId, { ...draft, status: 'publishing', publishingPublisherId: publisherId,
          publishingPreviousStatus: draft.status, publishingPhase: 'claimed', publishingAttemptId: attempt.attemptId,
          publishingAttemptNumber: attempt.attemptNumber, publishingReceiptId: attempt.receiptId, publishingIntent: intent,
          ...(intentId ? { publishingIntentId: intentId } : {}), updatedAt: at })
      } catch (error) {
        await this.updateAttempt(attempt.attemptId, { state: 'not-committed', completedAt: new Date().toISOString() }).catch(() => {})
        throw error
      }
      return { artifact, attempt }
    })
    const { artifact, attempt } = claim
    this.publicationClaims.set(draftId, { publisherId, artifact, attemptId: attempt.attemptId, attemptNumber: attempt.attemptNumber,
      receiptId: attempt.receiptId, intent, ...(intentId ? { intentId } : {}), trigger: attempt.trigger })
    try {
      await this.mutate(async () => {
        const draft = this.requireDrafts().get(draftId)
        const durableAttempt = this.requireAttempts().get(attempt.attemptId)
        if (!draft || draft.status !== 'publishing' || draft.publishingAttemptId !== attempt.attemptId || draft.publishingPhase !== 'claimed'
          || !durableAttempt || durableAttempt.state !== 'claimed' || durableAttempt.receiptId !== attempt.receiptId
          || durableAttempt.attemptNumber !== attempt.attemptNumber || durableAttempt.publisherId !== publisherId
          || durableAttempt.draftVersion !== artifact.draftVersion || durableAttempt.artifactSha256 !== artifact.artifactSha256) {
          throw new Error('Draft or attempt changed before publication destination start')
        }
        await this.updateAttempt(attempt.attemptId, { state: 'destination-started', destinationStartedAt: new Date().toISOString() })
        await this.requireDrafts().put(draftId, { ...draft, publishingPhase: 'destination-started', updatedAt: new Date().toISOString() })
      }, true)
      const rawReceipt = await this.ctx.prismPublishers.publishArtifact(publisherId, artifact, records, { ...execution, trigger: attempt.trigger })
      const receipt = { ...rawReceipt, receiptId: rawReceipt.receiptId ?? attempt.receiptId,
        publicationAttemptId: rawReceipt.publicationAttemptId ?? attempt.attemptId,
        publicationAttemptNumber: rawReceipt.publicationAttemptNumber ?? attempt.attemptNumber,
        publicationIntent: rawReceipt.publicationIntent ?? intent }
      if (receipt.receiptId !== attempt.receiptId || receipt.publicationAttemptId !== attempt.attemptId
        || receipt.publicationAttemptNumber !== attempt.attemptNumber || receipt.publicationIntent !== intent) throw new Error('Publication Receipt does not match its exact attempt')
      if (receipt.receiptPersistence === 'failed') {
        await this.mutate(async () => {
          await this.updateAttempt(attempt.attemptId, { state: 'reconciliation-required', reconciliationReason: 'receipt-persistence-failure', receiptCandidate: normalizedReceiptCandidate(receipt) })
          const draft = this.requireDrafts().get(draftId)
          await this.requireDrafts().put(draftId, { ...draft, publishingPhase: 'reconciliation-required', publishingOutcome: 'unknown', updatedAt: new Date().toISOString() })
        }, true)
        throw new PublicationReconciliationError(receipt)
      }
      await this.mutate(async () => {
        const draft = this.requireDrafts().get(draftId)
        if (receipt.status === 'skipped') {
          await this.updateAttempt(attempt.attemptId, { state: 'skipped', publicationStatus: 'skipped',
            terminalReceipt: normalizedReceiptCandidate(receipt), terminalFailure: undefined,
            completedAt: receipt.recordedAt ?? new Date().toISOString() })
          await this.restorePublicationDraft(draft, attempt)
        } else await this.completeAttemptAndDraft(draft, attempt, receipt)
      }, true)
      if (execution.signal?.aborted && receipt.status !== 'skipped') {
        const error = new Error('Publication destination committed before cancellation was observed'); error.publicationCommitted = true; error.receipt = receipt; throw error
      }
      return receipt
    } catch (error) {
      const current = this.requireDrafts().get(draftId)
      const durableAttempt = this.requireAttempts().get(attempt.attemptId)
      if (durableAttempt?.state === 'reconciliation-required'
        && durableAttempt.reconciliationReason === 'receipt-persistence-failure' && durableAttempt.receiptCandidate) {
        if (current?.status === 'publishing' && current.publishingAttemptId === attempt.attemptId
          && (current.publishingPhase !== 'reconciliation-required' || current.publishingOutcome !== 'unknown')) {
          await this.mutate(async () => {
            const latest = this.requireDrafts().get(draftId)
            const latestAttempt = this.requireAttempts().get(attempt.attemptId)
            if (latest?.status === 'publishing' && latest.publishingAttemptId === attempt.attemptId
              && latestAttempt?.reconciliationReason === 'receipt-persistence-failure' && latestAttempt.receiptCandidate) {
              await this.requireDrafts().put(draftId, { ...latest, publishingPhase: 'reconciliation-required',
                publishingOutcome: 'unknown', updatedAt: new Date().toISOString() })
            }
          }, true).catch(() => {})
        }
        throw new PublicationReconciliationError(this.replayReceiptPersistenceFailure(durableAttempt))
      }
      if (current?.status === 'publishing' && current.publishingAttemptId === attempt.attemptId) {
        if (current.publishingPhase === 'claimed' || isPublisherOutcomeError(error) && error.outcome === 'not-committed') {
          const terminalFailure = isPublisherOutcomeError(error) && error.outcome === 'not-committed'
            ? { kind: 'publisher-not-committed', operation: error.operation,
              ...(error.externalOutcomeUnknown === true ? { externalOutcome: 'unknown' } : {}),
              ...(Number.isInteger(error.errcode) && error.errcode >= -1 && error.errcode !== 0 && error.errcode <= 1_000_000_000 ? { code: error.errcode } : {}),
              ...(typeof error.rid === 'string' && error.rid.length > 0 && error.rid.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(error.rid) ? { requestId: error.rid } : {}) }
            : { kind: 'publication-not-committed' }
          await this.mutate(async () => { await this.updateAttempt(attempt.attemptId, { state: 'not-committed', terminalFailure,
            completedAt: new Date().toISOString() }); await this.restorePublicationDraft(current, attempt) }, true)
        } else if (current.publishingPhase !== 'reconciliation-required') {
          await this.mutate(async () => {
            await this.updateAttempt(attempt.attemptId, { state: 'reconciliation-required', reconciliationReason: 'external-unknown',
              ...(isPublisherOutcomeError(error) ? { reconciliationOperation: error.operation } : {}) })
            const latest = this.requireDrafts().get(draftId)
            await this.requireDrafts().put(draftId, { ...latest, publishingPhase: 'reconciliation-required', publishingOutcome: 'unknown', updatedAt: new Date().toISOString() })
          }, true)
          throw new PublicationReconciliationError({ publisherId, draftId, draftVersion: artifact.draftVersion,
            artifactSha256: artifact.artifactSha256, artifactBindingSha256: artifact.artifactBindingSha256,
            receiptId: attempt.receiptId, publicationAttemptId: attempt.attemptId, publicationAttemptNumber: attempt.attemptNumber, publicationIntent: intent }, 'unknown')
        }
      }
      throw error
    } finally {
      const active = this.publicationClaims.get(draftId)
      if (active?.attemptId === attempt.attemptId) this.publicationClaims.delete(draftId)
    }
  }

  async failRequest(requestId, attempt, code) {
    await this.mutate(async () => {
      const request = this.requireRequests().get(requestId)
      if (!request || request.status !== 'running' || request.attempt !== attempt) return
      await this.requireRequests().put(requestId, { ...request, status: code === 'cancelled' ? 'cancelled' : 'failed', errorCode: code, updatedAt: new Date().toISOString() })
    }, true)
  }

  async recoverInterrupted() {
    this.requireWriter()
    const requests = new Map()
    const drafts = new Map()
    if (typeof this.requireDrafts().delete !== 'function') throw new Error('Draft table does not support recovery deletion')

    // Validate the complete durable image and every table key before planning a
    // single cleanup write. Wrong keys are corruption, never deletion hints.
    for (const [requestId, raw] of this.requireRequests().entries()) {
      const parsed = requestSchema.safeParse(raw)
      if (typeof requestId !== 'string' || !parsed.success || parsed.data.requestId !== requestId
        || Object.keys(parsed.data).length !== Object.keys(raw).length) throw new Error('Production request storage contains a malformed key or row')
      requests.set(requestId, parsed.data)
    }
    for (const [draftId, raw] of this.requireDrafts().entries()) {
      const parsed = draftSchema.safeParse(raw)
      if (typeof draftId !== 'string' || !parsed.success || parsed.data.draftId !== draftId
        || Object.keys(parsed.data).length !== Object.keys(raw).length) throw new Error('Production draft storage contains a malformed key or row')
      drafts.set(draftId, parsed.data)
    }
    for (const [draftId, raw] of this.requireDraftDeletions().entries()) {
      const parsed = draftDeletionSchema.safeParse(raw)
      const draft = drafts.get(draftId)
      if (typeof draftId !== 'string' || !parsed.success || parsed.data.draftId !== draftId
        || Object.keys(parsed.data).length !== Object.keys(raw).length || !draft
        || draft.requestId !== parsed.data.requestId || draft.version !== parsed.data.version || draft.sha256 !== parsed.data.sha256) {
        throw new Error('Production draft deletion storage contains a malformed key, row, or Draft binding')
      }
    }

    const attempts = new Map()
    for (const [attemptId, raw] of this.requireAttempts().entries()) {
      const parsed = attemptSchema.safeParse(raw)
      if (typeof attemptId !== 'string' || !parsed.success || parsed.data.attemptId !== attemptId
        || Object.keys(parsed.data).length !== Object.keys(raw).length) throw new Error('Publication attempt storage contains a malformed key or row')
      attempts.set(attemptId, parsed.data)
    }

    // Enforce ledger uniqueness before any startup recovery write. UUID parsing
    // above canonicalizes legacy mixed-case repeat ids before any comparison.
    this.completePublicationAttempts()
    for (const [draftId, draft] of drafts) {
      const raw = this.requireDrafts().get(draftId)
      if (raw?.publishingIntentId !== draft.publishingIntentId) await this.requireDrafts().put(draftId, draft)
    }
    for (const [attemptId, attempt] of attempts) {
      const raw = this.requireAttempts().get(attemptId)
      if (raw?.intentId !== attempt.intentId) await this.requireAttempts().put(attemptId, attempt)
    }

    // Upgrade claims from releases which had no durable attempt identity. The
    // identity is deterministic, so a crash during this migration is replay-safe.
    for (const [draftId, draft] of drafts) {
      if (draft.status !== 'publishing' || draft.publishingAttemptId || !exactRequestDraftLink(requests.get(draft.requestId), draft)) continue
      const identity = JSON.stringify([draftId, draft.publishingPublisherId, draft.version, draft.sha256,
        draft.artifactBindingSha256 ?? null, draft.publishingPreviousStatus, draft.publishingPhase])
      const attemptId = deterministicUuid('prismflow-legacy-publication-attempt', identity)
      const receiptId = deterministicUuid('prismflow-legacy-publication-receipt', identity)
      const existing = attempts.get(attemptId)
      const publisherHistory = Array.from(attempts.values()).filter(item => item.attemptId !== attemptId
        && item.draftId === draftId && item.publisherId === draft.publishingPublisherId)
      const knownMax = publisherHistory.reduce((max, item) => Math.max(max, item.attemptNumber), 0)
      const receiptSeed = typeof this.ctx.prismPublicationReceipts?.attemptNumberSeed === 'function'
        ? this.ctx.prismPublicationReceipts.attemptNumberSeed(draft.publishingPublisherId, {
          draftId, draftVersion: draft.version, artifactSha256: draft.sha256, artifactBindingSha256: draft.artifactBindingSha256,
        }) : 0
      const attemptNumber = Math.max(knownMax, receiptSeed) + 1
      if (publisherHistory.some(item => item.attemptNumber === attemptNumber)) throw new Error('Legacy publication attempt number conflicts with durable history')
      const at = draft.updatedAt || new Date().toISOString()
      const attempt = { attemptId, receiptId, attemptNumber, draftId, draftVersion: draft.version,
        artifactSha256: draft.sha256, ...(draft.artifactBindingSha256 ? { artifactBindingSha256: draft.artifactBindingSha256 } : {}),
        publisherId: draft.publishingPublisherId, intent: draft.publishingPreviousStatus === 'published' ? 'repeat' : 'initial',
        legacyClaim: true, trigger: 'host', surface: 'host',
        state: draft.publishingPhase === 'claimed' ? 'claimed' : 'reconciliation-required',
        ...(draft.publishingPhase === 'claimed' ? {} : { reconciliationReason: 'external-unknown' }), createdAt: at, updatedAt: at }
      if (existing && JSON.stringify(existing) !== JSON.stringify(attempt)) {
        throw new Error('Legacy publication attempt migration identity conflicts with durable history')
      }
      if (!existing) await this.requireAttempts().put(attemptId, attempt)
      attempts.set(attemptId, existing ?? attempt)
      const migrated = { ...draft, publishingAttemptId: attemptId, publishingAttemptNumber: attemptNumber,
        publishingReceiptId: receiptId, publishingIntent: attempt.intent }
      await this.requireDrafts().put(draftId, migrated)
      drafts.set(draftId, migrated)
    }

    const deleteDraftIds = new Set()
    const requestUpdates = []
    const draftUpdates = []
    for (const [draftId, draft] of drafts) {
      const request = requests.get(draft.requestId)
      if (!exactRequestDraftLink(request, draft)) deleteDraftIds.add(draftId)
    }
    for (const [requestId, request] of requests) {
      const draft = request.draftId ? drafts.get(request.draftId) : undefined
      const completedLinked = exactRequestDraftLink(request, draft)
      const completedCoverAsset = request.status === 'completed' && request.outputKind === 'cover-asset-v1'
        && request.draftId === undefined && request.outputAsset !== undefined
      const completedWorkflowResult = request.status === 'completed' && request.outputKind === 'workflow-result-v1'
      if (request.status === 'running' || request.status === 'completed' && !completedLinked && !completedCoverAsset && !completedWorkflowResult) {
        if (draft?.requestId === requestId) deleteDraftIds.add(draft.draftId)
        requestUpdates.push([requestId, {
          ...request, status: 'failed', draftId: undefined,
          errorCode: request.status === 'running' ? 'host-restarted' : 'recovery-draft-mismatch',
          updatedAt: new Date().toISOString(),
        }])
      }
    }
    for (const [draftId, draft] of drafts) {
      if (draft.status !== 'publishing' || deleteDraftIds.has(draftId)) continue
      const artifact = {
        draftId, draftVersion: draft.version, artifactSha256: draft.sha256,
        title: draft.title, markdown: draft.markdown, sourceContentStoreIds: draft.sourceContentStoreIds,
        ...(draft.workflowInputSha256 ? { workflowInputSha256: draft.workflowInputSha256 } : {}),
        ...(draft.artifactBindingSha256 ? { artifactBindingSha256: draft.artifactBindingSha256,
          mediaAssets: draft.mediaAssets, destinationPresentations: draft.destinationPresentations } : {}),
      }
      let outcome = 'ambiguous'
      const attempt = draft.publishingAttemptId ? attempts.get(draft.publishingAttemptId) : undefined
      const exactAttempt = attempt && attempt.receiptId === draft.publishingReceiptId
        && attempt.attemptNumber === draft.publishingAttemptNumber && attempt.intent === draft.publishingIntent
        && attempt.publisherId === draft.publishingPublisherId && attempt.draftId === draftId
        && attempt.draftVersion === draft.version && attempt.artifactSha256 === draft.sha256
        && attempt.artifactBindingSha256 === draft.artifactBindingSha256
      if (draft.publishingAttemptId) {
        if (!exactAttempt) outcome = 'ambiguous'
        else if (attempt.reconciliationReason === 'receipt-persistence-failure' && attempt.receiptCandidate) outcome = 'receipt-repair-required'
        else if (draft.publishingPhase === 'claimed' && attempt.state === 'claimed') outcome = 'not-committed'
        else if (attempt.state === 'not-committed' || attempt.state === 'skipped') outcome = 'not-committed'
        else if (attempt.legacyClaim) outcome = 'ambiguous'
        else if (typeof this.ctx.prismPublicationReceipts?.inspectAttemptPublication === 'function') {
          try { outcome = (await this.ctx.prismPublicationReceipts.inspectAttemptPublication(attempt, artifact)).outcome }
          catch { outcome = 'ambiguous' }
        }
      } else if (draft.publishingPhase === 'claimed') outcome = 'not-committed'
      else if (draft.publishingOutcome !== 'unknown' && draft.publishingPhase !== 'reconciliation-required'
        && typeof this.ctx.prismPublicationReceipts?.inspectArtifactPublication === 'function') {
        try { outcome = (await this.ctx.prismPublicationReceipts.inspectArtifactPublication(draft.publishingPublisherId, artifact)).outcome }
        catch { outcome = 'ambiguous' }
      }
      if (outcome === 'receipt-repair-required') {
        draftUpdates.push([draftId, { ...draft, publishingPhase: 'reconciliation-required', publishingOutcome: 'unknown', updatedAt: new Date().toISOString() }])
      } else if (outcome === 'committed') {
        if (attempt) await this.updateAttempt(attempt.attemptId, { state: 'completed', reconciliationReason: undefined, reconciliationOperation: undefined, receiptCandidate: undefined, completedAt: new Date().toISOString() })
        const at = new Date().toISOString()
        draftUpdates.push([draftId, { ...this.publicationDraftWithoutClaim(draft), status: 'published', publishedAt: at,
          publishedPublisherIds: [...new Set([...(draft.publishedPublisherIds ?? []), draft.publishingPublisherId])], updatedAt: at }])
      } else if (outcome === 'not-committed') {
        if (attempt && attempt.state !== 'skipped') await this.updateAttempt(attempt.attemptId, { state: 'not-committed', reconciliationReason: undefined, reconciliationOperation: undefined, receiptCandidate: undefined, completedAt: new Date().toISOString() })
        draftUpdates.push([draftId, { ...this.publicationDraftWithoutClaim(draft), status: draft.publishingPreviousStatus, updatedAt: new Date().toISOString() }])
      } else {
        if (attempt) await this.updateAttempt(attempt.attemptId, { state: 'reconciliation-required',
          reconciliationReason: attempt.reconciliationReason ?? 'external-unknown' })
        draftUpdates.push([draftId, { ...draft, publishingPhase: 'reconciliation-required', publishingOutcome: 'unknown', updatedAt: new Date().toISOString() }])
      }
      // Every post-destination ambiguous result remains fail closed across restart until exact operator reconciliation.
    }

    const activeAttemptIds = new Set(Array.from(drafts.values())
      .filter(draft => draft.status === 'publishing' && !deleteDraftIds.has(draft.draftId) && draft.publishingAttemptId)
      .map(draft => draft.publishingAttemptId))
    for (const attempt of attempts.values()) {
      if (activeAttemptIds.has(attempt.attemptId)) continue
      if (attempt.state === 'claimed') await this.updateAttempt(attempt.attemptId, {
        state: 'not-committed', completedAt: new Date().toISOString(), reconciliationReason: undefined,
      })
      else if (attempt.state === 'destination-started') await this.updateAttempt(attempt.attemptId, {
        state: 'reconciliation-required', reconciliationReason: 'external-unknown',
      })
    }

    for (const draftId of deleteDraftIds) await this.requireDrafts().delete(draftId)
    for (const [requestId, request] of requestUpdates) await this.requireRequests().put(requestId, request)
    for (const [draftId, draft] of draftUpdates) await this.requireDrafts().put(draftId, draft)
  }

  requireWriter() {
    if (!this.releaseWriterLock) throw new Error('Production mutations require a deployment-configured writerLockPath')
  }
  mutate(operation, allowStopping = false) {
    if (this.stopping && !allowStopping) return Promise.reject(new Error('PrismFlow production store is stopping'))
    try { this.requireWriter() } catch (error) { return Promise.reject(error) }
    const result = this.tail.then(operation)
    this.tail = result.then(() => {}, () => {})
    return result
  }
  requireRequests() { if (!this.requests) throw new Error('Production Store is not initialized'); return this.requests }
  requireDrafts() { if (!this.drafts) throw new Error('Production Store is not initialized'); return this.drafts }
  requireDraftDeletions() { if (!this.draftDeletions) throw new Error('Production Draft Deletion Store is not initialized'); return this.draftDeletions }
  requireAttempts() { if (!this.attempts) throw new Error('Publication Attempt Store is not initialized'); return this.attempts }
}

export default PrismProductionService
