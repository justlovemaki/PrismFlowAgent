import { BaseTool } from '../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';
import { LogService } from '../../../services/LogService.js';

export class ProcessMarkdownMediaTool extends BaseTool {
  readonly id = 'process_markdown_media';
  readonly name = 'process_markdown_media';
  readonly description = '处理 Markdown 中的图片和视频，将其转换为高效格式并上传到图床 (GitHub 或 R2)';
  readonly parameters = {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Markdown 内容' },
      filePath: { type: 'string', description: '原始文件路径 (可选，用于确定临时目录位置)' },
      storageId: { type: 'string', description: '存储插件 ID (如 "github-storage", "r2")。如果不指定，将使用第一个已启用的存储插件。' }
    },
    required: ['content']
  };

  async handler(args: { content: string; filePath?: string; storageId?: string }) {
    const context = await ServiceContext.getInstance();
    let storageProvider = args.storageId ? context.storageInstances.find(s => s.id === args.storageId) : context.storageInstances[0];
    
    if (args.storageId && !storageProvider) {
      LogService.warn(`Specified storageId ${args.storageId} not found, falling back to ${context.storageInstances[0]?.id}`);
      storageProvider = context.storageInstances[0];
    }

    return await context.imageService.processMarkdown(args.content, context.settings, args.filePath, storageProvider);
  }
}
