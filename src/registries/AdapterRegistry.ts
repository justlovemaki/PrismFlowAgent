import { BaseAdapter } from '../plugins/base/BaseAdapter.js';
import { LogService } from '../services/LogService.js';
import { ConfigField } from '../types/plugin.js';

export type AdapterConstructor = new (...args: any[]) => BaseAdapter;

export interface AdapterMetadata {
  type: string;
  name: string;
  description?: string;
  icon?: string;
  configFields: ConfigField[];
  isBuiltin?: boolean;
}

export class AdapterRegistry {
  private static instance: AdapterRegistry;
  private adapters: Map<string, { constructor: AdapterConstructor; metadata: AdapterMetadata }> = new Map();

  private constructor() {}

  public static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  public register(type: string, constructor: AdapterConstructor, metadata: AdapterMetadata) {
    this.adapters.set(type, { constructor, metadata });
    LogService.info(`Adapter registered: ${type}`);
  }

  public get(type: string): AdapterConstructor | undefined {
    return this.adapters.get(type)?.constructor;
  }

  public getMetadata(type: string): AdapterMetadata | undefined {
    return this.adapters.get(type)?.metadata;
  }

  public list(): string[] {
    return Array.from(this.adapters.keys());
  }

  public listMetadata(): AdapterMetadata[] {
    return Array.from(this.adapters.values()).map(a => a.metadata);
  }
}
