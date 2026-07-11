import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types.js';
import { LogService } from '../../services/LogService.js';

export async function registerScheduleRoutes(fastify: FastifyInstance, deps: RouteDeps) {
  const { store, context } = deps;

  fastify.get('/api/schedules', async () => {
    return await store.listSchedules();
  });

  fastify.post('/api/schedules', async (request) => {
    const schedule = request.body as any;
    await store.saveSchedule(schedule);
    
    // Restart/Start the task in memory
    if (schedule.enabled) {
      context.schedulerService.startSchedule(schedule);
    } else {
      context.schedulerService.stopSchedule(schedule.id);
    }
    
    return { status: 'success' };
  });

  fastify.delete('/api/schedules/:id', async (request) => {
    const { id } = request.params as any;
    context.schedulerService.stopSchedule(id);
    await store.deleteSchedule(id);
    return { status: 'success' };
  });

  fastify.get('/api/schedules/logs', async (request) => {
    const { limit, offset, taskId } = request.query as any;
    return await store.listTaskLogs({
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      taskId
    });
  });

  fastify.post('/api/schedules/:id/run', async (request, reply) => {
    try {
      const { id } = request.params as any;
      
      // Fire and forget
      context.schedulerService.runNow(id).catch(err => LogService.error(`Manual run for ${id} failed: ${err}`));
      
      return { status: 'success', message: 'Task triggered' };
    } catch (error: any) {
      reply.status(500).send({ error: error.message });
    }
  });
}
