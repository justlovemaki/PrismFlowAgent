import fs from 'fs-extra';
import { Octokit } from '@octokit/rest';
import { IStorageProvider } from '../../../../types/plugin.js';
import { LogService } from '../../../../services/LogService.js';
import { StorageMetadata } from '../../../../registries/StorageRegistry.js';

export interface GitHubStorageConfig {
  token: string;
  repo: string; // "owner/repo"
  branch: string;
  pathPrefix: string;
  publicUrlPrefix: string;
}

export class GitHubStorage implements IStorageProvider {
  static metadata: StorageMetadata = {
    id: 'github-storage',
    name: 'GitHub 图床',
    description: '使用 GitHub 仓库存储多媒体资源',
    icon: 'cloud_upload',
    configFields: [
      { key: 'token', label: 'GitHub Token', type: 'password', required: true },
      { key: 'repo', label: 'Repository (Owner/Repo)', type: 'text', required: true },
      { key: 'branch', label: 'Branch', type: 'text', default: 'main' },
      { key: 'pathPrefix', label: 'Path Prefix', type: 'text', default: 'images' },
      { key: 'publicUrlPrefix', label: 'Public URL Prefix', type: 'text', required: true, description: '例如: https://raw.githubusercontent.com 或 https://cdn.jsdelivr.net/gh' }
    ]
  };

  id = 'github-storage';
  name = 'GitHub 图床';
  description = GitHubStorage.metadata.description;
  icon = GitHubStorage.metadata.icon;
  
  configFields = GitHubStorage.metadata.configFields;

  private octokit: Octokit;
  private config: GitHubStorageConfig;
  private owner: string = '';
  private repo: string = '';

  constructor(config: GitHubStorageConfig) {
    this.config = config;
    
    const [owner, repo] = (config.repo || '').split('/');
    this.owner = owner || '';
    this.repo = repo || '';

    this.octokit = new Octokit({ auth: config.token });
  }

  async upload(localFilePath: string, targetFilename: string): Promise<string | null> {
    try {
      const content = await fs.readFile(localFilePath);
      const base64Content = content.toString('base64');
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const repoPath = `${this.config.pathPrefix}/${year}/${month}/${targetFilename}`;

      LogService.info(`[GitHub Storage] Uploading ${targetFilename}...`);
      
      try {
        await this.octokit.repos.createOrUpdateFileContents({
          owner: this.owner,
          repo: this.repo,
          path: repoPath,
          message: `feat: Upload asset ${targetFilename}`,
          content: base64Content,
          branch: this.config.branch
        });
        
        const baseUrl = this.config.publicUrlPrefix.replace(/\/$/, '');
        const cdnUrl = `${baseUrl}/${this.owner}/${this.repo}/refs/heads/${this.config.branch}/${repoPath}`;
        return cdnUrl;
      } catch (e: any) {
        if (e.status === 422) { // File already exists
          const baseUrl = this.config.publicUrlPrefix.replace(/\/$/, '');
          return `${baseUrl}/${this.owner}/${this.repo}/refs/heads/${this.config.branch}/${repoPath}`;
        }
        throw e;
      }
    } catch (error: any) {
      LogService.error(`[GitHub Storage] Upload failed: ${error.message}`);
      return null;
    }
  }
}


