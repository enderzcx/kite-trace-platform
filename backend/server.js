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
