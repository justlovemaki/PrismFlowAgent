import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { SkillEntry, SkillFrontmatter } from '../../types/skill.js';
import { LogService } from '../LogService.js';
import { execSync } from 'child_process';

export class SkillService {
  private skills: Map<string, SkillEntry> = new Map();
  private searchPaths: string[];

  constructor(searchPaths?: string[]) {
    this.searchPaths = searchPaths || [
      path.join(process.cwd(), 'skills'),
      path.join(process.cwd(), '.agents', 'skills'),
      path.join(process.cwd(), 'data', 'skills'),
      // Add more paths if needed
    ];
  }

  async init() {
    await this.refreshSkills();
  }

  async refreshSkills() {
    this.skills.clear();
    
    // Reverse search paths to respect priority (higher priority paths loaded last to overwrite)
    const pathsToSearch = [...this.searchPaths].reverse();

    for (const searchPath of pathsToSearch) {
      if (!(await fs.pathExists(searchPath))) continue;

      const entries = await fs.readdir(searchPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(searchPath, entry.name, 'SKILL.md');
          if (await fs.pathExists(skillPath)) {
            try {
              const skill = await this.parseSkillFile(skillPath);
              this.skills.set(skill.id, skill);
              LogService.info(`Loaded skill: ${skill.name} (${skill.id}) from ${searchPath}`);
            } catch (error) {
              LogService.error(`Failed to parse skill at ${skillPath}: ${error}`);
            }
          }
        }
      }
    }
  }

  private async parseSkillFile(filePath: string): Promise<SkillEntry> {
    const content = await fs.readFile(filePath, 'utf-8');
    const dirPath = path.dirname(filePath);
    const id = path.basename(dirPath);

    // Parse Frontmatter
    const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n([\s\S]*)$/);
    if (!match) {
      throw new Error('Invalid Skill format: Missing Frontmatter');
    }

    const frontmatterRaw = match[1];
    const instructions = match[2].trim();
    const frontmatter = yaml.parse(frontmatterRaw) as SkillFrontmatter;

    return {
      id,
      name: frontmatter.name || id,
      description: frontmatter.description || '',
      instructions,
      frontmatter,
      dirPath,
      fullPath: filePath
    };
  }

  getSkill(id: string): SkillEntry | undefined {
    return this.skills.get(id);
  }

  listSkills(): SkillEntry[] {
    return Array.from(this.skills.values());
  }

  async buildSkillsPrompt(skillIds: string[]): Promise<string> {
    let prompt = '';
    for (const id of skillIds) {
      const skill = this.getSkill(id);
      if (skill) {
        // Check if dependencies are met
        const depsMet = this.checkDependencies(skill);
        if (depsMet) {
          prompt += `### Skill: ${skill.name}\n`;
          prompt += `ID: ${skill.id}\n`;
          prompt += `Location: ${skill.dirPath}\n`;
          prompt += `Instructions:\n${skill.instructions}\n\n`;
        } else {
          LogService.warn(`Skipping skill ${skill.name} due to missing dependencies.`);
        }
      }
    }

    if (prompt) {
      prompt = `## Available Skills\n\nYou have access to the following skills. To use a skill, follow its instructions and use the 'execute_command' tool to run the provided command examples. Always ensure you are in the correct directory (provided in 'Location') or use absolute paths when calling scripts.\n\n${prompt}`;
    }

    return prompt;
  }

  private checkDependencies(skill: SkillEntry): boolean {
    if (!skill.frontmatter.bins || skill.frontmatter.bins.length === 0) {
      return true;
    }

    for (const bin of skill.frontmatter.bins) {
      try {
        // Simple check using 'where' on Windows or 'which' on others
        const cmd = process.platform === 'win32' ? `where ${bin}` : `which ${bin}`;
        execSync(cmd, { stdio: 'ignore' });
      } catch (e) {
        LogService.error(`Dependency missing for skill ${skill.name}: ${bin}`);
        return false;
      }
    }

    return true;
  }
}
