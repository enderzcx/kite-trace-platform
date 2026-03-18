export function createJobApprovalHelpers(deps = {}, shared = {}) {
  const {
    crypto,
    KTRACE_JOB_APPROVAL_THRESHOLD,
    KTRACE_JOB_APPROVAL_TTL_MS,
    KTRACE_APPROVAL_RULES,
    PORT,
    readSessionApprovalRequests,
    writeSessionApprovalRequests
  } =
    deps;
  const { normalizeAddress, normalizePositiveNumber, normalizeText, pickAddress } = shared;

  function normalizeRuleSelector(value = '') {
    const normalized = normalizeText(value).toLowerCase();
    return normalized || '*';
  }

  function buildMatchedRule(job = {}, fallbackThreshold = 0) {
    const provider = normalizeRuleSelector(job?.provider);
    const capability = normalizeRuleSelector(job?.capability);
    const rules = Array.isArray(KTRACE_APPROVAL_RULES) ? KTRACE_APPROVAL_RULES : [];

    const exactPair = rules.find(
      (item) =>
        normalizeRuleSelector(item?.provider) === provider &&
        normalizeRuleSelector(item?.capability) === capability
    );
    if (exactPair) {
      return {
        provider,
        capability,
        threshold: normalizePositiveNumber(exactPair.threshold, fallbackThreshold),
        source: 'provider_capability'
      };
    }

    const exactCapability = rules.find(
      (item) =>
        normalizeRuleSelector(item?.provider) === '*' &&
        normalizeRuleSelector(item?.capability) === capability
    );
    if (exactCapability) {
      return {
        provider: '*',
        capability,
        threshold: normalizePositiveNumber(exactCapability.threshold, fallbackThreshold),
        source: 'capability'
      };
    }

    const exactProvider = rules.find(
      (item) =>
        normalizeRuleSelector(item?.provider) === provider &&
        normalizeRuleSelector(item?.capability) === '*'
    );
    if (exactProvider) {
      return {
        provider,
        capability: '*',
        threshold: normalizePositiveNumber(exactProvider.threshold, fallbackThreshold),
        source: 'provider'
      };
    }

    const wildcard = rules.find(
      (item) =>
        normalizeRuleSelector(item?.provider) === '*' &&
        normalizeRuleSelector(item?.capability) === '*'
    );
    if (wildcard) {
      return {
        provider: '*',
        capability: '*',
        threshold: normalizePositiveNumber(wildcard.threshold, fallbackThreshold),
        source: 'wildcard'
      };
    }

    return {
      provider: provider || '*',
      capability: capability || '*',
      threshold: fallbackThreshold,
      source: 'default_threshold'
    };
  }

  function normalizeApprovalRequestRows(rows = []) {
    const items = Array.isArray(rows) ? rows.filter((item) => item && typeof item === 'object') : [];
    return items
      .filter((item) => normalizeText(item?.approvalRequestId || item?.approvalId))
      .sort((left, right) => Number(right.updatedAt || right.createdAt || 0) - Number(left.updatedAt || left.createdAt || 0))
      .slice(0, 2000);
  }

  function listApprovalRequests() {
    return normalizeApprovalRequestRows(readSessionApprovalRequests?.() || []);
  }

  function writeApprovalRequestRows(rows = []) {
    writeSessionApprovalRequests?.(normalizeApprovalRequestRows(rows));
    return listApprovalRequests();
  }

  function findApprovalRequest(approvalRequestId = '') {
    const normalizedId = normalizeText(approvalRequestId);
    if (!normalizedId) return null;
    return (
      listApprovalRequests().find(
        (item) => normalizeText(item?.approvalRequestId || item?.approvalId) === normalizedId
      ) || null
    );
  }

  function appendApprovalRequest(record = {}) {
    const rows = listApprovalRequests();
    rows.unshift(record);
    return writeApprovalRequestRows(rows)[0] || null;
  }

  function updateApprovalRequest(approvalRequestId = '', patch = {}) {
    const normalizedId = normalizeText(approvalRequestId);
    const rows = listApprovalRequests().map((item) =>
      normalizeText(item?.approvalRequestId || item?.approvalId) === normalizedId ? { ...item, ...patch } : item
    );
    writeApprovalRequestRows(rows);
    return findApprovalRequest(normalizedId);
  }

  function buildApprovalRequestToken() {
    return `sat_${crypto.randomBytes(18).toString('hex')}`;
  }

  function resolveApprovalFrontendBaseUrl(audience = '') {
    const explicit = String(
      process.env.KTRACE_APPROVAL_FRONTEND_URL ||
        process.env.FRONTEND_PUBLIC_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.AGENT_NETWORK_PUBLIC_URL ||
        ''
    ).trim();
    if (explicit) return explicit.replace(/\/+$/, '');
    const fallback = String(audience || '').trim() || `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`;
    try {
      const url = new URL(fallback);
      if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.port && url.port !== '3000') {
        url.port = '3000';
      }
      return url.toString().replace(/\/+$/, '');
    } catch {
      return fallback.replace(/\/+$/, '');
    }
  }

  function buildApprovalRequestUrl(approvalRequestId = '', approvalToken = '', audience = '') {
    const frontendBaseUrl = resolveApprovalFrontendBaseUrl(audience);
    const backendBaseUrl = String(audience || '').trim() || `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`;
    try {
      const url = new URL(
        `/approval/${encodeURIComponent(normalizeText(approvalRequestId))}`,
        `${frontendBaseUrl.replace(/\/+$/, '')}/`
      );
      if (approvalToken) url.searchParams.set('token', normalizeText(approvalToken));
      if (backendBaseUrl) url.searchParams.set('backend', backendBaseUrl.replace(/\/+$/, ''));
      return url.toString();
    } catch {
      const query = new URLSearchParams();
      if (approvalToken) query.set('token', normalizeText(approvalToken));
      if (backendBaseUrl) query.set('backend', backendBaseUrl.replace(/\/+$/, ''));
      const suffix = query.toString();
      return `/approval/${encodeURIComponent(normalizeText(approvalRequestId))}${suffix ? `?${suffix}` : ''}`;
    }
  }

  function buildJobApprovalEnvelope(record = {}) {
    const approvalId = normalizeText(record?.approvalRequestId || record?.approvalId);
    const approvalToken = normalizeText(record?.approvalToken);
    const audience = normalizeText(record?.authorizationAudience || record?.audience || '');
    return {
      approvalId,
      approvalRequestId: approvalId,
      approvalKind: 'job',
      approvalState: normalizeText(record?.status).toLowerCase() || 'pending',
      approvalToken,
      approvalUrl: buildApprovalRequestUrl(approvalId, approvalToken, audience),
      createdAt: Number(record?.createdAt || 0),
      updatedAt: Number(record?.updatedAt || 0),
      expiresAt: Number(record?.expiresAt || 0),
      decidedAt: Number(record?.decidedAt || 0),
      decidedBy: normalizeText(record?.decidedBy),
      decisionNote: normalizeText(record?.decisionNote),
      reasonCode: normalizeText(record?.reasonCode || 'amount_threshold'),
      requestedByAaWallet: normalizeText(record?.requestedByAaWallet),
      requestedByOwnerEoa: normalizeText(record?.requestedByOwnerEoa),
      jobId: normalizeText(record?.jobId),
      traceId: normalizeText(record?.traceId),
      policySnapshot: record?.policySnapshot && typeof record.policySnapshot === 'object' ? record.policySnapshot : {},
      jobSnapshot: record?.jobSnapshot && typeof record.jobSnapshot === 'object' ? record.jobSnapshot : {},
      resumeStatus: normalizeText(record?.resumeStatus),
      resumeError: normalizeText(record?.resumeError)
    };
  }

  function buildApprovalPolicySnapshot(job = {}, overrides = {}) {
    const fallbackThreshold = normalizePositiveNumber(KTRACE_JOB_APPROVAL_THRESHOLD, 0);
    const matchedRule =
      overrides?.matchedRule && typeof overrides.matchedRule === 'object'
        ? {
            provider: normalizeText(overrides.matchedRule.provider || '*') || '*',
            capability: normalizeText(overrides.matchedRule.capability || '*') || '*',
            threshold: normalizePositiveNumber(overrides.matchedRule.threshold, fallbackThreshold),
            source: normalizeText(overrides.matchedRule.source || 'override') || 'override'
          }
        : buildMatchedRule(job, fallbackThreshold);
    const threshold = normalizePositiveNumber(
      overrides?.threshold,
      normalizePositiveNumber(matchedRule.threshold, fallbackThreshold)
    );
    const ttlMs = Math.max(
      60_000,
      Number(overrides?.ttlMs || overrides?.approvalTtlMs || KTRACE_JOB_APPROVAL_TTL_MS || 0) || 24 * 60 * 60 * 1000
    );
    const amount = normalizePositiveNumber(
      overrides?.amount,
      normalizePositiveNumber(job?.escrowAmount, normalizePositiveNumber(job?.budget, 0))
    );
    const currency = normalizeText(overrides?.currency || job?.escrowTokenAddress || process.env.KITE_SETTLEMENT_TOKEN || '');
    return {
      threshold,
      ttlMs,
      amount,
      currency,
      matchedRule,
      exceeded: threshold > 0 && amount > threshold,
      reasonCode: threshold > 0 && amount > threshold ? 'amount_threshold' : ''
    };
  }

  function buildJobFundResumeToken({
    approvalId = '',
    createdAt = 0,
    job = {},
    payerAaWallet = '',
    sessionAuthorizationRef = ''
  } = {}) {
    return {
      version: 'ktrace-job-fund-resume-v1',
      operation: 'job_fund',
      approvalId: normalizeText(approvalId),
      jobId: normalizeText(job?.jobId),
      traceId: normalizeText(job?.traceId),
      createdAt: Number(createdAt || 0),
      fundRequest: {
        budget: normalizeText(job?.budget),
        escrowAmount: normalizeText(job?.escrowAmount || job?.budget),
        tokenAddress: normalizeText(job?.escrowTokenAddress || process.env.KITE_SETTLEMENT_TOKEN || ''),
        payerAaWallet: pickAddress(payerAaWallet, job?.payer),
        requester: pickAddress(job?.payer, deps.ERC8183_REQUESTER_OWNER_ADDRESS, deps.ERC8183_REQUESTER_AA_ADDRESS),
        executor: pickAddress(job?.executor, deps.ERC8183_EXECUTOR_OWNER_ADDRESS, deps.ERC8183_EXECUTOR_AA_ADDRESS),
        validator: pickAddress(job?.validator, deps.ERC8183_VALIDATOR_OWNER_ADDRESS, deps.ERC8183_VALIDATOR_AA_ADDRESS)
      },
      sessionAuthorizationRef: normalizeText(sessionAuthorizationRef || job?.authorizationId)
    };
  }

  function findActiveJobApproval(jobId = '') {
    const normalizedJobId = normalizeText(jobId);
    if (!normalizedJobId) return null;
    const now = Date.now();
    return (
      listApprovalRequests().find((item) => {
        if (normalizeText(item?.approvalKind || 'session') !== 'job') return false;
        if (normalizeText(item?.jobId) !== normalizedJobId) return false;
        const status = normalizeText(item?.status).toLowerCase();
        if (!['pending', 'approved', 'completed'].includes(status)) return false;
        const expiresAt = Number(item?.expiresAt || 0);
        if (status === 'pending' && expiresAt > 0 && expiresAt <= now) return false;
        return true;
      }) || null
    );
  }

  return {
    appendApprovalRequest,
    buildApprovalPolicySnapshot,
    buildApprovalRequestToken,
    buildJobApprovalEnvelope,
    buildJobFundResumeToken,
    findActiveJobApproval,
    findApprovalRequest,
    listApprovalRequests,
    normalizeApprovalRequestRows,
    resolveApprovalFrontendBaseUrl,
    updateApprovalRequest,
    writeApprovalRequestRows
  };
}
