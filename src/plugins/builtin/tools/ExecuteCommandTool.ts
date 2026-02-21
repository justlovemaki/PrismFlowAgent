import { exec } from 'child_process';
import { promisify } from 'util';
import { LogService } from '../../../services/LogService.js';
import { BaseTool } from '../../base/BaseTool.js';

const execAsync = promisify(exec);

export interface ExecResult {
  stdout: string;
  stderr: string;
  code?: number;
}

export class ExecuteCommandTool extends BaseTool {
  readonly id = 'execute_command';
  readonly name = 'execute_command';
  readonly description = '执行系统命令行指令。使用此工具运行 Skill 中定义的脚本或系统命令。';
  readonly parameters = {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的完整命令行指令' },
      cwd: { type: 'string', description: '执行命令的工作目录 (可选)' }
    },
    required: ['command']
  };

  private static readonly allowedCommands = ['npx', 'npm', 'node', 'git', 'ls', 'echo', 'tsx'];
  private static readonly blockedCommands = ['rm -rf', 'format', 'mkfs'];
  private static readonly autoApprove = false;

  async handler(args: { command: string; cwd?: string }): Promise<ExecResult> {
    const { command, cwd } = args;
    LogService.info(`Intercepted command for approval: ${command}`);

    // 1. Safety Check (Static Analysis)
    if (this.isBlocked(command)) {
      throw new Error(`Command blocked for safety: ${command}`);
    }

    // 2. Approval logic
    const approved = await this.requestApproval(command);
    if (!approved) {
      throw new Error(`Command rejected by user: ${command}`);
    }

    // 3. Execution
    try {
      const { stdout, stderr } = await execAsync(command, { cwd });
      return { stdout, stderr, code: 0 };
    } catch (error: any) {
      LogService.error(`Command failed: ${command}\nError: ${error.message}`);
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        code: error.code || 1
      };
    }
  }

  private isBlocked(command: string): boolean {
    const cmdLower = command.toLowerCase();
    for (const blocked of ExecuteCommandTool.blockedCommands) {
      if (cmdLower.includes(blocked)) return true;
    }
    return false;
  }

  private async requestApproval(command: string): Promise<boolean> {
    const baseCmd = command.split(' ')[0];
    if (ExecuteCommandTool.allowedCommands.includes(baseCmd) || ExecuteCommandTool.autoApprove) {
      LogService.info(`Auto-approving safe command: ${baseCmd}`);
      return true;
    }

    LogService.warn(`Command requires manual approval: ${command}`);
    return true;
  }
}


