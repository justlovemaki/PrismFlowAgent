import type { Agent, Tool, Workflow } from '../services/agentService';

const RECENT_EXECUTOR_KEY = 'recent_executors';
const MAX_RECENT_EXECUTORS = 20;

export type ExecutorType = 'agent' | 'workflow' | 'tool';

export interface RecentExecutor {
  type: ExecutorType;
  id: string;
  name: string;
}

export interface AgentGroup {
  category: string;
  agents: Agent[];
}

export const getRecentExecutors = (): RecentExecutor[] => {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_EXECUTOR_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((item): item is RecentExecutor => (
        item &&
        ['agent', 'workflow', 'tool'].includes(item.type) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string'
      ))
      : [];
  } catch {
    return [];
  }
};

export const recordRecentExecutor = (executor: RecentExecutor) => {
  const recentExecutors = getRecentExecutors();
  const nextExecutors = [
    executor,
    ...recentExecutors.filter(item => !(item.type === executor.type && item.id === executor.id))
  ].slice(0, MAX_RECENT_EXECUTORS);
  localStorage.setItem(RECENT_EXECUTOR_KEY, JSON.stringify(nextExecutors));
};

export const groupAgentsByCategory = (agents: Agent[]): AgentGroup[] => {
  const groups = new Map<string, Agent[]>();

  agents.forEach(agent => {
    const category = agent.category?.trim() || '未分类';
    const group = groups.get(category) || [];
    group.push(agent);
    groups.set(category, group);
  });

  const categoryGroups = Array.from(groups, ([category, groupAgents]) => ({
    category,
    agents: groupAgents.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  })).sort((left, right) => {
    if (left.category === '未分类') return 1;
    if (right.category === '未分类') return -1;
    return left.category.localeCompare(right.category, 'zh-CN');
  });

  return categoryGroups;
};

export const getAvailableRecentExecutors = (
  recentExecutors: RecentExecutor[],
  agents: Agent[],
  workflows: Workflow[],
  tools: Tool[] = []
): RecentExecutor[] => {
  const available = {
    agent: new Set(agents.map(agent => agent.id)),
    workflow: new Set(workflows.map(workflow => workflow.id)),
    tool: new Set(tools.map(tool => tool.id))
  };

  return recentExecutors.filter(executor => available[executor.type].has(executor.id));
};
