import { Octokit } from '@octokit/rest';
import { IPublisher } from '../../../../types/plugin.js';
import { LogService } from '../../../../services/LogService.js';
import { PublisherMetadata } from '../../../../registries/PublisherRegistry.js';

export interface GitHubConfig {
  token: string;
  repo: string; // 格式为 owner/repo
  branch: string;
  pathPrefix: string;
  baseUrl?: string;
}

export class GitHubPublisher implements IPublisher {
  static metadata: PublisherMetadata = {
    id: 'github',
    name: 'GitHub Archive',
    description: '提交内容到 GitHub 仓库进行存档',
    icon: 'code',
    configFields: [
      { key: 'token', label: 'GitHub Token', type: 'password', required: true },
      { key: 'repo', label: '仓库 (Owner/Repo)', type: 'text', required: true },
      { key: 'branch', label: 'Branch', type: 'text', default: 'main' },
      { key: 'pathPrefix', label: 'Path Prefix', type: 'text', default: 'daily' },
      { key: 'baseUrl', label: 'API Base URL', type: 'text', default: 'https://api.github.com', required: false }
    ]
  };

  id = 'github';
  name = 'GitHub Archive';
  description = GitHubPublisher.metadata.description;
  icon = GitHubPublisher.metadata.icon;
  
  configFields = GitHubPublisher.metadata.configFields;

  private octokit: Octokit;
  public config: GitHubConfig;
  private owner: string = '';
  private repo: string = '';

  constructor(config: GitHubConfig) {
    this.config = config;
    
    const [owner, repo] = (config.repo || '').split('/');
    this.owner = owner || '';
    this.repo = repo || '';

    this.octokit = new Octokit({ 
      auth: config.token,
      baseUrl: config.baseUrl || 'https://api.github.com'
    });
  }

  async publish(content: string, options: { filePath?: string; message?: string; date?: string; repo?: string; branch?: string }) {
    const date = options.date || new Date().toISOString().split('T')[0];
    const filePath = options.filePath || `${this.config.pathPrefix || 'daily'}/${date}.md`;
    const message = options.message || `Push Github for ${date}`;
    
    let owner = this.owner;
    let repo = this.repo;
    if (options.repo) {
      const [o, r] = options.repo.split('/');
      if (o && r) {
        owner = o;
        repo = r;
      }
    }
    const branch = options.branch || this.config.branch;

    LogService.info(`Publishing to GitHub: ${owner}/${repo} -> ${filePath}`);
    
    let sha: string | undefined;
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: filePath,
        ref: branch
      });
      if ('sha' in data) {
        sha = data.sha;
      }
    } catch (error: any) {
      if (error.status !== 404) throw error;
    }

    const params: any = {
      owner,
      repo,
      path: filePath,
      message,
      content: Buffer.from(content).toString('base64'),
      branch
    };

    if (sha) {
      params.sha = sha;
    }

    const result = await this.octokit.repos.createOrUpdateFileContents(params);
    return { 
      success: true, 
      filePath, 
      sha: (result.data as any).content?.sha,
      repo: `${owner}/${repo}`,
      branch
    };
  }

  // Helper for reading (as in original GitHubService)
  async getFileContent(filePath: string): Promise<string> {
    const { data } = await this.octokit.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path: filePath,
      ref: this.config.branch
    });
    if ('content' in data) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    throw new Error('Not a file');
  }

  getItemUrl(item: any) {
    if (!item || !item.filePath || !this.owner || !this.repo) return '';
    return `https://github.com/${this.owner}/${this.repo}/blob/${this.config.branch || 'main'}/${item.filePath}`;
  }
}


