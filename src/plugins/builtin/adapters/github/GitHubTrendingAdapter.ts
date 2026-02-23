import { BaseAdapter } from '../../../base/BaseAdapter.js';
import type { UnifiedData } from '../../../../types/index.js';
import type { AdapterMetadata } from '../../../../registries/AdapterRegistry.js';
import { LogService } from '../../../../services/LogService.js';


export class GitHubTrendingAdapter extends BaseAdapter {
  static metadata: AdapterMetadata = {
    type: 'GitHubTrendingAdapter',
    name: 'GitHub Trending',
    description: '获取 GitHub 热搜榜单',
    icon: 'trending_up',
    configFields: [
      { key: 'apiUrl', label: 'API 地址', type: 'text', required: true, scope: 'adapter' },
      { key: 'since', label: '时间范围', type: 'select', options: ['daily', 'weekly', 'monthly'], default: 'daily', scope: 'item' }
    ]
  };

  configFields = GitHubTrendingAdapter.metadata.configFields;


  constructor(

    public readonly name: string = 'GitHub Trending',
    public readonly category: string = 'githubTrending',
    private since: string = 'daily'
  ) {
    super();
    this.appendDateToId = true;
  }

  async fetch(config: { apiUrl: string, since?: string }): Promise<any> {
    // If apiUrl ends with daily/weekly/monthly, we might want to replace it
    // but better to expect a base URL or a full URL in config
    const since = config.since || this.since;
    const url = config.apiUrl.replace(/\/(daily|weekly|monthly)$/, `/${since}`);
    LogService.info(`[GitHubTrendingAdapter: ${this.name}] Requesting: ${url}`);
    const response = await fetch(url, { dispatcher: this.dispatcher } as any);
    if (!response.ok) {
      LogService.error(`[GitHubTrendingAdapter: ${this.name}] Failed to fetch: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch GitHub Trending: ${response.statusText}`);
    }
    const data = await response.json();
    LogService.info(`[GitHubTrendingAdapter: ${this.name}] Successfully fetched ${Array.isArray(data) ? data.length : 0} items.`);
    return data;
  }

  transform(rawData: any[], config?: any): UnifiedData[] {
    const now = new Date().toISOString();
    return rawData.map((project, index) => ({
      id: `gh-${project.owner}-${project.name}`, // 更稳定的 ID 用于去重
      title: project.name,
      url: project.url,
      description: project.description || '',
      published_date: now,
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


