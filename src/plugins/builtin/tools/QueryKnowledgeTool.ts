import { BaseTool } from '../../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';

export class QueryKnowledgeTool extends BaseTool {
  readonly id = 'query_knowledge';
  readonly name = 'query_knowledge';
  readonly description = '检索专业知识库文档。输入查询词，系统将从已上传的 PDF、Word 或 Markdown 文档中提取相关事实和回答。';
  readonly parameters = {
    type: 'object',
    properties: {
      query: { 
        type: 'string', 
        description: '具体的查询词或问题（例如：“公司关于加班的补贴政策是什么？”）' 
      },
      categoryIds: {
        type: 'array',
        items: { type: 'string' },
        description: '可选：限定检索的分类 ID 列表'
      },
      limit: { 
        type: 'number', 
        description: '返回相关结果的数量限制',
        default: 3
      }
    },
    required: ['query']
  };

  async handler(args: { query: string; categoryIds?: string[]; limit?: number }) {
    const context = await ServiceContext.getInstance();
    const result = await context.knowledgeBaseService.queryKnowledge(args.query, {
      categoryIds: args.categoryIds,
      limit: args.limit
    });

    return {
      answer: result
    };
  }
}
