export function registerReceiptEvidenceDemoRoutes(ctx = {}) {
  const { app, deps = {}, helpers = {} } = ctx;
  const {
    getLatestIdentityChallengeSnapshot,
    mapX402Item,
    normalizeExecutionState,
    buildA2AReceipt,
    buildTraceXmtpEvidence
  } = helpers;
  const { readWorkflows, readX402Requests, requireRole } = deps;

  app.get('/api/demo/trace/:traceId', requireRole('viewer'), (req, res) => {
    const traceId = String(req.params.traceId || '').trim();
    if (!traceId) {
      return res.status(400).json({ ok: false, error: 'traceId_required' });
    }

    const workflows = readWorkflows();
    const workflow = workflows.find((w) => String(w.traceId || '') === traceId);
    if (!workflow) {
      return res.status(404).json({ ok: false, error: 'workflow_not_found', traceId });
    }

    const reqItem = readX402Requests().find((item) => String(item.requestId || '') === String(workflow.requestId || ''));
    const mapped = reqItem ? mapX402Item(reqItem, workflow) : null;
    const receipt = reqItem?.a2a ? buildA2AReceipt(reqItem, workflow, { traceId }) : null;
    const xmtpEvidence = buildTraceXmtpEvidence({
      traceId,
      requestId: String(workflow?.requestId || reqItem?.requestId || '').trim()
    });
    const identityLatest = getLatestIdentityChallengeSnapshot();

    const hasIdentity = Boolean(reqItem?.identity?.registry || reqItem?.identity?.agentId);
    const hasChallenge = Boolean(
      workflow?.requestId ||
        (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'challenge_issued'))
    );
    const hasPayment = Boolean(
      workflow?.txHash ||
        reqItem?.paymentTxHash ||
        reqItem?.paymentProof?.txHash ||
        (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'payment_sent'))
    );
    const hasProof = Boolean(
      reqItem?.proofVerification ||
        (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'proof_submitted'))
    );
    const hasApiResult = Boolean(
      workflow?.result ||
        String(workflow?.state || '').trim().toLowerCase() === 'unlocked' ||
        (Array.isArray(workflow?.steps) && workflow.steps.some((step) => String(step?.name || '') === 'unlocked'))
    );
    const hasOnchain = Boolean(reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || workflow?.txHash);
    const workflowState = normalizeExecutionState(workflow?.state || '', 'running');

    const order = ['identity', 'challenge', 'payment', 'proof', 'api_result', 'onchain'];
    const stepState = {
      identity: hasIdentity ? 'success' : 'waiting',
      challenge: hasChallenge ? 'success' : 'waiting',
      payment: hasPayment ? 'success' : 'waiting',
      proof: hasProof ? 'success' : 'waiting',
      api_result: hasApiResult ? 'success' : 'waiting',
      onchain: hasOnchain ? 'success' : 'waiting'
    };

    if (workflowState === 'failed') {
      const failedStep =
        order.find((id) => stepState[id] !== 'success') ||
        'api_result';
      stepState[failedStep] = 'failed';
    } else {
      const runningStep = order.find((id) => stepState[id] !== 'success');
      if (runningStep) {
        stepState[runningStep] = 'running';
      }
    }

    const timeline = [
      {
        id: 'identity',
        label: 'ERC8004 Identity',
        state: stepState.identity,
        detail: hasIdentity
          ? `agentId ${String(reqItem?.identity?.agentId || '-')}`
          : 'waiting for identity metadata'
      },
      {
        id: 'challenge',
        label: 'x402 Challenge',
        state: stepState.challenge,
        detail: hasChallenge ? `requestId ${String(workflow?.requestId || reqItem?.requestId || '-')}` : 'waiting for challenge'
      },
      {
        id: 'payment',
        label: 'Payment Sent',
        state: stepState.payment,
        detail: hasPayment ? `tx ${String(workflow?.txHash || reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || '-')}` : 'waiting for payment'
      },
      {
        id: 'proof',
        label: 'Proof Verified',
        state: stepState.proof,
        detail: hasProof ? 'on-chain transfer log matched' : 'waiting for proof verification'
      },
      {
        id: 'api_result',
        label: 'API Result',
        state: stepState.api_result,
        detail: hasApiResult ? String(workflow?.result?.summary || reqItem?.result?.summary || 'result unlocked') : 'waiting for result unlock'
      },
      {
        id: 'onchain',
        label: 'On-chain Evidence',
        state: stepState.onchain,
        detail: hasOnchain ? String(workflow?.txHash || reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || '-') : 'waiting for tx evidence'
      }
    ];

    return res.json({
      ok: true,
      traceId,
      state: workflowState,
      workflow,
      request: reqItem || null,
      mapped,
      receipt,
      xmtp: xmtpEvidence,
      identityLatest,
      timeline
    });
  });

  app.get('/api/demo/trace-by-request/:requestId', requireRole('viewer'), (req, res) => {
    const requestId = String(req.params.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'requestId_required' });
    }
    const workflows = readWorkflows();
    const workflow = workflows.find((w) => String(w.requestId || '').trim() === requestId);
    if (!workflow?.traceId) {
      return res.status(404).json({ ok: false, error: 'workflow_not_found_by_request', requestId });
    }
    return res.json({
      ok: true,
      requestId,
      traceId: String(workflow.traceId || '').trim()
    });
  });
}
