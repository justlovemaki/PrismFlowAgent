import { createHash } from 'node:crypto';

export const AI_RELEVANCE_CLASSIFIER_VERSION = 'ai-relevance-lexical-v1';

export type AIRelevanceVerdict = 'matched-ai' | 'ambiguous' | 'unmatched';

export type AIRelevanceTopic =
  | 'foundation-models'
  | 'machine-learning'
  | 'agents-rag-inference'
  | 'multimodal-generative-ai'
  | 'frameworks-deployment'
  | 'ai-compute'
  | 'robotics-autonomy'
  | 'safety-governance'
  | 'ai-companies-funding';

export interface RelevanceRecordLike {
  storeId: string;
  sourceId: string;
  firstSeenAt?: string;
  updatedAt?: string;
  item: {
    title?: unknown;
    description?: unknown;
    content?: unknown;
    source?: unknown;
    category?: unknown;
    published_date?: unknown;
    url?: unknown;
    metadata?: unknown;
  };
}

export interface AIRelevanceEvidence {
  field: 'title' | 'description' | 'content' | 'ai_summary' | 'source' | 'category';
  topic?: AIRelevanceTopic;
  phrase: string;
  excerpt: string;
}

export interface AIRelevanceAssessment {
  verdict: AIRelevanceVerdict;
  topics: AIRelevanceTopic[];
  reasonCodes: string[];
  evidence: AIRelevanceEvidence[];
  scannedChars: number;
  truncated: boolean;
}

export interface AIRelevanceClassifierOptions {
  maxScanChars?: number;
  maxEvidence?: number;
  maxEvidenceChars?: number;
}

type ClassificationField = 'title' | 'description' | 'content' | 'ai_summary' | 'source' | 'category';
interface PhraseSpec { topic: AIRelevanceTopic; phrase: string }

const TOPIC_PHRASES: Record<AIRelevanceTopic, string[]> = {
  'foundation-models': [
    'large language model', 'foundation model', '大语言模型', '基础模型', '大模型',
    'llm', 'gpt-4', 'chatgpt', 'deepseek', 'claude', 'gemini', 'llama model',
  ],
  'machine-learning': [
    'machine learning', 'deep learning', 'reinforcement learning', 'neural network',
    '机器学习', '深度学习', '强化学习', '神经网络',
  ],
  'agents-rag-inference': [
    'ai agent', 'agentic ai', 'agentic workflow', 'retrieval augmented generation',
    '检索增强生成', '智能体', '模型推理', '模型训练', 'fine-tuning', 'fine tuning',
    '微调模型', 'prompt engineering', 'rag pipeline',
  ],
  'multimodal-generative-ai': [
    'generative ai', 'multimodal model', 'text-to-image', 'text to image',
    '生成式人工智能', '生成式ai', '多模态模型', '文生图', '文生视频',
  ],
  'frameworks-deployment': [
    'pytorch', 'tensorflow', 'hugging face', 'transformers library', 'vllm',
    'llama.cpp', 'langchain', '模型部署', '推理框架', '模型服务',
  ],
  'ai-compute': [
    'ai chip', 'ai accelerator', 'artificial intelligence chip', 'gpu cluster',
    'tensor processing unit', 'nvidia cuda', '人工智能芯片', 'ai算力', '人工智能算力', 'gpu集群',
  ],
  'robotics-autonomy': [
    'robot learning', 'humanoid robot', 'autonomous driving', 'embodied ai',
    '机器人学习', '人形机器人', '自动驾驶', '具身智能',
  ],
  'safety-governance': [
    'ai safety', 'ai governance', 'ai regulation', 'artificial intelligence safety',
    'artificial intelligence regulation', '人工智能安全', '人工智能治理', '人工智能监管', '大模型监管',
  ],
  'ai-companies-funding': [
    'ai startup', 'ai company', 'ai funding', 'ai investment',
    'artificial intelligence company', '人工智能公司', '人工智能融资', '大模型公司', '大模型融资',
  ],
};

