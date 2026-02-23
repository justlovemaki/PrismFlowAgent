export class LogService {
  private static logs: { timestamp: string, level: string, message: string }[] = [];
  private static maxLogs = 100;

  static info(message: string) {
    this.addLog('INFO', message);
  }

  static warn(message: string) {
    this.addLog('WARN', message);
  }

  static error(message: string) {
    this.addLog('ERROR', message);
  }

  private static addLog(level: string, message: string) {
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    this.logs.push({ timestamp, level, message });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    console.log(`[${timestamp}] ${level}: ${message}`);
  }

  static getLogs() {
    return [...this.logs].reverse();
  }
}
