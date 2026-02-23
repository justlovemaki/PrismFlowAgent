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
        const name = path.basename(file, path.extname(file));
        const content = await fs.readFile(path.join(this.promptsDir, file), 'utf-8');
        this.templates.set(name, content);
        LogService.info(`Prompt template loaded: ${name}`);
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
        const regex = new RegExp(`{{${key}}}`, 'g');
        template = template.replace(regex, value);
      }
    }

    return template;
  }
}
