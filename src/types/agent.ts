import { UnifiedData } from './index.js';

export interface ToolResult {
  success: boolean;
  content?: string;
  data?: any;
  error?: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  parameters: any; // JSON Schema
  isBuiltin?: boolean;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  files: string[];
  dirPath: string;
}

export interface AgentDefinition {
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
  agentId?: string;
  skillId?: string;
  inputMap: Record<string, string>; // Maps output from previous steps to current input
  nextStepId?: string;             // Single next step (backward-compatible)
  nextStepIds?: string[];          // Multiple next steps (parallel branching)
  condition?: string; // Optional simple logic
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  initialStepId: string;
}

export interface AgentExecutionResult {
  content: string;
  toolCalls?: any[];
  data?: any;
  usage?: any;
}

export interface MCPServerConfig {
  id: string;
  name: string;
  description: string;
  transportType: 'stdio' | 'sse' | 'streamable-http';
  // stdio transport
  command?: string;
  args?: string[];
  // sse / streamable-http transport
  url?: string;
  headers?: Record<string, string>;
  // common
  env?: Record<string, string>;
  enabled: boolean;
}
