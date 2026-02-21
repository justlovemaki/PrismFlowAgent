import type { UnifiedData } from '../../types/index.js';
import type { ConfigField } from '../../types/plugin.js';
import { LogService } from '../../services/LogService.js';

export abstract class BaseAdapter {
  abstract readonly name: string;
  abstract readonly category: string;
  readonly description?: string;
  readonly icon?: string;
  configFields: ConfigField[] = [];
  apiUrl?: string;
  dispatcher?: any;

  abstract fetch(config: any): Promise<any>;
  abstract transform(rawData: any, config?: any): UnifiedData[];

  async fetchAndTransform(config: any): Promise<UnifiedData[]> {
    LogService.info(`[Adapter: ${this.name}] Starting fetch and transform...`);
    try {
      const rawData = await this.fetch(config);
      const transformedData = this.transform(rawData, config);
      LogService.info(`[Adapter: ${this.name}] Successfully fetched and transformed ${transformedData.length} items.`);
      return transformedData;
    } catch (error: any) {
      LogService.error(`[Adapter: ${this.name}] Fetch error: ${error.message}`);
      return [];
    }
  }
}