const STRONG_PHRASES: PhraseSpec[] = Object.entries(TOPIC_PHRASES)
  .flatMap(([topic, phrases]) => phrases.map(phrase => ({ topic: topic as AIRelevanceTopic, phrase })));
const AMBIGUOUS_PHRASES = [
  'ai', 'model', 'agent', 'training', 'inference', 'chip', 'robot',
  '模型', '训练', '推理', '芯片', '机器人', '智能', '算法',
];
const MAX_MATCHES_PER_FIELD = 64;

function rawString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function metadataSummary(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return '';
  return rawString((metadata as Record<string, unknown>).ai_summary);
}

export function rawAIRelevanceFields(record: RelevanceRecordLike): Record<ClassificationField, string> {
  const item = record?.item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Relevance record item is invalid');
  return {
    title: rawString(item.title),
    description: rawString(item.description),
    content: rawString(item.content),
    ai_summary: metadataSummary(item.metadata),
    source: rawString(item.source),
    category: rawString(item.category),
  };
}

export function aiRelevanceInputChars(record: RelevanceRecordLike): number {
  return Object.values(rawAIRelevanceFields(record)).reduce((total, value) => total + value.length, 0);
}

/** Hash exact raw classifier inputs without constructing a second full-body string. */
export function aiRelevanceContentHash(record: RelevanceRecordLike, maxInputChars = 2_000_000): string {
  if (!Number.isInteger(maxInputChars) || maxInputChars < 1_024 || maxInputChars > 10_000_000) {
    throw new Error('maxInputChars is invalid');
  }
  const fields = rawAIRelevanceFields(record);
  const inputChars = Object.values(fields).reduce((total, value) => total + value.length, 0);
  if (inputChars > maxInputChars) throw new Error('AI relevance hash input exceeds the configured per-record limit');
  const hash = createHash('sha256');
  for (const [field, value] of Object.entries(fields)) {
    const fieldBytes = Buffer.byteLength(field, 'utf8');
    const valueBytes = Buffer.byteLength(value, 'utf8');
    hash.update(`${fieldBytes}:`).update(field, 'utf8').update(`${valueBytes}:`).update(value, 'utf8');
  }
  return hash.digest('hex');
}

export function aiRelevanceProfileFingerprint(profile: {
  maxScanCharsPerRecord: number;
  maxEvidence: number;
  maxEvidenceChars: number;
  maxCardChars: number;
}): string {
  return createHash('sha256').update(JSON.stringify({
    classifierVersion: AI_RELEVANCE_CLASSIFIER_VERSION,
    maxScanCharsPerRecord: profile.maxScanCharsPerRecord,
    maxEvidence: profile.maxEvidence,
    maxEvidenceChars: profile.maxEvidenceChars,
    maxCardChars: profile.maxCardChars,
  }), 'utf8').digest('hex');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
}

