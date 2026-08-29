export type GitHubTrendingSince = 'daily' | 'weekly' | 'monthly';

export interface GitHubTrendingDefinition {
  id: string;
  name: string;
  baseUrl: string;
  category: string;
  since: GitHubTrendingSince;
  spokenLanguageCode: string;
  limit: number;
}

export interface GitHubTrendingRepository {
  url: string;
  owner: string;
  name: string;
  description: string;
  language: string;
  languageColor: string;
  totalStars: number;
  forks: number;
  starsToday: number;
  builtBy: string[];
}

export interface NormalizedGitHubTrendingItem {
  id: string;
  title: string;
  url: string;
  description: string;
  published_date: string;
  ingestion_date: string;
  source: string;
  category: string;
  author: string;
  metadata: {
    language: string;
    stars: number;
    starsToday: number;
    forks: number;
  };
}

export interface FetchGitHubTrendingOptions {
  limit?: number;
  signal?: AbortSignal;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}

export interface NormalizeGitHubTrendingOptions {
  sourceName: string;
  category: string;
  now?: Date;
}

const DEFAULT_BASE_URL = 'https://github.com/trending';
const DEFAULT_USER_AGENT = 'PrismFlowAgent/1.0';
const MAX_TRENDING_ITEMS = 100;
const VALID_SINCE = new Set<GitHubTrendingSince>(['daily', 'weekly', 'monthly']);

const ScraperPatterns = {
  repositoryArticle: /<article class="Box-row">(.*?)<\/article>/gs,
  repositoryLinks: [
    /<h2 class="h3 lh-condensed">\s*<a data-hydro-click=.*?href="(\/([^"/]+)\/([^"/]+))"[^>]*>\s*(?:<svg.*?<\/svg>\s*)?(?:<span class="text-normal">\s*[^<]+\s*\/\s*<\/span>\s*)?[^<]+<\/a>\s*<\/h2>/s,
    /<h2 class="h3 lh-condensed">\s*<a\s*[^>]*href="(\/([^"/]+)\/([^"/]+))"[^>]*>\s*(?:<svg.*?<\/svg>\s*)?(?:<span data-view-component="true" class="text-normal">\s*[^<]+\s*\/\s*<\/span>\s*)?[^<]+<\/a>\s*<\/h2>/s,
    /<h2 class="h3 lh-condensed">\s*<a\s*[^>]*href="(\/([^"/]+)\/([^"/]+))"[^>]*>\s*(?:<svg.*?<\/svg>\s*)?(?:<span class="text-normal">[^<]+<\/span>\s*\/\s*<strong>[^<]+<\/strong>\s*)?[^<]+<\/a>\s*<\/h2>/s,
  ],
  description: /<p class="col-9 color-fg-muted my-1 [^"]*">\s*(.*?)\s*<\/p>/s,
  language: /<span itemprop="programmingLanguage">(.*?)<\/span>/s,
  languageColor: /<span class="repo-language-color" style="background-color:\s*(#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|[a-zA-Z]+)">/s,
  totalStars: /<a [^>]*href="[^"]*\/stargazers"[^>]*>\s*(?:<svg.*?<\/svg>\s*)?([\d,]+)\s*<\/a>/s,
  forks: /<a [^>]*href="[^"]*\/forks"[^>]*>\s*(?:<svg.*?<\/svg>\s*)?([\d,]+)\s*<\/a>/s,
  starsToday: [
    />\s*(?:<svg.*?<\/svg>\s*)?([\d,]+)\s*stars today\s*</is,
    />\s*(?:<svg.*?<\/svg>\s*)?([\d,]+)\s*star today\s*</is,
    /([\d,]+)\s*<[^>]*>\s*stars today\s*<[^>]*>/is,
    /([\d,]+)\s*<[^>]*>\s*star today\s*<[^>]*>/is,
    /([\d,]+)\s*stars today/is,
    /([\d,]+)\s*star today/is,
  ],
  builtByAvatar: /<img class="avatar mb-1(?: avatar-user)?" src="([^"]+)"/g,
};

function firstMatch(regex: RegExp, text: string, groupIndex = 1): string {
  const match = regex.exec(text);
  return match?.[groupIndex]?.trim() ?? '';
}

function firstSequentialMatch(regexes: RegExp[], text: string, groupIndex = 1): string {
  for (const regex of regexes) {
    const value = firstMatch(regex, text, groupIndex);
    if (value) return value;
  }
  return '';
}

function repositoryLinkParts(articleHtml: string): [string, string, string] {
  for (const regex of ScraperPatterns.repositoryLinks) {
    const match = regex.exec(articleHtml);
    if (match) {
      return [match[1]?.trim() ?? '', match[2]?.trim() ?? '', match[3]?.trim() ?? ''];
    }
  }
  return ['', '', ''];
}

function allMatches(regex: RegExp, text: string, groupIndex = 1): string[] {
  const values: string[] = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[groupIndex]) values.push(match[groupIndex].trim());
  }
  return values;
}

function parseCount(value: string): number {
  return Number.parseInt(value.replace(/,/g, ''), 10) || 0;
}

