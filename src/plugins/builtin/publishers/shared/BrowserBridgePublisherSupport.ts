import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LogService } from '../../../../services/LogService.js';

const execAsync = promisify(exec);

export interface BrowserBridgeConfig {
  browserBridgeHost?: string;
  browserBridgePort?: string;
}

export class BrowserBridgePublisherSupport {
  constructor(
    private readonly cliPath: string,
    private readonly config: BrowserBridgeConfig,
    private readonly tempPrefix: string
  ) {}

  private getConnectionArgs(): string {
    const args: string[] = [];
    if (this.config.browserBridgeHost?.trim()) {
      args.push(`--host "${this.config.browserBridgeHost.trim()}"`);
    }
    if (this.config.browserBridgePort?.trim()) {
      args.push(`--port ${this.config.browserBridgePort.trim()}`);
    }
    return args.join(' ');
  }

  async runCli(method: string, params: any, timeoutMs: number = 120000): Promise<any> {
    const tempDir = path.join(os.tmpdir(), 'opencode');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = path.join(
      tempDir,
      `${this.tempPrefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.json`
    );
    fs.writeFileSync(tempFile, JSON.stringify(params, null, 2), 'utf8');

    try {
      const connectionArgs = this.getConnectionArgs();
      const command = `node "${this.cliPath}" --method ${method} --params-file "${tempFile}"${connectionArgs ? ` ${connectionArgs}` : ''}`;
      const { stdout } = await execAsync(command, { timeout: timeoutMs + 5000 });

      let responseObj: any = null;
      let jsonStr = '';
      let braceCount = 0;
      let inJson = false;

      for (let i = stdout.length - 1; i >= 0; i--) {
        const char = stdout[i];
        if (char === '}') {
          braceCount++;
          inJson = true;
        }
        if (inJson) {
          jsonStr = char + jsonStr;
        }
        if (char === '{') {
          braceCount--;
          if (braceCount === 0 && inJson) {
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.id !== undefined || parsed.error !== undefined) {
                responseObj = parsed;
                break;
              }
            } catch {
            }
            jsonStr = '';
            inJson = false;
          }
        }
      }

      if (!responseObj) {
        throw new Error(`Invalid CLI stdout output (JSON response not found). Raw stdout: ${stdout}`);
      }

      return responseObj;
    } catch (e: any) {
      LogService.error(`Failed to execute browser bridge CLI: ${e.message}`);
      throw e;
    } finally {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch {
      }
    }
  }
}
