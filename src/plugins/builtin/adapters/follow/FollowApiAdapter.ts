import { BaseAdapter } from '../../../base/BaseAdapter.js';
import type { UnifiedData } from '../../../../types/index.js';
import { getRandomUserAgent } from '../../../../utils/helpers.js';
import type { AdapterMetadata } from '../../../../registries/AdapterRegistry.js';
import { LogService } from '../../../../services/LogService.js';
import {
  fetchFollowEntries,
  normalizeFollowEntries,
  type FollowRawData,
  type FollowSourceDefinition,
} from '../../../../core/sources/FollowSource.js';

interface FollowAdapterConfig {
  apiUrl?: string;
  foloCookie?: string;
  listId?: string;
  feedId?: string;
  fetchDays?: number;
  fetchPages?: number;
  view?: number;
}

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
    ],
  };

  public foloCookie?: string;
  configFields = FollowApiAdapter.metadata.configFields;

  private listId?: string;
  private feedId?: string;
  private fetchDays = 3;
  private fetchPages = 1;
  private view = 0;

  constructor(
    public readonly name: string,
    public readonly category: string,
    itemConfig: FollowAdapterConfig = {},
  ) {
    super();
    this.listId = itemConfig.listId;
    this.feedId = itemConfig.feedId;
    this.fetchDays = itemConfig.fetchDays || 3;
    this.fetchPages = itemConfig.fetchPages || 1;
    this.view = itemConfig.view ?? 0;

    if (!this.listId && !this.feedId) {
      throw new Error(`[FollowApiAdapter: ${this.name}] 必须提供 listId 或 feedId 其中之一`);
    }
  }

  private definition(config: FollowAdapterConfig = {}): FollowSourceDefinition {
    const apiUrl = config.apiUrl || this.apiUrl;
    if (!apiUrl) {
      throw new Error(`[FollowApiAdapter: ${this.name}] API 地址未配置`);
    }

    return {
      id: this.name,
      name: this.name,
      apiUrl,
      category: this.category,
      listId: config.listId || this.listId,
      feedId: config.feedId || this.feedId,
      fetchDays: config.fetchDays || this.fetchDays,
      fetchPages: config.fetchPages || this.fetchPages,
      view: config.view ?? this.view,
    };
  }

  private fetchImpl(): typeof fetch {
    return this.dispatcher
      ? (input, init) => fetch(input, { ...init, dispatcher: this.dispatcher } as RequestInit)
      : fetch;
  }

  async fetch(config: FollowAdapterConfig): Promise<FollowRawData> {
    const definition = this.definition(config);
    LogService.info(
      `[FollowApiAdapter: ${this.name}] Requesting ${definition.apiUrl}, listId: ${definition.listId || 'none'}, feedId: ${definition.feedId || 'none'}, pages: ${definition.fetchPages}, view: ${definition.view}`,
    );

    const rawData = await fetchFollowEntries(definition, {
      cookie: config.foloCookie || this.foloCookie,
      userAgent: getRandomUserAgent(),
      fetchImpl: this.fetchImpl(),
      pageDelayMs: 1500,
    });
    LogService.info(`[FollowApiAdapter: ${this.name}] Successfully fetched ${rawData.data.length} entries.`);
    return rawData;
  }

  async transform(rawData: FollowRawData, config: FollowAdapterConfig = {}): Promise<UnifiedData[]> {
    const definition = this.definition(config);
    const results = await normalizeFollowEntries(rawData, definition, {
      cookie: config.foloCookie || this.foloCookie,
      userAgent: getRandomUserAgent(),
      fetchImpl: this.fetchImpl(),
      detailDelayMs: 400,
    });
    LogService.info(`[FollowApiAdapter: ${this.name}] Normalized ${results.length} entries.`);
    return results;
  }
}
