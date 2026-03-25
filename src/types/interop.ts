import { ToolDefinition, AgentDefinition, WorkflowDefinition } from './agent.js';
import { SkillEntry } from './skill.js';

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyHash: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface DiscoveryResponse {
  system: {
    name: string;
    version: string;
    description: string;
  };
  capabilities: {
    agents: Pick<AgentDefinition, 'id' | 'name' | 'description'>[];
    workflows: Pick<WorkflowDefinition, 'id' | 'name' | 'description'>[];
    skills: Pick<SkillEntry, 'id' | 'name' | 'description'>[];
    tools: Pick<ToolDefinition, 'id' | 'name' | 'description'>[];
    schedules: { id: string; name: string; type: string; enabled: boolean }[];
  };
  endpoints: {
    context: string;
    tools: string;
    skills: string;
    settings: string;
    schedules: string;
    agents: string;
    workflows: string;
    execute: string;
  };

}

export interface ExecuteRequest {
  action: 'tool' | 'agent' | 'workflow' | 'schedule_run';
  id: string;
  input: any; // Can be string for agent/workflow, or object for tool
  date?: string;
  stream?: boolean;
}
