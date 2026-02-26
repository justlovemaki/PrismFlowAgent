import { BaseAdapter } from '../../../base/BaseAdapter.js';
import type { UnifiedData } from '../../../../types/index.js';
import type { AdapterMetadata } from '../../../../registries/AdapterRegistry.js';
import { LogService } from '../../../../services/LogService.js';


// --- Constants and Configuration ---
const GITHUB_TRENDING_BASE_URL = 'https://github.com/trending';

const ScraperConstants = {
  REPO_ARTICLE_SELECTOR: /<article class="Box-row">(.*?)<\/article>/gs,
  REPO_LINK_NAME_SELECTORS: [
    // Order matters: try more specific/common ones first
    /<h2 class="h3 lh-condensed">\s*<a data-hydro-click=.*?href="(\/([^"/]+)\/([^"/]+))"[^>]*>\s*(?:<svg.*?<\/svg>\s*)?(?:<span class="text-normal">\s*[^<]+\s*\/\s*<\/span>\s*)?[^<]+<\/a>\s*<\/h2>/s, // Covers more variations of owner/name presentation
    /<h2 class="h3 lh-condensed">\s*<a\s*[^>]*href="(\/([^"/]+)\/([^"/]+))"[^>]*>\s*(?:<svg.*?<\/svg>\s*)?(?:<span data-view-component="true" class="text-normal">\s*[^<]+\s*\/\s*<\/span>\s*)?[^<]+<\/a>\s*<\/h2>/s,
    /<h2 class="h3 lh-condensed">\s*<a\s*[^>]*href="(\/([^"/]+)\/([^"/]+))"[^>]*>\s*(?:<svg.*?<\/svg>\s*)?(?:<span class="text-normal">[^<]+<\/span>\s*\/\s*<strong>[^<]+<\/strong>\s*)?[^<]+<\/a>\s*<\/h2>/s,
  ],
  // Specific detail extractors (relative to articleHtml)
  DESCRIPTION_SELECTOR: /<p class="col-9 color-fg-muted my-1 [^"]*">\s*(.*?)\s*<\/p>/s,
  LANGUAGE_SELECTOR: /<span itemprop="programmingLanguage">(.*?)<\/span>/s,
  LANGUAGE_COLOR_SELECTOR: /<span class="repo-language-color" style="background-color:\s*(#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|[a-zA-Z]+)">/s,
  TOTAL_STARS_SELECTOR: /<a [^>]*href="[^"]*\/stargazers"[^>]*>\s*(?:<svg.*?<\/svg>\s*)?([\d,]+)\s*<\/a>/s,
  FORKS_SELECTOR: /<a [^>]*href="[^"]*\/forks"[^>]*>\s*(?:<svg.*?<\/svg>\s*)?([\d,]+)\s*<\/a>/s,
  STARS_TODAY_SELECTORS: [
    // Try more specific patterns first
    />\s*(?:<svg.*?<\/svg>\s*)?([\d,]+)\s*stars today\s*</is,
    />\s*(?:<svg.*?<\/svg>\s*)?([\d,]+)\s*star today\s*</is, // Singular form
    /([\d,]+)\s*<[^>]*>\s*stars today\s*<[^>]*>/is,
    /([\d,]+)\s*<[^>]*>\s*star today\s*<[^>]*>/is,
    /([\d,]+)\s*stars today/is, // Most loose
    /([\d,]+)\s*star today/is,
  ],
  BUILT_BY_AVATAR_SELECTOR: /<img class="avatar mb-1(?: avatar-user)?" src="([^"]+)"/g,
};

// --- Utility Functions ---

function tryRegexSequentially(text: string, regexArray: RegExp[], groupIndices: number | number[] = 1): string | string[] | null {
  for (const regex of regexArray) {
    const match = regex.exec(text);
    if (match) {
      if (Array.isArray(groupIndices)) {
        return groupIndices.map(idx => (match[idx] ? match[idx].trim() : ''));
      }
      return match[groupIndices as number] ? match[groupIndices as number].trim() : null;
    }
  }
  return Array.isArray(groupIndices) ? groupIndices.map(() => '') : null;
}

function getMatch(regex: RegExp, text: string, groupIndex: number = 1, defaultValue: string = ''): string {
  const match = regex.exec(text);
  return match && match[groupIndex] ? match[groupIndex].trim() : defaultValue;
}

function getAllMatches(regex: RegExp, text: string, groupIndex: number = 1): string[] {
  const matches = [];
  let match;
  regex.lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match[groupIndex]) {
      matches.push(match[groupIndex].trim());
    }
  }
  return matches;
}

function safeParseInt(str: string | null): number {
  if (!str) return 0;
  return parseInt(str.replace(/,/g, ''), 10) || 0;
}

