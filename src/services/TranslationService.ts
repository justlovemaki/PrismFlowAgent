import type { AIProvider } from './AIProvider.js';
import { LogService } from './LogService.js';

export class TranslationService {
  private ai: AIProvider | undefined;

  constructor(ai?: AIProvider) {
    this.ai = ai;
  }

  setAIProvider(ai: AIProvider) {
    this.ai = ai;
  }

  async translate(text: string, targetLang: string = 'Chinese'): Promise<string> {
    if (!this.ai) {
      LogService.warn('[TranslationService] AI Provider not available, skipping translation.');
      return text;
    }

    if (!text || text.trim() === '') {
      return text;
    }

    try {
      const prompt = `Translate the following text to ${targetLang}. Only return the translated text without any explanations or extra characters.\n\nText:\n${text}`;
      const response = await this.ai.generateContent(prompt, 'You are a professional translator.');
      
      if (response && response.content) {
        return response.content.trim();
      }
      return text;
    } catch (error: any) {
      LogService.error(`[TranslationService] Translation failed: ${error.message}`);
      return text;
    }
  }

  async translateUnifiedData(item: any, targetLang: string = 'Chinese'): Promise<any> {
    if (!this.ai) return item;

    const translated_title = await this.translate(item.title, targetLang);
    const translated_description = await this.translate(item.description, targetLang);

    return {
      ...item,
      metadata: {
        ...(item.metadata || {}),
        translated_title,
        translated_description
      }
    };
  }
}
