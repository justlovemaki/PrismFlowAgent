import { ProxyAgent, fetch } from 'undici';
import { LogService } from '../LogService.js';
import { Octokit } from '@octokit/rest';

export interface StoreSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  author?: string;
  stars?: number;
  updatedAt?: string;
  version?: string;
}

export class SkillStoreService {
  private apiKey: string;
  private proxyAgent?: ProxyAgent;
  private baseUrl = 'https://skillsmp.com/api/v1';

  constructor(apiKey: string, proxyAgent?: ProxyAgent) {
    this.apiKey = apiKey;
    this.proxyAgent = proxyAgent;
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  async searchSkills(query: string, page = 1, limit = 20, sortBy = 'recent'): Promise<any> {
    const url = new URL(`${this.baseUrl}/skills/search`);
    url.searchParams.append('q', query);
    url.searchParams.append('page', page.toString());
    url.searchParams.append('limit', limit.toString());
    url.searchParams.append('sortBy', sortBy);

    try {
      const response = await fetch(url.toString(), {
        headers: this.headers,
        dispatcher: this.proxyAgent as any
      });

      if (!response.ok) {
        const error = await response.json() as any;
        throw new Error(error.error?.message || `Search failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      LogService.error(`Skill Store search failed: ${error.message}`);
      throw error;
    }
  }

  async aiSearchSkills(query: string): Promise<any> {
    const url = new URL(`${this.baseUrl}/skills/ai-search`);
    url.searchParams.append('q', query);

    try {
      const response = await fetch(url.toString(), {
        headers: this.headers,
        dispatcher: this.proxyAgent as any
      });

      if (!response.ok) {
        const error = await response.json() as any;
        throw new Error(error.error?.message || `AI Search failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      LogService.error(`Skill Store AI search failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 直接通过 GitHub API 获取技能内容（不通过 skillsmp.com）
   */
  async fetchGithubSkillContentsDirectly(params: { owner: string, repo: string, path: string, branch?: string }, token?: string): Promise<any> {
    const octokit = new Octokit({
      auth: token,
      request: {
        dispatcher: this.proxyAgent
      }
    });
    const files: { path: string; content: string }[] = [];

    const fetchRecursive = async (currentPath: string) => {
      const { data } = await octokit.repos.getContent({
        owner: params.owner,
        repo: params.repo,
        path: currentPath,
        ref: params.branch
      });

      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.type === 'dir') {
            await fetchRecursive(item.path);
          } else if (item.type === 'file') {
            const fileData = await octokit.repos.getContent({
              owner: params.owner,
              repo: params.repo,
              path: item.path,
              ref: params.branch
            });
            
            if ('content' in fileData.data && typeof fileData.data.content === 'string') {
              const content = Buffer.from(fileData.data.content, 'base64').toString('utf8');
              // 相对路径，移除起始的 params.path
              let relativePath = item.path;
              if (params.path && relativePath.startsWith(params.path)) {
                relativePath = relativePath.substring(params.path.length);
                if (relativePath.startsWith('/')) {
                  relativePath = relativePath.substring(1);
                }
              }
              files.push({
                path: relativePath || item.name,
                content
              });
            }
          }
        }
      } else if (typeof data === 'object' && 'content' in data) {
        // 单个文件
        const content = Buffer.from((data as any).content, 'base64').toString('utf8');
        files.push({
          path: (data as any).name,
          content
        });
      }
    };

    try {
      await fetchRecursive(params.path);
      return { files };
    } catch (error: any) {
      LogService.error(`GitHub direct fetch failed: ${error.message}`);
      throw error;
    }
  }
}
