import { createHash } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const name = 'prismflow-store-ai-prompts'
export const inject = ['storageDomain']

export const DEFAULT_AI_PROMPT_SETTINGS = Object.freeze({
  editorialInstruction: `你是AI内容主编与资深资讯评委。对每条原始Markdown独立判断、彻底重写并评分，不得依赖关键词词典。
内容要求：ai_summary以加粗新闻标题开头并使用中文新闻播报风格；标题必须为10至18个可见字符，生成时以12至16个可见字符为目标并在输出前逐字计数，避免落在边界外；标题同时表达主体与核心事件，禁止只有情绪、评价或宽泛概念。正文必须写成3至4个完整短句，每句建议20至25个可见字符，并必须以。！？之一结尾。只保留主体、核心事件与关键影响，删除背景铺陈、同义重复、排比、转折和连接词；允许少量自然口语感。标题和正文之间只能用空格。
格式红线：ai_summary必须是绝对单行字符串，禁止真实换行、\\n、\\r和<br\\>；结构分隔只能使用空格或<br/>。标题使用**新闻标题。**。核心术语和关键数据可加粗，每处不超过10字。
链接硬规则：每张卡片都有articleUrl，必须恰好使用一次并自然嵌入正文句中，格式为[约10至15个中文字符](完整articleUrl)。链接锚文本、标题和普通正文都不得包含“AI资讯”。不得伪造、截断或重复任何URL；链接去掉Markdown符号后句子仍须通顺。
Emoji规则：根据语境动态选择并穿插在句中，不得堆在句末；短句最多1个，宁缺毋滥。
媒体与SEO规则：媒体只能位于文字最后；有候选媒体时必须保留至少1个；最多1个视频或2张图片，不能混用。若输出图片，每一张图片Alt都必须且只能以“AI资讯：”开头，统一格式为<br/>![AI资讯：具体中文画面描述](URL)<br/>；每张图片对应一次“AI资讯”，其他位置不得出现。图片Alt严禁使用image、alt text、photo、插图等通用词。若没有输出图片（包括仅输出视频），全文不得出现“AI资讯”。视频格式为<br/><video src="URL" controls="controls" width="100%"></video><br/>。
分类规则：新闻概括事件、主体和影响；项目说明痛点并自然包含项目URL和Star数；论文用大白话解释突破和意义；社交媒体提炼观点或事件并保留原文链接。
评分：AI相关性40%、新闻新鲜度20%、炸裂程度20%、影响力20%，每个维度按0至100评分，总分必须逐项计算为round(相关性×0.4+新鲜度×0.2+炸裂程度×0.2+影响力×0.2)，禁止凭感觉给总分。例如90、80、70、60的总分是78。非实质AI内容的ai_score必须低于70；AI相关性不足50分时总分也必须低于70。reason必须按“AI相关性(40%):N分，理由；新闻新鲜度(20%):N分，理由；炸裂程度(20%):N分，理由；影响力(20%):N分，理由。因此综合评分为N分。”说明。
每条editorial对象必须且只能包含ai_summary、ai_score、reason三个字段。topics是内部分类标签，不得写入editorial。输出前逐条自检：加粗标题、articleUrl恰好1次、每张图片Alt各出现1次“AI资讯”且无图片时出现0次、媒体只在末尾；任何一项不满足都必须先重写再输出。`,
  clusterInstruction: `你是AI资讯事件聚类专家。只根据每条记录的标题和AI摘要判断它们是否描述同一个现实事件。
同一主体、同一核心动作、同一对象且属于同一发布或进展的报道应合并；即使标题、语序和措辞不同，只要核心事实、结论和现实指向语义等价，也应合并。同一模型的发布、评测、量化、框架适配和后续应用属于不同事件，除非摘要明确说明它们是同一次公告。
不得仅根据索引相邻、表面词句相似或同属宽泛主题而合并。只输出需要合并的clusterIndex组；不确定或无需合并的候选不要输出，系统会将它们安全地保留为单例。`,
  hotKeywordsPrompt: `你是专业的内容分析与趋势研判专家。请从以下给出的AI资讯摘要列表中，深入分析并提取当前最核心、最热门的实体关键词、事件主题词或行业技术术语（如模型名、机构公司名、核心技术架构、重磅事件等）。
要求：
1. 关键词必须具有明确的资讯价值与信息量，必须过滤泛化词、虚词及通用停用词（如“发布”、“最新”、“推出”、“行业”、“发展”、“消息”、“全面”等）。
2. 每项包含：keyword（规范化关键词，统一大小写与全称简写）、weight（热度/词频权重，正数）、summaryCount（关联的摘要条数）、sampleSummaries（选出1-2条最有代表性的摘要原文）。
3. 请以最重要、最热门的顺序输出最多20个关键词。`,
  hotKeywordsConsolidationPrompt: `你是专业的内容趋势研判专家。以下是从多个批次初步提取的候选热门关键词及其词频权重与样例。
请进行最终同义词合并归一（例如将“DeepSeek”与“DeepSeek-V3”按实际指向合理合并，或去除近义重复词）、过滤掉漏网的泛化弱特征词，重新计算权重与摘要数，并挑选出最热门的关键词。`,
})

export const Config = Schema.object({
  editorialInstruction: Schema.string().default(DEFAULT_AI_PROMPT_SETTINGS.editorialInstruction),
  clusterInstruction: Schema.string().default(DEFAULT_AI_PROMPT_SETTINGS.clusterInstruction),
  hotKeywordsPrompt: Schema.string().default(DEFAULT_AI_PROMPT_SETTINGS.hotKeywordsPrompt),
  hotKeywordsConsolidationPrompt: Schema.string().default(DEFAULT_AI_PROMPT_SETTINGS.hotKeywordsConsolidationPrompt),
})

