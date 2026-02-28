import type { AIProvider } from './AIProvider.js';

export class AIService {
  private ai: AIProvider;
  private settings: any;

  constructor(ai: AIProvider, settings: any) {
    this.ai = ai;
    this.settings = settings;
  }

  async testConnection() {
    try {
      const testPrompt = '请回复"OK"';
      const result = await this.ai.generateContent(testPrompt, '测试 AI 服务连接');
      return { status: 'healthy', message: 'AI 服务连接正常' };
    } catch (error: any) {
      return { status: 'error', message: error.message };
    }
  }

  streamContent(prompt: string, systemInstruction?: string) {
    if (!this.ai.streamContent) {
      throw new Error(`Provider ${this.ai.name} does not support streaming`);
    }
    return this.ai.streamContent(prompt, [], systemInstruction);
  }
}