function getRandomInt(min: number, max: number): number {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const userAgentGenerators = [
  () => {
    const chromeVersion = `${getRandomInt(100, 122)}.0.${getRandomInt(5000, 6200)}.${getRandomInt(0, 150)}`;
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  },
  () => {
    const chromeVersion = `${getRandomInt(100, 122)}.0.${getRandomInt(5000, 6200)}.${getRandomInt(0, 150)}`;
    const macOsVersions = ['10_15_7', '11_7_10', '12_6_3', '13_5_1', '14_1_1'];
    const macOsVersion = macOsVersions[getRandomInt(0, macOsVersions.length - 1)];
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macOsVersion}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  },
  () => {
    const chromeVersion = `${getRandomInt(100, 122)}.0.${getRandomInt(5000, 6200)}.${getRandomInt(0, 150)}`;
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  },
  () => {
    const ffVersion = `${getRandomInt(98, 120)}.0`;
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${ffVersion}) Gecko/20100101 Firefox/${ffVersion}`;
  },
  () => {
    const ffVersion = `${getRandomInt(98, 120)}.0`;
    const macOsVersions = ['10.15', '11.0', '12.0', '13.0', '14.0'];
    const macOsVersion = macOsVersions[getRandomInt(0, macOsVersions.length - 1)];
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macOsVersion}; rv:${ffVersion}) Gecko/20100101 Firefox/${ffVersion}`;
  },
  () => {
    const safariVersionMajor = getRandomInt(15, 17);
    const safariVersionMinor = getRandomInt(0, 3);
    const webkitVersion = `${getRandomInt(605, 612)}.1.${getRandomInt(15, 40)}`;
    const macOsVersions = ['10_15_7', '11_7_10', '12_6_3', '13_5_1', '14_1_1'];
    const macOsVersion = macOsVersions[getRandomInt(0, macOsVersions.length - 1)];
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macOsVersion}) AppleWebKit/${webkitVersion} (KHTML, like Gecko) Version/${safariVersionMajor}.${safariVersionMinor} Safari/${webkitVersion.split('.')[0]}.1`;
  },
  () => {
    const baseChromeVersion = `${getRandomInt(100, 122)}`;
    const chromeVersion = `${baseChromeVersion}.0.${getRandomInt(5000, 6200)}.${getRandomInt(0, 150)}`;
    const edgeVersion = `${baseChromeVersion}.0.${getRandomInt(1800, 2300)}.${getRandomInt(0, 100)}`;
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 Edg/${edgeVersion}`;
  },
  () => {
    const chromeVersion = `${getRandomInt(100, 122)}.0.${getRandomInt(5000, 6200)}.${getRandomInt(0, 150)}`;
    const androidVersion = getRandomInt(10, 14);
    const deviceModels = ["SM-G991U", "Pixel 7", "SM-A536U", "OnePlus 10 Pro", "Xiaomi M2102K1G"];
    const deviceModel = deviceModels[getRandomInt(0, deviceModels.length - 1)];
    return `Mozilla/5.0 (Linux; Android ${androidVersion}; ${deviceModel}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`;
  },
  () => {
    const ffVersion = `${getRandomInt(98, 120)}.0`;
    const androidVersion = getRandomInt(10, 14);
    return `Mozilla/5.0 (Android ${androidVersion}; Mobile; rv:${ffVersion}) Gecko/${ffVersion} Firefox/${ffVersion}`;
  },
  () => {
    const iOSVersionMajor = getRandomInt(15, 17);
    const iOSVersionMinor = getRandomInt(0, 5);
    const webkitVersion = `${getRandomInt(605, 612)}.1.${getRandomInt(15, 40)}`;
    const deviceBuild = `${iOSVersionMajor < 16 ? 15 + (iOSVersionMajor - 15) : 19 + (iOSVersionMajor - 16)}${String.fromCharCode(65 + getRandomInt(0, 10))}${getRandomInt(100, 500)}${getRandomInt(0, 1) === 0 ? String.fromCharCode(97 + getRandomInt(0, 3)) : ''}`;
    return `Mozilla/5.0 (iPhone; CPU iPhone OS ${iOSVersionMajor}_${iOSVersionMinor} like Mac OS X) AppleWebKit/${webkitVersion} (KHTML, like Gecko) Version/${iOSVersionMajor}.${iOSVersionMinor} Mobile/${deviceBuild} Safari/${webkitVersion.split('.')[0]}.1.15`;
  }
];

function getRandomUserAgent(): string {
  const generatorIndex = Math.floor(Math.random() * userAgentGenerators.length);
  return userAgentGenerators[generatorIndex]();
}

export class GitHubTrendingAdapter extends BaseAdapter {
  static metadata: AdapterMetadata = {
    type: 'GitHubTrendingAdapter',
    name: 'GitHub Trending',
    description: '获取 GitHub 热搜榜单',
    icon: 'trending_up',
    configFields: [
      { key: 'apiUrl', label: 'API 地址', type: 'text', required: true, scope: 'adapter' },
      { key: 'since', label: '时间范围', type: 'select', options: ['daily', 'weekly', 'monthly'], default: 'daily', scope: 'item' },
      { key: 'spoken_language_code', label: '口语代码', type: 'select', options: ['', 'en', 'zh'], default: '', scope: 'item' }
    ]
  };

