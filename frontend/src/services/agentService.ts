import { request } from './api';

export interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: any;
}

export interface ToolResult {
  success: boolean;
  content?: string;
  data?: any;
  error?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  files: string[];
  dirPath: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId: string;
  model: string;
  temperature: number;
  toolIds: string[];
  skillIds: string[];
  mcpServerIds: string[];
}

export interface WorkflowStep {
  id: string;
  type?: 'agent' | 'workflow';
  agentId?: string;
  workflowId?: string;
  skillId?: string;
  inputMap: Record<string, string>;
  nextStepId?: string;
  nextStepIds?: string[];
  condition?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  initialStepId: string;
}

export interface MCPServerConfig {
  id: string;
  name: string;
  description: string;
  transportType: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  enabled: boolean;
}

export const agentService = {
  getAgents: () => request('/api/agents'),
  saveAgent: (agent: Agent) => request('/api/agents', {
    method: 'POST',
    body: JSON.stringify(agent)
  }),
  deleteAgent: (id: string) => request(`/api/agents/${id}`, {
    method: 'DELETE'
  }),
  runAgent: (id: string, input: string, date?: string) => request(`/api/agents/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ input, date })
  }),
  
  getSkills: () => request('/api/skills'),
  uploadSkill: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch('/api/skills', {
      method: 'POST',
      headers,
      body: formData,
    });
    if (response.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    return response.json();
  },
  deleteSkill: (id: string) => request(`/api/skills/${id}`, {
    method: 'DELETE'
  }),
  getSkillFiles: (id: string) => request(`/api/skills/${id}/files`),
  getSkillFileContent: (id: string, filePath: string) => request(`/api/skills/${id}/file/${filePath}`),
  saveSkillFileContent: (id: string, filePath: string, content: string) => request(`/api/skills/${id}/file/${filePath}`, {
    method: 'POST',
    body: JSON.stringify({ content })
  }),
  
  searchStoreSkills: (q: string, page = 1, limit = 20, sortBy = 'recent') => 
    request(`/api/skills/store/search?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}&sortBy=${sortBy}`),
  aiSearchStoreSkills: (q: string) => 
    request(`/api/skills/store/ai-search?q=${encodeURIComponent(q)}`),
  installStoreSkill: (skill: any) => request('/api/skills/import/github', {
    method: 'POST',
    body: JSON.stringify({ githubUrl: skill.githubUrl || skill.url })
  }),
  importSkillFromGithub: (githubUrl: string) => request('/api/skills/import/github', {
    method: 'POST',
    body: JSON.stringify({ githubUrl })
  }),
  
  getTools: () => request('/api/tools'),
  runTool: (id: string, args: any): Promise<ToolResult> => request(`/api/tools/${id}/run`, {
    method: 'POST',
    body: JSON.stringify(args)
  }),
  
  getWorkflows: () => request('/api/workflows'),
  saveWorkflow: (workflow: Workflow) => request('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(workflow)
  }),
  deleteWorkflow: (id: string) => request(`/api/workflows/${id}`, {
    method: 'DELETE'
  }),
  runWorkflow: (id: string, input: any, date?: string) => request(`/api/workflows/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ input, date })
  }),

  getMCPConfigs: () => request('/api/mcp-configs'),
  saveMCPConfig: (config: MCPServerConfig) => request('/api/mcp-configs', {
    method: 'POST',
    body: JSON.stringify(config)
  }),
  deleteMCPConfig: (id: string) => request(`/api/mcp-configs/${id}`, {
    method: 'DELETE'
  })
};
