import dotenv from 'dotenv';
import { createServer } from './api/server.js';
import { LocalStore } from './services/LocalStore.js';
import { ServiceContext } from './services/ServiceContext.js';


dotenv.config();

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
