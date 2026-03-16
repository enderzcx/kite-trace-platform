import { registerCapabilitiesV1Routes } from './capabilitiesV1Routes.js';
import { registerDiscoveryV1Routes } from './discoveryV1Routes.js';
import { registerProvidersV1Routes } from './providersV1Routes.js';
import { registerTemplatesV1Routes } from './templatesV1Routes.js';
import { registerTrustV1Routes } from './trustV1Routes.js';

export function registerPlatformV1ScopedRoutes(app, deps, options = {}) {
  const scopes = new Set(
    Array.isArray(options?.scopes) && options.scopes.length > 0
      ? options.scopes
      : ['providers', 'capabilities', 'discovery', 'templates', 'trust']
  );

  if (scopes.has('providers')) {
    registerProvidersV1Routes(app, deps);
  }
  if (scopes.has('capabilities')) {
    registerCapabilitiesV1Routes(app, deps);
  }
  if (scopes.has('discovery')) {
    registerDiscoveryV1Routes(app, deps);
  }
  if (scopes.has('templates')) {
    registerTemplatesV1Routes(app, deps);
  }
  if (scopes.has('trust')) {
    registerTrustV1Routes(app, deps);
  }
}
