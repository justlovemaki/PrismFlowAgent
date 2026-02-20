import { BaseTool } from '../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';
import { UnifiedData } from '../../../types/index.js';

export class SearchKnowledgeBaseTool extends BaseTool {
  readonly id = 'search_knowledge_base';
  readonly name = 'search_knowledge_base';
  readonly description = '搜索已抓取的资讯库以获取相关上下文';
  readonly parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      date: { type: 'string', description: '日期 (YYYY-MM-DD, 默认今日)' },
      topK: { type: 'number', description: '返回结果数量 (默认 5)' },
      categories: { type: 'array', items: { type: 'string' }, description: '限定搜索的分类列表 (可选, 不传则搜索全部分类)' }
    },
    required: ['query']
  };

  async handler(args: { query: string; date?: string; topK?: number; categories?: string[] }) {
    const context = await ServiceContext.getInstance();
    const targetDate = args.date || new Date().toISOString().split('T')[0];
    const data = await context.taskService.getAggregatedData(targetDate);
    
    // Filter by categories if specified
    const entries = args.categories?.length
      ? Object.entries(data).filter(([key]) => args.categories!.includes(key))
      : Object.entries(data);
    
    const allItems = entries.flatMap(([, items]) => items) as UnifiedData[];
    const results = allItems.filter(item => 
      item.title.toLowerCase().includes(args.query.toLowerCase()) || 
      item.description?.toLowerCase().includes(args.query.toLowerCase())
    ).slice(0, args.topK || 5);
    
    return results;
  }
}
