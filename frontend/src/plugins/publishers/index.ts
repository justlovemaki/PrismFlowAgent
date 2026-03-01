export interface PublisherPlugin {
  id: string;
  name: string;
  modal?: React.ComponentType<any>;
}

/**
 * 自动发现并加载发布渠道插件
 * 分别扫描内置插件 (builtin) 和自定义插件 (custom)
 */
const builtinModules = import.meta.glob('../builtin/publishers/*/index.ts', { eager: true });
const customModules = import.meta.glob('../custom/publishers/*/index.ts', { eager: true });

export const PUBLISHER_PLUGINS: Record<string, PublisherPlugin> = {};

const registerModules = (modules: Record<string, any>) => {
  Object.values(modules).forEach((module: any) => {
    if (module.default && module.default.id) {
      PUBLISHER_PLUGINS[module.default.id] = module.default;
    }
  });
};

// 内置插件优先注册，但自定义插件同名会覆盖内置插件（符合插件覆盖逻辑）
registerModules(builtinModules);
registerModules(customModules);

export const getPublisherPlugin = (id: string) => PUBLISHER_PLUGINS[id];

export const getAllPublisherPlugins = () => Object.values(PUBLISHER_PLUGINS);
