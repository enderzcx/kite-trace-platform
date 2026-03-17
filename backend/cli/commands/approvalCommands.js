export function createApprovalCommandHandlers({
  parseApprovalListArgs,
  parseApprovalShowArgs,
  parseApprovalDecisionArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  resolveAdminTransportApiKey,
  createEnvelope,
  ensureReference
}) {
  async function handleApprovalList(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseApprovalListArgs(commandArgs);
    const adminKey = String(resolveAdminTransportApiKey(runtime) || '').trim();
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/approvals', {
        approvalKind: options.approvalKind,
        state: options.state,
        owner: options.owner,
        limit: options.limit || '20'
      }),
      omitRuntimeApiKey: true,
      headers: adminKey ? { 'x-admin-key': adminKey } : {}
    });
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'approval', action: 'list', display: 'ktrace approval list' },
      runtime,
      data: {
        total: Number(payload?.total || items.length || 0),
        meta: payload?.meta || null,
        items
      },
      message: `Loaded ${items.length} approval request(s).`
    });
  }

  async function handleApprovalShow(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const approvalId = ensureReference(commandArgs, 'approval-id');
    const options = parseApprovalShowArgs(commandArgs.slice(1));
    const payload = await requestJson(runtime, {
      pathname: buildQueryPath(`/api/approvals/${encodeURIComponent(approvalId)}`, {
        token: options.token
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    const approval = payload?.approval || payload?.approvalRequest || null;
    const nextStep =
      approval && approval.approvalKind === 'job' && approval.approvalState === 'pending'
        ? {
            action: 'approve_or_reject',
            expiresAt: Number(approval?.expiresAt || 0),
            approvalUrl: String(approval?.approvalUrl || '').trim(),
            policySnapshot:
              approval?.policySnapshot && typeof approval.policySnapshot === 'object' ? approval.policySnapshot : {},
            note: 'Approve or reject this job approval before expiry to unblock or terminate funding.'
          }
        : null;
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'approval', action: 'show', display: 'ktrace approval show' },
      runtime,
      data: {
        approval,
        ...(nextStep ? { nextStep } : {})
      },
      message: `Approval loaded for ${approvalId}.`
    });
  }

  async function handleApprovalApprove(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const approvalId = ensureReference(commandArgs, 'approval-id');
    const options = parseApprovalDecisionArgs(commandArgs.slice(1));
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: buildQueryPath(`/api/approvals/${encodeURIComponent(approvalId)}/approve`, {
        token: options.token
      }),
      apiKey: resolveAgentTransportApiKey(runtime),
      body: {
        ...(options.note ? { note: options.note } : {}),
        ...(options.decidedBy ? { decidedBy: options.decidedBy } : {})
      }
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'approval', action: 'approve', display: 'ktrace approval approve' },
      runtime,
      data: {
        approval: payload?.approval || payload?.approvalRequest || null,
        resume: payload?.resume || null
      },
      message: `Approval ${approvalId} completed.`
    });
  }

  async function handleApprovalReject(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const approvalId = ensureReference(commandArgs, 'approval-id');
    const options = parseApprovalDecisionArgs(commandArgs.slice(1));
    const payload = await requestJson(runtime, {
      method: 'POST',
      pathname: buildQueryPath(`/api/approvals/${encodeURIComponent(approvalId)}/reject`, {
        token: options.token
      }),
      apiKey: resolveAgentTransportApiKey(runtime),
      body: {
        ...(options.note ? { note: options.note, reason: options.note } : {}),
        ...(options.decidedBy ? { decidedBy: options.decidedBy } : {})
      }
    });
    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'approval', action: 'reject', display: 'ktrace approval reject' },
      runtime,
      data: {
        approval: payload?.approval || payload?.approvalRequest || null
      },
      message: `Approval ${approvalId} rejected.`
    });
  }

  return {
    handleApprovalList,
    handleApprovalShow,
    handleApprovalApprove,
    handleApprovalReject
  };
}
