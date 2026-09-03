# 流光 PrismFlowAgent 🌈

> **自动化信息聚合 + AI 智能体：让高质量信息自动流向你**

流光 (PrismFlowAgent) 是一个全栈自动化资讯处理系统。它能帮你从 GitHub、RSS、社交媒体抓取海量信息，利用最强的 AI (Gemini/Claude/GPT) 进行深度总结，并自动分发到你的微信公众号、GitHub 仓库或 RSS 订阅源。项目同时提供 **DeepSeek Harness 专属原生插件 `@prismflow/dsh`**，可将 PrismFlow 的采集、筛选、生成、审核与发布能力直接带入 DSH Chat 和 Dashboard。

---

## 🌟 核心亮点 (Core Highlights)

流光 (PrismFlowAgent) 的核心竞争力在于其**极高可靠性的全链路自动化**：

### 1. 深度信息聚合 (Smart Ingest)
- **多源监控**: 实时监控 GitHub Trending、学术论文、Twitter/Reddit 等动态。
- **极速扩展**: 插件化架构，几分钟即可接入任何新的网页或 API 数据源。

### 2. 流程高度稳定 (Stable Workflow)
- **健壮调度**: 从抓取、处理到存储（SQLite/本地缓存），任务调度逻辑严密，支持 24 小时无人值守监控。
- **自动化流转**: 确保信息从源头到分发的每一个环节都稳定可靠。

### 3. 生成内容稳定 (Stable AI Content)
- **全模型适配**: 原生支持 Gemini, Claude, GPT 和本地部署的 Ollama。
- **结构化输出**: 通过预设 Prompt 模板确保语义统一、格式标准，输出高质量深度总结。

### 4. 一键/自动发布 (Stable Distribution)
- **多端触达**: 一键（或全自动）推送到**微信公众号**、存入 **GitHub** 归档，或生成标准 **RSS**。
- **媒体优化**: 自动压缩图片 (AVIF) 和处理视频 (FFmpeg)，在保证画质的同时节省存储空间。

### 5. AI 交互与互操作 (Agent Interop)
- **专为 AI 设计**: 提供 API 与接入指引，让外部 AI Agent 能像操作四肢一样调用本地工具，Agent，工作流。
- **闭环协作**: 支持 AI 自动触发抓取、筛选与发布流程，实现真正的人机协作。

### 6. DeepSeek Harness 专属插件
- **原生集成**：`@prismflow/dsh` 直接运行在 DeepSeek Harness / Cordis 进程内，无需额外启动 PrismFlow HTTP 服务。
- **完整工作链路**：在 DSH 中完成数据源同步、AI Selection、工作流生成、草稿审核、媒体处理和受控发布。
- **专属管理界面**：向 DSH Dashboard 注入 PrismFlow 工作台，用于数据源、工具集、工作流、草稿、发布目标及审计管理。
- **安全可审计**：关键配置采用版本与 SHA-256 CAS，发布严格绑定已审批 Artifact，并保留发布尝试与回执记录。

---

## 🤝 人机协作：你定规则，它干活

我们坚持 **“人脑决策，AI 执行”** 的原则：
- **你负责**：挑选数据源、设定 Prompt 模板、审核发布内容。
- **AI 负责**：24小时不间断盯盘、海量内容阅读总结、自动排版、资源上传。

---

## 🤖 AI 接入示例 (Agent Interop)

如果你有外部 AI Agent（如 Claude Desktop 或其他自主 Agent），可以直接让它接管本系统。

**发送给 Agent 的指令示例：**
> “请阅读 `https://raw.githubusercontent.com/justlovemaki/PrismFlowAgent/main/AI_INTEROP.md` 接入指引，按照流程完成自助注册并接入我的系统, 地址：http://localhost:3000 。”

---

## 📖 分步使用指南

![Home Screenshot](./static/home.png)

### 1. 登录系统
访问 `http://localhost:5173/login`，输入默认密码 `admin123`。

