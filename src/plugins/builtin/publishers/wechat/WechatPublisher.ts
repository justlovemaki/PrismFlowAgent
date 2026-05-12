import { IPublisher } from '../../../../types/plugin.js';
import { WechatService, WechatConfig } from './WechatService.js';
import { LogService } from '../../../../services/LogService.js';
import { PublisherMetadata } from '../../../../registries/PublisherRegistry.js';
import { WechatRenderer } from '../../tools/RenderStandardWechatArticleTool.js';
import { getISODate } from '../../../../utils/helpers.js';

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
      { key: 'fallbackLogoUrl', label: '备用封面图片 URL', type: 'text', default: 'https://source.hex2077.dev/logo/hex2077.ai.png', required: false }
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
    articleType?: 'news' | 'newspic',
    imageMediaIds?: string[]
  }) {
    const title = options.title || this.config.title || '';
    LogService.info(`Publishing to WeChat: ${title}`);

    let finalContent = content;
    const articleType = options.articleType || 'news';

    // 检查是否为 HTML。如果不是（大概率是 Markdown），则使用 WechatRenderer 自动渲染
    const isHtml = /<\/(p|div|section|h[1-6]|table|ul|ol)>/i.test(content);
    if (!isHtml) {
      LogService.info("Detected non-HTML content (Markdown), auto-rendering with WechatRenderer...");
      finalContent = WechatRenderer.convert(content);
    }
    
    let displayDate = options.displayDate || getISODate().replace(/-/g, '/');
    let displaySummary = options.digest || '';

    // 压缩并处理 HTML
    finalContent = finalContent
      .replace(/&nbsp;|\u00A0/g, ' ')
      .replace(/\s{2,}/g, '')
      .trim();

    // 处理图片 (上传到微信)
    const fallbackLogo = this.config.fallbackLogoUrl || 'https://source.hex2077.dev/logo/hex2077.ai.png';
    const { html: processedHtml, firstMediaId, allMediaIds } = await this.service.processHtmlImages(
      finalContent, 
      undefined, 
      fallbackLogo,
      articleType
    );

    // 发布到草稿箱
    const result = await this.service.publishToDraft({
      title: title || `${displayDate}`,
      author: options.author || this.config.author || '',
      digest: displaySummary,
      content: articleType === 'newspic' ? content : processedHtml,
      thumbMediaId: options.thumbMediaId || firstMediaId,
      articleType,
      imageMediaIds: options.imageMediaIds || allMediaIds
    });

    return { success: true, media_id: result.media_id, title: title };
  }

  getItemUrl(item: any) {
    return item.viewUrl || '';
  }
}
