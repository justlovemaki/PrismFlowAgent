import { BaseAdapter } from '../base/BaseAdapter.js';
import type { UnifiedData } from '../../../types/index.js';
import { stripHtml, getRandomUserAgent, sleep } from '../../../utils/helpers.js';
import type { ConfigField } from '../../../types/plugin.js';
import type { AdapterMetadata } from '../../../registries/AdapterRegistry.js';
import { LogService } from '../../../services/LogService.js';


export class FollowApiAdapter extends BaseAdapter {
  static metadata: AdapterMetadata = {
    type: 'FollowApiAdapter',
    name: 'Follow API',
    description: '通过 Follow API 获取内容，支持 List ID 或 Feed ID',
    icon: 'rss_feed',
    configFields: [
      { key: 'apiUrl', label: 'API 地址', type: 'text', required: true, scope: 'adapter' },
      { key: 'foloCookie', label: 'Folo Cookie', type: 'password', scope: 'adapter' },
      { key: 'fetchDays', label: '抓取天数', type: 'number', default: 3, scope: 'adapter' },
      { key: 'listId', label: 'List ID', type: 'text', scope: 'item' },
      { key: 'feedId', label: 'Feed ID', type: 'text', scope: 'item' },
      { key: 'fetchPages', label: '抓取页数', type: 'number', default: 1, scope: 'item' },
    ]
  };

  public foloCookie?: string;
  configFields = FollowApiAdapter.metadata.configFields;


  constructor(
    public readonly name: string,
    public readonly category: string,
    private listId?: string,
    private feedId?: string,
    private fetchDays: number = 3,
    private fetchPages: number = 1
  ) {
    super();
    // 校验逻辑：listId 和 feedId 必须填其中一个
    if (!this.listId && !this.feedId) {
      throw new Error(`[FollowApiAdapter: ${this.name}] 必须提供 listId 或 feedId 其中之一`);
    }
  }

  async fetch(config: { apiUrl: string, foloCookie?: string, listId?: string, feedId?: string, fetchPages?: number }): Promise<any> {
    const allData: any[] = [];
    let publishedAfter: string | null = null;
    const fetchPages = config.fetchPages || this.fetchPages;
    const listId = config.listId || this.listId;
    const feedId = config.feedId || this.feedId;

    LogService.info(`[FollowApiAdapter: ${this.name}] Requesting: ${config.apiUrl}, listId: ${listId || 'none'}, feedId: ${feedId || 'none'}, pages: ${fetchPages}`);

    for (let i = 0; i < fetchPages; i++) {
      const body: any = {
        view: 1,
        withContent: true
      };
      if (listId) body.listId = listId;
      if (feedId) body.feedId = feedId;
      if (publishedAfter) body.publishedAfter = publishedAfter;

      const headers: Record<string, string> = {
        'User-Agent': getRandomUserAgent(),
        'Content-Type': 'application/json',
        'accept': 'application/json',
        'accept-language': 'zh-CN,zh;q=0.9',
        'origin': 'https://app.follow.is',
        'priority': 'u=1, i',
        'sec-ch-ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'x-app-name': 'Folo Web',
        'x-app-version': '0.4.9',
      };

      if (config.foloCookie) {
        headers['Cookie'] = config.foloCookie;
      }

      try {
        const response = await fetch(config.apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          dispatcher: this.dispatcher
        } as any);

        if (!response.ok) {
          LogService.error(`[FollowApiAdapter: ${this.name}] Failed to fetch page ${i + 1}: ${response.status} ${response.statusText}`);
          break;
        }

        const json: any = await response.json();
        const pageData = json.data || [];
        
        LogService.info(`[FollowApiAdapter: ${this.name}] Page ${i + 1} fetched, found ${pageData.length} entries.`);

        if (pageData.length === 0) {
          break;
        }

        allData.push(...pageData);
        publishedAfter = pageData[pageData.length - 1].entries?.publishedAt;

        if (i < this.fetchPages - 1) {
          await sleep(Math.random() * 2000 + 1000);
        }
      } catch (error: any) {
        LogService.error(`[FollowApiAdapter: ${this.name}] Error fetching page ${i + 1}: ${error.message}`);
        break;
      }
    }

    return { data: allData };
  }

  transform(rawData: any, config?: any): UnifiedData[] {
    const items = rawData.data || [];
    const now = Date.now();
    const fetchDays = config?.fetchDays || this.fetchDays;
    const msLimit = fetchDays * 24 * 60 * 60 * 1000;

    return items
      .filter((entry: any) => {
        const publishedAt = entry.entries?.publishedAt;
        if (!publishedAt) return true;
        const pubTime = new Date(publishedAt).getTime();
        return (now - pubTime) <= msLimit;
      })
      .map((entry: any) => ({
        id: entry.entries.id,
        title: entry.entries.title,
        url: entry.entries.url,
        description: stripHtml(entry.entries.content || ''),
        published_date: entry.entries.publishedAt,
        source: entry.feeds.title,
        category: this.category,
        author: entry.entries.author,
        metadata: { content_html: entry.entries.content }
      }));
  }
}
