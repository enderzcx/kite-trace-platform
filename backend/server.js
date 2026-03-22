import 'dotenv/config';
import { createRequestLogger } from './lib/logger.js';

import { applyNodeEnvProxyPreference } from './lib/envProxy.js';

applyNodeEnvProxyPreference();

const { startServer, shutdownServer } = await import('./app.js');
const logger = createRequestLogger('backend-server');

startServer().catch((error) => {
  logger.error('backend_startup_failed', {
    error: error?.message || String(error || 'backend_startup_failed')
  });
  process.exit(1);
});

process.on('SIGINT', () => {
  shutdownServer()
    .catch((error) => {
      logger.error('backend_shutdown_failed', {
        signal: 'SIGINT',
        error: error?.message || String(error || 'backend_shutdown_failed')
      });
    })
    .finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  shutdownServer()
    .catch((error) => {
      logger.error('backend_shutdown_failed', {
        signal: 'SIGTERM',
        error: error?.message || String(error || 'backend_shutdown_failed')
      });
    })
    .finally(() => process.exit(0));
});
