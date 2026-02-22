# 流光 PrismFlowAgent 🌈

流光 (PrismFlowAgent) 是一款基于 Node.js (ESM) 和 TypeScript 构建的现代化、全栈资讯处理与 AI Agent 系统。它能够自动化地从全球多源渠道抓取高质量资讯，利用顶级大语言模型进行深度总结，并将其精准分发至 GitHub、微信公众号、RSS 等多种终端。

流光采用高度模块化、插件化的架构设计，特别加强了对 AI Agent 工作流、多媒体资产处理以及 MCP 协议的支持，旨在打造一个可高度扩展的智能化信息流枢纽。

---

## ✨ 核心能力

### 🔍 智能数据抓取 (Adapters)
-   **GitHub Trending**: 实时监控全球热门开源项目趋势。
-   **Follow API (Folo)**: 深度集成，支持学术论文、Twitter/Reddit 动态及各类 RSS 源。
-   **高度可扩展**: 继承 `BaseAdapter` 即可分钟级接入任意第三方数据源。

### 🧠 顶级 AI 生态集成
-   **全模型适配**: 原生支持 **Google Gemini**, **Anthropic Claude**, **OpenAI** 和 **Ollama**。
-   **智能工具链 (Tool Use)**: 赋予 AI 调用本地工具（搜索、绘图、执行指令）的能力。
-   **MCP 协议支持**: 动态加载外部 MCP 服务器，无限扩展 Agent 能力边界。

### ⚙️ 自动化工作流与插件架构
-   **可视化工作流 (Workflow Engine)**: 支持定义复杂的 DAG 自动化流程，具备并行执行与数据依赖注入能力。
-   **可插拔技能 (Skill System)**: 灵活配置特定领域的 AI 技能包。
-   **统一注册表**: 动态管理 Adapter、Publisher、Storage 和 Tool，支持热启停。

### 🖼️ 工业级多媒体管道 (Media Pipeline)
-   **极致压缩**: 自动将图像转换为高压缩比、高质量的 **AVIF** 格式。
-   **视频优化**: 集成 `ffmpeg` 进行全自动转码与体积优化。
-   **云端托管**: 支持 **Cloudflare R2** (S3 兼容) 与 **GitHub** 资源存储。

### 🚀 多端分发矩阵
-   **GitHub Archive**: 自动生成结构化的 Markdown 每日/每周资讯存档。
-   **微信公众号**: 自动完成图文排版、图片上传及草稿发布。
-   **RSS XML**: 生成标准化的订阅源，满足极客阅读需求。

### 📊 现代化管理控制台
-   **实时看板**: 直观监控抓取状态、任务成功率与数据走势。
-   **人机协作**: 支持手动触发任务、预览 AI 摘要并进行二次干预。

---

## 🛠 技术架构

-   **后端**: Node.js 20+ (ESM), Fastify, TypeScript 5, SQLite (KV & Relational).
-   **前端**: React 19, Vite, Tailwind CSS, Framer Motion.
-   **包管理**: 后端使用 `npm`，前端强制使用 `pnpm`。
-   **核心模式**: Service-Adapter 架构、单例模式、依赖注入。

---

## 📂 核心目录结构

```text
├── src/
│   ├── api/            # Fastify 路由与服务器
│   ├── plugins/        # 插件系统（工具、发布、存储）
│   ├── registries/     # 插件注册中心
│   ├── services/       # 核心业务逻辑 (Agent, Workflow, Task)
│   ├── types/          # 全局强类型定义
│   └── utils/          # 渲染引擎与工具类
├── frontend/           # React 前端单页应用 (SPA)
└── data/               # SQLite 数据库与本地缓存
```

---

## 🚀 快速开始

### 1. 环境准备

确保您的环境中已安装 **Node.js 20+** 和 **pnpm**。

```bash
# 克隆项目
git clone https://github.com/justlovemaki/PrismFlowAgent.git
cd PrismFlowAgent

# 安装后端依赖
npm install

# 安装前端依赖
cd frontend
pnpm install
cd ..
```

### 2. 配置环境

复制 `.env.example` 为 `.env`，并配置

### 3. 本地运行

```bash
# 启动全栈开发模式 (后端 + 前端)
npm run dev:all

# 仅启动后端
npm run dev

# 仅启动前端 (Vite)
npm run dev:frontend
```

### 4. Docker 部署 (推荐)

如果您希望使用 Docker 进行快速部署，请参考 [Docker 部署指南](./DOCKER.md)。

---

## 📅 开发路线图

| 阶段 | 状态 | 核心产物 |
| :--- | :--- | :--- |
| **1. 基础构建** | ✅ | 模块化重构、Docker 容器化、统一配置中心 |
| **2. 插件架构** | ✅ | 适配器/发布器注册表、多模型适配层、Tool Use 框架 |
| **3. 智能生产** | ✅ | 自动摘要 Agent、任务调度系统 |
| **4. 数据增强** | 🚀 | 多数据源接入、AI搜索数据、导入文本内容、RAG 知识库、记忆系统 |
| **5. 交互编排** | 📅 | 对话式 Master Agent、HITL 人机协作 |
| **6. 收费saas版** | 📅 | saas框架开发、支付订阅、后台管理、收费功能 |

---

## 🤖 开发者与 Agent 指南

如果您是参与此项目的开发者或 AI Agent，请**务必**阅读：
-   [AGENTS.md](./AGENTS.md) - 规范、开发准则与最佳实践。
-   [PLUGINS.md](./PLUGINS.md) - 如何扩展自定义适配器、发布器与工具。

---

## 📜 许可证

本项目基于 [ISC License](./LICENSE) 授权。
