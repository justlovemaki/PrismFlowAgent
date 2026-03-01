import { BaseTool } from '../../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';

export class PublishToGitHubTool extends BaseTool {
  readonly id = 'publish_to_github';
  readonly name = 'publish_to_github';
  readonly description = '将生成的 Markdown 内容发布到 GitHub 仓库';
  readonly parameters = {
    type: 'object',
    properties: {
      date: { type: 'string', description: '日期 (YYYY-MM-DD)' },
      dailyMd: { type: 'string', description: '日报 Markdown 内容' },
      title: { type: 'string', description: '文章标题 (可选)' }
    },
    required: ['date', 'dailyMd']
  };

  async handler(args: { date: string; dailyMd: string; title?: string }) {
    const context = await ServiceContext.getInstance();
    const githubPublisher = context.publisherInstances.find(p => p.id === 'github') as any;
    const prefix = githubPublisher?.config?.pathPrefix || 'daily';

    return await context.taskService.publish('github', args.dailyMd, {
      filePath: `${prefix}/${args.date}.md`,
      message: args.title || `Push Github for ${args.date}`,
      title: args.title,
      date: args.date
    });
  }
}


