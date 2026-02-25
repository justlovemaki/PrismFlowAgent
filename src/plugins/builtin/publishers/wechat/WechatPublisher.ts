import { IPublisher } from '../../../../types/plugin.js';
import { WechatService, WechatConfig } from './WechatService.js';
import { LogService } from '../../../../services/LogService.js';
import { PublisherMetadata } from '../../../../registries/PublisherRegistry.js';
import { WechatRenderer } from '../../tools/RenderStandardWechatArticleTool.js';

export class WechatPublisher implements IPublisher {
  static metadata: PublisherMetadata = {
    id: 'wechat',
    name: '微信公众号',
    description: '发布到微信公众号草稿箱',
    icon: 'chat',
    configFields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true },
      { key: 'appSecret', label: 'App Secret', type: 'password', required: true },
      { key: 'title', label: '默认标题', type: 'text', required: false },
      { key: 'author', label: '文章作者', type: 'text', default: '' },
      { key: 'baseUrl', label: 'API 基础 URL', type: 'text', default: 'https://api.weixin.qq.com', required: false },
      { key: 'fallbackLogoUrl', label: '备用封面图片 URL', type: 'text', default: 'https://source.hubtoday.app/logo/ai.hubtoday.app.png', required: false }
    ]
  };

  id = 'wechat';
  name = '微信公众号';
  description = WechatPublisher.metadata.description;
  icon = WechatPublisher.metadata.icon;

  configFields = WechatPublisher.metadata.configFields;

  private service: WechatService;
  private config: WechatConfig;

  constructor(config: WechatConfig) {
    this.config = config;
    this.service = WechatService.getInstance(config);
  }

  async publish(content: string, options: { 
    title?: string, 
    author?: string, 
    digest?: string, 
    showVoice?: boolean,
    displayDate?: string,
    thumbMediaId?: string,
  }) {
    const title = options.title || this.config.title || '';
    LogService.info(`Publishing to WeChat: ${title}`);

    let finalContent = content;

    // 检查是否为 HTML。如果不是（大概率是 Markdown），则使用 WechatRenderer 自动渲染
    // 逻辑：如果包含块级闭合标签如 </p>, </div>, </section> 则视为 HTML；
    // 仅包含 <br/> 或 <img> 等单标签的 Markdown 仍会被渲染。
    const isHtml = /<\/(p|div|section|h[1-6]|table|ul|ol)>/i.test(content);
    if (!isHtml) {
      LogService.info("Detected non-HTML content (Markdown), auto-rendering with WechatRenderer...");
      finalContent = WechatRenderer.convert(content);
    }

    let displayDate = options.displayDate || new Date().toISOString().split('T')[0].replace(/-/g, '/');
    let displaySummary = '';

    // 尝试从最终内容（已确保是 HTML）中提取日期
    const dateMatch = finalContent.match(/20\d{2}\/\d{1,2}\/\d{1,2}/);
    if (dateMatch) displayDate = dateMatch[0];

    // 3. 压缩并处理 HTML
    finalContent = finalContent
      .replace(/&nbsp;|\u00A0/g, ' ')
      .replace(/\s{2,}/g, '')
      .trim();

    // 4. 处理图片 (上传到微信)
    const fallbackLogo = this.config.fallbackLogoUrl || 'https://source.hubtoday.app/logo/ai.hubtoday.app.png';
    const { html: processedHtml, firstMediaId } = await this.service.processHtmlImages(finalContent, undefined, fallbackLogo);

    // 5. 发布到草稿箱
    const result = await this.service.publishToDraft({
      title: title || `${displayDate}`,
      author: options.author || this.config.author || '',
      digest: options.digest || displaySummary,
      content: processedHtml,
      thumbMediaId: options.thumbMediaId || firstMediaId
    });

    return { success: true, media_id: result.media_id, title: title };
  }

  getItemUrl(item: any) {
    return item.viewUrl || '';
  }
}


