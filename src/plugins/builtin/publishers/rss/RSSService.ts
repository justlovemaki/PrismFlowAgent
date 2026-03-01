import RSS from 'rss';
import type { UnifiedData } from '../../../../types/index.js';

export class RSSService {
  private static instance: RSSService;

  public static getInstance(): RSSService {
    if (!RSSService.instance) {
      RSSService.instance = new RSSService();
    }
    return RSSService.instance;
  }

  generateFeed(items: UnifiedData[], options: any) {
    const feed = new RSS({
      title: options.title || 'AI Insight Daily',
      description: options.description || '每日 AI 资讯聚合',
      feed_url: options.feed_url || '',
      site_url: options.site_url || '',
      image_url: options.image_url || '',
      pubDate: new Date(),
      ...options
    });

    items.forEach(item => {
      feed.item({
        title: item.title,
        description: item.metadata?.ai_summary || item.metadata?.translated_description || item.description,
        url: item.url,
        date: item.published_date || new Date(),
        author: item.author || 'AI Insight Daily',
        custom_elements: [
          { 'content:encoded': item.metadata?.content_html || item.metadata?.full_content || item.description }
        ]
      });
    });

    return feed.xml({ indent: true });
  }
}
