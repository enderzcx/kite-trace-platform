module.exports = {
  apps: [
    {
      name: 'kiteclaw-backend',
      cwd: '/srv/kiteclaw/app/backend',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: '3001'
      }
    },
    {
      name: 'ktrace-relay-bundler',
      cwd: '/srv/kiteclaw/app/backend',
      script: 'lib/relay-bundler/relay-bundler.mjs',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        KITEAI_RPC_URL: 'https://testnet.hsk.xyz',
        KITE_CHAIN_ID: '133',
        RELAY_BUNDLER_PORT: '4337'
      }
    }
  ]
};
