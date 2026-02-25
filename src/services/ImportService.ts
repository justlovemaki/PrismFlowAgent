import { LocalStore } from './LocalStore.js';
import { UnifiedData } from '../types/index.js';
import { getISODate, stripHtml, getRandomUserAgent } from '../utils/helpers.js';
import { LogService } from './LogService.js';
import crypto from 'crypto';

export class ImportService {
  constructor(private store: LocalStore) {}

  /**
   * 从 URL 导入
   */
  async importFromUrl(url: string, categoryId: string): Promise<UnifiedData> {
    LogService.info(`Importing from URL: ${url} into category: ${categoryId}`);
    
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': getRandomUserAgent(),
        }
      });

      if (!response.ok) {
        throw new Error(`无法访问该 URL: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const plainText = stripHtml(html);
      
      // 基础提取：尝试寻找标题
      const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
      let title = titleMatch ? titleMatch[1].trim() : '未命名导入内容';
      // 解码 HTML 实体（简单处理）
      title = stripHtml(title).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

      const description = plainText.substring(0, 500) + (plainText.length > 500 ? '...' : '');

      const item: UnifiedData = {
        id: `manual-url-${crypto.createHash('md5').update(url).digest('hex').substring(0, 12)}`,
        title,
        url,
        description,
        published_date: new Date().toISOString(),
        ingestion_date: getISODate(),
        source: '手动 URL 导入',
        category: categoryId,
        metadata: {
          import_mode: 'URL',
          full_html: plainText.substring(0, 50000) // 只存储纯文本
        }
      };

      await this.store.saveSourceData(item, getISODate(), 'ManualImport', true);
      return item;
    } catch (error: any) {
      console.log(error)
      LogService.error(`URL import failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 从纯文本导入
   */
  async importFromText(title: string, content: string, categoryId: string): Promise<UnifiedData> {
    const plainTitle = stripHtml(title || '手动录入内容');
    const plainContent = stripHtml(content);

    const item: UnifiedData = {
      id: `manual-text-${crypto.createHash('md5').update(plainContent + Date.now()).digest('hex').substring(0, 12)}`,
      title: plainTitle,
      url: '#',
      description: plainContent.substring(0, 1000),
      published_date: new Date().toISOString(),
      ingestion_date: getISODate(),
      source: '手动文本导入',
      category: categoryId,
      metadata: {
        import_mode: 'TEXT',
        content_html: plainContent // 存储纯文本
      }
    };

    await this.store.saveSourceData(item, getISODate(), 'ManualImport', true);
    return item;
  }

  /**
   * 从 JSON 批量导入
   */
  async importFromJson(jsonString: string, categoryId: string): Promise<number> {
    try {
      const data = JSON.parse(jsonString);
      const items = Array.isArray(data) ? data : [data];
      
      const normalizedItems: UnifiedData[] = items.map((item: any, index: number) => {
        const description = item.description || '';
        const plainDescription = stripHtml(description);
        const plainTitle = stripHtml(item.title || '无标题');

        return {
          id: item.id || `manual-json-${Date.now()}-${index}`,
          title: plainTitle,
          url: item.url || '#',
          description: plainDescription,
          published_date: item.published_date || new Date().toISOString(),
          ingestion_date: getISODate(),
          source: item.source || '手动 JSON 导入',
          category: categoryId || item.category || 'default',
          metadata: {
            ...(item.metadata || {}),
            import_mode: 'JSON'
          }
        };
      });

      return await this.store.saveSourceDataBatch(normalizedItems, getISODate(), 'ManualImport', true);
    } catch (error: any) {
      LogService.error(`JSON import failed: ${error.message}`);
      throw new Error('无效的 JSON 格式');
    }
  }
}
