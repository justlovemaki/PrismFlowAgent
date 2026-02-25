import { BaseTool } from '../../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';

export class QueryDataByScoreTool extends BaseTool {
  readonly id = 'query_data_by_score';
  readonly name = 'query_data_by_score';
  readonly description = '从数据库中按日期和最低分数查询资讯数据';
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
      minScore: { 
        type: 'number', 
        description: '最低 AI 分数 (0-100)' 
      },
      limit: {
        type: 'number',
        description: '返回结果数量限制, 默认为 50'
      }
    },
    required: ['startDate', 'endDate', 'minScore']
  };

  async handler(args: { startDate: string; endDate: string; minScore: number; limit?: number }) {
    const context = await ServiceContext.getInstance();
    
    // 生成日期范围内的所有日期字符串
    const dates: string[] = [];
    let current = new Date(args.startDate);
    const end = new Date(args.endDate);
    
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }

    const result = await context.taskService.queryDataByScore({
      publishedDates: dates,
      minScore: args.minScore,
      limit: args.limit
    });

    // 查询 endDate 5 天内的 GitHub Archive 提交历史
    const historyDates: string[] = [];
    const endDateObj = new Date(args.endDate);
    for (let i = 0; i < 5; i++) {
      const d = new Date(endDateObj);
      d.setDate(d.getDate() - i);
      historyDates.push(d.toISOString().split('T')[0]);
    }

    const historyResult = await context.taskService.getCommitHistory({
      platform: 'GitHub Archive',
      dates: historyDates,
      limit: 50
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
        category: item.category
      };
    });

    const historyItems = historyResult.records.map(record => ({
      id: `history-${record.id}`,
      title: record.commitMessage || `Archive: ${record.date}`,
      url: '',
      description: '',
      html: record.fullContent || '',
      score: undefined,
      date: new Date(record.commitTime).toISOString(),
      source: record.platform,
      category: 'history'
    }));
    
    return {
      total: result.total,
      count: mappedItems.length,
      items: mappedItems,
      historyItems: historyItems
    };
  }
}
