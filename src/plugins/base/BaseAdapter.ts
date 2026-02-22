import type { UnifiedData } from '../../types/index.js';
import type { ConfigField } from '../../types/plugin.js';
import { LogService } from '../../services/LogService.js';
import type { TranslationService } from '../../services/TranslationService.js';

export abstract class BaseAdapter {
  abstract readonly name: string;
  abstract readonly category: string;
  readonly description?: string;
  readonly icon?: string;
  configFields: ConfigField[] = [];
  apiUrl?: string;
  dispatcher?: any;
  translationService?: TranslationService;
  enableTranslation?: boolean;

  abstract fetch(config: any): Promise<any>;
  abstract transform(rawData: any, config?: any): UnifiedData[];

  async fetchAndTransform(config: any): Promise<UnifiedData[]> {
    LogService.info(`[Adapter: ${this.name}] Starting fetch and transform...`);
    try {
      const rawData = await this.fetch(config);
      let transformedData = this.transform(rawData, config);
      
      // 执行翻译逻辑
      if (this.enableTranslation && this.translationService) {
        LogService.info(`[Adapter: ${this.name}] Translation enabled, translating ${transformedData.length} items...`);
        const translatedData = await Promise.all(
          transformedData.map(item => this.translationService!.translateUnifiedData(item))
        );
        transformedData = translatedData;
      }

      LogService.info(`[Adapter: ${this.name}] Successfully fetched and transformed ${transformedData.length} items.`);
      return transformedData;
    } catch (error: any) {
      LogService.error(`[Adapter: ${this.name}] Fetch error: ${error.message}`);
      return [];
    }
  }
}

