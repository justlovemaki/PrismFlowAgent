# PrismFlowAgent (流光) Agent Development Guide  

本文档为在 PrismFlowAgent (流光) 仓库中运行的 AI Agent 提供核心开发指南、命令参考和代码规范。

## 1. 核心开发指令

项目主要基于 Node.js (ESM) 和 TypeScript 构建。

### 基础环境
- **运行环境**: Node.js 20+, TypeScript 5+

### 构建与编译
- `npm run build`: 使用 `tsc` 编译后端代码到 `dist/` 目录。
- `npm run build:frontend`: 编译前端代码。
- `npm run build:all`: 编译前后端所有代码。
- **校验**: 在提交代码前，**必须**运行 `npm run build` 以确保没有类型错误。

### 运行与调试
- `npm run dev`: 启动后端开发服务器，使用 `tsx watch` 监听文件变动。
- `npm run dev:frontend`: 启动 Vite 前端开发服务器。
- `npm run dev:all`: 同时启动前后端（使用 `concurrently`）。
- `npm run prod`: 构建并启动生产模式（合并服务）。

### 测试指令
由于本项目目前没有配置统一的测试框架（如 Vitest 或 Jest），建议通过以下方式运行单脚本验证：
- **运行单文件**: `npx tsx src/path/to/file.ts`
- **临时测试**: 建议在 `src/tests/` (如果不存在则创建) 下编写临时脚本，并使用 `tsx` 执行。
- **自定义验证**: 修改代码后，应通过 `npm run build` 确保类型检查通过，并通过 `npm run dev` 进行功能性验证。

---

## 2. 代码风格与规范

### 导入规范 (Imports)
- **ESM 扩展名**: 由于项目使用 `type: "module"`，在 TypeScript 文件中引用本地模块时，**必须**带上 `.js` 后缀。
  - ✅ `import { BaseAdapter } from '../adapters/BaseAdapter.js';`
  - ❌ `import { BaseAdapter } from '../adapters/BaseAdapter';`
- **类型导入**: 优先使用 `import type` 来导入接口或类型。

### 命名约定 (Naming)
- **类名**: 使用 `PascalCase`（如 `TaskService`, `FollowApiAdapter`）。
- **方法与变量**: 使用 `camelCase`（如 `runDailyIngestion`, `targetDate`）。
- **常量**: 使用 `UPPER_SNAKE_CASE`（如 `DEFAULT_PORT`）。
- **文件命名**: 尽量与类名保持一致（如 `AIService.ts`）。

### 强类型要求 (Typing)
- 避免使用 `any`，除非是在处理动态配置或第三方不规范数据时。
- 业务数据结构应在 `src/types/` 中定义（如 `UnifiedData`）。
- 接口定义应清晰，利用 TypeScript 的联合类型和可选属性。

### 错误处理 (Error Handling)
- 使用 `try...catch` 包裹可能失败的异步操作。
- 统一使用 `LogService` 进行日志记录：
  - `LogService.info(msg)`
  - `LogService.error(msg)`
  - `LogService.warn(msg)`
- 在 Adapter 中失败时，应抛出有意义的错误信息以便 Service 层捕获。

---

## 3. 项目目录结构与核心文件

### 后端结构 (`/src/`)
- `api/`: Fastify 路由定义与服务器初始化。
- `infra/`: 基础设施层，如权限执行校验。
- `plugins/`: 插件系统，包含内建 (`builtin`) 和自定义 (`custom`) 的适配器、发布器、存储和工具。
  - `base/`: 插件基类。
  - `builtin/`: 内建插件。
  - `custom/`: 用户自定义插件存放处。
- `registries/`: 插件注册中心与自动发现逻辑。
- `services/`: 核心业务逻辑（AI、数据库、任务调度、微信/GitHub 集成）。
- `types/`: 全局 TypeScript 类型定义。
- `utils/`: 辅助工具函数（日期处理、文本转换）。
- `index.ts`: 后端入口文件。

### 前端结构 (`/frontend/src/`)
- `components/`: UI 组件，采用现代 React Hooks 风格。
- `pages/`: 页面组件（仪表盘、任务管理、生成界面）。
- `context/`: 状态管理（如 AuthContext）。
- `services/`: 前端 API 通讯层。
- `plugins/`: 前端插件渲染配置。
- `utils/`: 通用工具类。
- `App.tsx`: 前端路由与根组件。
- `main.tsx`: 入口文件。

---

## 4. 架构设计模式

### Service-Adapter 模式
- **Adapters**: 负责外部数据抓取和格式转换。必须继承 `BaseAdapter` 并实现 `fetch` 和 `transform` 方法。
- **Services**: 负责核心业务逻辑。例如 `TaskService` 协调各个 Adapter 并管理存储。

### 单例模式 (Singleton)
- 核心服务实例通过 `ServiceContext` 进行管理。
- 使用 `ServiceContext.getInstance()` 获取全局唯一的服务集合。

### 依赖注入 (Dependency Injection)
- 服务之间通过构造函数注入依赖，便于单元测试和模拟。

---

## 5. AI Agent 操作流程

1. **理解上下文**: 
   - 修改前先阅读 `src/services/ServiceContext.ts` 了解服务依赖。
   - 检查 `src/types/` 下的数据结构，特别是 `UnifiedData` 和 `CommitRecord`。
2. **制定计划**: 
   - 优先修改类型定义，确保数据流向明确。
   - 如果是新增适配器，必须继承 `BaseAdapter`。
   - 在对应的 `src/plugins/custom/` 目录下创建新插件。
3. **安全准则**:
   - **严禁**硬编码任何敏感信息。
   - 使用 `LogService` 记录关键步骤，但不要泄露隐私数据。
4. **验证变更**:
   - **核心步骤**: 必须运行 `npm run build` 进行全量类型检查。
   - 功能测试: 启动 `npm run dev` 并在浏览器（或通过 API 调用）进行验证。
   - 观察 `app.log` 确认没有异常堆栈。

---

## 6. 常见任务模板

### 添加新适配器 (New Adapter)
1. 在 `src/plugins/custom/adapters/` 创建 `NewSourceAdapter.ts`。
2. 继承 `BaseAdapter`，实现 `fetch` 和 `transform`。
3. 定义 `static metadata` 属性以启用自动发现。
4. 详见 [PLUGINS.md](./PLUGINS.md)。

### 修改 AI 总结逻辑
1. 检查 `src/prompts/` (如果存在) 或 `AIService.ts` 中的 Prompt 定义。
2. 调整 Prompt 模板，并确保 `AIService` 能正确解析返回结果。

---

## 7. 其他注意事项
- **数据库**: 使用 SQLite。修改模型时需注意数据迁移或 `LocalStore` 的初始化逻辑。
- **前端**: 前端基于 React + Vite + Tailwind CSS。修改 UI 时应保持设计语言一致。
- **注释**: 复杂逻辑使用 JSDoc 注释。

---
*Last Updated: 2026-03-01*
