export interface SkillFrontmatter {
  name: string;
  description: string;
  bins?: string[];
  icon?: string;
  version?: string;
  author?: string;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  instructions: string;
  files: string[];
  frontmatter: SkillFrontmatter;
  dirPath: string;
  fullPath: string;
  isBuiltin?: boolean;
}

export interface SkillExecutionConfig {
  allowedCommands?: string[];
  blockedCommands?: string[];
  requiresApproval?: boolean;
}
