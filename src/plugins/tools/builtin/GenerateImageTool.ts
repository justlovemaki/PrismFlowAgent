import { BaseTool } from '../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';
import { LogService } from '../../../services/LogService.js';

export class GenerateImageTool extends BaseTool {
  readonly id = 'generate_image';
  readonly name = 'generate_image';
  readonly description = '根据描述生成图片（DALL-E 3）。';
  readonly parameters = {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '图片生成描述' },
      size: { type: 'string', enum: ['256x256', '512x512', '1024x1024'], description: '图片尺寸 (默认 1024x1024)' }
    },
    required: ['prompt']
  };

  async handler(args: { prompt: string; size?: string }) {
    try {
      const context = await ServiceContext.getInstance();
      const providers = context.settings.AI_PROVIDERS || [];
      const activeProvider = providers.find((p: any) => p.id === context.settings.ACTIVE_AI_PROVIDER_ID);
      
      if (!activeProvider || activeProvider.type !== 'OPENAI') {
        throw new Error('当前激活的 AI 提供商不支持图片生成 (仅支持 OpenAI)');
      }

      const url = `${activeProvider.apiUrl}/v1/images/generations`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeProvider.apiKey}`
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: args.prompt,
          n: 1,
          size: args.size || '1024x1024'
        }),
        dispatcher: activeProvider.useProxy ? context.proxyAgent : undefined
      } as any);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI Image API error: ${response.status} ${errorText}`);
      }

      const data = await response.json() as any;
      return { url: data.data[0].url };
    } catch (error: any) {
      LogService.error(`Tool: generate_image failed: ${error.message}`);
      throw error;
    }
  }
}