### 2. 配置 AI 与插件
前往 **设置 (Settings)** 页面：
- **AI 配置**：填写你的 Gemini 或 OpenAI API Key。
- **插件配置**：配置 GitHub Token 或微信公众号凭据。
- **浏览器发布渠道说明**：像 **小红书** 这类通过浏览器自动化发布的渠道，需额外配合 [OpenChromeCLI](https://github.com/justlovemaki/OpenChromeCLI) 一起使用，并在系统设置中配置对应的 **浏览器桥接 Host / Port**。

### 3. 运行抓取
在 **任务管理 (Task Management)** 页面，点击任务旁的 **立即运行**（如 GitHub Trending），系统将自动拉取最新资讯。

### 4. 筛选与排序
前往 **内容筛选 (Selection)** 页面，勾选你感兴趣的条目，支持拖拽调整顺序。

### 5. AI 生成
点击下方的 **生成 AI 内容**：
- 确认素材，选择合适的 **智能体 (Agent)** 或 **工作流 (Workflow)**。
- 点击生成，AI 将输出深度精简后的结构化内容。

### 6. 发布
生成完成后，一键点击 **发布到 GitHub** 或 **发布到微信** 即可完成全自动分发。

> 说明：若使用 **小红书** 这类浏览器自动化发布渠道，请先确保已启动并正确配置 [OpenChromeCLI](https://github.com/justlovemaki/OpenChromeCLI)，否则系统无法连接浏览器执行自动发布。

> 特别标识：系统中的发布渠道分为 **API 直连发布** 与 **浏览器自动化发布** 两类。像 **小红书** 这样的渠道会在界面中明确标注“浏览器自动化发布”，以提醒用户它依赖额外的浏览器桥接环境，而不是纯 API 推送。

---

## 🛠️ 技术底座

| 模块 | 关键技术 |
| :--- | :--- |
| **后端** | Node.js 20+ (ESM), Fastify, TypeScript 5 |
| **前端** | React 19, Vite, Tailwind CSS, Framer Motion |
| **数据库** | SQLite (轻量可靠，无需复杂配置) |
| **存储** | Cloudflare R2 / GitHub / 本地存储 |

---

## 📂 核心目录结构

```text
├── src/
│   ├── api/            # Fastify 路由与接口
│   ├── plugins/        # 核心插件 (适配器、工具、分发器)
│   ├── registries/     # 插件注册中心 (支持热启停)
│   ├── services/       # 业务逻辑 (AI、任务调度、工作流)
│   └── types/          # 全局 TypeScript 定义
├── frontend/           # 管理后台 (React SPA)
├── integrations/dsh/   # DeepSeek Harness 专属原生插件
└── data/               # 本地数据库与缓存
```

---

## ⚡ 快速开始

### 1. 安装环境
确保你本地有 **Node.js 20+** 和 **pnpm**。

```bash
git clone https://github.com/justlovemaki/PrismFlowAgent.git
cd PrismFlowAgent

# 安装依赖
npm install
cd frontend && pnpm install && cd ..
```

### 2. 本地启动
```bash
# 全栈开发模式 (后端 + 前端一起启动)
npm run dev:all

# 访问: http://localhost:5173
# 默认密码: admin123
```

---

## 🧩 DeepSeek Harness 专属原生插件

PrismFlow 为 **DeepSeek Harness** 提供独立发行的专属插件包 [`@prismflow/dsh`](./integrations/dsh/)。它直接运行在 DSH/Cordis 进程内，不依赖 PrismFlow HTTP 服务或 PrismFlow API Key，也不会把 DSH 简单作为外部接口调用方。

安装后，DSH Chat 可以直接调用 PrismFlow 工具完成“来源同步 → AI 筛选 → 内容生成 → 草稿修订 → 人工审批 → 多渠道发布”；DSH Dashboard 则获得一套专属 PrismFlow 管理工作台。插件复用主项目的内容处理 Core，同时保持独立打包、独立安装和明确的运行边界。

### 插件能力

- **原生数据源**：支持 GitHub Trending、Follow API (Folo)、AI Search 与 RSS；
- **AI 内容筛选**：基于相关性评审、语义聚类、来源配额和 AI 评分生成可追溯 Selection；
- **工作流生成**：支持直接文本、Markdown、JSON 或已持久化内容作为输入，并执行多阶段串行生成；
- **草稿与媒体**：支持并发安全修订、图片生成、AVIF/WebP/HEIF 转换及 FFmpeg 媒体处理；
- **受控发布**：支持本地 Markdown、GitHub、Cloudflare R2 和微信公众号草稿；
- **安全审计**：Generation Request、Draft、Artifact、发布尝试和 Receipt 均保留版本、哈希与来源绑定。

### 安装专属插件

停止正在运行的 DSH Web 后，将发行包路径或下载地址传给插件管理器：

```sh
dsh plugin --profile web add --allow-build=sharp <path-or-url-to-prismflow-dsh.tgz>
dsh plugin --profile web exec prismflow-dsh-install
```

安装完成后重新启动 DSH Web，并创建新 Chat 以加载最新工具与 Skills。完整的版本兼容范围、Profile 配置、升级和故障恢复说明见 [`integrations/dsh/README.md`](./integrations/dsh/README.md)。

### 运行边界

`@prismflow/dsh` 的职责边界为：

- PrismFlow 工作台按原项目的 Adapter + Items 模型配置 GitHub Trending、Follow API (Folo)、AI 搜索和 RSS 订阅；预定义凭证槽位可显示配置状态，并按部署策略安全写入或轮换 Follow Cookie；
- 工作流生成器统一管理 Persona 与串行步骤；元数据会显示未保存/已保存状态，保存与放弃操作位于画布后的自然流页脚（支持受保护的 Ctrl/Cmd+S CAS 保存，不自动保存），归档/重新启用则在独立的“生成器状态”区确认执行；旧版投影会标记“旧版生成器 · 尚未迁移”，并通过精确版本/hash CAS 迁移，不再提供 Dashboard 兼容提示词编辑入口；旧提示词存储仅供旧 Request 解析与迁移使用；
- 工作台还负责待审核/已拒绝草稿的并发安全 Markdown 修订、源文与安全 React 节点渲染预览、显示版本/hash 的并发冲突刷新后再次确认审核、已批准 Artifact 发布和发布审计；
- 数据抓取、持久化查询、素材选择排序、Generation Request 创建和 AI 生成全部由 DSH Chat 工具执行；内置 `daily-brief` 旧版生成器保留两个串行、无工具的兼容阶段，只有最终终审结果会持久化为草稿；
- 已批准草稿既可从工作台发布，也可由 Chat 调用受限发布工具；浏览器和模型都不能提供发布正文或部署目标参数。

详细工具顺序和 Profile 配置见 [`integrations/dsh/README.md`](./integrations/dsh/README.md)。

## 📖 相关文档
- 🛠️ [AGENTS.md](./AGENTS.md) - 规范、开发准则与最佳实践。
- 🔌 [PLUGINS.md](./PLUGINS.md) - 如何编写自己的适配器与分发器。
- 🛰️ [AI_INTEROP.md](./AI_INTEROP.md) - **AI 接入必读**: 让你的 Agent 开启上帝视角。
- 🧩 [integrations/dsh/README.md](./integrations/dsh/README.md) - DeepSeek Harness 插件 Bundle 的本地打包与接入说明。

---

## 📜 许可证
基于 [GPL-3.0 License](./LICENSE) 授权。
