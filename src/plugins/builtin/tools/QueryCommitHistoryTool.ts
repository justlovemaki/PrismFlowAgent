import { BaseTool } from '../../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';

export class QueryCommitHistoryTool extends BaseTool {
  readonly id = 'query_commit_history';
  readonly name = 'query_commit_history';
  readonly description = '从数据库中查询发布历史记录';
  readonly parameters = {
    type: 'object',
    properties: {
      date: { 
        type: 'string', 
        description: '特定日期 (YYYY-MM-DD)' 
      },
      dates: {
        type: 'array',
        items: { type: 'string' },
        description: '日期列表'
      },
      platform: { 
        type: 'string', 
        description: '平台名称 (例如: GitHub Archive, Wechat)' 
      },
      limit: {
        type: 'number',
        description: '返回结果数量限制, 默认为 50'
      },
      offset: {
        type: 'number',
        description: '结果偏移量'
      }
    }
  };

  async handler(args: { 
    date?: string; 
    dates?: string[];
    platform?: string; 
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const context = await ServiceContext.getInstance();
    
    const result = await context.taskService.getCommitHistory({
      date: args.date,
      dates: args.dates,
      platform: args.platform,
      search: args.search,
      limit: args.limit || 50,
      offset: args.offset
    });
    
    return {
      total: result.total,
      count: result.records.length,
      records: result.records.map(record => ({
        id: record.id,
        date: record.date,
        platform: record.platform,
        filePath: record.filePath,
        commitMessage: record.commitMessage,
        commitTime: new Date(record.commitTime).toISOString(),
        fullContent: record.fullContent
      }))
    };
  }
}
