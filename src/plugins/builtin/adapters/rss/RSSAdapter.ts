import { BaseAdapter } from '../../../base/BaseAdapter.js';
import type { UnifiedData } from '../../../../types/index.js';
import type { AdapterMetadata } from '../../../../registries/AdapterRegistry.js';
import { getRandomUserAgent } from '../../../../utils/helpers.js';
import {
  fetchParsedRssFeed,
  normalizeParsedRssFeed,
  type ParsedRssFeed,
  type RssFeedDefinition,
} from '../../../../core/sources/RssSource.js';

export class RSSAdapter extends BaseAdapter {
  static metadata: AdapterMetadata = {
    type: 'RSSAdapter',
    name: 'RSS 订阅源',
    description: '通过标准 RSS/Atom 地址获取内容',
    icon: 'rss_feed',
    configFields: [
      { key: 'rssUrl', label: 'RSS 地址', type: 'text', required: true, scope: 'item' },
      { key: 'limit', label: '抓取上限', type: 'number', default: 20, scope: 'item' },
    ]
  };

  configFields = RSSAdapter.metadata.configFields;

  private rssUrl?: string;
  private limit: number = 20;

  constructor(
    public readonly name: string,
    public readonly category: string,
    itemConfig: any = {}
  ) {
    super();
    this.rssUrl = itemConfig.rssUrl;
    this.limit = itemConfig.limit || 20;
  }

  private feedDefinition(config: { rssUrl?: string; limit?: number; category?: string } = {}): RssFeedDefinition {
    const url = config.rssUrl || this.rssUrl;
    if (!url) {
      throw new Error(`[RSSAdapter: ${this.name}] RSS 地址未配置`);
    }

    return {
      id: this.name,
      name: this.name,
      url,
      category: config.category || this.category || 'rss',
      limit: config.limit || this.limit,
    };
  }

  async fetch(config: { rssUrl: string; limit?: number }): Promise<ParsedRssFeed> {
    const feed = this.feedDefinition(config);
    return fetchParsedRssFeed(feed, {
      userAgent: getRandomUserAgent(),
      fetchImpl: this.dispatcher
        ? (input, init) => fetch(input, { ...init, dispatcher: this.dispatcher } as RequestInit)
        : fetch,
    });
  }

  transform(rawData: ParsedRssFeed, config?: { category?: string }): UnifiedData[] {
    return normalizeParsedRssFeed(rawData, {
      feedId: this.name,
      name: this.name,
      category: config?.category || this.category || 'rss',
    });
  }
}
