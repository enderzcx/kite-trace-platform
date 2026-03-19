export function registerReceiptEvidenceReceiptRoutes(ctx = {}) {
  const { app, deps = {}, helpers = {} } = ctx;
  const {
    fetchXReaderDigest,
    buildEvidenceExportPayloadForTrace,
    normalizeXReaderParams,
    parseExcerptMaxChars,
    signResponseHash,
    buildResponseHash,
    buildLatestWorkflowByRequestId,
    hydrateJobForRead,
    buildJobAuditSnapshot,
    normalizeExecutionState
  } = helpers;
  const { readJobs, readWorkflows, readX402Requests, requireRole, writeX402Requests } = deps;

  app.get('/api/receipt/:requestId', requireRole('viewer'), async (req, res) => {
    const requestId = String(req.params.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'requestId_required' });
    }
    const requests = readX402Requests();
    const reqItem = requests.find((item) => String(item?.requestId || '').trim() === requestId);
    if (!reqItem) {
      return res.status(404).json({ ok: false, error: 'request_not_found', requestId });
    }

    const workflowByRequestId = buildLatestWorkflowByRequestId(readWorkflows());
    const workflow = workflowByRequestId.get(requestId) || null;
    const jobs = typeof readJobs === 'function' ? readJobs() : [];
    const jobCandidate =
      jobs.find((item) => String(item?.traceId || '').trim() === String(workflow?.traceId || '').trim()) || null;
    const job = await hydrateJobForRead(jobCandidate);
    const jobAudit = buildJobAuditSnapshot(job);
    const flowTraceId = String(workflow?.traceId || reqItem?.a2a?.traceId || '').trim();
    const exportResult = flowTraceId ? await buildEvidenceExportPayloadForTrace(flowTraceId) : null;
    const exportPayload = exportResult?.ok ? exportResult.exportPayload : null;
    const authorityEnvelope = exportPayload?.authorization || null;
    const action = String(reqItem?.action || workflow?.type || '').trim().toLowerCase();
    const resultPayload = (workflow?.result && typeof workflow.result === 'object' ? workflow.result : null) ||
      (reqItem?.result && typeof reqItem.result === 'object' ? reqItem.result : {}) ||
      {};
    const { responseHash } = buildResponseHash(requestId, action, resultPayload);
    const signatureBundle = await signResponseHash(responseHash);

    const txHash = String(reqItem?.paymentTxHash || reqItem?.paymentProof?.txHash || workflow?.txHash || '').trim();
    const block = reqItem?.proofVerification?.details?.blockNumber ?? '-';
    const onchainStatus =
      reqItem?.proofVerification
        ? 'success'
        : ['failed', 'expired', 'rejected', 'error'].includes(String(reqItem?.status || '').trim().toLowerCase())
          ? 'failed'
          : 'pending';
    const explorer = txHash ? `https://testnet.kitescan.ai/tx/${txHash}` : '';
    const flow =
      String(reqItem?.a2a?.sourceAgentId || '').trim() && String(reqItem?.a2a?.targetAgentId || '').trim()
        ? 'a2a+x402'
        : 'agent-to-api+x402';

    const receiptPayload = {
      version: 'kiteclaw-receipt-v1',
      generatedAt: new Date().toISOString(),
      requestId,
      traceId: String(workflow?.traceId || reqItem?.a2a?.traceId || '').trim(),
      workflowTraceId: String(workflow?.traceId || reqItem?.a2a?.traceId || '').trim(),
      jobId: String(jobAudit?.jobId || '').trim(),
      state: String(jobAudit?.state || normalizeExecutionState(workflow?.state || reqItem?.status || '', 'pending')).trim(),
      action,
      capability: String(jobAudit?.capability || action || '').trim(),
      flow,
      requester: String(jobAudit?.requester || reqItem?.payer || workflow?.payer || '').trim(),
      executor: String(jobAudit?.executor || '').trim(),
      validator: String(jobAudit?.validator || '').trim(),
      executorStakeAmount: String(jobAudit?.executorStakeAmount || '').trim(),
      inputHash: String(jobAudit?.inputHash || '').trim(),
      resultHash: String(jobAudit?.resultHash || '').trim(),
      approved: typeof jobAudit?.approved === 'boolean' ? jobAudit.approved : null,
      approvalState: String(jobAudit?.approvalState || '').trim(),
      approvalRequestedAt: Number(jobAudit?.approvalRequestedAt || 0),
      approvalDecidedAt: Number(jobAudit?.approvalDecidedAt || 0),
      approvalDecidedBy: String(jobAudit?.approvalDecidedBy || '').trim(),
      approvalReasonCode: String(jobAudit?.approvalReasonCode || '').trim(),
      approvalPolicy:
        jobAudit?.approvalPolicy && typeof jobAudit.approvalPolicy === 'object' ? jobAudit.approvalPolicy : {},
      authorizationId: String(authorityEnvelope?.authorityId || jobAudit?.authorizationId || '').trim(),
      authorityId: String(authorityEnvelope?.authorityId || '').trim(),
      intentId: String(authorityEnvelope?.intentId || '').trim(),
      policySnapshotHash: String(authorityEnvelope?.policySnapshotHash || '').trim(),
      authorizedBy: String(jobAudit?.authorizedBy || '').trim(),
      authorizationMode: String(jobAudit?.authorizationMode || '').trim(),
      authorizationPayloadHash: String(jobAudit?.authorizationPayloadHash || '').trim(),
      authorizationExpiresAt: Number(jobAudit?.authorizationExpiresAt || 0),
      allowedCapabilities: Array.isArray(jobAudit?.allowedCapabilities) ? jobAudit.allowedCapabilities : [],
      deadline: jobAudit?.deadline || null,
      contractPrimitives: jobAudit?.contractPrimitives || null,
      deliveryStandard: jobAudit?.deliveryStandard || null,
      escrowAddress: String(jobAudit?.escrowAddress || '').trim(),
      tokenAddress: String(jobAudit?.tokenAddress || reqItem?.tokenAddress || '').trim(),
      amount: String(jobAudit?.amount || reqItem?.amount || '').trim(),
      createAnchorTxHash: String(jobAudit?.createAnchorTxHash || '').trim(),
      fundingAnchorTxHash: String(jobAudit?.fundingAnchorTxHash || '').trim(),
      acceptAnchorTxHash: String(jobAudit?.acceptAnchorTxHash || '').trim(),
      submitAnchorTxHash: String(jobAudit?.submitAnchorTxHash || '').trim(),
      outcomeAnchorTxHash: String(jobAudit?.outcomeAnchorTxHash || '').trim(),
      escrowFundTxHash: String(jobAudit?.escrowFundTxHash || '').trim(),
      escrowAcceptTxHash: String(jobAudit?.escrowAcceptTxHash || '').trim(),
      escrowSubmitTxHash: String(jobAudit?.escrowSubmitTxHash || '').trim(),
      escrowValidateTxHash: String(jobAudit?.escrowValidateTxHash || '').trim(),
      receiptRef: String(jobAudit?.receiptRef || '').trim(),
      evidenceRef: String(jobAudit?.evidenceRef || '').trim(),
      identity: {
        agentId: reqItem?.identity?.agentId || '',
        registry: reqItem?.identity?.registry || '',
        wallet: reqItem?.identity?.agentWallet || ''
      },
      payment: {
        amount: String(reqItem?.amount || '').trim(),
        tokenAddress: String(reqItem?.tokenAddress || '').trim(),
        payer: String(reqItem?.payer || workflow?.payer || '').trim(),
        payee: String(reqItem?.recipient || '').trim(),
        txHash,
        userOpHash: String(workflow?.userOpHash || '').trim(),
        settledAt: Number(reqItem?.paidAt || 0) > 0 ? new Date(Number(reqItem.paidAt)).toISOString() : ''
      },
      onchainConfirmation: {
        txHash,
        block,
        status: onchainStatus,
        explorer,
        mode: reqItem?.proofVerification?.mode || 'onchain_transfer_log',
        verifiedAt:
          Number(reqItem?.proofVerification?.verifiedAt || 0) > 0
            ? new Date(Number(reqItem.proofVerification.verifiedAt)).toISOString()
            : ''
      },
      job: jobAudit,
      authorization: authorityEnvelope
        ? {
            authorityId: authorityEnvelope.authorityId,
            intentId: authorityEnvelope.intentId,
            policySnapshotHash: authorityEnvelope.policySnapshotHash,
            policySnapshot: authorityEnvelope.policySnapshot,
            authoritySummary: authorityEnvelope.authoritySummary,
            validationDecision: authorityEnvelope.validationDecision
          }
        : jobAudit
          ? {
              authorizationId: jobAudit.authorizationId,
              authorizedBy: jobAudit.authorizedBy,
              authorizedAt: jobAudit.authorizedAt,
              authorizationMode: jobAudit.authorizationMode,
              authorizationPayloadHash: jobAudit.authorizationPayloadHash,
              authorizationExpiresAt: jobAudit.authorizationExpiresAt,
              authorizationAudience: jobAudit.authorizationAudience,
              allowedCapabilities: jobAudit.allowedCapabilities
            }
          : null,
      humanApproval: jobAudit
        ? {
            approvalState: jobAudit.approvalState,
            approvalRequestedAt: jobAudit.approvalRequestedAt,
            approvalDecidedAt: jobAudit.approvalDecidedAt,
            approvalDecidedBy: jobAudit.approvalDecidedBy,
            approvalReasonCode: jobAudit.approvalReasonCode,
            approvalDecisionNote: jobAudit.approvalDecisionNote
          }
        : null,
      apiResult: {
        summary: String(resultPayload?.summary || '').trim(),
        payload: resultPayload,
        responseHash,
        responseSignature: signatureBundle.signature,
        signer: signatureBundle.signer,
        signatureScheme: signatureBundle.scheme,
        signatureAvailable: signatureBundle.available
      }
    };

    const shouldDownload = /^(1|true|yes|download)$/i.test(String(req.query.download || '').trim());
    if (shouldDownload) {
      const fileName = `kiteclaw_receipt_${requestId}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename=\"${fileName}\"`);
    }
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      receipt: receiptPayload
    });
  });

  app.get('/api/receipt/:requestId/excerpt', requireRole('viewer'), async (req, res) => {
    const requestId = String(req.params.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'requestId_required' });
    }

    const requests = readX402Requests();
    const reqIndex = requests.findIndex((item) => String(item?.requestId || '').trim() === requestId);
    if (reqIndex < 0) {
      return res.status(404).json({ ok: false, error: 'request_not_found', requestId });
    }

    const reqItem = requests[reqIndex];
    if (!['x-reader-feed', 'info-analysis-feed'].includes(String(reqItem?.action || '').trim().toLowerCase())) {
      return res.status(400).json({
        ok: false,
        error: 'excerpt_not_supported',
        reason: 'only info-analysis-feed supports excerpt retrieval'
      });
    }

    const state = String(reqItem?.status || '').trim().toLowerCase();
    const isUnlocked = state === 'paid' || state === 'unlocked';
    if (!isUnlocked) {
      return res.status(409).json({
        ok: false,
        error: 'request_not_unlocked',
        reason: `request state is ${state || 'pending'}`
      });
    }

    const maxChars = parseExcerptMaxChars(req.query.maxChars, 8000);
    const forceRefresh = /^(1|true|yes|refresh)$/i.test(String(req.query.refresh || '').trim());
    const workflowByRequestId = buildLatestWorkflowByRequestId(readWorkflows());
    const workflow = workflowByRequestId.get(requestId) || null;
    const workflowReader =
      workflow?.result?.reader && typeof workflow.result.reader === 'object'
        ? workflow.result.reader
        : null;
    const storedReader =
      reqItem?.result?.reader && typeof reqItem.result.reader === 'object'
        ? reqItem.result.reader
        : workflowReader;
    const storedExcerpt = String(storedReader?.excerpt || '').trim();
    const shouldRefresh = forceRefresh || !storedExcerpt || storedExcerpt.length < maxChars;

    let reader = storedReader;
    let source = 'stored';
    if (shouldRefresh) {
      try {
        const normalizedTask = normalizeXReaderParams({
          url: reqItem?.actionParams?.url || storedReader?.url || '',
          topic:
            reqItem?.actionParams?.topic ||
            reqItem?.actionParams?.query ||
            reqItem?.actionParams?.keyword ||
            storedReader?.topic ||
            '',
          mode: reqItem?.actionParams?.mode || storedReader?.mode || 'auto',
          maxChars
        });
        reader = await fetchXReaderDigest(normalizedTask);
        source = 'refreshed';
        reqItem.actionParams = {
          ...(reqItem.actionParams || {}),
          ...normalizedTask
        };
        reqItem.result = {
          ...(reqItem.result || {}),
          summary: String(reqItem?.result?.summary || `x-reader digest unlocked by x402 payment: ${reader.title || reader.url}`).trim(),
          reader
        };
        requests[reqIndex] = reqItem;
        writeX402Requests(requests);
      } catch (error) {
        return res.status(502).json({
          ok: false,
          error: 'x_reader_fetch_failed',
          reason: error?.message || 'x_reader_fetch_failed'
        });
      }
    }

    const excerpt = String(reader?.excerpt || '').trim();
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      requestId,
      excerpt: {
        provider: String(reader?.provider || 'x-reader').trim() || 'x-reader',
        url: String(reader?.url || reqItem?.actionParams?.url || '').trim(),
        title: String(reader?.title || '').trim(),
        mode: String(reader?.mode || reqItem?.actionParams?.mode || 'auto').trim(),
        contentLength: Number(reader?.contentLength || excerpt.length || 0),
        maxCharsRequested: maxChars,
        capped: excerpt.length >= maxChars,
        fetchedAt: String(reader?.fetchedAt || '').trim(),
        source,
        excerpt
      }
    });
  });
}
