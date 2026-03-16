import { registerProvidersV1Routes } from './v1/providersV1Routes.js';
import { registerCapabilitiesV1Routes } from './v1/capabilitiesV1Routes.js';
import { registerDiscoveryV1Routes } from './v1/discoveryV1Routes.js';
import { registerTemplatesV1Routes } from './v1/templatesV1Routes.js';
import { registerTrustV1Routes } from './v1/trustV1Routes.js';

export function registerPlatformV1Routes(app, deps) {
  registerProvidersV1Routes(app, deps);
  registerCapabilitiesV1Routes(app, deps);
  registerTemplatesV1Routes(app, deps);
  registerTrustV1Routes(app, deps);
  registerDiscoveryV1Routes(app, deps);
}
