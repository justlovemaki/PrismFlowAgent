import { BaseTool } from '../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';
import { LogService } from '../../../services/LogService.js';
import { WechatRenderer } from '../../../utils/wechatRenderer.js';

export class PublishToWechatTool extends BaseTool {
  readonly id = 'publish_to_wechat';
  readonly name = 'publish_to_wechat';
  readonly description = '将内容发布到微信公众号草稿箱。会自动处理图片上传。必须传入 markdown 参数。';
  readonly parameters = {
    type: 'object',
    properties: {
      markdown: { type: 'string', description: '日报 Markdown 完整内容 (重要: 请务必传入此参数)' },
      title: { type: 'string', description: '文章标题 (可选)' },
      author: { type: 'string', description: '作者 (可选)' },
      digest: { type: 'string', description: '摘要 (可选)' },
      showVoice: { type: 'boolean', description: '是否显示语音版/渠道卡片 (可选)' }
    },
    required: ['markdown']
  };

  async handler(args: any) {
    try {
      LogService.info(`Tool: publish_to_wechat started. Received keys: ${Object.keys(args || {}).join(', ')}`);
      const markdown = args.markdown || args.content || args.dailyMd;
      if (!markdown) {
        LogService.error('Tool: publish_to_wechat failed - missing markdown. Args received: ' + JSON.stringify(args));
        throw new Error('缺少必要参数: markdown (请确保将生成的 Markdown 内容传入此参数)');
      }
      const context = await ServiceContext.getInstance();
      
      // 1. Render HTML
      const data = WechatRenderer.parseMarkdown(markdown);
      const html = WechatRenderer.render(data, args.showVoice);

      // 2. Publish to WeChat via TaskService (Handles image processing and history)
      LogService.info('Tool: publish_to_wechat - publishing via TaskService');
      const result = await context.taskService.publish('wechat', html, {
        title: `${args.title || ''}`,
        author: args.author || '',
        digest: args.digest || data.summaryLines.join(' '),
        displayDate: data.date
      });

      LogService.info(`Tool: publish_to_wechat success. media_id: ${result.media_id}`);
      return { status: 'success', media_id: result.media_id, title: args.title || data.date };
    } catch (error: any) {
      LogService.error(`Tool: publish_to_wechat failed: ${error.message}`);
      return { error: `发布到微信失败: ${error.message}` };
    }
  }
}
