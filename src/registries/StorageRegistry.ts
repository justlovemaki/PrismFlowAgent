import { IStorageProvider } from '../types/plugin.js';
import { LogService } from '../services/LogService.js';

export type StorageConstructor = new (config: any) => IStorageProvider;

export interface StorageMetadata {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  configFields: any[];
  isBuiltin?: boolean;
}

export class StorageRegistry {
  private static instance: StorageRegistry;
  private storages: Map<string, { constructor: StorageConstructor; metadata: StorageMetadata }> = new Map();

  private constructor() {}

  public static getInstance(): StorageRegistry {
    if (!StorageRegistry.instance) {
      StorageRegistry.instance = new StorageRegistry();
    }
    return StorageRegistry.instance;
  }

  public register(id: string, constructor: StorageConstructor, metadata: StorageMetadata) {
    this.storages.set(id, { constructor, metadata });
    LogService.info(`Storage registered: ${id}`);
  }

  public get(id: string): StorageConstructor | undefined {
    return this.storages.get(id)?.constructor;
  }

  public getMetadata(id: string): StorageMetadata | undefined {
    return this.storages.get(id)?.metadata;
  }

  public list(): string[] {
    return Array.from(this.storages.keys());
  }

  public listMetadata(): StorageMetadata[] {
    return Array.from(this.storages.values()).map(s => s.metadata);
  }
}
