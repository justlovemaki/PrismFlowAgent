import { BaseAdapter } from '../../../base/BaseAdapter.js';
import type { UnifiedData } from '../../../../types/index.js';
import type { AdapterMetadata } from '../../../../registries/AdapterRegistry.js';
import { stripHtml, getRandomUserAgent } from '../../../../utils/helpers.js';
import Parser from 'rss-parser';

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

  private parser = new Parser();
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

  async fetch(config: { rssUrl: string, limit?: number }): Promise<any> {
    const url = config.rssUrl || this.rssUrl;
    if (!url) {
      throw new Error(`[RSSAdapter: ${this.name}] RSS 地址未配置`);
    }

    const headers = {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
    };

    const response = await fetch(url, { 
      headers,
      dispatcher: this.dispatcher 
    } as any);

    if (!response.ok) {
      throw new Error(`抓取 RSS 失败: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    const feed = await this.parser.parseString(xml);
    const limit = config.limit || this.limit;
    
    return {
      title: feed.title || this.name,
      items: (feed.items || []).slice(0, limit)
    };
  }

  transform(rawData: any, config?: any): UnifiedData[] {
    const items = rawData.items || [];
    return items.map((item: any) => ({
      id: item.guid || item.link || item.id || `rss-${Date.now()}-${Math.random()}`,
      title: item.title || '无标题',
      url: item.link || '',
      description: stripHtml(item.contentSnippet || item.content || item.summary || ''),
      published_date: item.isoDate || item.pubDate || new Date().toISOString(),
      ingestion_date: new Date().toISOString().split('T')[0],
      source: rawData.title || this.name,
      category: config?.category || this.category || 'rss',
      author: item.creator || item.author || ''
    }));
  }
}
