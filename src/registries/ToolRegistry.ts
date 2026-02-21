import { BaseTool } from '../plugins/base/BaseTool.js';

export interface ToolMetadata {
  id: string;
  name: string;
  description?: string;
  isBuiltin?: boolean;
}

export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, { constructor: typeof BaseTool; metadata: ToolMetadata }> = new Map();

  private constructor() {}

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  public register(id: string, toolClass: typeof BaseTool, metadata?: ToolMetadata) {
    this.tools.set(id, { 
      constructor: toolClass, 
      metadata: metadata || { id, name: id, isBuiltin: false } 
    });
  }

  public get(id: string): typeof BaseTool | undefined {
    return this.tools.get(id)?.constructor;
  }

  public getMetadata(id: string): ToolMetadata | undefined {
    return this.tools.get(id)?.metadata;
  }

  public getAll(): string[] {
    return Array.from(this.tools.keys());
  }

  public listMetadata(): ToolMetadata[] {
    return Array.from(this.tools.values()).map(t => t.metadata);
  }
}