function resolveLimit(requested: number | undefined, configured: number): number {
  const value = requested ?? configured;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('GitHub Trending fetch limit must be a positive integer');
  }
  return Math.min(value, configured, MAX_TRENDING_ITEMS);
}

export function validateGitHubTrendingDefinition(definition: GitHubTrendingDefinition): void {
  if (!definition.id.trim()) throw new Error('GitHub Trending source id is required');
  if (!definition.name.trim()) throw new Error(`GitHub Trending source ${definition.id} name is required`);
  if (!VALID_SINCE.has(definition.since)) {
    throw new Error(`GitHub Trending source ${definition.id} has invalid since value: ${definition.since}`);
  }
  if (!Number.isInteger(definition.limit) || definition.limit < 1 || definition.limit > MAX_TRENDING_ITEMS) {
    throw new Error(`GitHub Trending source ${definition.id} limit must be an integer from 1 to ${MAX_TRENDING_ITEMS}`);
  }

  const url = new URL(definition.baseUrl || DEFAULT_BASE_URL);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`GitHub Trending source ${definition.id} must use http or https`);
  }
}

export function buildGitHubTrendingUrl(definition: GitHubTrendingDefinition): string {
  validateGitHubTrendingDefinition(definition);
  const url = new URL(definition.baseUrl || DEFAULT_BASE_URL);
  url.searchParams.set('since', definition.since);
  if (definition.spokenLanguageCode) {
    url.searchParams.set('spoken_language_code', definition.spokenLanguageCode);
  } else {
    url.searchParams.delete('spoken_language_code');
  }
  return url.toString();
}

export function parseGitHubTrendingHtml(html: string): GitHubTrendingRepository[] {
  const repositories: GitHubTrendingRepository[] = [];
  const articleMatches = html.matchAll(ScraperPatterns.repositoryArticle);

  for (const articleMatch of articleMatches) {
    const articleHtml = articleMatch[1];
    if (!articleHtml) continue;

    const [path, owner, name] = repositoryLinkParts(articleHtml);
    if (!path || !owner || !name) continue;

    const description = firstMatch(ScraperPatterns.description, articleHtml)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    repositories.push({
      url: `https://github.com${path}`,
      owner,
      name,
      description,
      language: firstMatch(ScraperPatterns.language, articleHtml),
      languageColor: firstMatch(ScraperPatterns.languageColor, articleHtml),
      totalStars: parseCount(firstMatch(ScraperPatterns.totalStars, articleHtml)),
      forks: parseCount(firstMatch(ScraperPatterns.forks, articleHtml)),
      starsToday: parseCount(firstSequentialMatch(ScraperPatterns.starsToday, articleHtml)),
      builtBy: allMatches(ScraperPatterns.builtByAvatar, articleHtml),
    });
  }

  return repositories;
}

export async function fetchGitHubTrending(
  definition: GitHubTrendingDefinition,
  options: FetchGitHubTrendingOptions = {},
): Promise<GitHubTrendingRepository[]> {
  const limit = resolveLimit(options.limit, definition.limit);
  const url = buildGitHubTrendingUrl(definition);
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`GitHub Trending fetch failed for ${definition.id}: ${response.status} ${response.statusText}`);
  }

  return parseGitHubTrendingHtml(await response.text()).slice(0, limit);
}

export function normalizeGitHubTrending(
  repositories: GitHubTrendingRepository[],
  options: NormalizeGitHubTrendingOptions,
): NormalizedGitHubTrendingItem[] {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();

  const results: NormalizedGitHubTrendingItem[] = [];
  const candidates = Array.isArray(repositories) ? repositories : [];
  for (const repository of candidates) {
    try {
      if (!repository || typeof repository !== 'object' || Array.isArray(repository)
        || typeof repository.owner !== 'string' || !repository.owner.trim()
        || typeof repository.name !== 'string' || !repository.name.trim()
        || typeof repository.url !== 'string' || !repository.url.trim()) continue;
      const description = typeof repository.description === 'string' ? repository.description : '';
      const totalStars = Number.isFinite(repository.totalStars) ? repository.totalStars : 0;
      const starsToday = Number.isFinite(repository.starsToday) ? repository.starsToday : 0;
      const forks = Number.isFinite(repository.forks) ? repository.forks : 0;
      const stats: string[] = [];
      if (totalStars) stats.push(`总Star: ${totalStars}`);
      if (starsToday) stats.push(`今日Star: ${starsToday}`);
      if (forks) stats.push(`Fork: ${forks}`);
      const statsText = stats.length > 0 ? `\n[GitHub 统计] ${stats.join(' | ')}` : '';
      const normalizedDescription = `${description}${statsText}`;
      if (!normalizedDescription.trim()) continue;

      results.push({
        id: `gh-${repository.owner}-${repository.name}`,
        title: repository.name,
        url: repository.url,
        description: normalizedDescription,
        published_date: nowIso,
        ingestion_date: nowIso.slice(0, 10),
        source: options.sourceName,
        category: options.category,
        author: repository.owner,
        metadata: {
          language: typeof repository.language === 'string' ? repository.language : '',
          stars: totalStars,
          starsToday,
          forks,
        },
      });
    } catch {
      // A malformed scraped repository must not interrupt later trending rows.
    }
  }
  return results;
}
