import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { LogService } from './LogService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PromptService {
  private static instance: PromptService;
  private templates: Map<string, string> = new Map();
  private promptsDir: string;

  private constructor() {
    this.promptsDir = path.join(__dirname, '..', 'prompts');
  }

  public static getInstance(): PromptService {
    if (!PromptService.instance) {
      PromptService.instance = new PromptService();
    }
    return PromptService.instance;
  }

  public async loadTemplates() {
    if (!(await fs.pathExists(this.promptsDir))) {
      await fs.ensureDir(this.promptsDir);
      return;
    }

    const files = await fs.readdir(this.promptsDir);
    for (const file of files) {
      if (file.endsWith('.md') || file.endsWith('.txt')) {
        const content = await fs.readFile(path.join(this.promptsDir, file), 'utf-8');
        
        // 支持多模板语法: ## [TemplateName]
        if (content.includes('## [') && content.includes(']')) {
          const sections = content.split(/## \[([\w-]+)\]/g);
          // sections[0] 是第一个 ## [ 前的内容，通常为空或描述
          for (let i = 1; i < sections.length; i += 2) {
            const name = sections[i].trim();
            const body = sections[i + 1].trim();
            this.templates.set(name, body);
            LogService.info(`Prompt template loaded from multi-section file (${file}): ${name}`);
          }
        } else {
          // 回退到单模板语法: 文件名即模板名
          const name = path.basename(file, path.extname(file));
          this.templates.set(name, content.trim());
          LogService.info(`Prompt template loaded: ${name}`);
        }
      }
    }
  }

  public getPrompt(name: string, variables?: Record<string, string>): string {
    let template = this.templates.get(name);
    if (!template) {
      LogService.warn(`Prompt template not found: ${name}`);
      return '';
    }

    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        // 使用 split/join 代替 replace，避免 $ 符号被错误解析
        template = template.split(`{{${key}}}`).join(value);
      }
    }

    return template;
  }
}
