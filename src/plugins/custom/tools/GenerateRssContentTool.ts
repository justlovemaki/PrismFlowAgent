import { BaseTool } from '../../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';
import { LogService } from '../../../services/LogService.js';
import { PromptService } from '../../../services/PromptService.js';
import { 
  extractContentFromSecondHash, 
  truncateContent, 
  getAppUrl, 
  removeMarkdownCodeBlock 
} from '../../../utils/helpers.js';

export class GenerateRssContentTool extends BaseTool {
  readonly id = 'generate_rss_content';
  readonly name = 'generate_rss_content';
  readonly description = '从 daily 目录读取内容，生成 AI 简化的 RSS 内容并写入 rss 目录';
  readonly parameters = {
    type: 'object',
    properties: {
      date: { type: 'string', description: '日期 (YYYY-MM-DD)' }
    },
    required: ['date']
  };

  async handler(args: { date: string }) {
    try {
      const context = await ServiceContext.getInstance();
      const githubPublisher = context.publisherInstances.find(p => p.id === 'github') as any;
      if (!githubPublisher) throw new Error('GitHub Publisher not configured');
      if (!context.aiProvider) throw new Error('AI Provider not configured');

      const dateStr = args.date;
      const prefix = githubPublisher.config?.pathPrefix || 'daily';
      const dailyPath = `${prefix}/${dateStr}.md`;
      LogService.info(`Tool: generate_rss_content - Reading from ${dailyPath}`);

      let content = await githubPublisher.getFileContent(dailyPath);
      if (!content) throw new Error(`No content found for ${dailyPath}`);

      content = extractContentFromSecondHash(content);

      // Generate AI content using template
      const prompt = PromptService.getInstance().getPrompt('rss_generation');
      if (!prompt) {
        throw new Error('Prompt template rss_generation not found');
      }
      
      const aiResponse = await context.aiProvider.generateContent(content, prompt);
      let aiContent = aiResponse.content;

      aiContent = removeMarkdownCodeBlock(aiContent);
      aiContent = truncateContent(aiContent, 360);
      aiContent = "[前往官网查看完整版 (ai.hubtoday.app)](https://ai.hubtoday.app/)\n\n" + aiContent + "\n\n" + getAppUrl();

      // Write to rss directory
      const rssPath = `rss/${dateStr}.md`;
      const commitMessage = `Create/Update RSS content for ${dateStr}`;
      await githubPublisher.publish(aiContent, { filePath: rssPath, message: commitMessage });

      LogService.info(`Tool: generate_rss_content success for ${dateStr}`);
      return aiContent;
    } catch (error: any) {
      LogService.error(`Tool: generate_rss_content failed: ${error.message}`);
      throw error;
    }
  }
}


