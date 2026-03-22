import { BaseTool } from '../../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';

export class SaveMemoryTool extends BaseTool {
  readonly id = 'save_memory';
  readonly name = 'save_memory';
  readonly description = '保存重要的事实、用户偏好或任务结论到长期记忆中，以便将来回顾。';
  readonly parameters = {
    type: 'object',
    properties: {
      content: { 
        type: 'string', 
        description: '需要保存的内容（例如：“用户更喜欢使用 TypeScript 进行开发”）' 
      },
      importance: { 
        type: 'number', 
        description: '重要程度 (1-5)，1 为普通，5 为极其重要',
        default: 1
      },
      tags: { 
        type: 'array', 
        items: { type: 'string' },
        description: '可选的标签，用于分类（例如：["preference", "tech_stack"]）' 
      }
    },
    required: ['content']
  };

  async handler(args: { content: string; importance?: number; tags?: string[] }) {
    const context = await ServiceContext.getInstance();
    const id = await context.memoryService.saveMemory(args.content, {
      importance: args.importance,
      tags: args.tags
    });

    return {
      success: true,
      id,
      message: '记忆已成功保存。'
    };
  }
}
