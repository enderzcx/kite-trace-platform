import { startServer, shutdownServer } from './app.js';

startServer().catch((error) => {
  console.error(`Backend startup failed: ${error?.message || error}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  shutdownServer().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  shutdownServer().finally(() => process.exit(0));
});
