import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { AdapterRegistry } from './AdapterRegistry.js';
import { PublisherRegistry } from './PublisherRegistry.js';
import { StorageRegistry } from './StorageRegistry.js';
import { ToolRegistry as ToolRegistryClass } from './ToolRegistry.js';
import { LogService } from '../services/LogService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 递归扫描目录并自动注册插件
 */
async function scanAndRegister(
  dir: string,
  registry: any,
  type: 'adapter' | 'publisher' | 'storage' | 'tool',
  isBuiltin: boolean
) {
  if (!fs.existsSync(dir)) return;

  const files = fs.readdirSync(dir, { recursive: true }) as string[];
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) continue;
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
    if (file.endsWith('.d.ts')) continue;
    if (file.includes('base') || file.includes('Base')) continue;

    try {
      // 转换为文件 URL 以支持 Windows
      const fileUrl = pathToFileURL(fullPath).href;
      const module = await import(fileUrl);
      
      // 遍历模块导出，寻找带有 metadata 静态属性的类，或者工具类
      for (const exportKey of Object.keys(module)) {
        const ExportedClass = module[exportKey];
        if (typeof ExportedClass === 'function') {
          // 处理带有 metadata 的插件 (Adapter, Publisher, Storage)
          if (ExportedClass.metadata) {
            const metadata = { ...ExportedClass.metadata, isBuiltin };
            if (type === 'adapter') {
              registry.register(metadata.type, ExportedClass, metadata);
            } else {
              registry.register(metadata.id, ExportedClass, metadata);
            }
            LogService.info(`Auto-registered ${type}: ${metadata.name || metadata.id || metadata.type} (builtin: ${isBuiltin})`);
          }
          // 处理工具插件 (Tool)
          else if (type as string === 'tool') {
            try {
              const toolInstance = new ExportedClass();
              if (toolInstance.id && toolInstance.handler) {
                // 如果是工具，我们需要在类或者实例上标记 isBuiltin
                // 由于目前 ToolRegistry 只存储类，我们可以在实例上标记然后传递，或者在注册时处理
                // 修改: 给实例设置 isBuiltin
                (toolInstance as any).isBuiltin = isBuiltin;
                registry.register(toolInstance.id, ExportedClass, { 
                  id: toolInstance.id, 
                  name: toolInstance.name, 
                  description: toolInstance.description,
                  isBuiltin 
                });
                LogService.info(`Auto-registered tool: ${toolInstance.id} (builtin: ${isBuiltin})`);
              }
            } catch (e) {
              // Ignore if not a valid tool class
            }
          }
        }
      }
    } catch (error: any) {
      LogService.error(`Failed to auto-register plugin from ${file}: ${error.message}`);
    }
  }
}

export async function initRegistries() {
  const adapterRegistry = AdapterRegistry.getInstance();
  const publisherRegistry = PublisherRegistry.getInstance();
  const storageRegistry = StorageRegistry.getInstance();
  const toolRegistry = ToolRegistryClass.getInstance();

  const pluginsDir = path.resolve(__dirname, '../plugins');
  const builtinDir = path.join(pluginsDir, 'builtin');
  const customDir = path.join(pluginsDir, 'custom');

  const categories = [
    { name: 'adapters', registry: adapterRegistry, type: 'adapter' as const },
    { name: 'publishers', registry: publisherRegistry, type: 'publisher' as const },
    { name: 'storages', registry: storageRegistry, type: 'storage' as const },
    { name: 'tools', registry: toolRegistry, type: 'tool' as const },
  ];

  for (const category of categories) {
    // 1. 扫描内建插件
    await scanAndRegister(
      path.join(builtinDir, category.name),
      category.registry,
      category.type,
      true
    );
    // 2. 扫描自定义插件
    await scanAndRegister(
      path.join(customDir, category.name),
      category.registry,
      category.type,
      false
    );
  }
}
