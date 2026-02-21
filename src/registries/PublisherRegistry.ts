import { IPublisher, ConfigField } from '../types/plugin.js';
import { LogService } from '../services/LogService.js';

export type PublisherConstructor = new (config: any) => IPublisher;

export interface PublisherMetadata {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  configFields: ConfigField[];
  isBuiltin?: boolean;
}

export class PublisherRegistry {
  private static instance: PublisherRegistry;
  private publishers: Map<string, { constructor: PublisherConstructor; metadata: PublisherMetadata }> = new Map();

  private constructor() {}

  public static getInstance(): PublisherRegistry {
    if (!PublisherRegistry.instance) {
      PublisherRegistry.instance = new PublisherRegistry();
    }
    return PublisherRegistry.instance;
  }

  public register(id: string, constructor: PublisherConstructor, metadata: PublisherMetadata) {
    this.publishers.set(id, { constructor, metadata });
    LogService.info(`Publisher registered: ${id}`);
  }

  public get(id: string): PublisherConstructor | undefined {
    return this.publishers.get(id)?.constructor;
  }

  public getMetadata(id: string): PublisherMetadata | undefined {
    return this.publishers.get(id)?.metadata;
  }

  public list(): string[] {
    return Array.from(this.publishers.keys());
  }

  public listMetadata(): PublisherMetadata[] {
    return Array.from(this.publishers.values()).map(p => p.metadata);
  }
}
