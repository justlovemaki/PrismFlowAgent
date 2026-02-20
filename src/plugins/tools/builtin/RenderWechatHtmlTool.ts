import { BaseTool } from '../base/BaseTool.js';
import { LogService } from '../../../services/LogService.js';
import { WechatRenderer } from '../../../utils/wechatRenderer.js';

export class RenderWechatHtmlTool extends BaseTool {
  readonly id = 'render_wechat_html';
  readonly name = 'render_wechat_html';
  readonly description = '将日报 Markdown 内容渲染为微信公众号专用的 HTML 格式。必须传入 markdown 参数。';
  readonly parameters = {
    type: 'object',
    properties: {
      markdown: { type: 'string', description: '日报 Markdown 完整内容 (重要: 请务必传入此参数)' },
      showVoice: { type: 'boolean', description: '是否显示语音版/渠道卡片 (可选)' }
    },
    required: ['markdown']
  };

  async handler(args: any) {
    try {
      LogService.info(`Tool: render_wechat_html started. Received keys: ${Object.keys(args || {}).join(', ')}`);
      const markdown = args.markdown || args.content || args.dailyMd;
      if (!markdown) {
        LogService.error('Tool: render_wechat_html failed - missing markdown. Args received: ' + JSON.stringify(args));
        throw new Error('缺少必要参数: markdown (请确保将生成的 Markdown 内容传入此参数)');
      }
      const data = WechatRenderer.parseMarkdown(markdown);
      const html = WechatRenderer.render(data, args.showVoice);
      LogService.info(`Tool: render_wechat_html success. Date: ${data.date}`);
      return { 
        summary: `已成功渲染微信 HTML。日期: ${data.date}, 包含 ${data.allLinks.length} 个链接。`,
        data: data,
        html: html
      };
    } catch (error: any) {
      LogService.error(`Tool: render_wechat_html failed: ${error.message}`);
      return { error: `渲染微信 HTML 失败: ${error.message}` };
    }
  }
}
