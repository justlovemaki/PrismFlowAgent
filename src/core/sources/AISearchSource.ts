import { createHash } from 'node:crypto';

export interface AISearchRawItem {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  content?: unknown;
  author?: unknown;
  published_date?: unknown;
  metadata?: unknown;
}

export interface NormalizedAISearchItem {
  id: string;
  title: string;
  url: string;
  description: string;
  published_date: string;
  ingestion_date: string;
  source: string;
  category: string;
  author: string;
  metadata: Record<string, unknown> & {
    content_html: string;
    is_ai_generated: true;
    keyword: string;
    executor_id: string;
  };
}

export interface NormalizeAISearchOptions {
  sourceName: string;
  category: string;
  keyword: string;
  executorId: string;
  now?: Date;
}

function asString(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function removeMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const withoutOpen = trimmed.replace(/^```(?:json|markdown)?\s*/i, '');
  return withoutOpen.replace(/\s*```$/, '').trim();
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function itemsFromValue(value: unknown): AISearchRawItem[] | null {
  if (Array.isArray(value)) return value as AISearchRawItem[];
  if (value && typeof value === 'object') {
    const items = (value as { items?: unknown }).items;
    if (Array.isArray(items)) return items as AISearchRawItem[];
  }
  return null;
}

export function buildAISearchPrompt(keyword: string, limit: number): string {
  if (!keyword.trim()) throw new Error('AI Search keyword is required');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('AI Search limit must be an integer from 1 to 50');
  }

  return `请针对关键词“${keyword}”进行深入网络检索，最多返回 ${limit} 条真实且相关的资讯。\n\n`
    + '必须先使用可用的网络搜索工具核实信息和真实 URL。不要编造链接、作者、日期或统计数据。\n'
    + '最终通过结构化输出提交一个对象，格式为 {"items":[...]}。每个 items 元素包含：\n'
    + '- title：资讯标题\n'
    + '- url：真实来源链接；没有真实链接的条目不要返回\n'
    + '- description：简要描述\n'
    + '- content：完整但精炼的事实描述\n'
    + '- author：作者或来源机构（可选）\n'
    + '- published_date：ISO 日期或可验证的发布日期（可选）\n'
    + '- metadata：额外结构化信息（可选）';
}

export function parseAISearchItems(content: string): AISearchRawItem[] {
  if (!content.trim()) return [];
  const cleaned = removeMarkdownFence(content);

  const candidates = [
    cleaned,
    content.match(/\[[\s\S]*\]/)?.[0],
    content.match(/\{[\s\S]*\}/)?.[0],
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      const items = itemsFromValue(JSON.parse(candidate));
      if (items) return items;
    } catch {
      // Continue to the next bounded extraction candidate.
    }
  }

  return [];
}

export function normalizeAISearchItems(
  items: AISearchRawItem[],
  options: NormalizeAISearchOptions,
): NormalizedAISearchItem[] {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const results: NormalizedAISearchItem[] = [];
  const candidates = Array.isArray(items) ? items : [];
  for (let index = 0; index < candidates.length; index += 1) {
    const item = candidates[index];
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (typeof item.title !== 'string' || !item.title.trim() || typeof item.url !== 'string' || typeof item.content !== 'string' || !item.content.trim()) continue;
      let url: URL;
      try { url = new URL(item.url); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      const title = item.title;
      const idHash = createHash('sha256').update(title).digest('hex').slice(0, 8);
      const metadata = jsonObject(item.metadata);
      results.push({
        id: `ai-search-${options.sourceName}-${index}-${idHash}`,
        title,
        url: item.url,
        description: typeof item.description === 'string' ? item.description : '',
        published_date: typeof item.published_date === 'string' ? item.published_date : nowIso,
        ingestion_date: nowIso.slice(0, 10),
        source: typeof item.author === 'string' && item.author.trim() ? item.author : options.sourceName,
        category: options.category,
        author: typeof item.author === 'string' ? item.author : '',
        metadata: {
          ...metadata,
          content_html: item.content,
          is_ai_generated: true,
          keyword: options.keyword,
          executor_id: options.executorId,
        },
      });
    } catch {
      // One malformed model item must not invalidate later structured search results.
    }
  }
  return results;
}
