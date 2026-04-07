import { BaseTool } from '../../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';

export class QueryMemoryTool extends BaseTool {
  readonly id = 'query_memory';
  readonly name = 'query_memory';
  readonly description = '检索长期记忆库。输入查询词，系统将根据相关性、重要性和时间顺序返回精炼后的记忆摘要。';
  readonly parameters = {
    type: 'object',
    properties: {
      query: { 
        type: 'string', 
        description: '关键词或自然语言描述（例如：“用户喜欢的编程语言是什么？”）。建议搜索完整的意图以获得更准确的深度匹配结果。' 
      },
      limit: { 
        type: 'number', 
        description: '检索记录的最大数量限制',
        default: 5
      },
      minImportance: { 
        type: 'number', 
        description: '最低重要度 (1-5)',
        default: 1
      }
    },
    required: ['query']
  };

  async handler(args: { query: string; limit?: number; minImportance?: number }) {
    const context = await ServiceContext.getInstance();
    const result = await context.memoryService.queryMemory(args.query, {
      limit: args.limit,
      minImportance: args.minImportance
    });

    return {
      summary: result
    };
  }
}
