import { BaseAdapter } from '../../../base/BaseAdapter.js';
import type { UnifiedData } from '../../../../types/index.js';
import { stripHtml, getRandomUserAgent, sleep, getISODate } from '../../../../utils/helpers.js';
import type { AdapterMetadata } from '../../../../registries/AdapterRegistry.js';
import { LogService } from '../../../../services/LogService.js';


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
      { key: 'view', label: '视图模式', type: 'number', default: 0, scope: 'item' },
    ]
  };

  public foloCookie?: string;
  configFields = FollowApiAdapter.metadata.configFields;

  private listId?: string;
  private feedId?: string;
  private fetchDays: number = 3;
  private fetchPages: number = 1;
  private view: number = 0;


  constructor(
    public readonly name: string,
    public readonly category: string,
    itemConfig: any = {}
  ) {
    super();
    this.listId = itemConfig.listId;
    this.feedId = itemConfig.feedId;
    this.fetchDays = itemConfig.fetchDays || 3;
    this.fetchPages = itemConfig.fetchPages || 1;
    this.view = itemConfig.view || 0;

    // 校验逻辑：listId 和 feedId 必须填其中一个
    if (!this.listId && !this.feedId) {
      throw new Error(`[FollowApiAdapter: ${this.name}] 必须提供 listId 或 feedId 其中之一`);
    }
  }

  async fetch(config: { apiUrl: string, foloCookie?: string, listId?: string, feedId?: string, fetchPages?: number, view?: number }): Promise<any> {
    const allData: any[] = [];
    let publishedAfter: string | null = null;
    const fetchPages = config.fetchPages || this.fetchPages;
    const listId = config.listId || this.listId;
    const feedId = config.feedId || this.feedId;
    const view =  config.view || this.view;

    LogService.info(`[FollowApiAdapter: ${this.name}] Requesting: ${config.apiUrl}, listId: ${listId || 'none'}, feedId: ${feedId || 'none'}, pages: ${fetchPages}, view: ${view}`);

    for (let i = 0; i < fetchPages; i++) {
      const body: any = {
        view: view,
      };
      if (view === 1) {
        body.withContent = true;
      }
      if (listId) body.listId = listId;
      if (feedId) body.feedId = feedId;
      if (publishedAfter) body.publishedAfter = publishedAfter;

      const headers = this.getHeaders(config.foloCookie, true);

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

  private getHeaders(foloCookie?: string, isPost: boolean = false): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': getRandomUserAgent(),
      'accept': '*/*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
      'cache-control': 'no-store',
      'origin': 'https://app.folo.is',
      'priority': 'u=1, i',
      'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'x-app-name': 'Folo Web',
      'x-app-platform': 'desktop/web',
      'x-app-version': '1.4.0',
    };

    if (foloCookie) {
      headers['Cookie'] = foloCookie;
    }

    if (isPost) {
      headers['Content-Type'] = 'application/json';
    }

    return headers;
  }

  private async fetchEntryDetail(id: string, config: { apiUrl: string, foloCookie?: string }): Promise<string> {
    const headers = this.getHeaders(config.foloCookie);

    try {
      const detailUrl = `${config.apiUrl}?id=${id}`;
      const response = await fetch(detailUrl, {
        method: 'GET',
        headers,
        dispatcher: this.dispatcher
      } as any);

      if (!response.ok) {
        LogService.error(`[FollowApiAdapter: ${this.name}] Failed to fetch detail for ${id}: ${response.status}`);
        return '';
      }

      const json: any = await response.json();
      // 根据 Folo API，详情内容在 data.content 或 data.entries.content 中
      return json.data?.content || json.data?.entries?.content || '';
    } catch (error: any) {
      LogService.error(`[FollowApiAdapter: ${this.name}] Error fetching detail for ${id}: ${error.message}`);
      return '';
    }
  }

  async transform(rawData: any, config?: any): Promise<UnifiedData[]> {
    const items = rawData.data || [];
    const now = Date.now();
    const fetchDays = config?.fetchDays || this.fetchDays;
    const msLimit = fetchDays * 24 * 60 * 60 * 1000;

    const filteredItems = items.filter((entry: any) => {
      const publishedAt = entry.entries?.publishedAt;
      if (!publishedAt) return true;
      const pubTime = new Date(publishedAt).getTime();
      return (now - pubTime) <= msLimit;
    });

    const results: UnifiedData[] = [];
    for (const entry of filteredItems) {
      if (entry.entries?.id && !entry.entries.content) {
        LogService.info(`[FollowApiAdapter: ${this.name}] Fetching detail for entry: ${entry.entries.id}`);
        entry.entries.content = await this.fetchEntryDetail(entry.entries.id, config);
        // 稍微等一下，避免请求过快
        await sleep(300 + Math.random() * 200);
      }

      results.push({
        id: entry.entries.id,
        title: entry.entries.title,
        url: entry.entries.url,
        description: stripHtml(entry.entries.content || ''),
        published_date: entry.entries.publishedAt,
        ingestion_date: getISODate(),
        source: entry.feeds.title,
        category: this.category,
        author: entry.entries.author,
        metadata: { content_html: entry.entries.content }
      });
    }

    return results;
  }
}


