#!/usr/bin/env node
/**
 * Synthesis Demo Script
 *
 * Triggers the hourly news brief requester loop so the backend creates and
 * funds open ERC-8183 jobs for external agents.
 *
 * Usage:
 *   node scripts/synthesisDemo.mjs
 *   node scripts/synthesisDemo.mjs --rounds 1
 *   node scripts/synthesisDemo.mjs --interval 30
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
  console.log(`\n${'='.repeat(80)}\n`);
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
  log(`Synthesis Demo | rounds=${ROUNDS} interval=${INTERVAL_SEC}s backend=${BASE_URL}`);
  divider();

  const health = await getJson('/health');
  if (!health?.ok) {
    log('Backend not reachable. Start it first: cd backend && npm start');
    process.exit(1);
  }
  log(`Backend healthy (uptime=${health.uptime}s)`);

  const createdJobs = [];
  divider();
  log(`Creating ${ROUNDS} hourly news brief jobs...`);

  for (let round = 1; round <= ROUNDS; round += 1) {
    log(`Round ${round}/${ROUNDS}`);
    const trigger = await postJson('/api/synthesis/loop/trigger');
    const status = trigger?.status || {};

    if (status.lastStatus === 'ok' && status.lastJobId) {
      const jobId = status.lastJobId;
      const jobData = await getJson(`/api/jobs/${jobId}`);
      const job = jobData?.job || jobData;
      log(`Created: ${jobId}`);
      log(`  state=${job.state}`);
      log(`  capability=${job.capability}`);
      log(`  executor=${job.executor}`);
      log(`  budget=${job.budget || job.escrowAmount}`);
      if (job.createAnchorTxHash) log(`  createAnchor=${job.createAnchorTxHash}`);
      if (job.escrowFundTxHash) log(`  escrowFund=${job.escrowFundTxHash}`);
      if (job.fundingAnchorTxHash) log(`  fundingAnchor=${job.fundingAnchorTxHash}`);
      createdJobs.push({
        round,
        jobId,
        state: job.state,
        createAnchorTxHash: job.createAnchorTxHash || '',
        escrowFundTxHash: job.escrowFundTxHash || '',
        fundingAnchorTxHash: job.fundingAnchorTxHash || ''
      });
    } else if (status.lastStatus === 'skipped_active_job') {
      log(`Skipped: active hourly news job still in progress (${status.lastJobId || 'unknown'})`);
      createdJobs.push({ round, jobId: status.lastJobId || '', state: 'skipped_active_job', error: '' });
    } else {
      log(`Failed: ${status.lastError || 'unknown'}`);
      createdJobs.push({ round, jobId: '', state: 'failed', error: status.lastError || 'unknown' });
    }

    if (round < ROUNDS) {
      await sleep(INTERVAL_SEC * 1000);
    }
  }

  divider();
  log('Summary:');
  for (const job of createdJobs) {
    if (job.state === 'funded') {
      log(`  round=${job.round} jobId=${job.jobId}`);
    } else if (job.state === 'skipped_active_job') {
      log(`  round=${job.round} skipped active job ${job.jobId || ''}`.trim());
    } else {
      log(`  round=${job.round} failed ${job.error || ''}`.trim());
    }
  }

  divider();
  log('Next steps for the external agent:');
  for (const job of createdJobs.filter((item) => item.state === 'funded')) {
    log(`  1. ktrace job_claim  { jobId: "${job.jobId}" }`);
    log(`  2. ktrace job_accept { jobId: "${job.jobId}" }`);
    log(`  3. ktrace cap_news_signal { coin: "BTC", minScore: 50, limit: 5 }`);
    log(`  4. Build ktrace-news-brief-v1 delivery with summary/items/newsTraceId/paymentTxHash/trustTxHash`);
    log(`  5. ktrace job_submit { jobId: "${job.jobId}", delivery: {...} }`);
  }

  divider();
  log('Agent log:');
  const agentLog = await getJson('/api/synthesis/agent-log');
  console.log(JSON.stringify(agentLog, null, 2));

  divider();
  log(`agent-log=${BASE_URL}/api/synthesis/agent-log`);
  log(`agent-json=${BASE_URL}/.well-known/agent.json`);
}

main().catch((error) => {
  console.error('Demo failed:', error.message);
  process.exit(1);
});