const SHA = /^[a-f0-9]{64}$/u
const PROMPT_FIELDS = ['editorialInstruction', 'clusterInstruction', 'hotKeywordsPrompt', 'hotKeywordsConsolidationPrompt']

const recordSchema = z.object({
  id: z.literal('current'),
  version: z.number().int().min(1).max(1_000_000_000),
  sha256: z.string().regex(SHA),
  editorialInstruction: z.string().min(1).max(30_000),
  clusterInstruction: z.string().min(1).max(20_000),
  hotKeywordsPrompt: z.string().min(1).max(20_000),
  hotKeywordsConsolidationPrompt: z.string().min(1).max(20_000),
  updatedAt: z.string().datetime(),
}).strict()

export const prismAiPromptsDomain = defineDomain({
  name: 'prismflow_ai_prompts',
  version: 1,
  tables: { current: domainTable(recordSchema), history: domainTable(recordSchema) },
})

export class AiPromptsError extends Error {
  constructor(message, code = 'validation') {
    super(message)
    this.name = 'AiPromptsError'
    this.code = code
  }
}

function cleanPromptText(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000\u007f]/u.test(value)) {
    throw new AiPromptsError(`${field} is invalid`)
  }
  return value.trim()
}

function normalizePromptInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AiPromptsError('Prompt settings fields are invalid')
  }
  return {
    editorialInstruction: cleanPromptText(value.editorialInstruction, 'editorialInstruction', 30_000),
    clusterInstruction: cleanPromptText(value.clusterInstruction, 'clusterInstruction', 20_000),
    hotKeywordsPrompt: cleanPromptText(value.hotKeywordsPrompt, 'hotKeywordsPrompt', 20_000),
    hotKeywordsConsolidationPrompt: cleanPromptText(value.hotKeywordsConsolidationPrompt, 'hotKeywordsConsolidationPrompt', 20_000),
  }
}

function promptSettingsHash(values) {
  const hash = createHash('sha256')
  for (const field of PROMPT_FIELDS) {
    const text = values[field] ?? ''
    hash.update(`${field}:${text.length}:${text}\n`)
  }
  return hash.digest('hex')
}

function makeRecord(values, version) {
  const sha256 = promptSettingsHash(values)
  return {
    id: 'current',
    version,
    sha256,
    ...values,
    updatedAt: new Date().toISOString(),
  }
}

function validateRecord(raw) {
  const parsed = recordSchema.safeParse(raw)
  if (parsed.success && promptSettingsHash(parsed.data) === parsed.data.sha256) {
    return parsed.data
  }
  throw new AiPromptsError('Persisted AI prompts settings are corrupt', 'corrupt')
}

export class PrismAiPromptsStore extends Service {
  static inject = inject

  constructor(ctx, config = {}) {
    super(ctx, 'prismAiPrompts')
    this.bootstrap = normalizePromptInput({
      editorialInstruction: config.editorialInstruction ?? DEFAULT_AI_PROMPT_SETTINGS.editorialInstruction,
      clusterInstruction: config.clusterInstruction ?? DEFAULT_AI_PROMPT_SETTINGS.clusterInstruction,
      hotKeywordsPrompt: config.hotKeywordsPrompt ?? DEFAULT_AI_PROMPT_SETTINGS.hotKeywordsPrompt,
      hotKeywordsConsolidationPrompt: config.hotKeywordsConsolidationPrompt ?? DEFAULT_AI_PROMPT_SETTINGS.hotKeywordsConsolidationPrompt,
    })
    this.current = undefined
    this.history = undefined
    this.tail = Promise.resolve()
  }

  async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(prismAiPromptsDomain)
    this.current = domain.table('current')
    this.history = domain.table('history')
    try {
      const existing = this.current.get('current')
      if (existing === undefined) {
        const initial = makeRecord(this.bootstrap, 1)
        await this.current.put('current', initial)
        await this.history.put(String(initial.version), initial)
      } else {
        validateRecord(existing)
      }
      this.ctx.effect(() => async () => {
        await this.tail.catch(() => {})
        this.current = undefined
        this.history = undefined
        await domain.close()
      }, 'prismflow-ai-prompts.domainClose')
    } catch (error) {
      this.current = undefined
      this.history = undefined
      await domain.close()
      throw error
    }
  }

  requireCurrent() {
    if (!this.current) throw new AiPromptsError('AI prompts store is unavailable', 'unavailable')
    return this.current
  }

  requireHistory() {
    if (!this.history) throw new AiPromptsError('AI prompts history is unavailable', 'unavailable')
    return this.history
  }

  get() {
    return structuredClone(validateRecord(this.requireCurrent().get('current')))
  }

  getDefaults() {
    return structuredClone(DEFAULT_AI_PROMPT_SETTINGS)
  }

  enqueue(op) {
    const run = this.tail.then(op)
    this.tail = run.then(() => {}, () => {})
    return run
  }

  update(settings, expected) {
    return this.enqueue(async () => {
      if (!expected || typeof expected !== 'object' || !Number.isInteger(expected.version) || !SHA.test(expected.sha256 ?? '')) {
        throw new AiPromptsError('Expected prompt settings revision is invalid')
      }
      const current = this.get()
      if (current.version !== expected.version || current.sha256 !== expected.sha256) {
        throw new AiPromptsError('AI prompts settings changed; reload before saving', 'conflict')
      }
      const normalized = normalizePromptInput(settings)
      const next = makeRecord(normalized, current.version + 1)
      await this.requireHistory().put(String(next.version), next)
      await this.requireCurrent().put('current', next)
      return this.get()
    })
  }

  resetToDefaults(expected) {
    return this.update(DEFAULT_AI_PROMPT_SETTINGS, expected)
  }
}

export default PrismAiPromptsStore
