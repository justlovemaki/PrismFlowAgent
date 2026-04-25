import { BaseTool } from '../../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';
import { getISODate } from '../../../utils/helpers.js';

export class QueryDataTool extends BaseTool {
  readonly id = 'query_data';
  readonly name = 'query_data';
  readonly description = '从数据库中查询资讯数据，支持日期、分类、最低分数和关键词搜索';
  readonly parameters = {
    type: 'object',
    properties: {
      startDate: { 
        type: 'string', 
        description: '起始日期 (YYYY-MM-DD)' 
      },
      endDate: { 
        type: 'string', 
        description: '结束日期 (YYYY-MM-DD)' 
      },
      category: {
        type: 'string',
        description: '分类名称 (如 AI, GitHub, News 等)'
      },
      minScore: { 
        type: 'number', 
        description: '最低 AI 分数 (0-100)' 
      },
      search: {
        type: 'string',
        description: '关键词搜索'
      },
      limit: {
        type: 'number',
        description: '返回结果数量限制, 默认为 50'
      }
    },
    required: ['startDate', 'endDate']
  };

  async handler(args: { startDate: string; endDate: string; category?: string; minScore?: number; search?: string; limit?: number }) {
    const context = await ServiceContext.getInstance();
    
    // 生成日期范围内的所有日期字符串
    const dates: string[] = [];
    let current = new Date(args.startDate);
    const end = new Date(args.endDate);
    
    while (current <= end) {
      dates.push(getISODate(current));
      current.setDate(current.getDate() + 1);
    }

    const result = await context.taskService.queryData({
      publishedDates: dates,
      category: args.category,
      minScore: args.minScore,
      search: args.search,
      limit: args.limit
    });

    const mappedItems = result.items.map(item => {
      const content = item.metadata?.ai_summary || item.metadata?.content_html || '';
      return {
        id: item.id,
        title: item.title,
        url: item.url,
        description: content ? '' : item.description,
        html: content,
        score: item.metadata?.ai_score,
        date: item.published_date,
        source: item.source,
        category: item.category,
        metadata: item.metadata
      };
    });
    
    return {
      total: result.total,
      count: mappedItems.length,
      items: mappedItems
    };
  }
}