function hasHan(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function combinedMatcher(phrases: string[]): RegExp {
  const alternatives = [...phrases].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
  return new RegExp(alternatives, 'giu');
}

const STRONG_MATCHER = combinedMatcher(STRONG_PHRASES.map(item => item.phrase));
const AMBIGUOUS_MATCHER = combinedMatcher(AMBIGUOUS_PHRASES);
const STRONG_BY_PHRASE = new Map(STRONG_PHRASES.map(item => [item.phrase.toLocaleLowerCase('en-US'), item]));
const AMBIGUOUS_SET = new Set(AMBIGUOUS_PHRASES.map(item => item.toLocaleLowerCase('en-US')));

function normalizedPhrase(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}

function validLatinBoundary(text: string, index: number, length: number, phrase: string): boolean {
  if (hasHan(phrase) || !/[a-z]/iu.test(phrase)) return true;
  const before = index > 0 ? text[index - 1] : '';
  const after = index + length < text.length ? text[index + length] : '';
  return !/[A-Za-z0-9_]/u.test(before) && !/[A-Za-z0-9_]/u.test(after);
}

function matches(text: string, matcher: RegExp, allowed: ReadonlySet<string> | ReadonlyMap<string, unknown>) {
  matcher.lastIndex = 0;
  const result: Array<{ index: number; phrase: string }> = [];
  for (const match of text.matchAll(matcher)) {
    const phrase = normalizedPhrase(match[0]);
    if (!allowed.has(phrase) || !validLatinBoundary(text, match.index ?? 0, match[0].length, phrase)) continue;
    result.push({ index: match.index ?? 0, phrase });
    if (result.length >= MAX_MATCHES_PER_FIELD) break;
  }
  return result;
}

function normalizeSample(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function boundedExcerpt(text: string, index: number, maxChars: number): string {
  const radius = Math.max(8, Math.floor((maxChars - 1) / 2));
  let start = Math.max(0, index - radius);
  let end = Math.min(text.length, index + radius);
  if (end - start > maxChars) end = start + maxChars;
  if (end === text.length && end - start < maxChars) start = Math.max(0, end - maxChars);
  const value = text.slice(start, end).replace(/[\u0000-\u001f\u007f]/gu, ' ').trim();
  return `${start > 0 ? '…' : ''}${value}${end < text.length ? '…' : ''}`.slice(0, maxChars);
}

function sampledText(value: string, maxChars: number): { text: string; consumedChars: number; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, consumedChars: value.length, truncated: false };
  const first = Math.floor(maxChars / 3);
  const second = Math.floor(maxChars / 3);
  const third = maxChars - first - second;
  const middle = Math.max(0, Math.floor((value.length - second) / 2));
  return {
    text: `${value.slice(0, first)}${value.slice(middle, middle + second)}${value.slice(-third)}`,
    consumedChars: maxChars,
    truncated: true,
  };
}

export function assessAIRelevance(record: RelevanceRecordLike, options: AIRelevanceClassifierOptions = {}): AIRelevanceAssessment {
  const maxScanChars = options.maxScanChars ?? 524_288;
  const maxEvidence = options.maxEvidence ?? 8;
  const maxEvidenceChars = options.maxEvidenceChars ?? 160;
  if (!Number.isInteger(maxScanChars) || maxScanChars < 1_024 || maxScanChars > 2_000_000) throw new Error('maxScanChars is invalid');
  if (!Number.isInteger(maxEvidence) || maxEvidence < 1 || maxEvidence > 32) throw new Error('maxEvidence is invalid');
  if (!Number.isInteger(maxEvidenceChars) || maxEvidenceChars < 40 || maxEvidenceChars > 500) throw new Error('maxEvidenceChars is invalid');

  const rawFields = rawAIRelevanceFields(record);
  const fields: Array<{ field: ClassificationField; text: string }> = [];
  let remaining = maxScanChars;
  let scannedChars = 0;
  let truncated = false;
  for (const [field, value] of Object.entries(rawFields) as Array<[ClassificationField, string]>) {
    if (!value) continue;
    if (remaining === 0) { truncated = true; continue; }
    const sample = sampledText(value, remaining);
    fields.push({ field, text: normalizeSample(sample.text) });
    remaining -= sample.consumedChars;
    scannedChars += sample.consumedChars;
    truncated ||= sample.truncated;
  }

  const evidence: AIRelevanceEvidence[] = [];
  const topics = new Set<AIRelevanceTopic>();
  let strongCount = 0;
  let titleOrSummaryStrong = false;
  for (const field of fields) {
    const found = matches(field.text, STRONG_MATCHER, STRONG_BY_PHRASE);
    for (const match of found) {
      const spec = STRONG_BY_PHRASE.get(match.phrase);
      if (!spec) continue;
      topics.add(spec.topic);
      strongCount += 1;
      if (field.field === 'title' || field.field === 'ai_summary') titleOrSummaryStrong = true;
      if (evidence.length < maxEvidence) evidence.push({
        field: field.field, topic: spec.topic, phrase: spec.phrase,
        excerpt: boundedExcerpt(field.text, match.index, maxEvidenceChars),
      });
    }
  }

  let weakCount = 0;
  if (strongCount === 0) {
    for (const field of fields) {
      const found = matches(field.text, AMBIGUOUS_MATCHER, AMBIGUOUS_SET);
      weakCount += found.length;
      if (found.length > 0 && evidence.length < maxEvidence) evidence.push({
        field: field.field, phrase: found[0].phrase,
        excerpt: boundedExcerpt(field.text, found[0].index, maxEvidenceChars),
      });
    }
  }

  const reasonCodes: string[] = [];
  let verdict: AIRelevanceVerdict;
  if (titleOrSummaryStrong) { verdict = 'matched-ai'; reasonCodes.push('strong-title-or-summary'); }
  else if (topics.size >= 2) { verdict = 'matched-ai'; reasonCodes.push('multiple-ai-topic-families'); }
  else if (strongCount >= 2) { verdict = 'matched-ai'; reasonCodes.push('repeated-strong-ai-evidence'); }
  else if (strongCount === 1) { verdict = 'ambiguous'; reasonCodes.push('single-strong-body-signal'); }
  else if (weakCount > 0) { verdict = 'ambiguous'; reasonCodes.push('ambiguous-ai-terms-only'); }
  else if (truncated) { verdict = 'ambiguous'; reasonCodes.push('scan-truncated-without-signal'); }
  else { verdict = 'unmatched'; reasonCodes.push('no-recognized-ai-evidence'); }
  if (truncated && !reasonCodes.includes('scan-truncated-without-signal')) reasonCodes.push('scan-truncated');
  return { verdict, topics: [...topics].sort(), reasonCodes, evidence, scannedChars, truncated };
}

function boundedText(value: unknown, maxChars: number): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim().slice(0, maxChars).replace(/[\u0000-\u001f\u007f]/gu, ' ')
    : '';
}

