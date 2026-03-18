import { createRequestLogger } from './lib/logger.js';

if (
  !String(process.env.NODE_USE_ENV_PROXY || '').trim() &&
  (
    String(process.env.HTTP_PROXY || '').trim() ||
    String(process.env.HTTPS_PROXY || '').trim() ||
    String(process.env.ALL_PROXY || '').trim()
  )
) {
  process.env.NODE_USE_ENV_PROXY = '1';
}

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
