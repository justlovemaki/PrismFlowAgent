import { IPublisher } from '../../../../types/plugin.js';
import { RSSService } from './RSSService.js';
import { PublisherMetadata } from '../../../../registries/PublisherRegistry.js';

export interface RSSConfig {
  title: string;
  description: string;
  siteUrl: string;
  feedUrl: string;
}

export class RSSPublisher implements IPublisher {
  static metadata: PublisherMetadata = {
    id: 'rss',
    name: 'RSS Feed',
    description: '生成 RSS 内容并支持下载',
    icon: 'rss_feed',
    configFields: [
      { key: 'title', label: 'Feed Title', type: 'text', default: 'AI Insight Daily' },
      { key: 'description', label: 'Feed Description', type: 'text', default: '每日 AI 资讯聚合' },
      { key: 'siteUrl', label: 'Site URL', type: 'text', default: 'https://github.com/PrismFlow/AI-Insight-Daily' },
      { key: 'feedUrl', label: 'Feed URL', type: 'text', default: '' }
    ]
  };

  id = 'rss';
  name = 'RSS Feed';
  description = RSSPublisher.metadata.description;
  icon = RSSPublisher.metadata.icon;
  configFields = RSSPublisher.metadata.configFields;

  constructor(public config: RSSConfig) {}

  async publish(content: any, options: any) {
    const rssService = RSSService.getInstance();
    
    // 如果 content 是字符串且 options 中有 items，则使用 items
    // 如果 content 包含 items，则直接使用
    let items = [];
    if (options.items && Array.isArray(options.items)) {
      items = options.items;
    } else if (content && typeof content === 'object' && Array.isArray(content.items)) {
      items = content.items;
    }

    const xml = rssService.generateFeed(items, {
      title: this.config.title,
      description: this.config.description,
      site_url: this.config.siteUrl,
      feed_url: this.config.feedUrl,
      ...options
    });

    return {
      success: true,
      content: xml,
      format: 'xml',
      filename: `rss-${options.date || new Date().toISOString().split('T')[0]}.xml`
    };
  }

  getItemUrl(item: any) {
    return '';
  }
}
