import { BaseAdapter } from '../plugins/adapters/base/BaseAdapter.js';
import { LocalStore } from './LocalStore.js';
import type { AIProvider } from './AIProvider.js';
import type { UnifiedData } from '../types/index.js';
import { getISODate } from '../utils/helpers.js';
import { LogService } from './LogService.js';
import { IPublisher } from '../types/plugin.js';

export class TaskService {
  private adapters: BaseAdapter[];
  private publishers: Map<string, IPublisher> = new Map();
  private store: LocalStore;
  private ai?: AIProvider;
  private adapterStatus: Record<string, { lastActive: string, status: string, count: number, category: string }> = {};
  private statsCache: { todayCount: number, yesterdayCount: number, lastUpdate: string } | null = null;

  constructor(adapters: BaseAdapter[], store: LocalStore, ai?: AIProvider, publishers: IPublisher[] = []) {
    this.adapters = adapters;
    this.store = store;
    this.ai = ai;
    
    for (const publisher of publishers) {
      this.publishers.set(publisher.id, publisher);
    }


    // 基础初始化
    for (const adapter of this.adapters) {
      this.adapterStatus[adapter.name] = {
        lastActive: '从未运行',
        status: 'idle',
        count: 0,
        category: adapter.category
      };
    }
  }

  /**
   * 尝试从存储中恢复今日的状态（条目数等）
   */
  async initStatus() {
    try {
      const targetDate = getISODate();
      
      for (const adapter of this.adapters) {
        // 仅从特定的 日期-分类-适配器名 路径获取数据
        const adapterData = await this.store.get(`${targetDate}-${adapter.category}-${adapter.name}`);
        
        if (adapterData && Array.isArray(adapterData)) {
          this.adapterStatus[adapter.name] = {
            ...this.adapterStatus[adapter.name],
            lastActive: '今日已同步',
            status: 'success',
            count: adapterData.length
          };
        }
      }
      // 初始加载后清除缓存，强制下次获取时重新计算
      this.statsCache = null;
    } catch (error) {
      LogService.error(`Failed to initialize adapter status: ${error}`);
    }
  }

  async runDailyIngestion(date?: string, config?: { foloCookie?: string }) {
    const targetDate = date || getISODate();
    LogService.info(`Starting ingestion for ${targetDate}`);

    for (const adapter of this.adapters) {
      await this.runAdapter(adapter, config, targetDate);
    }
    
    LogService.info(`Ingestion completed for ${targetDate}`);
    return this.getAggregatedData(targetDate);
  }

  /**
   * 运行单个适配器并更新存储
   */
  async runSingleAdapterIngestion(adapterName: string, date?: string, config?: any) {
    const targetDate = date || getISODate();
    const adapter = this.adapters.find(a => a.name === adapterName);
    if (!adapter) throw new Error(`Adapter ${adapterName} not found`);

    LogService.info(`Manually triggering adapter: ${adapterName} with extra config: ${JSON.stringify(config)}`);
    
    // 运行适配器，它会更新自己的存储键
    await this.runAdapter(adapter, config, targetDate);

    return this.getAggregatedData(targetDate);
  }

  private async runAdapter(adapter: BaseAdapter, extraConfig?: any, targetDate?: string) {
    const date = targetDate || getISODate();
    LogService.info(`Running adapter: ${adapter.name}`);

    this.adapterStatus[adapter.name] = { 
      lastActive: new Date().toISOString(), 
      status: 'running', 
      count: this.adapterStatus[adapter.name]?.count || 0,
      category: adapter.category
    };

    try {
      const adapterConfig: any = {
        foloCookie: (adapter as any).foloCookie || extraConfig?.foloCookie,
        ...extraConfig
      };
      
      adapterConfig.apiUrl = extraConfig?.apiUrl || (adapter as any).apiUrl;
      adapterConfig.useProxy = extraConfig?.useProxy || (adapter as any).useProxy;

      const newData = await adapter.fetchAndTransform(adapterConfig);
      
      // 按日期-分类-适配器名 存储抓取的数据
      const storageKey = `${date}-${adapter.category}-${adapter.name}`;
      const oldData = await this.store.get(storageKey);
      
      // 合并并去重
      const mergedData = this.mergeAndDeduplicate(oldData || [], newData);
      
      await this.store.put(storageKey, mergedData);
      
      LogService.info(`[TaskService] Adapter ${adapter.name} finished. Total items for today: ${mergedData.length} (New items in this run: ${newData.length})`);

      this.adapterStatus[adapter.name] = {
        lastActive: new Date().toISOString(),
        status: 'success',
        count: mergedData.length,
        category: adapter.category
      };

      // 数据变动，清除缓存
      this.statsCache = null;
    } catch (error: any) {

      LogService.error(`Adapter ${adapter.name} failed: ${error.message}`);
      this.adapterStatus[adapter.name] = {
        lastActive: new Date().toISOString(),
        status: 'error',
        count: this.adapterStatus[adapter.name]?.count || 0,
        category: adapter.category
      };
      throw error;
    }
  }

  private mergeAndDeduplicate(oldData: UnifiedData[], newData: UnifiedData[]): UnifiedData[] {
    const map = new Map<string, UnifiedData>();
    
    // 先放旧数据
    for (const item of oldData) {
      map.set(item.id, item);
    }
    
    // 新数据覆盖或新增
    for (const item of newData) {
      map.set(item.id, item);
    }
    
    return Array.from(map.values());
  }

