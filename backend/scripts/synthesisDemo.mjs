#!/usr/bin/env node
/**
 * Synthesis Hackathon Demo Script
 *
 * Creates 3 open BTC trade plan jobs via the autonomous request loop.
 * After creation, an external agent (e.g. Claude + ktrace MCP) can:
 *   1. job_claim → claim a job
 *   2. Use cap abilities to gather BTC data
 *   3. job_submit → submit trade plan + evidence
 *   4. Auto-validator checks and completes
 *
 * Usage:
 *   node scripts/synthesisDemo.mjs
 *   node scripts/synthesisDemo.mjs --rounds 1    # single job
 *   node scripts/synthesisDemo.mjs --interval 30  # 30s between rounds
 */

import { config as loadEnv } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadEnv({ path: path.resolve(__dirname, '..', '.env') });

const BASE_URL = process.env.SYNTHESIS_DEMO_BASE_URL || 'http://127.0.0.1:3399';
const API_KEY = process.env.KITECLAW_API_KEY_AGENT || process.env.KITE_AGENT_API_KEY || 'agent-local-dev-key';
const ROUNDS = Math.max(1, Math.min(Number(process.argv.find((_, i, a) => a[i - 1] === '--rounds') || 3), 10));
const INTERVAL_SEC = Math.max(10, Number(process.argv.find((_, i, a) => a[i - 1] === '--interval') || 60));

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function divider() {
  console.log('\n' + '='.repeat(80) + '\n');
}

async function postJson(pathname, body = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000)
  });
  return response.json();
}

async function getJson(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: { 'x-api-key': API_KEY },
    signal: AbortSignal.timeout(15_000)
  });
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  divider();
  log('🚀 Synthesis Hackathon Demo — Kite Trace Platform');
  log(`   Rounds: ${ROUNDS} | Interval: ${INTERVAL_SEC}s | Backend: ${BASE_URL}`);
  divider();

  // Step 0: Health check
  const health = await getJson('/health');
  if (!health?.ok) {
    log('❌ Backend not reachable. Start it first: cd backend && node server.js');
    process.exit(1);
  }
  log('✅ Backend healthy (uptime: ' + health.uptime + 's)');

  // Step 1: Show agent.json
  log('\n📋 Agent Manifest (/.well-known/agent.json):');
  const agentCard = await getJson('/.well-known/agent.json');
  console.log(JSON.stringify({
    name: agentCard.name,
    protocols: agentCard.protocols,
    agents: agentCard.agents?.length + ' agents',
    safety: agentCard.safety,
    endpoints: agentCard.endpoints
  }, null, 2));

  divider();
  log('📝 Creating ' + ROUNDS + ' open BTC trade plan jobs...\n');

  const createdJobs = [];

  for (let round = 1; round <= ROUNDS; round++) {
    log(`--- Round ${round}/${ROUNDS} ---`);

    // Trigger synthesis loop
    const trigger = await postJson('/api/synthesis/loop/trigger');
    const status = trigger?.status || {};

    if (status.lastStatus === 'ok' && status.lastJobId) {
      const jobId = status.lastJobId;
      log(`✅ Job created: ${jobId}`);

      // Get job details
      const jobData = await getJson(`/api/jobs/${jobId}`);
      const job = jobData?.job || jobData;

      log(`   State: ${job.state}`);
      log(`   Executor: ${job.executor} (${job.executor === '0x0000000000000000000000000000000000000000' ? 'OPEN — any agent can claim' : 'assigned'})`);
      log(`   Budget: ${job.budget || job.escrowAmount} USDT`);
      log(`   Escrow: ${job.escrowState || 'N/A'}`);
      log(`   Payer: ${job.payer}`);
      if (job.createAnchorTxHash) log(`   📌 Create Anchor: ${job.createAnchorTxHash}`);
      if (job.escrowFundTxHash) log(`   💰 Escrow Fund TX: ${job.escrowFundTxHash}`);
      if (job.fundingAnchorTxHash) log(`   📌 Fund Anchor: ${job.fundingAnchorTxHash}`);

      createdJobs.push({
        round,
        jobId,
        state: job.state,
        budget: job.budget || job.escrowAmount,
        createAnchorTxHash: job.createAnchorTxHash || '',
        escrowFundTxHash: job.escrowFundTxHash || '',
        fundingAnchorTxHash: job.fundingAnchorTxHash || ''
      });
    } else {
      log(`❌ Job creation failed: ${status.lastError || 'unknown'}`);
      createdJobs.push({ round, jobId: '', state: 'failed', error: status.lastError });
    }

    if (round < ROUNDS) {
      log(`\n   Waiting ${INTERVAL_SEC}s before next round...\n`);
      await sleep(INTERVAL_SEC * 1000);
    }
  }

  divider();
  log('📊 Summary:\n');

  const successful = createdJobs.filter((j) => j.state === 'funded');
  log(`   Jobs created: ${successful.length}/${ROUNDS}`);
  log(`   All on-chain transactions:\n`);

  for (const job of createdJobs) {
    if (job.state === 'funded') {
      log(`   Round ${job.round}: ${job.jobId}`);
      if (job.createAnchorTxHash) log(`     - Create Anchor: ${job.createAnchorTxHash}`);
      if (job.escrowFundTxHash) log(`     - Escrow Fund:   ${job.escrowFundTxHash}`);
      if (job.fundingAnchorTxHash) log(`     - Fund Anchor:   ${job.fundingAnchorTxHash}`);
    } else {
      log(`   Round ${job.round}: FAILED — ${job.error || 'unknown'}`);
    }
  }

  divider();
  log('🎯 Next Steps (for the external agent / Claude + ktrace MCP):\n');
  for (const job of successful) {
    log(`   1. ktrace job_claim  { jobId: "${job.jobId}" }`);
    log(`   2. ktrace cap_news_signal / cap_dex_market / cap_token_analysis  (gather BTC data)`);
    log(`   3. Analyze data and create trade plan`);
    log(`   4. ktrace job_submit { jobId: "${job.jobId}", summary: "...", resultRef: "...", dataSourceTraceIds: [...] }`);
    log('');
  }

  // Export agent_log
  divider();
  log('📄 Agent Log (GET /api/synthesis/agent-log):\n');
  const agentLog = await getJson('/api/synthesis/agent-log');
  console.log(JSON.stringify(agentLog, null, 2));

  divider();
  log('✅ Demo script complete. Open jobs are waiting for external agents.');
  log(`   agent.json:  ${BASE_URL}/.well-known/agent.json`);
  log(`   agent_log:   ${BASE_URL}/api/synthesis/agent-log`);
  log(`   evidence:    ${BASE_URL}/api/public/evidence/<traceId>?logs=true`);
}

main().catch((error) => {
  console.error('Demo failed:', error.message);
  process.exit(1);
});
