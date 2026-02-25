import dotenv from 'dotenv';
import { createServer } from './api/server.js';
import { LocalStore } from './services/LocalStore.js';
import { ServiceContext } from './services/ServiceContext.js';
import { LogService } from './services/LogService.js';


dotenv.config();

// Global error handlers to prevent process crash
process.on('uncaughtException', (error) => {
  LogService.error(`Uncaught Exception: ${error.message}`);
  if (error.stack) LogService.error(error.stack);
  // Do not exit, try to keep the service running
});

process.on('unhandledRejection', (reason, promise) => {
  LogService.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

async function bootstrap() {
  const store = new LocalStore();
  await store.init();

  // --- Initialize Service Context (Singleton) ---
  const context = await ServiceContext.getInstance(store);

  const server = await createServer(store);

  const port = parseInt(process.env.PORT || '3000');

  try {
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

bootstrap();
