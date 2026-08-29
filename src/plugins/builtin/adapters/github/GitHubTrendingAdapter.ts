import { BaseAdapter } from '../../../base/BaseAdapter.js';
import type { UnifiedData } from '../../../../types/index.js';
import type { AdapterMetadata } from '../../../../registries/AdapterRegistry.js';
import { LogService } from '../../../../services/LogService.js';
import { getRandomUserAgent } from '../../../../utils/helpers.js';
import {
  buildGitHubTrendingUrl,
  fetchGitHubTrending,
  normalizeGitHubTrending,
  type GitHubTrendingDefinition,
  type GitHubTrendingRepository,
  type GitHubTrendingSince,
} from '../../../../core/sources/GitHubTrendingSource.js';

const GITHUB_TRENDING_BASE_URL = 'https://github.com/trending';

export class GitHubTrendingAdapter extends BaseAdapter {
  static metadata: AdapterMetadata = {
    type: 'GitHubTrendingAdapter',
    name: 'GitHub Trending',
    description: '获取 GitHub 热搜榜单',
    icon: 'trending_up',
    configFields: [
      { key: 'apiUrl', label: 'API 地址', type: 'text', required: true, scope: 'adapter' },
      { key: 'since', label: '时间范围', type: 'select', options: ['daily', 'weekly', 'monthly'], default: 'daily', scope: 'item' },
      { key: 'spoken_language_code', label: '口语代码', type: 'select', options: ['', 'en', 'zh'], default: '', scope: 'item' },
    ],
  };

  configFields = GitHubTrendingAdapter.metadata.configFields;
  private since: GitHubTrendingSince = 'daily';
  private spokenLanguageCode = '';

  constructor(
    public readonly name: string = 'GitHub Trending',
    public readonly category: string = 'githubTrending',
    itemConfig: { since?: GitHubTrendingSince; spoken_language_code?: string } = {},
  ) {
    super();
    this.since = itemConfig.since || 'daily';
    this.spokenLanguageCode = itemConfig.spoken_language_code || '';
    this.appendDateToId = true;
  }

  private definition(config: {
    apiUrl?: string;
    since?: GitHubTrendingSince;
    spoken_language_code?: string;
  } = {}): GitHubTrendingDefinition {
    return {
      id: this.name,
      name: this.name,
      baseUrl: config.apiUrl || this.apiUrl || GITHUB_TRENDING_BASE_URL,
      category: this.category,
      since: config.since || this.since,
      spokenLanguageCode: config.spoken_language_code || this.spokenLanguageCode,
      limit: 100,
    };
  }

  async fetch(config: {
    apiUrl: string;
    since?: GitHubTrendingSince;
    spoken_language_code?: string;
  }): Promise<GitHubTrendingRepository[]> {
    const definition = this.definition(config);
    LogService.info(`[GitHubTrendingAdapter: ${this.name}] Requesting: ${buildGitHubTrendingUrl(definition)}`);

    const repositories = await fetchGitHubTrending(definition, {
      userAgent: getRandomUserAgent(),
      fetchImpl: this.dispatcher
        ? (input, init) => fetch(input, { ...init, dispatcher: this.dispatcher } as RequestInit)
        : fetch,
    });

    if (repositories.length === 0) {
      LogService.warn(`[GitHubTrendingAdapter: ${this.name}] No repositories parsed. GitHub markup may have changed.`);
    }
    LogService.info(`[GitHubTrendingAdapter: ${this.name}] Successfully fetched and parsed ${repositories.length} items.`);
    return repositories;
  }

  transform(rawData: GitHubTrendingRepository[]): UnifiedData[] {
    return normalizeGitHubTrending(rawData, {
      sourceName: this.name,
      category: this.category,
    });
  }
}
