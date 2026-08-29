import { Service } from '@deepseek-ai/cordis'

export const name = 'prismflow-core'

/**
 * Registry of native PrismFlow content-source providers. Providers are scoped
 * Cordis effects, so unloading a provider removes only its own registrations.
 */
export class PrismSourceRegistry extends Service {
  constructor(ctx) {
    super(ctx, 'prismSources')
    this.providers = new Map()
  }

  register(provider) {
    if (!provider?.id || typeof provider.fetch !== 'function') {
      throw new Error('A PrismFlow source provider requires an id and fetch()')
    }
    if (this.providers.has(provider.id)) {
      throw new Error(`PrismFlow source provider already registered: ${provider.id}`)
    }

    this.providers.set(provider.id, provider)
    return () => {
      if (this.providers.get(provider.id) === provider) {
        this.providers.delete(provider.id)
      }
    }
  }

  list() {
    return Array.from(this.providers.values(), provider => ({
      id: provider.id,
      name: provider.name,
      description: provider.description ?? '',
      requiresAgent: provider.requiresAgent === true,
    }))
  }

  async fetch(sourceId, request, execution) {
    const provider = this.providers.get(sourceId)
    if (!provider) {
      const available = this.list().map(item => item.id)
      throw new Error(
        available.length > 0
          ? `Unknown PrismFlow source: ${sourceId}. Available sources: ${available.join(', ')}`
          : 'No PrismFlow sources are configured.',
      )
    }

    return provider.fetch(request, execution)
  }
}

export default PrismSourceRegistry
