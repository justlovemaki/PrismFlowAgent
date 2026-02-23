import { LocalStore } from './LocalStore.js';
import { initServices, AppServices } from './initServices.js';
import { SystemSettings } from '../types/config.js';
import { AIProvider } from './AIProvider.js';

export class ServiceContext {
  private static instance: ServiceContext;
  private store: LocalStore;
  private services!: AppServices;

  private constructor(store: LocalStore) {
    this.store = store;
  }

  public static async getInstance(store?: LocalStore): Promise<ServiceContext> {
    if (!ServiceContext.instance && store) {
      ServiceContext.instance = new ServiceContext(store);
      await ServiceContext.instance.reload();
    }
    return ServiceContext.instance;
  }

  public async reload() {
    console.log('Reloading services with latest configuration...');
    
    // Stop existing scheduler if it exists
    if (this.services?.schedulerService) {
      this.services.schedulerService.stopAll();
    }

    this.services = await initServices(this.store);
  }

  public get taskService() {
    return this.services.taskService;
  }

  public get schedulerService() {
    return this.services.schedulerService;
  }

  public get translationService() {
    return this.services.translationService;
  }

  public get aiProvider(): AIProvider | undefined {
    return this.services.aiProvider;
  }

  public get settings(): SystemSettings {
    return this.services.settings;
  }

  public get configService() {
    return this.services.configService;
  }

  public get agentService() {
    return this.services.agentService;
  }

  public get mcpService() {
    return this.services.mcpService;
  }

  public get skillService() {
    return this.services.skillService;
  }

  public get skillStoreService() {
    return this.services.skillStoreService;
  }

  public get workflowEngine() {
    return this.services.workflowEngine;
  }

  public get proxyAgent() {
    return this.services.proxyAgent;
  }

  public get adapterInstances() {
    return this.services.adapterInstances;
  }

  public get publisherInstances() {
    return this.services.publisherInstances;
  }

  public get storageInstances() {
    return this.services.storageInstances;
  }
}