  configFields = GitHubTrendingAdapter.metadata.configFields;
  private since: string = 'daily';
  private spokenLanguageCode: string = '';

  constructor(
    public readonly name: string = 'GitHub Trending',
    public readonly category: string = 'githubTrending',
    itemConfig: any = {}
  ) {
    super();
    this.since = itemConfig.since || 'daily';
    this.spokenLanguageCode = itemConfig.spoken_language_code || '';
    this.appendDateToId = true;
  }

  private parseRepositoryArticle(articleHtml: string) {
    const repo: any = {
      url: '',
      owner: '',
      name: '',
      description: '',
      language: '',
      languageColor: '',
      totalStars: 0,
      forks: 0,
      starsToday: 0,
      builtBy: [],
    };

    const repoLinkNameParts = tryRegexSequentially(articleHtml, ScraperConstants.REPO_LINK_NAME_SELECTORS, [1, 2, 3]) as string[];
    if (repoLinkNameParts && repoLinkNameParts[0]) {
      repo.url = `https://github.com${repoLinkNameParts[0]}`;
      repo.owner = repoLinkNameParts[1] || '';
      repo.name = repoLinkNameParts[2] || '';
    }

    repo.description = getMatch(ScraperConstants.DESCRIPTION_SELECTOR, articleHtml)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    repo.language = getMatch(ScraperConstants.LANGUAGE_SELECTOR, articleHtml);
    repo.languageColor = getMatch(ScraperConstants.LANGUAGE_COLOR_SELECTOR, articleHtml, 1, '');

    repo.totalStars = safeParseInt(getMatch(ScraperConstants.TOTAL_STARS_SELECTOR, articleHtml));
    repo.forks = safeParseInt(getMatch(ScraperConstants.FORKS_SELECTOR, articleHtml));

    const starsTodayStr = tryRegexSequentially(articleHtml, ScraperConstants.STARS_TODAY_SELECTORS, 1) as string;
    repo.starsToday = safeParseInt(starsTodayStr);

    repo.builtBy = getAllMatches(ScraperConstants.BUILT_BY_AVATAR_SELECTOR, articleHtml);

    return repo;
  }

  private scrapeTrendingRepos(html: string) {
    const repos = [];
    const articleMatches = html.matchAll(ScraperConstants.REPO_ARTICLE_SELECTOR);

    for (const articleMatch of articleMatches) {
      const articleHtml = articleMatch[1];
      if (articleHtml) {
        const repoData = this.parseRepositoryArticle(articleHtml);
        if (repoData.name && repoData.url) {
          repos.push(repoData);
        }
      }
    }
    return repos;
  }

  async fetch(config: { apiUrl: string, since?: string, spoken_language_code?: string }): Promise<any> {
    const since = config.since || this.since;
    const spokenLanguageCode = config.spoken_language_code || this.spokenLanguageCode;

    // Construct the URL. If apiUrl is provided, we use it as base.
    // GitHub trending usually expects something like https://github.com/trending?since=daily
    let url = config.apiUrl || GITHUB_TRENDING_BASE_URL;
    
    const urlObj = new URL(url);
    urlObj.searchParams.set('since', since);
    if (spokenLanguageCode) {
      urlObj.searchParams.set('spoken_language_code', spokenLanguageCode);
    }
    url = urlObj.toString();

    LogService.info(`[GitHubTrendingAdapter: ${this.name}] Requesting: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      dispatcher: this.dispatcher 
    } as any);

    if (!response.ok) {
      LogService.error(`[GitHubTrendingAdapter: ${this.name}] Failed to fetch: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch GitHub Trending: ${response.statusText}`);
    }

    const html = await response.text();
    const repos = this.scrapeTrendingRepos(html);

    if (repos.length === 0 && html.length > 0) {
      LogService.warn(`[GitHubTrendingAdapter: ${this.name}] No repositories parsed. Check selectors or URL: ${url}`);
    }

    LogService.info(`[GitHubTrendingAdapter: ${this.name}] Successfully fetched and parsed ${repos.length} items.`);
    return repos;
  }

  transform(rawData: any[], config?: any): UnifiedData[] {
    const now = new Date().toISOString();
    return rawData.map((project, index) => ({
      id: `gh-${project.owner}-${project.name}`,
      title: project.name,
      url: project.url,
      description: project.description || '',
      published_date: now,
      ingestion_date: now.split('T')[0],
      source: this.name,
      category: this.category,
      author: project.owner,
      metadata: {
        language: project.language,
        stars: project.totalStars,
        starsToday: project.starsToday,
        forks: project.forks
      }
    }));
  }
}



