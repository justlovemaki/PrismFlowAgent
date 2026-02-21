import { BaseTool } from '../../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';
import { LogService } from '../../../services/LogService.js';

export class PublishToWechatTool extends BaseTool {
  readonly id = 'publish_to_wechat';
  readonly name = 'publish_to_wechat';
  readonly description = '将内容发布到微信公众号草稿箱。会自动处理图片上传。必须传入 html 参数。';
  readonly parameters = {
    type: 'object',
    properties: {
      html: { type: 'string', description: '已渲染的微信 HTML 内容 (重要: 请务必传入此参数)' },
      title: { type: 'string', description: '文章标题 (可选)' },
      author: { type: 'string', description: '作者 (可选)' },
      digest: { type: 'string', description: '摘要 (可选)' },
      displayDate: { type: 'string', description: '显示日期，格式 YYYY/MM/DD (可选)' }
    },
    required: ['html']
  };

  async handler(args: any) {
    try {
      LogService.info(`Tool: publish_to_wechat started. Received keys: ${Object.keys(args || {}).join(', ')}`);
      const html = args.html || args.content;
      if (!html) {
        LogService.error('Tool: publish_to_wechat failed - missing html. Args received: ' + JSON.stringify(args));
        throw new Error('缺少必要参数: html (请确保将渲染后的 HTML 内容传入此参数)');
      }
      const context = await ServiceContext.getInstance();
      
      // Publish to WeChat via TaskService (Handles image processing and history)
      LogService.info('Tool: publish_to_wechat - publishing via TaskService');
      const result = await context.taskService.publish('wechat', html, {
        title: args.title || '',
        author: args.author || '',
        digest: args.digest || '',
        displayDate: args.displayDate
      });

      LogService.info(`Tool: publish_to_wechat success. media_id: ${result.media_id}`);
      return { status: 'success', media_id: result.media_id, title: args.title || args.displayDate };
    } catch (error: any) {
      LogService.error(`Tool: publish_to_wechat failed: ${error.message}`);
      return { error: `发布到微信失败: ${error.message}` };
    }
  }
}


