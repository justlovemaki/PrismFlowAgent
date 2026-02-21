import { BaseTool } from '../../base/BaseTool.js';
import { ServiceContext } from '../../../services/ServiceContext.js';

export class FetchDataTool extends BaseTool {
  readonly id = 'fetch_data';
  readonly name = 'fetch_data';
  readonly description = '从指定的适配器或所有适配器获取资讯数据';
  readonly parameters = {
    type: 'object',
    properties: {
      adapterName: { type: 'string', description: '适配器名称 (可选)' },
      date: { type: 'string', description: '目标日期 (YYYY-MM-DD, 可选)' }
    }
  };

  async handler(args: { adapterName?: string; date?: string }) {
    const context = await ServiceContext.getInstance();
    if (args.adapterName) {
      return await context.taskService.runSingleAdapterIngestion(args.adapterName, args.date);
    } else {
      return await context.taskService.runDailyIngestion(args.date);
    }
  }
}


