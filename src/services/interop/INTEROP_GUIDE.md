# PrismFlowAgent (流光) 交互指南

你正在与 PrismFlowAgent 系统直接交互。这是一个跨平台内容处理与 AI 自动化系统。本手册旨在帮助你理解如何通过 API 与系统协作。

---

## 1. 基础认证 (Authentication)

所有请求必须包含以下 Header：
`X-API-Key: sk_pf_your_api_key_here`

---

## 2. API 接口索引 (Endpoint Reference)

### 2.1 系统探测与元数据
*   **Discovery (`GET /api/ai/v1/discovery`)**: 获取系统信息及所有能力(Agents, Workflows, Tools, Skills)的 ID 索引。
*   **Context (`GET /api/ai/v1/context`)**: 获取本操作手册（即你当前阅读的内容）。
*   **Tools (`GET /api/ai/v1/tools`)**: 获取所有工具的 OpenAI Function 格式定义，直接用于 Function Calling。
*   **Skills (`GET /api/ai/v1/skills`)**: 获取加载的技能列表及其说明。

### 2.2 配置管理
*   **Settings (`GET /api/ai/v1/settings`)**: 获取脱敏后的系统配置（AI 提供商、适配器、发布渠道等）。
*   **Settings (`POST /api/ai/v1/settings`)**: 深度合并更新配置。

### 2.3 核心能力定义
*   **Agents (`GET/POST/DELETE /api/ai/v1/agents`)**: 管理智能体（System Prompt、模型、工具绑定）。
*   **Workflows (`GET/POST/DELETE /api/ai/v1/workflows`)**: 管理复杂工作流（多节点 DAG）。
*   **Schedules (`GET/POST/DELETE /api/ai/v1/schedules`)**: 管理定时任务（Cron 驱动）。

### 2.4 统一执行入口
*   **Execute (`POST /api/ai/v1/execute`)**: 触发 Agent, Workflow, Tool 或 Schedule 的统一网关。

---

## 3. 字段定义与参数指南 (Definitions & Parameters)

### 3.1 统一执行入口 (`POST /api/ai/v1/execute`)

**请求体定义 (TypeScript)**:
```typescript
interface ExecuteRequest {
  action: 'tool' | 'agent' | 'workflow' | 'schedule_run';
  id: string;      // 目标能力或任务的 ID
  input: any;     // 输入数据。Agent/Workflow 通常为 string，Tool 为 object
  date?: string;   // 可选：指定执行参考日期 (ISO 格式)
  stream?: boolean;// 可选：仅 action='agent' 时支持 SSE 流式返回
}
```

### 3.2 智能体配置 (`POST /api/ai/v1/agents`)

**数据结构**:
```typescript
interface AgentDefinition {
  id: string;             // 唯一 ID (推荐格式: custom-agent-name)
  name: string;           // 显示名称
  description: string;    // 描述
  systemPrompt: string;   // 系统提示词 (核心逻辑)
  providerId: string;     // 使用的 AI 提供商 ID (见 Settings)
  model: string;          // 模型名称 (如 gpt-4o, claude-3-5-sonnet)
  temperature: number;    // 采样温度 (0-2)
  toolIds: string[];      // 允许调用的工具 ID 列表
  skillIds: string[];     // 绑定的技能 ID 列表
  mcpServerIds: string[]; // 绑定的 MCP 服务器 ID 列表
}
```

### 3.3 工作流定义 (`POST /api/ai/v1/workflows`)

工作流通过定义一系列步骤 (Steps) 及其输入映射来实现复杂任务自动化。

**数据结构**:
```typescript
interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

interface WorkflowStep {
  id: string;             // 步骤 ID
  agentId?: string;       // 要运行的 Agent ID
  workflowId?: string;    // 要运行的嵌套 Workflow ID
  inputMap: Record<string, string>; // 参数映射
}
```
*   **inputMap**: 用于将前置步骤的输出或起始输入映射到当前步骤。`"start"` 代表工作流的初始输入。例如：`{"target_field": "previous_step_id"}`。

### 3.4 定时任务 (`POST /api/ai/v1/schedules`)

**数据结构**:
```typescript
interface ScheduleConfig {
  id: string;
  name: string;
  cron: string;           // 标准 Cron 表达式 (如 "30 9 * * *")
  type: 'ADAPTER' | 'AGENT_SUMMARY' | 'AGENT_DEAL' | 'FULL_INGESTION';
  targetId: string;       // 对应类型的 ID (如适配器 ID 或 Agent ID)
  enabled: boolean;
}
```

### 3.5 系统能力发现 (`GET /api/ai/v1/discovery`)

**响应体定义**:
```typescript
interface DiscoveryResponse {
  system: {
    name: string;
    version: string;
    description: string;
  };
  capabilities: {
    agents: { id: string; name: string; description: string }[];
    workflows: { id: string; name: string; description: string }[];
    skills: { id: string; name: string; description: string }[];
    tools: { id: string; name: string; description: string }[];
    schedules: { id: string; name: string; type: string; enabled: boolean }[];
  };
  endpoints: Record<string, string>; // API 路径映射
}
```

### 3.6 系统配置管理 (`GET/POST /api/ai/v1/settings`)

系统配置采用深度合并策略。更新时，对于数组类型的配置（如 `AI_PROVIDERS`, `ADAPTERS`），系统会根据 `id` 匹配现有项进行合并，或追加新项。

**核心配置项说明**:
- `ACTIVE_AI_PROVIDER_ID`: 当前选中的主 AI 提供商 ID。
- `AI_PROVIDERS`: AI 模型提供商列表（类型：`GEMINI`, `CLAUDE`, `OPENAI`, `OLLAMA`）。
- `ADAPTERS`: 数据采集适配器列表。
- `PUBLISHERS`: 内容发布渠道列表。
- `STORAGES`: 资源存储配置列表。

---

## 4. 当前系统状态 (System Status)

### 可用智能体 (Agents)
{{AGENTS_LIST}}

### 可用工作流 (Workflows)
{{WORKFLOWS_LIST}}

### 可用技能 (Skills)
{{SKILLS_LIST}}

### 可用定时任务 (Schedules)
{{SCHEDULES_LIST}}

### 可用工具 (Tools)
{{TOOLS_LIST}}

---

## 5. 操作流程指南

1.  **同步**: 在开始任何任务前，务必先通过 `GET /api/ai/v1/context` (即本手册) 同步最新的可用能力。
2.  **探测**: 使用 `GET /api/ai/v1/settings` 了解当前激活的 AI 提供商和已配置的数据源。
3.  **决策**: 
    - 如果需要执行单次复杂任务，使用 `POST /api/ai/v1/execute` 调用 `agent`。
    - 如果需要长期的自动化流程，先 `POST /api/ai/v1/agents` 定义能力，再 `POST /api/ai/v1/workflows` 定义流程，最后通过 `POST /api/ai/v1/schedules` 设置定时。
4.  **调试**: 如果工具调用失败，检查 `GET /api/ai/v1/tools` 中的参数 JSON Schema 是否匹配。

---
*Last Updated: 2026-03-25*
