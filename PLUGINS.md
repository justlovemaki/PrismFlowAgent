# PrismFlow 插件接入文档

PrismFlow 采用 **自动扫描机制**。只需将开发好的插件文件放入指定目录，系统在启动时会自动识别并注册。

---

## 目录
1. [核心概念](#核心概念)
2. [数据源适配器 (Adapters)](#数据源适配器-adapters)
3. [内容发布器 (Publishers)](#内容发布器-publishers)
4. [存储提供商 (Storages)](#存储提供商-storages)
5. [代理工具 (Tools)](#代理工具-tools)
6. [自动扫描机制](#自动扫描机制)
7. [配置字段定义 (ConfigField)](#配置字段定义-configfield)

---

## 核心概念

所有插件都需要通过静态属性 `static metadata` 定义其元数据。系统通过识别这些元数据来完成自动注册。

### 插件类型定义
核心接口定义在 [`src/types/plugin.ts`](src/types/plugin.ts) 中：
- `IAdapter`: 数据抓取与转换。
- `IPublisher`: 将生成的内容发布到外部平台。
- `IStorageProvider`: 文件（如图片）的云端存储。
- `BaseTool`: Agent 使用的工具函数。

---

## 数据源适配器 (Adapters)

适配器负责从外部 API 抓取原始数据，并将其转换为系统统一的 [`UnifiedData`](src/types/index.ts) 格式。

### 1. 开发步骤
在 `src/plugins/custom/adapters/` 目录下创建子目录及文件（如 `custom/MyAdapter.ts`）。

```typescript
import { BaseAdapter } from '../base/BaseAdapter.js';
import type { UnifiedData } from '../../../types/index.js';
import type { ConfigField } from '../../../types/plugin.js';
import type { AdapterMetadata } from '../../../registries/AdapterRegistry.js';

export class MyCustomAdapter extends BaseAdapter {
  // 【关键】定义静态元数据，系统将据此自动注册
  static metadata: AdapterMetadata = {
    type: 'MyCustomAdapter', // 唯一标识
    name: '我的自定义源',
    description: '获取自定义源的数据', // 可选
    icon: 'api', // 可选 (UI 显示图标)
    configFields: [
      { key: 'apiKey', label: 'API 密钥', type: 'password', required: true, scope: 'adapter' },
      { key: 'category', label: '抓取分类', type: 'text', default: 'general', scope: 'item' }
    ]
  };

  readonly name = 'My Custom Source';
  readonly category = 'custom';
  configFields = MyCustomAdapter.metadata.configFields;

  constructor() {
    super();
    this.appendDateToId = true; // 可选：是否在 ID 后追加日期以避免冲突
  }

  // 抓取原始数据
  async fetch(config: any): Promise<any> {
    const response = await fetch(`https://api.example.com/data?key=${config.apiKey}`);
    return response.json();
  }

  // 转换为统一格式
  transform(rawData: any, config?: any): UnifiedData[] {
    const now = new Date().toISOString();
    return rawData.map((item: any) => ({
      id: `custom-${item.uuid}`,
      title: item.title,
      url: item.link,
      description: item.summary,
      published_date: new Date(item.ts).toISOString(),
      ingestion_date: now.split('T')[0],
      source: this.name,
      category: this.category
    }));
  }
}
```

---

## 内容发布器 (Publishers)

### 1. 开发步骤
在 `src/plugins/custom/publishers/` 目录下创建文件。

```typescript
import { IPublisher, ConfigField } from '../../../types/plugin.js';
import { PublisherMetadata } from '../../../registries/PublisherRegistry.js';

export class MyPublisher implements IPublisher {
  // 【关键】静态元数据
  static metadata: PublisherMetadata = {
    id: 'my-publisher',
    name: '我的目标平台',
    description: '发布到自定义平台',
    icon: 'send',
    configFields: [
      { key: 'webhookUrl', label: 'Webhook 地址', type: 'text', required: true }
    ]
  };

  id = 'my-publisher';
  name = 'My Target Platform';
  configFields = MyPublisher.metadata.configFields;

  async publish(content: string, options: any): Promise<any> {
    // 发布逻辑...
  }
}
```

---

## 存储提供商 (Storages)

### 1. 开发步骤
在 `src/plugins/custom/storages/` 目录下创建文件。

```typescript
import { IStorageProvider, ConfigField } from '../../../types/plugin.js';
import { StorageMetadata } from '../../../registries/StorageRegistry.js';

export class MyStorage implements IStorageProvider {
  // 【关键】静态元数据
  static metadata: StorageMetadata = {
    id: 'my-storage',
    name: '我的云存储',
    description: '存储文件到云端',
    icon: 'cloud_upload',
    configFields: [
      { key: 'bucket', label: 'Bucket Name', type: 'text', required: true }
    ]
  };

  id = 'my-storage';
  name = 'My Storage';
  configFields = MyStorage.metadata.configFields;

  async upload(localPath: string, targetPath: string): Promise<string | null> {
    // 上传逻辑...
  }
}
```

---

## 代理工具 (Tools)

Agent 可以调用工具来执行特定的任务。工具插件放置在 `src/plugins/custom/tools/` 目录下。

### 1. 开发步骤
继承 `BaseTool` 类并实现核心方法。

```typescript
import { BaseTool } from '../base/BaseTool.js';

export class MyCustomTool extends BaseTool {
  // 【关键】定义工具的唯一 ID、名称、描述和参数 (JSON Schema)
  readonly id = 'my_custom_tool';
  readonly name = 'My Custom Tool';
  readonly description = '执行我的自定义逻辑';
  
  // JSON Schema 定义参数结构
  readonly parameters = {
    type: 'object',
    properties: {
      input: { type: 'string', description: '输入参数' }
    },
    required: ['input']
  };

  // 实现执行逻辑
  async handler(args: { input: string }): Promise<any> {
    return `Processed: ${args.input}`;
  }
}
```

---

## 自动扫描机制

系统在启动时会执行以下操作：
1. 递归扫描 `src/plugins/builtin/` 和 `src/plugins/custom/` 下的子目录：
   - `adapters/`
   - `publishers/`
   - `storages/`
   - `tools/`
2. 排除 `base` 目录、`.d.ts` 文件以及文件名包含 `Base` 的文件。
3. 动态加载模块并寻找拥有 `static metadata` 属性的类，或符合条件的 `BaseTool` 子类。
4. 将找到的类及其元数据注册到对应的 Registry 中。

**这意味着你不再需要手动修改 `PluginInit.ts`。**

---

## 配置字段定义 (ConfigField)

`ConfigField` 用于描述配置项在 UI 上的呈现方式。

| 属性 | 类型 | 说明 |
| :--- | :--- | :--- |
| `key` | `string` | 配置项的键名（代码中通过 `config[key]` 获取） |
| `label` | `string` | UI 显示的标签名称 |
| `type` | `string` | `text`, `password`, `number`, `select`, `boolean`, `textarea`, `executor` |
| `options` | `string[]` | 当 type 为 `select` 时的选项列表 |
| `default` | `any` | 默认值 |
| `required` | `boolean` | 是否必填 |
| `scope` | `string` | `adapter` (全局配置) 或 `item` (特定任务配置) |

---

## 注意事项

- **导入后缀**: 始终在导入本地模块时添加 `.js` 后缀。
- **静态元数据**: 必须定义 `static metadata`，否则系统将无法识别该类。
- **文件命名**: 建议文件名与类名保持一致。
- **构建校验**: 完成开发后，运行 `npm run build` 确保类型检查通过。
