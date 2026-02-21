import { Octokit } from '@octokit/rest';

export class GitHubService {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private branch: string;

  constructor(token: string, ownerRepo: string, branch: string) {
    this.octokit = new Octokit({ auth: token });
    const [owner, repo] = (ownerRepo || '').split('/');
    this.owner = owner || '';
    this.repo = repo || '';
    this.branch = branch;
  }

  async createOrUpdateFile(filePath: string, content: string, message: string) {
    let sha: string | undefined;
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path: filePath,
        ref: this.branch
      });
      if ('sha' in data) {
        sha = data.sha;
      }
    } catch (error: any) {
      if (error.status !== 404) throw error;
    }

    const params: any = {
      owner: this.owner,
      repo: this.repo,
      path: filePath,
      message,
      content: Buffer.from(content).toString('base64'),
      branch: this.branch
    };

    if (sha) {
      params.sha = sha;
    }

    return this.octokit.repos.createOrUpdateFileContents(params);
  }

  async getFileContent(filePath: string): Promise<string> {
    const { data } = await this.octokit.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path: filePath,
      ref: this.branch
    });
    if ('content' in data) {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    throw new Error('Not a file');
  }
}


