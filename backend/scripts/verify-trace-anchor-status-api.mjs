import { assert, startTraceAnchorHarness } from './traceAnchorHarness.mjs';

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });
  return {
    status: response.status,
    payload: await response.json()
  };
}

const harness = await startTraceAnchorHarness({
  port: 34935,
  anchorRegistry: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  guardAddress: '0x4444444444444444444444444444444444444444',
  initialJobs: [
    {
      jobId: 'job_trace_status',
      traceId: 'trace_job_trace_status',
      state: 'accepted',
      provider: 'provider-harness',
      capability: 'btc-price-feed',
      submitAnchorId: '42',
      submitAnchorTxHash: '0xsubmitstatus',
      submitAnchorConfirmedAt: '2026-03-18T00:00:00.000Z',
      anchorRegistry: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      updatedAt: '2026-03-18T00:00:00.000Z'
    }
  ],
  checkAnchorExists: async (jobId = '') => ({
    configured: true,
    registryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    jobId,
    hasAnchor: true,
    latestAnchorId: '42'
  }),
  readLatestAnchorId: async (jobId = '') => ({
    configured: true,
    registryAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    jobId,
    latestAnchorId: '42'
  })
});

try {
  const privateStatus = await getJson(`${harness.host}/api/jobs/job_trace_status/trace-anchor`);
  assert(privateStatus.status === 200 && privateStatus.payload?.ok === true, 'private trace-anchor status failed');
  assert(privateStatus.payload?.anchorRequired === true, 'private trace-anchor anchorRequired mismatch');
  assert(privateStatus.payload?.anchor?.published === true, 'private trace-anchor published mismatch');
  assert(privateStatus.payload?.anchor?.anchorId === '42', 'private trace-anchor anchorId mismatch');
  assert(privateStatus.payload?.anchor?.txHash === '0xsubmitstatus', 'private trace-anchor txHash mismatch');
  assert(privateStatus.payload?.guardConfigured === true, 'private trace-anchor guardConfigured mismatch');
  assert(privateStatus.payload?.verificationMode === 'v2_has_anchor', 'private trace-anchor verificationMode mismatch');
  assert(privateStatus.payload?.anchor?.verifiedOnchain === true, 'private trace-anchor verifiedOnchain mismatch');
  assert(privateStatus.payload?.anchor?.latestAnchorIdOnChain === '42', 'private trace-anchor latestAnchorIdOnChain mismatch');

  const publicStatus = await getJson(`${harness.host}/api/public/jobs/job_trace_status/trace-anchor`);
  assert(publicStatus.status === 200 && publicStatus.payload?.ok === true, 'public trace-anchor status failed');
  assert(publicStatus.payload?.anchorRequired === true, 'public trace-anchor anchorRequired mismatch');
  assert(publicStatus.payload?.anchor?.published === true, 'public trace-anchor published mismatch');
  assert(publicStatus.payload?.anchor?.anchoredAt === '2026-03-18T00:00:00.000Z', 'public trace-anchor anchoredAt mismatch');
  assert(publicStatus.payload?.guardAddress === '0x4444444444444444444444444444444444444444', 'public trace-anchor guardAddress mismatch');

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary: {
          jobId: privateStatus.payload?.jobId || '',
          traceId: privateStatus.payload?.traceId || '',
          anchorId: privateStatus.payload?.anchor?.anchorId || '',
          anchorPublished: Boolean(privateStatus.payload?.anchor?.published)
        }
      },
      null,
      2
    )
  );
} finally {
  await harness.close();
}
