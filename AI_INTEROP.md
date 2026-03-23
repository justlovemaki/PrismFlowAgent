---
name: PrismFlowAgent
description: 本指南旨在告诉外部 AI 系统（如 Claude, Openclaw 等）如何接入并协作使用 PrismFlowAgent (流光) 系统。
---


# PrismFlowAgent (流光) AI Interoperability Guide

本指南旨在告诉外部 AI 系统（如 Claude, Openclaw 等）如何接入并协作使用 PrismFlowAgent (流光) 系统。

---

## 1. 快速接入流程 (Quick Start)

如果你是一个 AI Agent，请按以下顺序执行：

1.  **自助注册**: 调用 `POST /api/ai/v1/register` 接口申请访问权限。
    *   你将收到一个 `apiKey` (处于 Pending 状态) 和一个 `verificationUrl`。
    *   **保存位置**: 请立即将 `apiKey` 持久化存储。推荐保存在你的环境变量 `PRISM_FLOW_AI_KEY` 或项目根目录的 `.env` 文件中（格式：`AI_INTEROP_KEY=sk_pf_...`）。
2.  **人为验证**: 你需要向人类用户展示 `verificationUrl`。人类用户必须在浏览器中打开该页面，并手动点击 **“确认并批准接入”** 按钮来正式激活你的 Key。
    *   该系统通过你的 **IP 地址** 和 **User-Agent** 生成唯一指纹，确保请求来源的唯一性。
3.  **获取上下文**: 验证通过后，调用 `GET /api/ai/v1/context` 获取 Markdown 格式的系统操作手册。
4.  **发现能力**: 调用 `GET /api/ai/v1/discovery` 获取当前系统加载的所有能力索引（Agents, Workflows, Tools）。
5.  **执行操作**: 通过 `POST /api/ai/v1/execute` 触发具体的操作。

---

## 2. API 接口规范 (API Reference)

### 2.1 申请注册 (Register)
*   **Endpoint**: `POST /api/ai/v1/register`
*   **参数**: `{"name": "你的智能体名称"}`
*   **响应**:
    ```json
    {
      "status": "pending",
      "apiKey": "sk_pf_...",
      "verificationUrl": "http://.../api/ai/v1/verify/..."
    }
    ```

### 2.2 获取 AI 引导手册 (Context)
所有后续请求必须包含以下 Header：
`X-API-Key: sk_pf_your_api_key_here`

*   **Endpoint**: `GET /api/ai/v1/context`
*   **返回内容**: Markdown。
*   **用途**: 将此内容直接注入你的 **System Message**。

### 2.3 能力发现 (Discovery)
*   **Endpoint**: `GET /api/ai/v1/discovery`
*   **用途**: 获取当前可用的 Agents, Workflows 和 Tools 列表。

### 2.4 工具集定义 (Tools Schema)
*   **Endpoint**: `GET /api/ai/v1/tools`
*   **用途**: 如果你支持 Tool Use (Function Calling)，请将此结果注入你的工具配置。

### 2.5 统一执行入口 (Execute)
*   **Endpoint**: `POST /api/ai/v1/execute`
*   **参数**:
    ```json
    {
      "action": "agent | workflow | tool",
      "id": "能力或工具的 ID",
      "input": "输入内容",
      "stream": false
    }
    ```
*   **流式支持**: 当 `action="agent"` 且 `stream=true` 时，接口将以 **SSE** 方式返回。

---

## 3. 核心能力模型 (Capabilities Model)

### Agents (智能体)
流光内的 Agents 是针对特定任务（如摘要、翻译、知识库问答）预设了系统提示词和工具权限的独立单元。

### Workflows (工作流)
工作流是多个 Agent 或步骤的串联，用于处理复杂业务逻辑。

### Tools (底层工具)
包括但不限于：
*   `query_knowledge`: 检索本地向量知识库。
*   `save_memory`: 写入长期记忆。
*   `publish`: 向微信公众号、GitHub 等平台推送内容。

---

## 4. 常见任务示例 (Use Cases)

### 场景 A：查询本地知识库并生成摘要
1.  调用 `tool:query_knowledge` 获取背景。
2.  调用 `agent:default_summarizer` 生成最终文本。

### 场景 B：内容全网分发
1.  通过 `discovery` 找到可用的 `publishers`。
2.  调用 `action:tool`, `id:publish` 配合对应的 `options` 进行分发。

---

## 5. 错误处理
*   `401 Unauthorized`: API Key 无效。
*   `403 Forbidden`: 权限不足（API Key 仅能访问 `/api/ai/v1/*`）。
*   `500 Internal Server Error`: 执行过程中发生错误，返回体会包含具体的错误信息。

---
*Last Updated: 2026-03-22*
