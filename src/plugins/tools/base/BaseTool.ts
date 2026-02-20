import { ToolDefinition } from '../../../types/agent.js';

/**
 * 基础工具类，所有内置和外部工具插件都应继承此类
 */
export abstract class BaseTool implements ToolDefinition {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: any; // JSON Schema

  /**
   * 工具执行逻辑
   * @param args 工具参数
   */
  abstract handler(args: any): Promise<any>;
}