export function buildAIRelevanceCard(record: RelevanceRecordLike, assessment: AIRelevanceAssessment, maxChars = 2_000): Record<string, unknown> {
  if (!Number.isInteger(maxChars) || maxChars < 512 || maxChars > 8_000) throw new Error('maxChars is invalid');
  const card = {
    storeId: record.storeId,
    sourceId: record.sourceId,
    title: boundedText(record.item.title, 500),
    url: boundedText(record.item.url, 1_000),
    source: boundedText(record.item.source, 200),
    category: boundedText(record.item.category, 200),
    publishedAt: boundedText(record.item.published_date, 64) || boundedText(record.firstSeenAt, 64),
    verdict: assessment.verdict,
    topics: assessment.topics,
    reasonCodes: assessment.reasonCodes,
    evidence: assessment.evidence.map(item => ({
      field: item.field,
      ...(item.topic ? { topic: item.topic } : {}),
      excerpt: item.excerpt,
    })),
  };
  if (JSON.stringify(card).length <= maxChars) return card;
  const compact = {
    storeId: card.storeId, sourceId: card.sourceId, title: card.title.slice(0, 120),
    publishedAt: card.publishedAt, verdict: card.verdict, topics: card.topics.slice(0, 3),
    reasonCodes: card.reasonCodes.slice(0, 2), evidence: card.evidence.slice(0, 1).map(item => ({
      field: item.field, ...(item.topic ? { topic: item.topic } : {}), excerpt: item.excerpt.slice(0, 60),
    })), truncated: true,
  };
  while (JSON.stringify(compact).length > maxChars && compact.evidence.length > 0) compact.evidence.pop();
  while (JSON.stringify(compact).length > maxChars && compact.topics.length > 0) compact.topics.pop();
  while (JSON.stringify(compact).length > maxChars && compact.reasonCodes.length > 0) compact.reasonCodes.pop();
  if (JSON.stringify(compact).length > maxChars) compact.title = compact.title.slice(0, 40);
  if (JSON.stringify(compact).length > maxChars) throw new Error('maxChars is too small for a compact relevance card');
  return compact;
}
