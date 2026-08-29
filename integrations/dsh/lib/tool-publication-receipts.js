import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'prismflow-tool-publication-receipts'
export const inject = ['tools', 'prismPublicationReceipts']

const queryParameters = {
  receiptId: { type: 'string', description: 'Optional exact publication receipt id.' },
  publisherId: { type: 'string', description: 'Optional exact configured publisher id.' },
  status: {
    type: 'string',
    enum: ['created', 'updated', 'unchanged', 'skipped'],
    description: 'Optional publication status.',
  },
  trigger: {
    type: 'string',
    enum: ['manual', 'scheduler', 'workflow', 'host'],
    description: 'Optional publication trigger.',
  },
  jobId: { type: 'string', description: 'Optional publication scheduler job id.' },
  workflowId: { type: 'string', description: 'Optional PrismFlow workflow id.' },
  draftId: { type: 'string', description: 'Optional exact Draft id.' },
  draftVersion: { type: 'integer', description: 'Optional exact Draft version.' },
  artifactSha256: { type: 'string', description: 'Optional exact Artifact SHA-256.' },
  publicationAttemptId: { type: 'string', description: 'Optional exact publication attempt id.' },
  from: { type: 'string', description: 'Optional inclusive ISO publication timestamp lower bound.' },
  to: { type: 'string', description: 'Optional inclusive ISO publication timestamp upper bound.' },
  limit: { type: 'integer', description: 'Maximum receipts from 1 to 100. Defaults to 20.' },
  offset: { type: 'integer', description: 'Non-negative result offset. Defaults to 0.' },
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'prismflow_publication_receipts',
    description: 'Query durable metadata receipts for native PrismFlow publications. Publication bodies and credentials are never stored.',
    parameters: queryParameters,
    output: {
      schema: { type: 'json' },
      render: (_args, receipts) => [{
        type: 'text',
        text: receipts.length > 0
          ? receipts.map(receipt => `${receipt.publishedAt} ${receipt.status} ${receipt.publisherId} (${receipt.receiptId}; ${receipt.publicationAttemptId ? `attempt #${receipt.publicationAttemptNumber} ${receipt.publicationAttemptId}` : 'legacy receipt without attempt number'})`).join('\n')
          : 'No PrismFlow publication receipts matched the query.',
      }],
    },
    async execute(args) {
      return ctx.prismPublicationReceipts.list(args)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'prismflow_publication_receipt',
    description: 'Get one durable PrismFlow publication receipt by its exact receipt id.',
    parameters: {
      receiptId: { type: 'string', required: true, description: 'Receipt id returned by prismflow_publication_receipts.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, receipt) => [{
        type: 'text',
        text: `${receipt.publishedAt} ${receipt.status} ${receipt.publisherId} (${receipt.receiptId})`,
      }],
    },
    async execute(args) {
      const receipt = ctx.prismPublicationReceipts.get(args.receiptId)
      if (!receipt) throw new Error(`Unknown PrismFlow publication receipt: ${args.receiptId}`)
      return receipt
    },
  }))
}