  async getStats() {
    const today = getISODate();
    
    // 获取最后一次提交时间和平台
    const lastCommitHistory = await this.store.getCommitHistory({ limit: 1 });
    const lastCommitTime = lastCommitHistory.records.length > 0 
      ? new Date(lastCommitHistory.records[0].commitTime).toISOString()
      : null;
    const lastCommitPlatform = lastCommitHistory.records.length > 0
      ? lastCommitHistory.records[0].platform
      : null;
    
    // 如果缓存存在且日期未变，直接返回
    if (this.statsCache && this.statsCache.lastUpdate === today) {
      return {
        todayCount: this.statsCache.todayCount,
        yesterdayCount: this.statsCache.yesterdayCount,
        aiStatus: 'healthy',
        lastCommit: lastCommitTime,
        lastCommitPlatform: lastCommitPlatform
      };
    }

    // 重新计算
    const allTodayData = await this.getAggregatedData(today);
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDate = yesterday.toISOString().split('T')[0];
    const allYesterdayData = await this.getAggregatedData(yesterdayDate);

    const stats = {
      todayCount: Object.entries(allTodayData)
        .filter(([key]) => key !== 'history')
        .reduce((sum, [, items]) => sum + items.length, 0),
      yesterdayCount: Object.entries(allYesterdayData)
        .filter(([key]) => key !== 'history')
        .reduce((sum, [, items]) => sum + items.length, 0),
      lastUpdate: today
    };

    this.statsCache = stats;
    
    return {
      ...stats,
      aiStatus: 'healthy',
      lastCommit: lastCommitTime,
      lastCommitPlatform: lastCommitPlatform
    };
  }

  getAdapterStatus() {
    const status: Record<string, any> = {};
    for (const adapter of this.adapters) {
      // 获取当前适配器的实际配置值
      const currentConfig: Record<string, any> = {};
      if (adapter.configFields) {
        for (const field of adapter.configFields) {
          currentConfig[field.key] = (adapter as any)[field.key];
        }
      }

      status[adapter.name] = {
        ...this.adapterStatus[adapter.name],
        type: (adapter as any).constructor.name,
        // 直接从适配器实例获取配置字段元数据
        configFields: adapter.configFields || [],
        // 包含当前配置值
        currentConfig
      };
    }
    return status;
  }


  /**
   * 聚合指定日期的所有适配器数据
   */
  async getAggregatedData(date: string): Promise<Record<string, UnifiedData[]>> {
    const data: Record<string, UnifiedData[]> = {};
    for (const adapter of this.adapters) {
      const adapterData = await this.store.get(`${date}-${adapter.category}-${adapter.name}`);
      if (adapterData && Array.isArray(adapterData)) {
        if (!data[adapter.category]) data[adapter.category] = [];
        data[adapter.category].push(...adapterData);
      }
    }

    // 加入历史记录作为一种特殊的数据源
    // 这里不按当前 date 过滤，避免“某日无提交”时历史存档页签为空
    const historyResult = await this.store.getCommitHistory({ limit: 30 });
    if (historyResult.records.length > 0) {
      data['history'] = historyResult.records.map(record => ({
        id: `history-${record.id}`,
        title: record.commitMessage || `Archive: ${record.date}`,
        url: '', // 可以在这里构造 GitHub URL，但后端拿不到完整的 settings
        description: (record.fullContent || '').substring(0, 500), // 缩略图只显示前 500 字
        published_date: new Date(record.commitTime).toISOString(),
        source: record.platform,
        category: 'history',
        metadata: {
          full_content: record.fullContent,
          archive_date: record.date,
          file_path: record.filePath
        }
      }));
    }

    return data;
  }


  /**
   * 统一发布接口
   */
  async publish(publisherId: string, content: any, options: any) {
    const publisher = this.publishers.get(publisherId);
    if (!publisher) throw new Error(`Publisher ${publisherId} not found or not configured`);

    const result = await publisher.publish(content, options);

    // 保存提交历史记录
    // 根据不同的平台，构造历史记录
    let historyDate = options.date || options.displayDate || getISODate();
    if (typeof historyDate === 'string') {
      historyDate = historyDate.replace(/\//g, '-');
    }

    await this.saveCommitHistory({
      date: historyDate,
      platform: publisher.name || publisherId,
      filePath: result.media_id || result.filePath || '',
      commitMessage: options.title || options.message || `Published to ${publisherId}`,
      fullContent: typeof content === 'string' ? content : JSON.stringify(content)
    });

    return result;
  }


  /**
   * 保存提交历史记录
   */
  async saveCommitHistory(record: {
    date: string;
    platform: string;
    filePath: string;
    commitMessage?: string;
    fullContent?: string;
  }) {
    return await this.store.saveCommitHistory(record);
  }

  /**
   * 获取提交历史记录
   */
  async getCommitHistory(options?: {
    date?: string;
    platform?: string;
    limit?: number;
    offset?: number;
    search?: string;
  }) {
    return await this.store.getCommitHistory(options);
  }

  /**
   * 获取所有已提交的日期列表
   */
  async getCommittedDates() {
    return await this.store.getCommittedDates();
  }

  /**
   * 删除提交历史记录
   */
  async deleteCommitHistory(id: number) {
    return await this.store.deleteCommitHistory(id);
  }
}
