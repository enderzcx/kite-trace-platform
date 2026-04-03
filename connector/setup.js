#!/usr/bin/env node
/**
 * KTrace Connector Setup
 * Guides user through creating ~/.ktrace-connector/config.json
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROXY_PATH = join(__dirname, 'local-signing-proxy.js');

const CONFIG_DIR = join(homedir(), '.ktrace-connector');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const rl = createInterface({ input: process.stdin, output: process.stderr });
function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.error('\n=== KTrace Connector Setup ===\n');

  let existing = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      console.error('Existing config found. Press Enter to keep current value.\n');
    } catch {}
  }

  const backendUrl = (await ask(`Backend URL [${existing.backendUrl || 'https://kiteclaw.xyz'}]: `)).trim()
    || existing.backendUrl || 'https://kiteclaw.xyz';

  const connectorToken = (await ask(`Connector token (ktrace_cc_...): `)).trim()
    || existing.connectorToken || '';

  const aaWallet = (await ask(`AA wallet address (0x...): `)).trim()
    || existing.aaWallet || '';

  const sessionId = (await ask(`Session ID (0x<64 hex>): `)).trim()
    || existing.sessionId || '';

  const ownerEoa = (await ask(`Owner EOA address (0x...): `)).trim()
    || existing.ownerEoa || '';

  const sessionKey = (await ask(`Session private key (0x... — stored locally, NEVER sent to server): `)).trim();
  rl.close();

  if (sessionKey) {
    // Validate
    try {
      const wallet = new ethers.Wallet(sessionKey);
      console.error(`\nSession signer address: ${wallet.address}`);
    } catch {
      console.error('WARNING: Invalid private key format');
    }
  }

  const cfg = {
    backendUrl,
    connectorToken,
    aaWallet,
    sessionId,
    ownerEoa,
    ...(sessionKey ? { sessionPrivateKey: sessionKey } : {})
  };

  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });

  console.error(`\nConfig saved to ${CONFIG_PATH}`);
  console.error('\nTo use with Claude Code, add to your MCP config:');
  console.error(JSON.stringify({
    "ktrace-proxy": {
      "command": "node",
      "args": [PROXY_PATH]
    }
  }, null, 2));
}

main().catch((e) => {
  console.error('Setup failed:', e.message);
  process.exit(1);
});
