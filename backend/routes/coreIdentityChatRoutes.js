export function registerCoreIdentityChatRoutes(app, deps) {
  const {
    BACKEND_RPC_URL,
    MERCHANT_ADDRESS,
    POLICY_DAILY_LIMIT_DEFAULT,
    POLICY_MAX_PER_TX_DEFAULT,
    ROUTER_WALLET_KEY_NORMALIZED,
    SETTLEMENT_TOKEN,
    backendSigner,
    createTraceId,
    crypto,
    ensureAAAccountDeployment,
    ERC8004_AGENT_ID,
    ERC8004_IDENTITY_REGISTRY,
    ethers,
    getInternalAgentApiKey,
    IDENTITY_CHALLENGE_MAX_ROWS,
    IDENTITY_CHALLENGE_TTL_MS,
    IDENTITY_VERIFY_MODE,
    KTRACE_ADMIN_KEY,
    KTRACE_JOB_APPROVAL_THRESHOLD,
    KTRACE_JOB_APPROVAL_TTL_MS,
    KITE_AGENT1_ID,
    KITE_AGENT2_ID,
    KITE_REQUIRE_AA_V2,
    AA_V2_VERSION_TAG,
    maskSecret,
    normalizeAddress,
    normalizeReactiveParams,
    llmAdapter,
    PORT,
    readJobs,
    readSessionAuthorizations,
    readSessionApprovalRequests,
    XMTP_ROUTER_DERIVED_ADDRESS,
    readIdentityChallenges,
    readRecords,
    readSessionRuntime,
    resolveSessionOwnerPrivateKey,
    resolveSessionRuntime,
    readWorkflows,
    readX402Requests,
    requireRole,
    resolveRoleByApiKey,
    sessionPayConfigSnapshot,
    sessionPayMetrics,
    sessionRuntimePath,
    writeIdentityChallenges,
    writeJsonObject,
    writeRecords,
    writeSessionApprovalRequests,
    writeSessionAuthorizations,
    writeSessionRuntime,
    upsertJobRecord,
  } = deps;

  function getBackendSignerState() {
    return {
      enabled: Boolean(backendSigner),
      address: backendSigner?.address || '',
      custody: 'backend_env'
    };
  }

  const AA_SESSION_ABI = [
    'function addSupportedToken(address token) external',
    'function createSession(bytes32 sessionId, address agent, tuple(uint256 timeWindow,uint160 budget,uint96 initialWindowStartTime,bytes32[] targetProviders)[] rules) external',
    'function sessionExists(bytes32 sessionId) view returns (bool)',
    'function getSessionAgent(bytes32 sessionId) view returns (address)',
    'function owner() view returns (address)',
    'function version() view returns (string)'
  ];

  function normalizeSessionGrantText(value = '', fallback = '') {
    const text = String(value ?? '').trim();
    return text || fallback;
  }

  function normalizeSessionGrantAddress(value = '') {
    const text = normalizeSessionGrantText(value);
    if (!text || !ethers.isAddress(text)) return '';
    return ethers.getAddress(text);
  }

  function normalizeSessionGrantAmount(value, fallback = '') {
    const text = normalizeSessionGrantText(value, fallback);
    const numeric = Number(text);
    if (!text || !Number.isFinite(numeric) || numeric <= 0) return '';
    return text;
  }

  function normalizeSessionGrantTimestamp(value, fallback = 0) {
    if (value === null || value === undefined || value === '') {
      return Number(fallback || 0);
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
    const text = normalizeSessionGrantText(value);
    if (!text) return Number(fallback || 0);
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round(numeric);
    }
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return Number(fallback || 0);
  }

  function normalizeAllowedCapabilities(input = []) {
    const values = Array.isArray(input)
      ? input
      : normalizeSessionGrantText(input)
          .split(',')
          .map((item) => String(item || '').trim())
          .filter(Boolean);
    return Array.from(
      new Set(values.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))
    ).sort();
  }

  function normalizeSessionGrantPayload(input = {}, fallback = {}) {
    const issuedAt = normalizeSessionGrantTimestamp(input.issuedAt, fallback.issuedAt || Date.now());
    const expiresAt = normalizeSessionGrantTimestamp(input.expiresAt, fallback.expiresAt || 0);
    return {
      schema: 'kite-session-grant-v1',
      agentId: normalizeSessionGrantText(input.agentId, fallback.agentId || ''),
      agentWallet: normalizeSessionGrantAddress(input.agentWallet || fallback.agentWallet || ''),
      identityRegistry: normalizeSessionGrantAddress(
        input.identityRegistry || fallback.identityRegistry || ''
      ),
      chainId: normalizeSessionGrantText(input.chainId, fallback.chainId || ''),
      payerAaWallet: normalizeSessionGrantAddress(input.payerAaWallet || fallback.payerAaWallet || ''),
      tokenAddress: normalizeSessionGrantAddress(input.tokenAddress || fallback.tokenAddress || ''),
      gatewayRecipient: normalizeSessionGrantAddress(
        input.gatewayRecipient || fallback.gatewayRecipient || ''
      ),
      audience: normalizeSessionGrantText(input.audience, fallback.audience || ''),
      singleLimit: normalizeSessionGrantAmount(input.singleLimit, fallback.singleLimit || ''),
      dailyLimit: normalizeSessionGrantAmount(input.dailyLimit, fallback.dailyLimit || ''),
      allowedCapabilities: normalizeAllowedCapabilities(
        input.allowedCapabilities ?? fallback.allowedCapabilities ?? []
      ),
      nonce: normalizeSessionGrantText(input.nonce, fallback.nonce || ''),
      issuedAt,
      expiresAt
    };
  }

  function buildSessionGrantMessage(payloadInput = {}) {
    const payload = normalizeSessionGrantPayload(payloadInput);
    return [
      'KTRACE Session Authorization',
      `schema: ${payload.schema}`,
      `agentId: ${payload.agentId}`,
      `agentWallet: ${payload.agentWallet}`,
      `identityRegistry: ${payload.identityRegistry}`,
      `chainId: ${payload.chainId}`,
      `payerAaWallet: ${payload.payerAaWallet}`,
      `tokenAddress: ${payload.tokenAddress}`,
      `gatewayRecipient: ${payload.gatewayRecipient}`,
      `singleLimit: ${payload.singleLimit}`,
      `dailyLimit: ${payload.dailyLimit}`,
      `allowedCapabilities: ${payload.allowedCapabilities.join(',')}`,
      `audience: ${payload.audience}`,
      `nonce: ${payload.nonce}`,
      `issuedAt: ${new Date(payload.issuedAt || 0).toISOString()}`,
      `expiresAt: ${new Date(payload.expiresAt || 0).toISOString()}`
    ].join('\n');
  }

  function createSessionAuthorizationMessage({ payload = {}, userEoa = '' } = {}) {
    return [
      buildSessionGrantMessage(payload),
      `userEoa: ${normalizeSessionGrantAddress(userEoa || '')}`
    ].join('\n');
  }

  function hashSessionGrantPayload(payloadInput = {}) {
    const payload = normalizeSessionGrantPayload(payloadInput);
    return ethers.keccak256(ethers.toUtf8Bytes(buildSessionGrantMessage(payload)));
  }

  function buildSessionRuntimePayload(runtime = {}) {
    return {
      ...runtime,
      sessionPrivateKey: undefined,
      sessionPrivateKeyMasked: maskSecret(runtime.sessionPrivateKey),
      hasSessionPrivateKey: Boolean(runtime.sessionPrivateKey),
      authorizationSignature: undefined,
      authorizationSignatureMasked: maskSecret(runtime.authorizationSignature),
      hasAuthorizationSignature: Boolean(runtime.authorizationSignature)
    };
  }

  function normalizeSessionAuthorizationRows(rows = []) {
    const items = Array.isArray(rows) ? rows.filter((item) => item && typeof item === 'object') : [];
    return items
      .filter((item) => String(item.authorizationId || '').trim())
      .sort((left, right) => Number(right.authorizedAt || 0) - Number(left.authorizedAt || 0))
      .slice(0, 1000);
  }

  function appendSessionAuthorizationRecord(record = {}) {
    const rows = normalizeSessionAuthorizationRows(readSessionAuthorizations());
    rows.unshift(record);
    const nextRows = normalizeSessionAuthorizationRows(rows);
    writeSessionAuthorizations(nextRows);
    return nextRows[0] || null;
  }

  function normalizeSessionApprovalRequestRows(rows = []) {
    const items = Array.isArray(rows) ? rows.filter((item) => item && typeof item === 'object') : [];
    return items
      .filter((item) => String(item.approvalRequestId || '').trim())
      .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))
      .slice(0, 1000);
  }

  function listSessionApprovalRequests() {
    return normalizeSessionApprovalRequestRows(readSessionApprovalRequests());
  }

  function findSessionApprovalRequest(approvalRequestId = '') {
    const normalizedId = String(approvalRequestId || '').trim();
    if (!normalizedId) return null;
    return listSessionApprovalRequests().find(
      (item) => String(item.approvalRequestId || '').trim() === normalizedId
    ) || null;
  }

  function writeSessionApprovalRequestRows(rows = []) {
    writeSessionApprovalRequests(normalizeSessionApprovalRequestRows(rows));
    return listSessionApprovalRequests();
  }

  function appendSessionApprovalRequest(record = {}) {
    const rows = listSessionApprovalRequests();
    rows.unshift(record);
    return writeSessionApprovalRequestRows(rows)[0] || null;
  }

  function updateSessionApprovalRequest(approvalRequestId = '', patch = {}) {
    const normalizedId = String(approvalRequestId || '').trim();
    const rows = listSessionApprovalRequests();
    const nextRows = rows.map((item) =>
      String(item.approvalRequestId || '').trim() === normalizedId ? { ...item, ...patch } : item
    );
    writeSessionApprovalRequests(nextRows);
    return findSessionApprovalRequest(normalizedId);
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
    const backendBaseUrl =
      String(audience || '').trim() || `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`;
    try {
      const url = new URL(
        `/approval/${encodeURIComponent(String(approvalRequestId || '').trim())}`,
        `${frontendBaseUrl.replace(/\/+$/, '')}/`
      );
      if (approvalToken) {
        url.searchParams.set('token', approvalToken);
      }
      if (backendBaseUrl) {
        url.searchParams.set('backend', backendBaseUrl.replace(/\/+$/, ''));
      }
      return url.toString();
    } catch {
      const query = new URLSearchParams();
      if (approvalToken) query.set('token', String(approvalToken || '').trim());
      if (backendBaseUrl) query.set('backend', backendBaseUrl.replace(/\/+$/, ''));
      const suffix = query.toString();
      return `/approval/${encodeURIComponent(String(approvalRequestId || '').trim())}${suffix ? `?${suffix}` : ''}`;
    }
  }

  function buildSessionApprovalRequestPayload(record = {}, { includeToken = false } = {}) {
    const payload =
      record?.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? record.payload
        : {};
    const authorization =
      record?.authorization && typeof record.authorization === 'object' && !Array.isArray(record.authorization)
        ? record.authorization
        : null;
    return {
      approvalId: String(record?.approvalRequestId || '').trim(),
      approvalRequestId: String(record?.approvalRequestId || '').trim(),
      approvalKind: 'session',
      approvalState: String(record?.status || '').trim().toLowerCase() || 'pending',
      state: String(record?.status || '').trim().toLowerCase() || 'pending',
      status: String(record?.status || '').trim(),
      executionMode: String(record?.executionMode || '').trim(),
      userEoa: normalizeSessionGrantAddress(record?.userEoa || ''),
      sessionAddress: normalizeSessionGrantAddress(record?.sessionAddress || ''),
      createdAt: Number(record?.createdAt || 0),
      updatedAt: Number(record?.updatedAt || 0),
      completedAt: Number(record?.completedAt || 0),
      approvalUrl: buildApprovalRequestUrl(
        record?.approvalRequestId,
        includeToken ? record?.approvalToken : '',
        payload?.audience || ''
      ),
      qrText: buildApprovalRequestUrl(
        record?.approvalRequestId,
        includeToken ? record?.approvalToken : '',
        payload?.audience || ''
      ),
      payload,
      authorizationId: String(record?.authorizationId || authorization?.authorizationId || '').trim(),
      authorization,
      runtime: record?.runtime && typeof record.runtime === 'object' && !Array.isArray(record.runtime)
        ? buildSessionRuntimePayload(record.runtime)
        : null,
      session:
        record?.runtime && typeof record.runtime === 'object' && !Array.isArray(record.runtime)
          ? {
              address: String(record.runtime.sessionAddress || '').trim(),
              id: String(record.runtime.sessionId || '').trim(),
              txHash: String(record.runtime.sessionTxHash || '').trim(),
              maxPerTx: Number(record.runtime.maxPerTx || 0),
              dailyLimit: Number(record.runtime.dailyLimit || 0),
              gatewayRecipient: String(record.runtime.gatewayRecipient || '').trim(),
              tokenAddress: String(record.runtime.tokenAddress || payload?.tokenAddress || '').trim()
            }
          : null,
      ...(includeToken ? { approvalToken: String(record?.approvalToken || '').trim() } : {})
    };
  }

  function buildUnifiedApprovalPayload(record = {}, { includeToken = false } = {}) {
    if (normalizeApprovalKind(record?.approvalKind) === 'job') {
      return buildJobApprovalPayload(record, { includeToken });
    }
    const legacy = buildSessionApprovalRequestPayload(record, { includeToken });
    const approvalState = String(record?.status || '').trim().toLowerCase() || 'pending';
    return {
      ...legacy,
      approvalId: legacy.approvalRequestId,
      approvalKind: 'session',
      approvalState,
      expiresAt: Number(record?.payload?.expiresAt || 0),
      meta: {
        sessionAuthorization: true
      }
    };
  }

  function clampApprovalListLimit(value, fallback = 20, min = 1, max = 100) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(Math.round(numeric), max));
  }

  function normalizeApprovalKind(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'job' ? 'job' : 'session';
  }

  function getApprovalOwner(record = {}) {
    if (normalizeApprovalKind(record?.approvalKind) === 'job') {
      return normalizeSessionGrantAddress(record?.requestedByOwnerEoa || '');
    }
    return normalizeSessionGrantAddress(record?.userEoa || '');
  }

  function maybeExpireApprovalRecord(record = {}) {
    const approvalId = String(record?.approvalRequestId || record?.approvalId || '').trim();
    const status = String(record?.status || '').trim().toLowerCase();
    const expiresAt = Number(record?.expiresAt || record?.payload?.expiresAt || 0);
    if (!approvalId || status !== 'pending' || !Number.isFinite(expiresAt) || expiresAt <= 0 || expiresAt > Date.now()) {
      return record;
    }
    const expired = updateSessionApprovalRequest(approvalId, {
      status: 'expired',
      updatedAt: Date.now(),
      completedAt: Date.now(),
      resumeStatus:
        normalizeApprovalKind(record?.approvalKind) === 'job'
          ? 'expired'
          : normalizeSessionGrantText(record?.resumeStatus)
    });
    if (normalizeApprovalKind(record?.approvalKind) === 'job') {
      const relatedJob =
        readJobs?.().find((item) => String(item?.jobId || '').trim() === String(record?.jobId || '').trim()) || null;
      if (relatedJob) {
        upsertJobRecord?.({
          ...relatedJob,
          state: 'approval_expired',
          approvalState: 'expired',
          approvalExpiresAt: expiresAt,
          updatedAt: new Date().toISOString(),
          summary: 'Job approval expired before funding.',
          error: 'approval_expired'
        });
      }
    }
    return expired || record;
  }

  function buildJobApprovalPayload(record = {}, { includeToken = false } = {}) {
    const approvalId = String(record?.approvalRequestId || record?.approvalId || '').trim();
    const approvalToken = includeToken ? String(record?.approvalToken || '').trim() : '';
    const audience = String(record?.authorizationAudience || record?.audience || '').trim();
    const jobId = String(record?.jobId || '').trim();
    const traceId = String(record?.traceId || '').trim();
    const auditBase = normalizeSessionGrantText(audience) || `http://127.0.0.1:${PORT}`;
    const policySnapshot =
      record?.policySnapshot && typeof record.policySnapshot === 'object' && !Array.isArray(record.policySnapshot)
        ? record.policySnapshot
        : {};
    const jobSnapshot =
      record?.jobSnapshot && typeof record.jobSnapshot === 'object' && !Array.isArray(record.jobSnapshot)
        ? record.jobSnapshot
        : {};
    return {
      approvalId,
      approvalRequestId: approvalId,
      approvalKind: 'job',
      approvalState: String(record?.status || '').trim().toLowerCase() || 'pending',
      state: String(record?.status || '').trim().toLowerCase() || 'pending',
      status: String(record?.status || '').trim().toLowerCase() || 'pending',
      createdAt: Number(record?.createdAt || 0),
      updatedAt: Number(record?.updatedAt || 0),
      completedAt: Number(record?.completedAt || 0),
      expiresAt: Number(record?.expiresAt || 0),
      approvalUrl: buildApprovalRequestUrl(approvalId, approvalToken, audience),
      qrText: buildApprovalRequestUrl(approvalId, approvalToken, audience),
      jobId,
      traceId,
      reasonCode: String(record?.reasonCode || '').trim(),
      requestedByAaWallet: normalizeSessionGrantAddress(record?.requestedByAaWallet || ''),
      requestedByOwnerEoa: normalizeSessionGrantAddress(record?.requestedByOwnerEoa || ''),
      requestedAction: String(record?.requestedAction || '').trim(),
      decidedAt: Number(record?.decidedAt || 0),
      decidedBy: normalizeSessionGrantAddress(record?.decidedBy || ''),
      decisionNote: String(record?.decisionNote || '').trim(),
      policySnapshot,
      jobSnapshot,
      jobSummary: {
        jobId,
        traceId,
        state: String(jobSnapshot?.state || '').trim(),
        provider: String(jobSnapshot?.provider || '').trim(),
        capability: String(jobSnapshot?.capability || '').trim(),
        payer: String(jobSnapshot?.payer || '').trim(),
        executor: String(jobSnapshot?.executor || '').trim(),
        validator: String(jobSnapshot?.validator || '').trim(),
        budget: String(jobSnapshot?.budget || '').trim(),
        escrowAmount: String(jobSnapshot?.escrowAmount || '').trim()
      },
      reviewSummary: {
        reasonCode: String(record?.reasonCode || '').trim(),
        threshold: Number(policySnapshot?.threshold || 0),
        amount: Number(policySnapshot?.amount || 0),
        currency: String(policySnapshot?.currency || '').trim(),
        exceeded: Boolean(policySnapshot?.exceeded),
        expiresAt: Number(record?.expiresAt || 0),
        requestedByOwnerEoa: normalizeSessionGrantAddress(record?.requestedByOwnerEoa || ''),
        requestedByAaWallet: normalizeSessionGrantAddress(record?.requestedByAaWallet || '')
      },
      authorizationId: String(record?.authorizationId || '').trim(),
      authorization: null,
      runtime: null,
      session: null,
      links: {
        approvalUrl: buildApprovalRequestUrl(approvalId, approvalToken, audience),
        jobAuditUrl: jobId ? `${auditBase}/api/jobs/${encodeURIComponent(jobId)}/audit` : '',
        publicJobAuditUrl: jobId ? `${auditBase}/api/public/jobs/${encodeURIComponent(jobId)}/audit` : '',
        publicJobAuditByTraceUrl: traceId ? `${auditBase}/api/public/jobs/by-trace/${encodeURIComponent(traceId)}/audit` : ''
      },
      meta: {
        sessionAuthorization: false,
        resumeStatus: String(record?.resumeStatus || '').trim(),
        resumeError: String(record?.resumeError || '').trim()
      },
      ...(includeToken ? { approvalToken } : {})
    };
  }

  function filterUnifiedApprovalRows({ state = '', approvalKind = '', owner = '', limit = 20 } = {}) {
    const normalizedState = String(state || '').trim().toLowerCase();
    const normalizedKind = String(approvalKind || '').trim().toLowerCase();
    const normalizedOwner = normalizeSessionGrantAddress(owner || '');
    return listSessionApprovalRequests()
      .map((item) => maybeExpireApprovalRecord(item))
      .filter((item) => {
        const itemKind = normalizeApprovalKind(item?.approvalKind);
        if (normalizedKind && normalizedKind !== itemKind) return false;
        if (normalizedState && String(item?.status || '').trim().toLowerCase() !== normalizedState) return false;
        if (normalizedOwner && getApprovalOwner(item) !== normalizedOwner) return false;
        return true;
      })
      .slice(0, clampApprovalListLimit(limit));
  }

  function buildApprovalListMeta({ state = '', approvalKind = '', owner = '', limit = 20, rows = [] } = {}) {
    const threshold = Number(KTRACE_JOB_APPROVAL_THRESHOLD || process.env.KTRACE_JOB_APPROVAL_THRESHOLD || 0);
    const ttlMs = Math.max(
      60_000,
      Number(KTRACE_JOB_APPROVAL_TTL_MS || process.env.KTRACE_JOB_APPROVAL_TTL_MS || 0) || 24 * 60 * 60 * 1000
    );
    const counts = (Array.isArray(rows) ? rows : []).reduce(
      (acc, item) => {
        const itemState = String(item?.status || '').trim().toLowerCase() || 'pending';
        const itemKind = normalizeApprovalKind(item?.approvalKind);
        acc.byState[itemState] = Number(acc.byState[itemState] || 0) + 1;
        acc.byKind[itemKind] = Number(acc.byKind[itemKind] || 0) + 1;
        return acc;
      },
      { byState: {}, byKind: {} }
    );
    return {
      filters: {
        state: String(state || '').trim().toLowerCase(),
        approvalKind: String(approvalKind || '').trim().toLowerCase(),
        owner: normalizeSessionGrantAddress(owner || ''),
        limit: clampApprovalListLimit(limit)
      },
      approvalPolicyDefaults: {
        threshold,
        ttlMs
      },
      counts
    };
  }

  function extractApprovalApiKey(req = {}) {
    const xApiKey = String(req.headers?.['x-api-key'] || '').trim();
    if (xApiKey) return xApiKey;
    const auth = String(req.headers?.authorization || '').trim();
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
    return '';
  }

  function extractApprovalAdminKey(req = {}) {
    return String(req.headers?.['x-admin-key'] || '').trim();
  }

  function assertApprovalInboxAccess(req = {}) {
    const configuredAdminKey = String(KTRACE_ADMIN_KEY || process.env.KTRACE_ADMIN_KEY || '').trim();
    if (!configuredAdminKey) {
      const error = new Error('Approval inbox auth is not configured on this backend.');
      error.statusCode = 501;
      error.code = 'approval_inbox_auth_not_configured';
      throw error;
    }
    const providedAdminKey = extractApprovalAdminKey(req);
    if (!providedAdminKey || providedAdminKey !== configuredAdminKey) {
      const error = new Error('Approval inbox requires a valid X-Admin-Key header.');
      error.statusCode = 403;
      error.code = 'approval_inbox_forbidden';
      throw error;
    }
  }

  function canAccessApprovalWithApiKey(req = {}, { requireWrite = false } = {}) {
    const role = resolveRoleByApiKey?.(extractApprovalApiKey(req)) || '';
    if (!role) return false;
    if (!requireWrite) return true;
    return role === 'admin' || role === 'agent';
  }

  function getSessionApprovalRecordOrThrow(approvalRequestId = '', approvalToken = '', req = null, { requireWrite = false } = {}) {
    const record = maybeExpireApprovalRecord(findSessionApprovalRequest(approvalRequestId));
    if (!record) {
      const error = new Error('Approval request not found.');
      error.statusCode = 404;
      error.code = 'approval_request_not_found';
      throw error;
    }
    if (approvalToken && approvalToken === String(record.approvalToken || '').trim()) {
      return record;
    }
    if (req && canAccessApprovalWithApiKey(req, { requireWrite })) {
      return record;
    }
    if (!approvalToken || approvalToken !== String(record.approvalToken || '').trim()) {
      const error = new Error('Approval request token is invalid.');
      error.statusCode = 403;
      error.code = 'approval_request_token_invalid';
      throw error;
    }
    return record;
  }

  function buildApprovalReadResponse(record = {}, { includeToken = true } = {}) {
    const approval = buildUnifiedApprovalPayload(record, { includeToken });
    return {
      approvalRequest: approval,
      approval,
      authorization: approval.authorization || null,
      runtime: approval.runtime || null,
      session: approval.session || null
    };
  }

  function normalizeJobApprovalResumeToken(record = {}) {
    const token =
      record?.resumeToken && typeof record.resumeToken === 'object' && !Array.isArray(record.resumeToken)
        ? record.resumeToken
        : {};
    const fundRequest =
      token?.fundRequest && typeof token.fundRequest === 'object' && !Array.isArray(token.fundRequest)
        ? token.fundRequest
        : {};
    return {
      version: normalizeSessionGrantText(token?.version),
      operation: normalizeSessionGrantText(token?.operation),
      approvalId: normalizeSessionGrantText(
        token?.approvalId || record?.approvalRequestId || record?.approvalId
      ),
      jobId: normalizeSessionGrantText(token?.jobId || record?.jobId),
      traceId: normalizeSessionGrantText(token?.traceId || record?.traceId),
      createdAt: Number(token?.createdAt || record?.createdAt || 0),
      sessionAuthorizationRef: normalizeSessionGrantText(
        token?.sessionAuthorizationRef || record?.sessionAuthorizationRef || record?.authorizationId
      ),
      fundRequest: {
        budget: normalizeSessionGrantText(fundRequest?.budget),
        escrowAmount: normalizeSessionGrantText(fundRequest?.escrowAmount),
        tokenAddress: normalizeSessionGrantAddress(fundRequest?.tokenAddress || ''),
        payerAaWallet: normalizeSessionGrantAddress(fundRequest?.payerAaWallet || ''),
        requester: normalizeSessionGrantAddress(fundRequest?.requester || ''),
        executor: normalizeSessionGrantAddress(fundRequest?.executor || ''),
        validator: normalizeSessionGrantAddress(fundRequest?.validator || '')
      }
    };
  }

  async function finalizeJobApprovalRecord({ approvalRequestId = '', approvalToken = '', body = {}, traceId = '', req = null } = {}) {
    const record = getSessionApprovalRecordOrThrow(approvalRequestId, approvalToken, req, { requireWrite: true });
    const approvalId = String(record?.approvalRequestId || record?.approvalId || '').trim();
    const status = String(record?.status || '').trim().toLowerCase();
    if (status === 'completed') {
      return {
        record,
        response: buildApprovalReadResponse(record, { includeToken: true })
      };
    }
    if (status === 'rejected') {
      const error = new Error('Approval request has already been rejected.');
      error.statusCode = 409;
      error.code = 'approval_request_rejected';
      throw error;
    }
    if (status === 'expired') {
      const error = new Error('Approval request has expired.');
      error.statusCode = 409;
      error.code = 'approval_request_expired';
      throw error;
    }

    const jobId = String(record?.jobId || '').trim();
    const relatedJob =
      readJobs?.().find((item) => String(item?.jobId || '').trim() === jobId) || null;
    if (!relatedJob) {
      const error = new Error('Related job not found for approval request.');
      error.statusCode = 404;
      error.code = 'approval_job_not_found';
      throw error;
    }

    const decidedBy = normalizeSessionGrantAddress(
      body?.decidedBy || body?.owner || body?.userEoa || record?.requestedByOwnerEoa || ''
    );
    const decisionNote = String(body?.reason || body?.note || '').trim();
    const approvedAt = Date.now();
    const approvedRecord = updateSessionApprovalRequest(approvalId, {
      status: 'approved',
      updatedAt: approvedAt,
      decidedAt: approvedAt,
      completedAt: 0,
      decidedBy,
      decisionNote,
      resumeStatus: 'resuming',
      resumeError: ''
    });

    upsertJobRecord?.({
      ...relatedJob,
      state: 'pending_approval',
      approvalId,
      approvalState: 'approved',
      approvalDecidedAt: approvedAt,
      approvalDecidedBy: decidedBy,
      approvalDecisionNote: decisionNote,
      updatedAt: new Date().toISOString(),
      summary: 'Job approval granted. Funding is resuming.',
      error: ''
    });

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };
    const internalApiKey = getInternalAgentApiKey?.();
    if (internalApiKey) headers['x-api-key'] = internalApiKey;

    let resumeResponse;
    let resumePayload = {};
    const resumeToken = normalizeJobApprovalResumeToken(record);
    try {
      resumeResponse = await fetch(
        `http://127.0.0.1:${PORT}/api/jobs/${encodeURIComponent(jobId)}/fund`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            approvalId: resumeToken.approvalId || approvalId,
            approvalRequestId: resumeToken.approvalId || approvalId,
            budget: resumeToken.fundRequest.budget,
            escrowAmount: resumeToken.fundRequest.escrowAmount,
            tokenAddress: resumeToken.fundRequest.tokenAddress,
            payerAaWallet: resumeToken.fundRequest.payerAaWallet,
            requester: resumeToken.fundRequest.requester,
            executor: resumeToken.fundRequest.executor,
            validator: resumeToken.fundRequest.validator,
            sessionAuthorizationRef: resumeToken.sessionAuthorizationRef
          })
        }
      );
      resumePayload = await resumeResponse.json().catch(() => ({}));
    } catch (error) {
      updateSessionApprovalRequest(approvalId, {
        status: 'approved',
        updatedAt: Date.now(),
        resumeStatus: 'failed',
        resumeError: String(error?.message || 'job approval resume failed').trim()
      });
      const failed = findSessionApprovalRequest(approvalId) || approvedRecord || record;
      return {
        record: failed,
        response: buildApprovalReadResponse(failed, { includeToken: true })
      };
    }

    const refreshed = findSessionApprovalRequest(approvalId) || approvedRecord || record;
    if (!resumeResponse?.ok) {
      return {
        record: refreshed,
        response: {
          ...buildApprovalReadResponse(refreshed, { includeToken: true }),
          resume: {
            ok: false,
            status: Number(resumeResponse?.status || 0),
            payload: resumePayload,
            traceId: traceId || ''
          }
        }
      };
    }

    const completedRecord = findSessionApprovalRequest(approvalId) || refreshed;
    return {
      record: completedRecord,
      response: {
        ...buildApprovalReadResponse(completedRecord, { includeToken: true }),
        resume: {
          ok: true,
          status: Number(resumeResponse?.status || 200),
          payload: resumePayload,
          traceId: traceId || ''
        }
      }
    };
  }

  async function finalizeSessionApprovalRecord({ approvalRequestId = '', approvalToken = '', body = {}, traceId = '', req = null } = {}) {
    const record = getSessionApprovalRecordOrThrow(approvalRequestId, approvalToken, req, { requireWrite: true });
    if (normalizeApprovalKind(record?.approvalKind) === 'job') {
      return finalizeJobApprovalRecord({ approvalRequestId, approvalToken, body, traceId, req });
    }
    const status = String(record.status || '').trim().toLowerCase();
    if (status === 'completed') {
      return {
        record,
        response: buildApprovalReadResponse(record, { includeToken: true })
      };
    }
    if (status === 'rejected') {
      const error = new Error('Approval request has already been rejected.');
      error.statusCode = 409;
      error.code = 'approval_request_rejected';
      throw error;
    }

    const finalized = await finalizeSessionAuthorization({
      body,
      traceId,
      approvalRequest: record
    });
    const completedRecord = updateSessionApprovalRequest(approvalRequestId, {
      status: 'completed',
      updatedAt: Date.now(),
      completedAt: finalized.authorizedAt,
      authorizationId: finalized.authorizationId,
      authorization: {
        authorizationId: finalized.authorizationId,
        mode: finalized.authorizationMode,
        authorizedBy: finalized.userEoa,
        authorizedAt: finalized.authorizedAt,
        payload: finalized.payload,
        payloadHash: finalized.authorizationPayloadHash,
        signatureMasked: maskSecret(finalized.userSignature),
        expiresAt: finalized.payload.expiresAt,
        nonce: finalized.payload.nonce,
        allowedCapabilities: finalized.payload.allowedCapabilities
      },
      runtime: finalized.nextRuntime
    });
    return {
      record: completedRecord,
      response: buildApprovalReadResponse(completedRecord, { includeToken: true })
    };
  }

  function rejectJobApprovalRecord({ approvalRequestId = '', approvalToken = '', reason = '', req = null } = {}) {
    const record = getSessionApprovalRecordOrThrow(approvalRequestId, approvalToken, req, { requireWrite: true });
    const approvalId = String(record?.approvalRequestId || record?.approvalId || '').trim();
    const status = String(record?.status || '').trim().toLowerCase();
    if (status === 'rejected') {
      return buildApprovalReadResponse(record, { includeToken: true });
    }
    if (status === 'completed') {
      const error = new Error('Approval request has already been completed.');
      error.statusCode = 409;
      error.code = 'approval_request_completed';
      throw error;
    }

    const rejectedAt = Date.now();
    const decisionNote = String(reason || '').trim();
    const rejectedRecord = updateSessionApprovalRequest(approvalId, {
      status: 'rejected',
      updatedAt: rejectedAt,
      completedAt: rejectedAt,
      decidedAt: rejectedAt,
      decidedBy: normalizeSessionGrantAddress(record?.requestedByOwnerEoa || ''),
      decisionNote,
      rejectionReason: decisionNote,
      resumeStatus: 'cancelled',
      resumeError: ''
    });

    const relatedJob =
      readJobs?.().find((item) => String(item?.jobId || '').trim() === String(record?.jobId || '').trim()) || null;
    if (relatedJob) {
      upsertJobRecord?.({
        ...relatedJob,
        state: 'approval_rejected',
        approvalId,
        approvalState: 'rejected',
        approvalDecidedAt: rejectedAt,
        approvalDecidedBy: normalizeSessionGrantAddress(record?.requestedByOwnerEoa || ''),
        approvalDecisionNote: decisionNote,
        updatedAt: new Date().toISOString(),
        summary: 'Job funding was rejected by the owner.',
        error: 'approval_rejected'
      });
    }

    return buildApprovalReadResponse(rejectedRecord, { includeToken: true });
  }

  function rejectSessionApprovalRecord({ approvalRequestId = '', approvalToken = '', reason = '', req = null } = {}) {
    const record = getSessionApprovalRecordOrThrow(approvalRequestId, approvalToken, req, { requireWrite: true });
    if (normalizeApprovalKind(record?.approvalKind) === 'job') {
      return rejectJobApprovalRecord({ approvalRequestId, approvalToken, reason, req });
    }
    const status = String(record.status || '').trim().toLowerCase();
    if (status === 'rejected') {
      return buildApprovalReadResponse(record, { includeToken: true });
    }
    if (status === 'completed') {
      const error = new Error('Approval request has already been completed.');
      error.statusCode = 409;
      error.code = 'approval_request_completed';
      throw error;
    }
    const rejectedRecord = updateSessionApprovalRequest(approvalRequestId, {
      status: 'rejected',
      updatedAt: Date.now(),
      completedAt: Date.now(),
      rejectionReason: String(reason || '').trim()
    });
    return buildApprovalReadResponse(rejectedRecord, { includeToken: true });
  }

  function normalizePositiveAmount(rawValue, fallbackValue, label = 'amount') {
    const rawText = String(rawValue ?? '').trim();
    const fallbackText = String(fallbackValue ?? '').trim();
    const candidate = rawText || fallbackText;
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error(`${label} must be a positive number.`);
    }
    return {
      text: candidate,
      numeric
    };
  }

  function shouldRetryRpcRead(error = null) {
    const text = [
      String(error?.message || ''),
      String(error?.code || ''),
      String(error?.shortMessage || ''),
      String(error?.cause?.message || ''),
      String(error?.cause?.code || '')
    ]
      .join(' ')
      .trim()
      .toLowerCase();
    if (!text) return false;
    return (
      text.includes('econnreset') ||
      text.includes('timeout') ||
      text.includes('timed out') ||
      text.includes('network') ||
      text.includes('socket') ||
      text.includes('tls') ||
      text.includes('fetch failed') ||
      text.includes('aborted')
    );
  }

  async function withRpcReadRetry(task, { attempts = 3, delayMs = 1200 } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= Math.max(1, Number(attempts || 1)); attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !shouldRetryRpcRead(error)) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
    throw lastError || new Error('rpc_read_failed');
  }

  async function isSessionRuntimeReadyOnchain(runtime = {}, contract = null) {
    if (!contract) return false;
    if (!ethers.isAddress(runtime?.aaWallet || '')) return false;
    if (!ethers.isAddress(runtime?.sessionAddress || '')) return false;
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(runtime?.sessionId || ''))) return false;
    const [exists, onchainAgent] = await withRpcReadRetry(() =>
      Promise.all([contract.sessionExists(runtime.sessionId), contract.getSessionAgent(runtime.sessionId)])
    );
    return Boolean(exists) && normalizeAddress(onchainAgent || '') === normalizeAddress(runtime.sessionAddress || '');
  }

  async function verifyExternalSessionRuntime({
    runtime = {},
    payload = {},
    userEoa = ''
  } = {}) {
    const provider = backendSigner?.provider || new ethers.JsonRpcProvider(BACKEND_RPC_URL);
    const suppliedOwner = normalizeAddress(runtime.owner || '');
    const sessionPrivateKey = String(runtime.sessionPrivateKey || '').trim();
    const hasSessionPrivateKey = /^0x[0-9a-fA-F]{64}$/.test(sessionPrivateKey);
    const sessionWallet = hasSessionPrivateKey ? new ethers.Wallet(sessionPrivateKey) : null;
    const sessionAddress = normalizeAddress(runtime.sessionAddress || sessionWallet?.address || '');
    const aaWallet = normalizeAddress(runtime.aaWallet || payload.payerAaWallet || '');
    const sessionId = String(runtime.sessionId || '').trim();
    const sessionTxHash = String(runtime.sessionTxHash || '').trim();
    const normalizedUserEoa = normalizeAddress(userEoa || '');
    if (!aaWallet || !ethers.isAddress(aaWallet)) {
      throw new Error('A valid aaWallet is required for self-custodial session import.');
    }
    if (!sessionAddress || !ethers.isAddress(sessionAddress)) {
      throw new Error('A valid sessionAddress is required for self-custodial session import.');
    }
    if (hasSessionPrivateKey && sessionAddress !== normalizeAddress(sessionWallet?.address || '')) {
      throw new Error('sessionPrivateKey does not match the supplied sessionAddress.');
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
      throw new Error('A valid sessionId is required for self-custodial session import.');
    }
    if (sessionTxHash && !/^0x[0-9a-fA-F]{64}$/.test(sessionTxHash)) {
      throw new Error('sessionTxHash must be a valid transaction hash when provided.');
    }
    if (payload?.payerAaWallet && normalizeAddress(payload.payerAaWallet || '') !== aaWallet) {
      throw new Error('authorization payload payerAaWallet does not match the supplied aaWallet.');
    }

    const accountCode = await withRpcReadRetry(() => provider.getCode(aaWallet));
    if (!accountCode || accountCode === '0x') {
      throw new Error(`No contract code found at aaWallet: ${aaWallet}`);
    }

    const account = new ethers.Contract(aaWallet, AA_SESSION_ABI, provider);
    const [exists, onchainAgent, onchainOwnerRaw] = await withRpcReadRetry(() =>
      Promise.all([
        account.sessionExists(sessionId),
        account.getSessionAgent(sessionId),
        account.owner().catch(() => '')
      ])
    );
    if (!exists) {
      throw new Error(`Session not found on-chain: ${sessionId}`);
    }
    if (normalizeAddress(onchainAgent || '') !== sessionAddress) {
      throw new Error(`On-chain session agent mismatch. expected=${onchainAgent}, supplied=${sessionAddress}`);
    }

    const onchainOwner = normalizeAddress(onchainOwnerRaw || '');
    const resolvedOwner = suppliedOwner || onchainOwner || normalizedUserEoa;
    if (!resolvedOwner || !ethers.isAddress(resolvedOwner)) {
      throw new Error('A valid owner address is required for self-custodial session import.');
    }
    if (onchainOwner && resolvedOwner !== onchainOwner) {
      throw new Error(`AA owner mismatch. onchain=${onchainOwner}, supplied=${resolvedOwner}`);
    }

    if (KITE_REQUIRE_AA_V2) {
      let aaVersion = '';
      try {
        aaVersion = String(await withRpcReadRetry(() => account.version())).trim();
      } catch {
        aaVersion = '';
      }
      if (aaVersion !== AA_V2_VERSION_TAG) {
        throw new Error(
          `AA must be upgraded to V2 for session-userop payments. required=${AA_V2_VERSION_TAG}, current=${aaVersion || 'unknown_or_legacy'}`
        );
      }
    }

    const maxPerTx = normalizePositiveAmount(
      payload?.singleLimit,
      runtime.maxPerTx || POLICY_MAX_PER_TX_DEFAULT,
      'singleLimit'
    );
    const dailyLimit = normalizePositiveAmount(
      payload?.dailyLimit,
      runtime.dailyLimit || POLICY_DAILY_LIMIT_DEFAULT,
      'dailyLimit'
    );
    const gatewayRecipient = normalizeAddress(
      runtime.gatewayRecipient || payload?.gatewayRecipient || MERCHANT_ADDRESS || ''
    );
    if (!gatewayRecipient || !ethers.isAddress(gatewayRecipient)) {
      throw new Error('A valid gatewayRecipient is required for self-custodial session import.');
    }

    return {
      aaWallet,
      owner: resolvedOwner,
      sessionAddress,
      sessionPrivateKey: hasSessionPrivateKey ? sessionPrivateKey : '',
      sessionId,
      sessionTxHash,
      expiresAt: Number(runtime.expiresAt || 0),
      maxPerTx: maxPerTx.numeric,
      dailyLimit: dailyLimit.numeric,
      gatewayRecipient,
      source: String(runtime.source || (hasSessionPrivateKey ? 'api-v1-session-authorize-external' : 'api-v1-session-authorize-agent-first')).trim(),
      updatedAt: Date.now()
    };
  }

  async function ensureBackendSessionRuntime({
    owner = '',
    singleLimit = '',
    dailyLimit = '',
    tokenAddress = '',
    gatewayRecipient = '',
    forceNewSession = false
  } = {}) {
    const provider = backendSigner?.provider || new ethers.JsonRpcProvider(BACKEND_RPC_URL);
    const fallbackRouterOwner = normalizeAddress(XMTP_ROUTER_DERIVED_ADDRESS || '');
    const currentRuntime = resolveSessionRuntime({ owner });
    const requestedOwner = normalizeAddress(owner || currentRuntime.owner || fallbackRouterOwner || '');
    if (!ethers.isAddress(requestedOwner)) {
      throw new Error('A valid owner address is required for session creation.');
    }

    const managedOwnerKey =
      String(resolveSessionOwnerPrivateKey?.(requestedOwner) || '').trim() ||
      String(ROUTER_WALLET_KEY_NORMALIZED || '').trim();
    if (!managedOwnerKey) {
      throw new Error(`Owner key unavailable for requested owner: ${requestedOwner}`);
    }
    const ownerWallet = new ethers.Wallet(managedOwnerKey, provider);
    const signerOwner = normalizeAddress(ownerWallet.address || '');
    if (requestedOwner !== signerOwner) {
      throw new Error(`Owner key mismatch. requested=${requestedOwner} signer=${signerOwner}`);
    }

    const saltRaw = String(process.env.KITECLAW_AA_SALT ?? '0').trim();
    let salt = 0n;
    try {
      salt = BigInt(saltRaw || '0');
    } catch {
      throw new Error(`Invalid salt: ${saltRaw}`);
    }

    const ensured = await ensureAAAccountDeployment({ owner: requestedOwner, salt });
    const account = new ethers.Contract(ensured.accountAddress, AA_SESSION_ABI, ownerWallet);

    if (!forceNewSession) {
      const canReuse =
        normalizeAddress(currentRuntime.owner || '') === requestedOwner &&
        normalizeAddress(currentRuntime.aaWallet || '') === normalizeAddress(ensured.accountAddress || '') &&
        currentRuntime.sessionPrivateKey &&
        currentRuntime.sessionAddress &&
        currentRuntime.sessionId;
      if (canReuse && (await isSessionRuntimeReadyOnchain(currentRuntime, account))) {
        return {
          created: false,
          reused: true,
          tokenAddress: normalizeAddress(tokenAddress || SETTLEMENT_TOKEN || ''),
          runtime: currentRuntime
        };
      }
    }

    const normalizedTokenAddress = normalizeAddress(tokenAddress || SETTLEMENT_TOKEN || '');
    if (!ethers.isAddress(normalizedTokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress || SETTLEMENT_TOKEN || ''}`);
    }

    const normalizedGatewayRecipient = normalizeAddress(
      gatewayRecipient || currentRuntime.gatewayRecipient || MERCHANT_ADDRESS || ''
    );
    if (!ethers.isAddress(normalizedGatewayRecipient)) {
      throw new Error(
        `Invalid gateway recipient: ${gatewayRecipient || currentRuntime.gatewayRecipient || MERCHANT_ADDRESS || ''}`
      );
    }

    const maxPerTx = normalizePositiveAmount(
      singleLimit,
      currentRuntime.maxPerTx || POLICY_MAX_PER_TX_DEFAULT,
      'singleLimit'
    );
    const dailyBudget = normalizePositiveAmount(
      dailyLimit,
      currentRuntime.dailyLimit || POLICY_DAILY_LIMIT_DEFAULT,
      'dailyLimit'
    );

    try {
      const tokenTx = await account.addSupportedToken(normalizedTokenAddress);
      await tokenTx.wait();
    } catch {
      // addSupportedToken may already be configured on-chain.
    }

    const latestBlock = await provider.getBlock('latest');
    const nowTs = Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000));
    const rules = [
      {
        timeWindow: 0n,
        budget: ethers.parseUnits(maxPerTx.text, 18),
        initialWindowStartTime: 0,
        targetProviders: []
      },
      {
        timeWindow: 86400n,
        budget: ethers.parseUnits(dailyBudget.text, 18),
        initialWindowStartTime: Math.max(0, nowTs - 1),
        targetProviders: []
      }
    ];

    const sessionWallet = ethers.Wallet.createRandom();
    const sessionId = ethers.keccak256(ethers.toUtf8Bytes(`${sessionWallet.address}-${Date.now()}`));
    const tx = await account.createSession(sessionId, sessionWallet.address, rules);
    await tx.wait();

    const sessionReady = await isSessionRuntimeReadyOnchain(
      {
        aaWallet: ensured.accountAddress,
        sessionAddress: sessionWallet.address,
        sessionId
      },
      account
    );
    if (!sessionReady) {
      throw new Error(`Session not found on-chain after tx: ${sessionId}`);
    }

    const nextRuntime = writeSessionRuntime({
      ...currentRuntime,
      aaWallet: ensured.accountAddress,
      owner: requestedOwner,
      sessionAddress: sessionWallet.address,
      sessionPrivateKey: sessionWallet.privateKey,
      sessionId,
      sessionTxHash: tx.hash,
      expiresAt: 0,
      maxPerTx: maxPerTx.numeric,
      dailyLimit: dailyBudget.numeric,
      gatewayRecipient: normalizedGatewayRecipient,
      source: 'api-session-runtime-ensure',
      updatedAt: Date.now()
    });

    return {
      created: true,
      reused: false,
      tokenAddress: normalizedTokenAddress,
      runtime: nextRuntime
    };
  }
  
  const ERC8004_IDENTITY_ABI = [
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function getAgentWallet(uint256 agentId) view returns (address)'
  ];
  
  function parseAgentId(raw) {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  
  function isIdentitySignatureRequired() {
    return !['registry', 'registry_only', 'service', 'service_registry'].includes(
      IDENTITY_VERIFY_MODE
    );
  }
  
  function buildIdentitySummary(profile = {}) {
    return {
      available: Boolean(profile?.available),
      chainId: String(profile?.chainId || ''),
      configured: profile?.configured || null,
      agentId: String(profile?.configured?.agentId || ''),
      registry: String(profile?.configured?.registry || ''),
      ownerAddress: String(profile?.ownerAddress || ''),
      agentWallet: String(profile?.agentWallet || ''),
      tokenURI: String(profile?.tokenURI || '')
    };
  }
  
  function createIdentityChallengeMessage({
    challengeId = '',
    traceId = '',
    nonce = '',
    issuedAt = 0,
    expiresAt = 0,
    profile = {}
  } = {}) {
    return [
      'KITECLAW Identity Verification',
      `challengeId: ${challengeId}`,
      `traceId: ${traceId}`,
      `registry: ${String(profile?.configured?.registry || '')}`,
      `agentId: ${String(profile?.configured?.agentId || '')}`,
      `agentWallet: ${String(profile?.agentWallet || '')}`,
      `nonce: ${nonce}`,
      `issuedAt: ${new Date(issuedAt).toISOString()}`,
      `expiresAt: ${new Date(expiresAt).toISOString()}`
    ].join('\n');
  }
  
  function normalizeIdentityChallengeRows(rows = []) {
    const now = Date.now();
    const validRows = Array.isArray(rows)
      ? rows.filter((item) => item && typeof item === 'object')
      : [];
    const freshRows = validRows.filter((item) => {
      const expiresAt = Number(item.expiresAt || 0);
      if (item.usedAt) return now - Number(item.usedAt || 0) <= 24 * 60 * 60 * 1000;
      return expiresAt > 0 && now - expiresAt <= 24 * 60 * 60 * 1000;
    });
    const limit = Number.isFinite(IDENTITY_CHALLENGE_MAX_ROWS) && IDENTITY_CHALLENGE_MAX_ROWS > 0
      ? IDENTITY_CHALLENGE_MAX_ROWS
      : 500;
    return freshRows.slice(0, limit);
  }
  
  function getLatestIdentityChallengeSnapshot() {
    const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
    if (!rows.length) return null;
    const latest = [...rows].sort((a, b) => {
      const ta = Number(a?.verifiedAt || a?.usedAt || a?.issuedAt || 0);
      const tb = Number(b?.verifiedAt || b?.usedAt || b?.issuedAt || 0);
      return tb - ta;
    })[0];
    if (!latest) return null;
    return {
      challengeId: String(latest.challengeId || ''),
      traceId: String(latest.traceId || ''),
      status: String(latest.status || ''),
      issuedAt: Number(latest.issuedAt || 0) > 0 ? new Date(Number(latest.issuedAt)).toISOString() : '',
      expiresAt: Number(latest.expiresAt || 0) > 0 ? new Date(Number(latest.expiresAt)).toISOString() : '',
      verifiedAt: Number(latest.verifiedAt || 0) > 0 ? new Date(Number(latest.verifiedAt)).toISOString() : '',
      recoveredAddress: String(latest.recoveredAddress || ''),
      identity: {
        registry: String(latest?.identity?.registry || ''),
        agentId: String(latest?.identity?.agentId || ''),
        agentWallet: String(latest?.identity?.agentWallet || '')
      }
    };
  }
  
  function buildIdentityPayload(profile = {}, extras = {}) {
    return {
      registry: String(profile?.configured?.registry || '').trim(),
      agentId: String(profile?.configured?.agentId || '').trim(),
      agentWallet: normalizeAddress(profile?.agentWallet || ''),
      ownerAddress: normalizeAddress(profile?.ownerAddress || ''),
      tokenURI: String(profile?.tokenURI || '').trim(),
      ...extras
    };
  }
  
  function saveIdentityVerificationRecord({
    traceId = '',
    profile = {},
    verifyMode = '',
    status = 'verified',
    challengeId = '',
    nonce = '',
    message = '',
    signature = '',
    issuedAt = 0,
    expiresAt = 0,
    verifiedAt = Date.now(),
    recoveredAddress = ''
  } = {}) {
    const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
    rows.unshift({
      challengeId: String(challengeId || createTraceId('idv')).trim(),
      traceId: String(traceId || '').trim(),
      nonce: String(nonce || '').trim(),
      message: String(message || '').trim(),
      signature: String(signature || '').trim(),
      issuedAt: Number(issuedAt || 0),
      expiresAt: Number(expiresAt || 0),
      usedAt: Number(verifiedAt || 0),
      verifiedAt: Number(verifiedAt || 0),
      recoveredAddress: normalizeAddress(recoveredAddress || ''),
      status: String(status || 'verified').trim(),
      verifyMode: String(verifyMode || IDENTITY_VERIFY_MODE || '').trim(),
      identity: buildIdentityPayload(profile)
    });
    writeIdentityChallenges(normalizeIdentityChallengeRows(rows));
  }
  
  async function ensureWorkflowIdentityVerified({ traceId = '', identityInput = {} } = {}) {
    const profile = await readIdentityProfile({
      registry: identityInput?.identityRegistry || identityInput?.registry,
      agentId: identityInput?.agentId
    });
    if (!profile?.available) {
      throw new Error(profile?.reason || 'identity_unavailable');
    }
  
    const agentWallet = normalizeAddress(profile.agentWallet || '');
    if (!ethers.isAddress(agentWallet)) {
      throw new Error('identity_wallet_invalid');
    }
  
    const now = Date.now();
    if (!isIdentitySignatureRequired()) {
      saveIdentityVerificationRecord({
        traceId,
        profile,
        verifyMode: 'registry',
        status: 'verified_registry',
        issuedAt: now,
        expiresAt: now,
        verifiedAt: now,
        recoveredAddress: agentWallet
      });
      return {
        verifyMode: 'registry',
        signatureRequired: false,
        verifiedAt: new Date(now).toISOString(),
        identity: buildIdentityPayload(profile, {
          verifyMode: 'registry',
          verifiedAt: new Date(now).toISOString()
        }),
        profile: buildIdentitySummary(profile)
      };
    }
  
    if (!backendSigner) {
      throw new Error('identity_signature_required_but_backend_signer_unavailable');
    }
  
    const signerAddress = normalizeAddress(backendSigner.address || '');
    if (!signerAddress || signerAddress !== agentWallet) {
      throw new Error(
        `identity_signer_mismatch: backend_signer=${signerAddress || '-'} expected_agent_wallet=${agentWallet}`
      );
    }
  
    const challengeId = createTraceId('idv');
    const nonce = `0x${crypto.randomBytes(16).toString('hex')}`;
    const ttl = Number.isFinite(IDENTITY_CHALLENGE_TTL_MS) && IDENTITY_CHALLENGE_TTL_MS > 0
      ? IDENTITY_CHALLENGE_TTL_MS
      : 120_000;
    const expiresAt = now + ttl;
    const message = createIdentityChallengeMessage({
      challengeId,
      traceId,
      nonce,
      issuedAt: now,
      expiresAt,
      profile
    });
    const signature = await backendSigner.signMessage(message);
    const recoveredAddress = normalizeAddress(ethers.verifyMessage(message, signature));
    if (!recoveredAddress || recoveredAddress !== agentWallet) {
      throw new Error(
        `identity_signature_invalid: recovered=${recoveredAddress || '-'} expected_agent_wallet=${agentWallet}`
      );
    }
  
    saveIdentityVerificationRecord({
      traceId,
      profile,
      verifyMode: 'signature',
      status: 'verified',
      challengeId,
      nonce,
      message,
      signature,
      issuedAt: now,
      expiresAt,
      verifiedAt: now,
      recoveredAddress
    });
  
    return {
      verifyMode: 'signature',
      signatureRequired: true,
      verifiedAt: new Date(now).toISOString(),
      identity: buildIdentityPayload(profile, {
        verifyMode: 'signature',
        verifiedAt: new Date(now).toISOString(),
        challengeId
      }),
      profile: buildIdentitySummary(profile)
    };
  }
  
  async function readIdentityProfile(input = {}) {
    const requestedRegistry = String(input.registry || '').trim();
    const requestedAgentId = parseAgentId(input.agentId);
    const configured = {
      registry: requestedRegistry || ERC8004_IDENTITY_REGISTRY || '',
      agentId:
        requestedAgentId !== null
          ? String(requestedAgentId)
          : ERC8004_AGENT_ID !== null
            ? String(ERC8004_AGENT_ID)
            : ''
    };
  
    if (!configured.registry || !ethers.isAddress(configured.registry)) {
      return {
        configured,
        available: false,
        reason: 'identity_registry_not_configured'
      };
    }
    const resolvedAgentId = parseAgentId(configured.agentId);
    if (resolvedAgentId === null) {
      return {
        configured,
        available: false,
        reason: 'agent_id_not_configured'
      };
    }
  
    const provider = new ethers.JsonRpcProvider(BACKEND_RPC_URL);
    const network = await provider.getNetwork();
    const contract = new ethers.Contract(configured.registry, ERC8004_IDENTITY_ABI, provider);
    const [ownerAddress, tokenURI, agentWallet] = await Promise.all([
      contract.ownerOf(resolvedAgentId),
      contract.tokenURI(resolvedAgentId),
      contract.getAgentWallet(resolvedAgentId)
    ]);
  
    return {
      configured,
      available: true,
      chainId: String(network.chainId),
      ownerAddress,
      tokenURI,
      agentWallet
    };
  }
  
  function assertBackendSigner(res) {
    if (!backendSigner) {
      res.status(503).json({
        error: 'backend_signer_unavailable',
        reason: 'Set KITECLAW_BACKEND_SIGNER_PRIVATE_KEY in backend environment.'
      });
      return false;
    }
    return true;
  }
  
  app.get('/api/records', requireRole('viewer'), (req, res) => {
    res.json(readRecords());
  });
  
  app.post('/api/records', requireRole('agent'), (req, res) => {
    const record = req.body || {};
    const records = readRecords();
    const normalized = {
      time: record.time || new Date().toISOString(),
      type: record.type || 'unknown',
      amount: record.amount || '',
      token: record.token || '',
      recipient: record.recipient || '',
      txHash: record.txHash || '',
      status: record.status || 'unknown',
      requestId: record.requestId || '',
      signerMode: record.signerMode || '',
      agentId:
        record.agentId ||
        (ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID) : ''),
      identityRegistry: record.identityRegistry || ERC8004_IDENTITY_REGISTRY || ''
    };
    records.unshift(normalized);
    writeRecords(records);
    res.json({ ok: true });
  });
  
  app.get('/api/signer/info', requireRole('viewer'), (req, res) => {
    res.json(getBackendSignerState());
  });
  
  app.get('/api/session/runtime', requireRole('viewer'), (req, res) => {
    const runtime = resolveSessionRuntime({
      owner: req.query.owner,
      aaWallet: req.query.aaWallet,
      sessionId: req.query.sessionId
    });
    return res.json({
      ok: true,
      runtime: buildSessionRuntimePayload(runtime)
    });
  });
  
  app.get('/api/session/pay/config', requireRole('viewer'), (req, res) => {
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      config: sessionPayConfigSnapshot()
    });
  });
  
  app.get('/api/session/pay/metrics', requireRole('viewer'), (req, res) => {
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      metrics: {
        startedAt: sessionPayMetrics.startedAt,
        totalRequests: sessionPayMetrics.totalRequests,
        totalSuccess: sessionPayMetrics.totalSuccess,
        totalFailed: sessionPayMetrics.totalFailed,
        totalRetryAttempts: sessionPayMetrics.totalRetryAttempts,
        totalRetryDelayMs: sessionPayMetrics.totalRetryDelayMs,
        averageRetryDelayMs:
          sessionPayMetrics.totalRetryAttempts > 0
            ? Number((sessionPayMetrics.totalRetryDelayMs / sessionPayMetrics.totalRetryAttempts).toFixed(2))
            : 0,
        totalRetriesUsed: sessionPayMetrics.totalRetriesUsed,
        totalFallbackAttempted: sessionPayMetrics.totalFallbackAttempted,
        totalFallbackSucceeded: sessionPayMetrics.totalFallbackSucceeded,
        failureRate:
          sessionPayMetrics.totalRequests > 0
            ? Number((sessionPayMetrics.totalFailed / sessionPayMetrics.totalRequests).toFixed(4))
            : 0,
        failuresByCategory: sessionPayMetrics.failuresByCategory,
        retriesByCategory: sessionPayMetrics.retriesByCategory,
        retryDelayMsByCategory: sessionPayMetrics.retryDelayMsByCategory,
        recentFailures: sessionPayMetrics.recentFailures
      }
    });
  });
  
  app.get('/api/session/runtime/secret', requireRole('admin'), (req, res) => {
    const runtime = resolveSessionRuntime({
      owner: req.query.owner,
      aaWallet: req.query.aaWallet,
      sessionId: req.query.sessionId
    });
    return res.json({
      ok: true,
      runtime
    });
  });
  
  app.post('/api/session/runtime/sync', requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const next = writeSessionRuntime({
      aaWallet: body.aaWallet,
      owner: body.owner,
      sessionAddress: body.sessionAddress,
      sessionPrivateKey: body.sessionPrivateKey,
      sessionId: body.sessionId,
      sessionTxHash: body.sessionTxHash,
      expiresAt: body.expiresAt,
      maxPerTx: body.maxPerTx,
      dailyLimit: body.dailyLimit,
      gatewayRecipient: body.gatewayRecipient,
      authorizedBy: body.authorizedBy,
      authorizedAt: body.authorizedAt,
      authorizationMode: body.authorizationMode,
      authorizationPayload: body.authorizationPayload,
      authorizationPayloadHash: body.authorizationPayloadHash,
      authorizationSignature: body.authorizationSignature,
      authorizationNonce: body.authorizationNonce,
      authorizationExpiresAt: body.authorizationExpiresAt,
      authorizedAgentId: body.authorizedAgentId,
      authorizedAgentWallet: body.authorizedAgentWallet,
      authorizationAudience: body.authorizationAudience,
      allowedCapabilities: body.allowedCapabilities,
      source: body.source || 'frontend',
      updatedAt: Date.now()
    });
    return res.json({
      ok: true,
      runtime: buildSessionRuntimePayload(next)
    });
  });

  app.post('/api/session/runtime/ensure', requireRole('agent'), async (req, res) => {
    try {
      const body = req.body || {};
      const ensured = await ensureBackendSessionRuntime({
        owner: body.owner,
        singleLimit: body.singleLimit,
        dailyLimit: body.dailyLimit,
        tokenAddress: body.tokenAddress || body.token,
        gatewayRecipient: body.gatewayRecipient,
        forceNewSession: /^(1|true|yes|on)$/i.test(String(body.forceNewSession || '').trim())
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        created: ensured.created,
        reused: ensured.reused,
        owner: ensured.runtime.owner,
        aaWallet: ensured.runtime.aaWallet,
        session: {
          address: ensured.runtime.sessionAddress,
          id: ensured.runtime.sessionId,
          txHash: ensured.runtime.sessionTxHash,
          maxPerTx: ensured.runtime.maxPerTx,
          dailyLimit: ensured.runtime.dailyLimit,
          gatewayRecipient: ensured.runtime.gatewayRecipient,
          tokenAddress: ensured.tokenAddress
        },
        runtime: buildSessionRuntimePayload(ensured.runtime)
      });
    } catch (error) {
      const reason = error?.message || 'session_runtime_ensure_failed';
      const status =
        /unavailable/i.test(reason)
          ? 503
          : /invalid|mismatch|required|positive number/i.test(reason)
            ? 400
            : 500;
      return res.status(status).json({
        ok: false,
        error: 'session_runtime_ensure_failed',
        reason,
        traceId: req.traceId || ''
      });
    }
  });

  async function finalizeSessionAuthorization({
    body = {},
    traceId = '',
    approvalRequest = null
  } = {}) {
    const executionModeRaw = String(body.executionMode || body.sessionStrategy || '').trim().toLowerCase();
    const executionMode =
      executionModeRaw === 'external' ||
      executionModeRaw === 'self-custodial' ||
      executionModeRaw === 'self_custodial'
        ? 'external'
        : 'managed';
    const rawPayload =
      body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : {};
    const profile = await readIdentityProfile({
      registry: rawPayload.identityRegistry || body.identityRegistry,
      agentId: rawPayload.agentId || body.agentId
    });
    if (!profile?.available) {
      const error = new Error(profile?.reason || 'identity_unavailable');
      error.statusCode = 400;
      error.code = 'identity_unavailable';
      error.data = {
        profile: buildIdentitySummary(profile)
      };
      throw error;
    }

    const currentRuntime = readSessionRuntime();
    const fallbackPayload = {
      agentId: String(profile?.configured?.agentId || '').trim(),
      agentWallet: normalizeSessionGrantAddress(profile?.agentWallet || ''),
      identityRegistry: normalizeSessionGrantAddress(profile?.configured?.registry || ''),
      chainId: String(profile?.chainId || '').trim(),
      payerAaWallet: normalizeSessionGrantAddress(currentRuntime?.aaWallet || ''),
      tokenAddress: normalizeSessionGrantAddress(
        rawPayload.tokenAddress || body.tokenAddress || body.token || SETTLEMENT_TOKEN || ''
      ),
      gatewayRecipient: normalizeSessionGrantAddress(
        rawPayload.gatewayRecipient || body.gatewayRecipient || currentRuntime?.gatewayRecipient || MERCHANT_ADDRESS || ''
      ),
      audience: normalizeSessionGrantText(
        rawPayload.audience,
        `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`
      ),
      singleLimit: normalizeSessionGrantAmount(
        rawPayload.singleLimit,
        body.singleLimit || currentRuntime?.maxPerTx || POLICY_MAX_PER_TX_DEFAULT
      ),
      dailyLimit: normalizeSessionGrantAmount(
        rawPayload.dailyLimit,
        body.dailyLimit || currentRuntime?.dailyLimit || POLICY_DAILY_LIMIT_DEFAULT
      ),
      allowedCapabilities: rawPayload.allowedCapabilities || body.allowedCapabilities || [],
      nonce:
        rawPayload.nonce ||
        (body.nonce ? String(body.nonce || '').trim() : `0x${crypto.randomBytes(16).toString('hex')}`),
      issuedAt: rawPayload.issuedAt || body.issuedAt || Date.now(),
      expiresAt: rawPayload.expiresAt || body.expiresAt || Date.now() + 24 * 60 * 60 * 1000
    };
    const payload = normalizeSessionGrantPayload(rawPayload, fallbackPayload);
    if (
      approvalRequest &&
      approvalRequest.payload &&
      typeof approvalRequest.payload === 'object' &&
      !Array.isArray(approvalRequest.payload)
    ) {
      const requestPayload = normalizeSessionGrantPayload(approvalRequest.payload);
      if (
        payload.agentId !== requestPayload.agentId ||
        payload.identityRegistry !== requestPayload.identityRegistry ||
        payload.agentWallet !== requestPayload.agentWallet ||
        payload.tokenAddress !== requestPayload.tokenAddress ||
        payload.gatewayRecipient !== requestPayload.gatewayRecipient ||
        payload.singleLimit !== requestPayload.singleLimit ||
        payload.dailyLimit !== requestPayload.dailyLimit ||
        payload.audience !== requestPayload.audience ||
        payload.nonce !== requestPayload.nonce
      ) {
        const error = new Error('Approval completion payload does not match the pending approval request.');
        error.statusCode = 400;
        error.code = 'approval_request_payload_mismatch';
        throw error;
      }
      if (payload.expiresAt !== requestPayload.expiresAt) {
        payload.expiresAt = requestPayload.expiresAt;
      }
    }
    if (!payload.agentId || !payload.identityRegistry || !payload.agentWallet) {
      const error = new Error(
        'Session authorization payload must include agentId, identityRegistry, and agentWallet.'
      );
      error.statusCode = 400;
      error.code = 'authorization_payload_invalid';
      error.data = { payload };
      throw error;
    }
    if (!payload.singleLimit || !payload.dailyLimit) {
      const error = new Error(
        'Session authorization payload must include positive singleLimit and dailyLimit values.'
      );
      error.statusCode = 400;
      error.code = 'authorization_limits_invalid';
      error.data = { payload };
      throw error;
    }
    if (!payload.nonce) {
      const error = new Error('Session authorization payload must include a nonce.');
      error.statusCode = 400;
      error.code = 'authorization_nonce_required';
      throw error;
    }
    if (!payload.expiresAt || payload.expiresAt <= Date.now()) {
      const error = new Error('Session authorization payload is already expired.');
      error.statusCode = 400;
      error.code = 'authorization_expired';
      error.data = { payload };
      throw error;
    }
    if (payload.issuedAt > Date.now() + 5 * 60 * 1000) {
      const error = new Error('Session authorization issuedAt is too far in the future.');
      error.statusCode = 400;
      error.code = 'authorization_issued_at_invalid';
      error.data = { payload };
      throw error;
    }

    const expectedRegistry = normalizeSessionGrantAddress(profile?.configured?.registry || '');
    const expectedAgentId = String(profile?.configured?.agentId || '').trim();
    const expectedAgentWallet = normalizeSessionGrantAddress(profile?.agentWallet || '');
    if (payload.identityRegistry !== expectedRegistry || payload.agentId !== expectedAgentId) {
      const error = new Error('Session authorization payload does not match the resolved ERC-8004 identity.');
      error.statusCode = 400;
      error.code = 'authorization_identity_mismatch';
      error.data = {
        payload,
        profile: buildIdentitySummary(profile)
      };
      throw error;
    }
    if (payload.agentWallet !== expectedAgentWallet) {
      const error = new Error(
        'Session authorization payload agentWallet does not match the ERC-8004 agent wallet.'
      );
      error.statusCode = 400;
      error.code = 'authorization_agent_wallet_mismatch';
      error.data = {
        payload,
        profile: buildIdentitySummary(profile)
      };
      throw error;
    }

    const userSignature = String(body.userSignature || body.signature || '').trim();
    if (!userSignature) {
      const error = new Error('userSignature is required for session authorization.');
      error.statusCode = 400;
      error.code = 'authorization_signature_required';
      throw error;
    }
    const recoveredAddress = normalizeSessionGrantAddress(
      ethers.verifyMessage(
        createSessionAuthorizationMessage({
          payload,
          userEoa: body.userEoa || ''
        }),
        userSignature
      )
    );
    const userEoa = normalizeSessionGrantAddress(body.userEoa || recoveredAddress || '');
    if (!userEoa) {
      const error = new Error('userEoa is invalid.');
      error.statusCode = 400;
      error.code = 'authorization_user_eoa_invalid';
      throw error;
    }
    if (recoveredAddress !== userEoa) {
      const error = new Error(`Signature recovered ${recoveredAddress || '-'} but expected ${userEoa}.`);
      error.statusCode = 400;
      error.code = 'authorization_signature_invalid';
      throw error;
    }
    if (
      approvalRequest?.userEoa &&
      normalizeSessionGrantAddress(approvalRequest.userEoa || '') !== userEoa
    ) {
      const error = new Error('Approval request was created for a different user EOA.');
      error.statusCode = 400;
      error.code = 'approval_request_user_mismatch';
      throw error;
    }

    const authorizationRows = normalizeSessionAuthorizationRows(readSessionAuthorizations());
    const duplicateNonce = authorizationRows.find(
      (item) =>
        String(item?.authorizationNonce || '').trim() === payload.nonce &&
        normalizeSessionGrantAddress(item?.authorizedBy || '') === userEoa
    );
    if (duplicateNonce) {
      const error = new Error('This session authorization nonce was already used for the same user.');
      error.statusCode = 409;
      error.code = 'authorization_nonce_reused';
      error.data = {
        authorizationId: String(duplicateNonce.authorizationId || '').trim()
      };
      throw error;
    }

    const ensured =
      executionMode === 'external'
        ? null
        : await ensureBackendSessionRuntime({
            owner: body.owner,
            singleLimit: payload.singleLimit,
            dailyLimit: payload.dailyLimit,
            tokenAddress: payload.tokenAddress,
            gatewayRecipient: payload.gatewayRecipient,
            forceNewSession: /^(1|true|yes|on)$/i.test(String(body.forceNewSession || '').trim())
          });
    const externalRuntime =
      executionMode === 'external'
        ? await verifyExternalSessionRuntime({
            runtime: body.runtime && typeof body.runtime === 'object' ? body.runtime : {},
            payload,
            userEoa
          })
        : null;
    if (
      approvalRequest?.sessionAddress &&
      normalizeSessionGrantAddress(approvalRequest.sessionAddress || '') !==
        normalizeSessionGrantAddress(externalRuntime?.sessionAddress || '')
    ) {
      const error = new Error('Approval completion sessionAddress does not match the requested sessionAddress.');
      error.statusCode = 400;
      error.code = 'approval_request_session_mismatch';
      throw error;
    }

    const authorizedAt = Date.now();
    const authorizationPayloadHash = hashSessionGrantPayload(payload);
    const authorizationId = createTraceId('sga');
    const authorizationMode =
      executionMode === 'external' ? 'user_grant_self_custodial' : 'user_grant_backend_executed';
    const authorizationRecord = appendSessionAuthorizationRecord({
      authorizationId,
      traceId,
      authorizedBy: userEoa,
      authorizedAt,
      authorizationMode,
      authorizationPayload: payload,
      authorizationPayloadHash,
      authorizationSignature: userSignature,
      authorizationNonce: payload.nonce,
      authorizationExpiresAt: payload.expiresAt,
      authorizedAgentId: payload.agentId,
      authorizedAgentWallet: payload.agentWallet,
      authorizationAudience: payload.audience,
      allowedCapabilities: payload.allowedCapabilities,
      status: 'authorized',
      created: ensured?.created ? 1 : 0,
      reused: ensured?.reused ? 1 : 0
    });

    const nextRuntime = writeSessionRuntime({
      ...(executionMode === 'external' ? externalRuntime : ensured.runtime),
      authorizedBy: userEoa,
      authorizedAt,
      authorizationMode,
      authorizationPayload: payload,
      authorizationPayloadHash,
      authorizationSignature: userSignature,
      authorizationNonce: payload.nonce,
      authorizationExpiresAt: payload.expiresAt,
      authorizedAgentId: payload.agentId,
      authorizedAgentWallet: payload.agentWallet,
      authorizationAudience: payload.audience,
      allowedCapabilities: payload.allowedCapabilities,
      source: approvalRequest ? 'api-session-approval-complete' : 'api-v1-session-authorize',
      updatedAt: Date.now()
    });

    return {
      profile,
      payload,
      executionMode,
      ensured,
      externalRuntime,
      nextRuntime,
      authorizationId,
      authorizationMode,
      authorizationPayloadHash,
      authorizationRecord,
      authorizedAt,
      userEoa,
      userSignature
    };
  }

  app.post('/api/v1/session/authorize', requireRole('agent'), async (req, res) => {
    try {
      const finalized = await finalizeSessionAuthorization({
        body: req.body || {},
        traceId: req.traceId || ''
      });

      return res.json({
        ok: true,
        schemaVersion: 'v1',
        traceId: req.traceId || '',
        created: Boolean(finalized?.ensured?.created),
        reused: Boolean(finalized?.ensured?.reused),
        imported: finalized.executionMode === 'external',
        executionMode: finalized.executionMode,
        authorizedBy: finalized.userEoa,
        authorization: {
          authorizationId: finalized.authorizationId,
          mode: finalized.authorizationMode,
          authorizedBy: finalized.userEoa,
          authorizedAt: finalized.authorizedAt,
          payload: finalized.payload,
          payloadHash: finalized.authorizationPayloadHash,
          signatureMasked: maskSecret(finalized.userSignature),
          expiresAt: finalized.payload.expiresAt,
          nonce: finalized.payload.nonce,
          allowedCapabilities: finalized.payload.allowedCapabilities
        },
        session: {
          address: finalized.nextRuntime.sessionAddress,
          id: finalized.nextRuntime.sessionId,
          txHash: finalized.nextRuntime.sessionTxHash,
          maxPerTx: finalized.nextRuntime.maxPerTx,
          dailyLimit: finalized.nextRuntime.dailyLimit,
          gatewayRecipient: finalized.nextRuntime.gatewayRecipient,
          tokenAddress: finalized.payload.tokenAddress,
          authorizedBy: finalized.nextRuntime.authorizedBy,
          authorizationMode: finalized.nextRuntime.authorizationMode
        },
        runtime: buildSessionRuntimePayload(finalized.nextRuntime),
        record: finalized.authorizationRecord
      });
    } catch (error) {
      const reason = error?.message || 'session_authorize_failed';
      const status = Number(error?.statusCode || 0) || (/already used|reused/i.test(reason) ? 409 : 400);
      return res.status(status).json({
        ok: false,
        schemaVersion: 'v1',
        error: error?.code || 'session_authorize_failed',
        reason,
        traceId: req.traceId || '',
        ...(error?.data && typeof error.data === 'object' ? error.data : {})
      });
    }
  });

  app.post('/api/v1/session/approval-requests', requireRole('agent'), async (req, res) => {
    try {
      const body = req.body || {};
      const executionModeRaw = String(body.executionMode || '').trim().toLowerCase();
      const executionMode =
        executionModeRaw === 'external' ||
        executionModeRaw === 'self-custodial' ||
        executionModeRaw === 'self_custodial'
          ? 'external'
          : 'managed';
      if (executionMode !== 'external') {
        return res.status(400).json({
          ok: false,
          error: 'approval_request_external_only',
          reason: 'Agent-first approval requests currently require executionMode=external.',
          traceId: req.traceId || ''
        });
      }

      const rawPayload =
        body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          ? body.payload
          : {};
      const payload = normalizeSessionGrantPayload(rawPayload, {
        audience: normalizeSessionGrantText(
          rawPayload.audience,
          `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`
        ),
        nonce: rawPayload.nonce || `0x${crypto.randomBytes(16).toString('hex')}`,
        issuedAt: rawPayload.issuedAt || Date.now(),
        expiresAt: rawPayload.expiresAt || Date.now() + 24 * 60 * 60 * 1000
      });
      const userEoa = normalizeSessionGrantAddress(body.userEoa || '');
      const sessionAddress = normalizeSessionGrantAddress(body.sessionAddress || '');
      if (!userEoa || !sessionAddress) {
        return res.status(400).json({
          ok: false,
          error: 'approval_request_invalid',
          reason: 'userEoa and sessionAddress are required to create an approval request.',
          traceId: req.traceId || ''
        });
      }
      if (!payload.agentId || !payload.agentWallet || !payload.identityRegistry) {
        return res.status(400).json({
          ok: false,
          error: 'approval_request_identity_missing',
          reason: 'Approval request payload is missing ERC-8004 identity fields.',
          traceId: req.traceId || '',
          payload
        });
      }
      if (!payload.singleLimit || !payload.dailyLimit) {
        return res.status(400).json({
          ok: false,
          error: 'approval_request_limits_invalid',
          reason: 'Approval request payload must include positive singleLimit and dailyLimit values.',
          traceId: req.traceId || '',
          payload
        });
      }
      if (!payload.expiresAt || payload.expiresAt <= Date.now()) {
        return res.status(400).json({
          ok: false,
          error: 'approval_request_expired',
          reason: 'Approval request payload is already expired.',
          traceId: req.traceId || '',
          payload
        });
      }

      const duplicate = listSessionApprovalRequests().find(
        (item) =>
          String(item.status || '').trim().toLowerCase() === 'pending' &&
          normalizeSessionGrantAddress(item.userEoa || '') === userEoa &&
          normalizeSessionGrantAddress(item.sessionAddress || '') === sessionAddress &&
          String(item?.payload?.nonce || '').trim() === payload.nonce
      );
      if (duplicate) {
        const existing = buildSessionApprovalRequestPayload(duplicate, { includeToken: true });
        return res.status(409).json({
          ok: false,
          error: 'approval_request_duplicate',
          reason: 'A pending approval request already exists for this user/session/nonce.',
          traceId: req.traceId || '',
          approvalRequest: existing
        });
      }

      const approvalRequestId = createTraceId('apr');
      const approvalToken = buildApprovalRequestToken();
      const createdAt = Date.now();
      const record = appendSessionApprovalRequest({
        approvalRequestId,
        approvalToken,
        executionMode: 'external',
        userEoa,
        sessionAddress,
        payload,
        status: 'pending',
        createdAt,
        updatedAt: createdAt,
        traceId: req.traceId || ''
      });

      return res.json({
        ok: true,
        traceId: req.traceId || '',
        approvalRequest: buildSessionApprovalRequestPayload(record, { includeToken: true })
      });
    } catch (error) {
      return res.status(Number(error?.statusCode || 0) || 500).json({
        ok: false,
        error: error?.code || 'approval_request_create_failed',
        reason: error?.message || 'approval_request_create_failed',
        traceId: req.traceId || ''
      });
    }
  });

  app.get('/api/approvals', async (req, res) => {
    try {
      assertApprovalInboxAccess(req);
      const rows = filterUnifiedApprovalRows({
        state: req.query.state,
        approvalKind: req.query.approvalKind,
        owner: req.query.owner,
        limit: req.query.limit
      });
      const items = rows.map((record) => buildUnifiedApprovalPayload(record, { includeToken: false }));
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        total: items.length,
        meta: buildApprovalListMeta({
          state: req.query.state,
          approvalKind: req.query.approvalKind,
          owner: req.query.owner,
          limit: req.query.limit,
          rows
        }),
        items
      });
    } catch (error) {
      return res.status(Number(error?.statusCode || 0) || 500).json({
        ok: false,
        error: error?.code || 'approval_list_failed',
        reason: error?.message || 'approval_list_failed',
        traceId: req.traceId || ''
      });
    }
  });

  app.get('/api/approvals/:approvalId', async (req, res) => {
    try {
      const approvalId = String(req.params.approvalId || '').trim();
      const approvalToken = String(req.query.token || '').trim();
      const record = getSessionApprovalRecordOrThrow(approvalId, approvalToken, req);
      const responsePayload = buildApprovalReadResponse(record, { includeToken: true });
      const wantsHtml = !String(req.headers.accept || '').toLowerCase().includes('application/json');
      if (wantsHtml) {
        const frontendUrl = String(responsePayload.approval?.approvalUrl || '').trim();
        if (frontendUrl && !frontendUrl.includes('/api/approvals/')) {
          return res.redirect(302, frontendUrl);
        }
      }
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        ...responsePayload
      });
    } catch (error) {
      return res.status(Number(error?.statusCode || 0) || 500).json({
        ok: false,
        error: error?.code || 'approval_request_read_failed',
        reason: error?.message || 'approval_request_read_failed',
        traceId: req.traceId || ''
      });
    }
  });

  app.post('/api/approvals/:approvalId/approve', async (req, res) => {
    try {
      const approvalId = String(req.params.approvalId || '').trim();
      const approvalToken = String(req.query.token || req.body?.token || '').trim();
      const completed = await finalizeSessionApprovalRecord({
        approvalRequestId: approvalId,
        approvalToken,
        body: req.body || {},
        traceId: req.traceId || '',
        req
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        ...completed.response
      });
    } catch (error) {
      return res.status(Number(error?.statusCode || 0) || 500).json({
        ok: false,
        error: error?.code || 'approval_request_complete_failed',
        reason: error?.message || 'approval_request_complete_failed',
        traceId: req.traceId || ''
      });
    }
  });

  app.post('/api/approvals/:approvalId/reject', async (req, res) => {
    try {
      const approvalId = String(req.params.approvalId || '').trim();
      const approvalToken = String(req.query.token || req.body?.token || '').trim();
      const responsePayload = rejectSessionApprovalRecord({
        approvalRequestId: approvalId,
        approvalToken,
        reason: req.body?.reason || req.body?.note || '',
        req
      });
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        ...responsePayload
      });
    } catch (error) {
      return res.status(Number(error?.statusCode || 0) || 500).json({
        ok: false,
        error: error?.code || 'approval_request_reject_failed',
        reason: error?.message || 'approval_request_reject_failed',
        traceId: req.traceId || ''
      });
    }
  });

  app.get('/api/session/approval/:approvalRequestId', async (req, res) => {
    try {
      const approvalRequestId = String(req.params.approvalRequestId || '').trim();
      const approvalToken = String(req.query.token || '').trim();
      const record = getSessionApprovalRecordOrThrow(approvalRequestId, approvalToken);
      const payload = buildSessionApprovalRequestPayload(record, { includeToken: true });
      const wantsHtml = !String(req.headers.accept || '').toLowerCase().includes('application/json');
      if (wantsHtml) {
        const frontendUrl = buildApprovalRequestUrl(
          payload.approvalRequestId,
          payload.approvalToken,
          payload?.payload?.audience || ''
        );
        if (frontendUrl && !frontendUrl.includes('/api/session/approval/')) {
          return res.redirect(302, frontendUrl);
        }
        const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>KTRACE Session Approval</title></head>
<body>
<h1>KTRACE Session Approval</h1>
<p>Status: ${payload.status || '-'}</p>
<p>Approval Request: ${payload.approvalRequestId || '-'}</p>
<p>User EOA: ${payload.userEoa || '-'}</p>
<p>Session Address: ${payload.sessionAddress || '-'}</p>
<p>This approval URL is ready. Use a wallet-aware client or the ktrace CLI to complete the session approval.</p>
<pre>${JSON.stringify(payload, null, 2)}</pre>
</body>
</html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      }

      return res.json({
        ok: true,
        traceId: req.traceId || '',
        approvalRequest: payload,
        authorization: payload.authorization || null,
        runtime: payload.runtime || null,
        session: payload.session || null
      });
    } catch (error) {
      return res.status(Number(error?.statusCode || 0) || 500).json({
        ok: false,
        error: error?.code || 'approval_request_read_failed',
        reason: error?.message || 'approval_request_read_failed',
        traceId: req.traceId || ''
      });
    }
  });

  app.post('/api/session/approval/:approvalRequestId/complete', async (req, res) => {
    try {
      const approvalRequestId = String(req.params.approvalRequestId || '').trim();
      const approvalToken = String(req.query.token || req.body?.token || '').trim();
      const completed = await finalizeSessionApprovalRecord({
        approvalRequestId,
        approvalToken,
        body: req.body || {},
        traceId: req.traceId || ''
      });

      return res.json({
        ok: true,
        traceId: req.traceId || '',
        approvalRequest: buildSessionApprovalRequestPayload(completed.record, { includeToken: true }),
        authorization: completed.response.authorization,
        session: completed.response.session,
        runtime: completed.response.runtime
      });
    } catch (error) {
      return res.status(Number(error?.statusCode || 0) || 500).json({
        ok: false,
        error: error?.code || 'approval_request_complete_failed',
        reason: error?.message || 'approval_request_complete_failed',
        traceId: req.traceId || '',
        ...(error?.data && typeof error.data === 'object' ? error.data : {})
      });
    }
  });
  
  app.post('/api/aa/ensure', requireRole('admin'), async (req, res) => {
    try {
      const body = req.body || {};
      const runtime = readSessionRuntime();
      const owner = String(body.owner || runtime.owner || '').trim();
      const saltRaw = String(body.salt ?? process.env.KITECLAW_AA_SALT ?? '0').trim();
      let salt = 0n;
      try {
        salt = BigInt(saltRaw || '0');
      } catch {
        return res.status(400).json({
          ok: false,
          error: 'invalid_salt',
          reason: `Invalid salt: ${saltRaw}`,
          traceId: req.traceId || ''
        });
      }
  
      const ensured = await ensureAAAccountDeployment({ owner, salt });
      const merged = writeSessionRuntime({
        ...runtime,
        aaWallet: ensured.accountAddress,
        owner: ensured.owner,
        source: 'aa-ensure',
        updatedAt: Date.now()
      });
  
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        aaWallet: ensured.accountAddress,
        owner: ensured.owner,
        salt: ensured.salt,
        deployed: ensured.deployed,
        createdNow: ensured.createdNow,
        txHash: ensured.txHash,
        runtime: buildSessionRuntimePayload(merged)
      });
    } catch (error) {
      const isSignerErr =
        /backend signer unavailable|KITECLAW_BACKEND_SIGNER_PRIVATE_KEY/i.test(String(error?.message || ''));
      return res.status(isSignerErr ? 503 : 400).json({
        ok: false,
        error: isSignerErr ? 'backend_signer_unavailable' : 'aa_ensure_failed',
        reason: error?.message || 'aa_ensure_failed',
        traceId: req.traceId || ''
      });
    }
  });
  
  app.delete('/api/session/runtime', requireRole('admin'), (req, res) => {
    writeJsonObject(sessionRuntimePath, {});
    return res.json({ ok: true, cleared: true });
  });
  
  app.get('/api/identity', requireRole('viewer'), async (req, res) => {
    try {
      const profile = await readIdentityProfile({
        registry: req.query.identityRegistry,
        agentId: req.query.agentId
      });
      res.json({ ok: true, profile });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: 'identity_read_failed',
        reason: error.message
      });
    }
  });
  
  app.get('/api/identity/current', requireRole('viewer'), async (req, res) => {
    try {
      const profile = await readIdentityProfile({});
      return res.json({ ok: true, profile });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'identity_read_failed',
        reason: error.message
      });
    }
  });
  
  app.post('/api/identity/challenge', requireRole('viewer'), async (req, res) => {
    try {
      const body = req.body || {};
      const profile = await readIdentityProfile({
        registry: body.identityRegistry || body.registry,
        agentId: body.agentId
      });
      if (!profile?.available) {
        return res.status(400).json({
          ok: false,
          error: 'identity_unavailable',
          reason: profile?.reason || 'identity_unavailable',
          profile: buildIdentitySummary(profile),
          traceId: req.traceId || ''
        });
      }
  
      const agentWallet = normalizeAddress(profile.agentWallet || '');
      if (!ethers.isAddress(agentWallet)) {
        return res.status(400).json({
          ok: false,
          error: 'identity_wallet_invalid',
          reason: 'Configured identity wallet is invalid.',
          profile: buildIdentitySummary(profile),
          traceId: req.traceId || ''
        });
      }
  
      if (!isIdentitySignatureRequired()) {
        return res.json({
          ok: true,
          traceId: req.traceId || '',
          challenge: {
            mode: 'registry',
            signatureRequired: false
          },
          profile: buildIdentitySummary(profile)
        });
      }
  
      const now = Date.now();
      const challengeId = createTraceId('idv');
      const nonce = `0x${crypto.randomBytes(16).toString('hex')}`;
      const ttl = Number.isFinite(IDENTITY_CHALLENGE_TTL_MS) && IDENTITY_CHALLENGE_TTL_MS > 0
        ? IDENTITY_CHALLENGE_TTL_MS
        : 120_000;
      const expiresAt = now + ttl;
      const message = createIdentityChallengeMessage({
        challengeId,
        traceId: req.traceId || '',
        nonce,
        issuedAt: now,
        expiresAt,
        profile
      });
  
      const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
      rows.unshift({
        challengeId,
        traceId: req.traceId || '',
        nonce,
        message,
        issuedAt: now,
        expiresAt,
        identity: {
          registry: String(profile?.configured?.registry || ''),
          agentId: String(profile?.configured?.agentId || ''),
          agentWallet
        },
        status: 'issued'
      });
      writeIdentityChallenges(normalizeIdentityChallengeRows(rows));
  
      return res.json({
        ok: true,
        traceId: req.traceId || '',
        challenge: {
          challengeId,
          message,
          issuedAt: new Date(now).toISOString(),
          expiresAt: new Date(expiresAt).toISOString(),
          ttlMs: ttl
        },
        profile: buildIdentitySummary(profile)
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'identity_challenge_failed',
        reason: error?.message || 'challenge failed',
        traceId: req.traceId || ''
      });
    }
  });
  
  app.post('/api/identity/verify', requireRole('viewer'), async (req, res) => {
    try {
      const body = req.body || {};
      const challengeId = String(body.challengeId || '').trim();
      const signature = String(body.signature || '').trim();
      if (!challengeId) {
        return res.status(400).json({
          ok: false,
          error: 'challenge_required',
          reason: 'challengeId is required.',
          traceId: req.traceId || ''
        });
      }
      if (!signature) {
        return res.status(400).json({
          ok: false,
          error: 'signature_required',
          reason: 'signature is required.',
          traceId: req.traceId || ''
        });
      }
  
      const rows = normalizeIdentityChallengeRows(readIdentityChallenges());
      const idx = rows.findIndex((item) => String(item?.challengeId || '') === challengeId);
      if (idx < 0) {
        return res.status(404).json({
          ok: false,
          error: 'challenge_not_found',
          reason: 'challenge not found',
          traceId: req.traceId || ''
        });
      }
  
      const entry = rows[idx];
      const now = Date.now();
      if (Number(entry.usedAt || 0) > 0) {
        return res.status(409).json({
          ok: false,
          error: 'challenge_used',
          reason: 'challenge already used',
          traceId: req.traceId || ''
        });
      }
      if (now > Number(entry.expiresAt || 0)) {
        entry.status = 'expired';
        rows[idx] = entry;
        writeIdentityChallenges(normalizeIdentityChallengeRows(rows));
        return res.status(410).json({
          ok: false,
          error: 'challenge_expired',
          reason: 'challenge expired',
          traceId: req.traceId || ''
        });
      }
  
      const profile = await readIdentityProfile({
        registry: entry?.identity?.registry || '',
        agentId: entry?.identity?.agentId || ''
      });
      if (!profile?.available) {
        return res.status(400).json({
          ok: false,
          error: 'identity_unavailable',
          reason: profile?.reason || 'identity_unavailable',
          profile: buildIdentitySummary(profile),
          traceId: req.traceId || ''
        });
      }
  
      const expectedWallet = normalizeAddress(profile.agentWallet || '');
      if (!ethers.isAddress(expectedWallet)) {
        return res.status(400).json({
          ok: false,
          error: 'identity_wallet_invalid',
          reason: 'Configured identity wallet is invalid.',
          profile: buildIdentitySummary(profile),
          traceId: req.traceId || ''
        });
      }
  
      let recoveredAddress = '';
      try {
        recoveredAddress = normalizeAddress(ethers.verifyMessage(String(entry.message || ''), signature));
      } catch (error) {
        return res.status(401).json({
          ok: false,
          error: 'invalid_signature',
          reason: error?.message || 'invalid signature',
          traceId: req.traceId || ''
        });
      }
  
      if (recoveredAddress !== expectedWallet) {
        return res.status(401).json({
          ok: false,
          error: 'invalid_signature',
          reason: 'signature does not match configured agent wallet',
          expected: expectedWallet,
          recovered: recoveredAddress,
          traceId: req.traceId || ''
        });
      }
  
      entry.status = 'verified';
      entry.usedAt = now;
      entry.verifiedAt = now;
      entry.recoveredAddress = recoveredAddress;
      rows[idx] = entry;
      writeIdentityChallenges(normalizeIdentityChallengeRows(rows));
  
      return res.json({
        ok: true,
        verified: true,
        traceId: req.traceId || '',
        challengeId,
        verifiedAt: new Date(now).toISOString(),
        profile: buildIdentitySummary(profile)
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'identity_verify_failed',
        reason: error?.message || 'identity verify failed',
        traceId: req.traceId || ''
      });
    }
  });
  
  app.get('/api/demo/identity/latest', requireRole('viewer'), (req, res) => {
    const latest = getLatestIdentityChallengeSnapshot();
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      verifyMode: IDENTITY_VERIFY_MODE,
      latest
    });
  });
  
  app.get('/api/x402/mapping/latest', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 200));
    const workflows = readWorkflows();
    const workflowByRequestId = buildLatestWorkflowByRequestId(workflows);
    const rows = readX402Requests()
      .map((item) => mapX402Item(item, workflowByRequestId.get(String(item?.requestId || '').trim()) || null))
      .slice(0, limit);
    const kpi = computeDashboardKpi(readX402Requests());
    return res.json({ ok: true, total: rows.length, kpi, items: rows });
  });
  
  app.get('/api/demo/price-series', requireRole('viewer'), (req, res) => {
    const { limit, series } = buildDemoPriceSeries(req.query.limit);
    return res.json({
      ok: true,
      traceId: req.traceId || '',
      window: {
        limit,
        intervalSec: 60
      },
      series
    });
  });
  
  app.get('/api/onchain/latest', requireRole('viewer'), (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 20), 200));
    const paidRows = readX402Requests()
      .filter((item) => String(item.status || '').toLowerCase() === 'paid' && (item.paymentTxHash || item?.paymentProof?.txHash))
      .map((item) => ({
        source: 'x402',
        requestId: item.requestId || '',
        txHash: item.paymentTxHash || item?.paymentProof?.txHash || '',
        payer: item.payer || '',
        from: item.payer || '',
        to: item.recipient || '',
        amount: item.amount || '',
        tokenAddress: item.tokenAddress || '',
        block: item?.proofVerification?.details?.blockNumber || '',
        time: Number(item.paidAt || item.createdAt || 0) > 0
          ? new Date(Number(item.paidAt || item.createdAt)).toISOString()
          : ''
      }));
  
    const recordRows = readRecords()
      .filter((row) => row && row.txHash)
      .map((row) => ({
        source: row.type || 'record',
        requestId: row.requestId || '',
        txHash: row.txHash || '',
        payer: row.aaWallet || '',
        from: row.aaWallet || '',
        to: row.recipient || '',
        amount: row.amount || '',
        tokenAddress: row.token || '',
        block: row.block || '',
        time: row.time || ''
      }));
  
    const merged = [...paidRows, ...recordRows];
    const dedup = [];
    const seen = new Set();
    for (const row of merged) {
      const key = String(row.txHash || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      dedup.push(row);
    }
    dedup.sort((a, b) => {
      const ta = Date.parse(a.time || 0) || 0;
      const tb = Date.parse(b.time || 0) || 0;
      return tb - ta;
    });
  
    return res.json({ ok: true, total: dedup.length, items: dedup.slice(0, limit) });
  });
  
  app.post('/api/chat/agent', requireRole('agent'), async (req, res) => {
    const message = String(req.body?.message || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();
    const traceId = String(req.body?.traceId || `trace_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`).trim();
    const agent = String(req.body?.agent || '').trim();
    const history = Array.isArray(req.body?.history)
      ? req.body.history
          .slice(-20)
          .map((item) => ({
            role: String(item?.role || '').trim(),
            content: String(item?.content || item?.text || item?.message || '').trim()
          }))
          .filter((item) => item.content)
      : [];
  
    if (!message) {
      return res.status(400).json({
        ok: false,
        error: 'message_required',
        reason: 'message is required',
        traceId
      });
    }
  
    try {
      const runtime = readSessionRuntime();
      const inferStopOrderIntent = ({ text = '', suggestions = [] }) => {
        const fromSuggestions = Array.isArray(suggestions)
          ? suggestions.find((item) => {
              const action = String(item?.action || '').trim().toLowerCase();
              const endpoint = String(item?.endpoint || '').trim().toLowerCase();
              return (
                action === 'place_stop_order' ||
                action === 'reactive-stop-orders' ||
                endpoint.includes('/workflow/stop-order/run') ||
                endpoint.includes('/a2a/tasks/stop-orders')
              );
            })
          : null;
  
        if (fromSuggestions) {
          try {
            const params = fromSuggestions?.params || fromSuggestions?.task || {};
            return normalizeReactiveParams(params);
          } catch {
            // fall through to text parser
          }
        }
  
        const raw = String(text || '').trim();
        if (!raw) return null;
        const triggerLike = /(stop[\s-]*order|reactive\s*stop|a2a|agent\s*to\s*agent|a\s*to\s*a|tp|sl)/i.test(raw);
        if (!triggerLike) return null;
  
        const symbolCandidates = Array.from(
          raw.matchAll(/\b([A-Za-z]{2,10}\s*[-/]\s*[A-Za-z]{2,10})\b/g),
          (m) => String(m?.[1] || '').replace(/\s+/g, '').replace('/', '-').toUpperCase()
        ).filter(Boolean);
        const symbolFromText =
          symbolCandidates.find((s) => /(USDT|USD|BTC|ETH|BNB|SOL)$/.test(s.split('-')[1] || '')) ||
          symbolCandidates.find((s) => s !== 'STOP-ORDER' && s !== 'TAKE-PROFIT' && s !== 'STOP-LOSS') ||
          '';
        const tpMatch = raw.match(/(?:\btp\b|take\s*profit)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        const slMatch = raw.match(/(?:\bsl\b|stop\s*loss)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        const qtyMatch = raw.match(/(?:\bqty\b|quantity|size|amount)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        if (!tpMatch || !slMatch) return null;
  
        try {
          const parsed = {
            symbol: symbolFromText || 'BTC-USDT',
            takeProfit: Number(tpMatch[1]),
            stopLoss: Number(slMatch[1])
          };
          if (qtyMatch) {
            parsed.quantity = Number(qtyMatch[1]);
          }
          return normalizeReactiveParams(parsed);
        } catch {
          return null;
        }
      };
  
      const runStopOrderWorkflow = async ({ intent, workflowTraceId }) => {
        const internalApiKey = getInternalAgentApiKey();
        const headers = { 'Content-Type': 'application/json' };
        if (internalApiKey) {
          headers['x-api-key'] = internalApiKey;
        }
        const payer = normalizeAddress(req.body?.payer || runtime?.aaWallet || '');
        const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
        const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
        const workflowResp = await fetch(`http://127.0.0.1:${PORT}/api/workflow/stop-order/run`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            symbol: intent.symbol,
            takeProfit: intent.takeProfit,
            stopLoss: intent.stopLoss,
            ...(Number.isFinite(intent.quantity) ? { quantity: intent.quantity } : {}),
            payer,
            sourceAgentId,
            targetAgentId,
            traceId: workflowTraceId
          })
        });
        const workflowBody = await workflowResp.json().catch(() => ({}));
        return {
          ok: workflowResp.ok && Boolean(workflowBody?.ok),
          status: workflowResp.status,
          body: workflowBody
        };
      };
  
      const fallbackIntent = inferStopOrderIntent({ text: message, suggestions: [] });
      let result = await llmAdapter.chat({
        message,
        sessionId,
        traceId,
        history,
        agent,
        context: {
          aaWallet: runtime?.aaWallet || '',
          owner: runtime?.owner || '',
          runtimeReady: Boolean(runtime?.sessionAddress && runtime?.sessionPrivateKey)
        }
      });
  
      if (!result?.ok && fallbackIntent) {
        result = {
          ok: true,
          mode: 'intent-fallback',
          reply: 'Intent recognized. Running x402 stop-order workflow now.',
          traceId,
          state: 'intent_recognized',
          step: 'intent_parsed',
          suggestions: [
            {
              action: 'place_stop_order',
              endpoint: '/api/workflow/stop-order/run',
              params: fallbackIntent
            }
          ]
        };
      }
  
      if (!result?.ok) {
        return res.status(result?.statusCode || 503).json({
          ok: false,
          error: result?.error || 'llm_adapter_error',
          reason: result?.reason || 'LLM adapter failed',
          traceId: result?.traceId || traceId
        });
      }
  
      const resolvedSuggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
      const intent = inferStopOrderIntent({ text: message, suggestions: resolvedSuggestions });
      const nextTraceId = String(result.traceId || traceId).trim() || traceId;
  
      if (intent) {
        const workflow = await runStopOrderWorkflow({
          intent,
          workflowTraceId: nextTraceId
        });
        if (!workflow.ok) {
          return res.status(workflow.status || 500).json({
            ok: false,
            mode: 'x402',
            error: workflow.body?.error || 'workflow_failed',
            reason: workflow.body?.reason || `workflow failed: HTTP ${workflow.status}`,
            traceId: nextTraceId,
            state: workflow.body?.state || 'failed',
            step: 'workflow_failed'
          });
        }
  
        return res.json({
          ok: true,
          mode: 'x402',
          reply:
            workflow.body?.state === 'unlocked'
              ? `A2A stop-order unlocked: ${intent.symbol} TP ${intent.takeProfit} SL ${intent.stopLoss}${
                Number.isFinite(intent.quantity) ? ` QTY ${intent.quantity}` : ''
              }`
              : (result.reply || 'Workflow accepted.'),
          traceId: nextTraceId,
          sessionId: sessionId || null,
          state: workflow.body?.state || 'unlocked',
          step: workflow.body?.state === 'unlocked' ? 'workflow_unlocked' : 'workflow_running',
          requestId: workflow.body?.requestId || workflow.body?.workflow?.requestId || '',
          txHash: workflow.body?.txHash || workflow.body?.workflow?.txHash || '',
          userOpHash: workflow.body?.userOpHash || workflow.body?.workflow?.userOpHash || '',
          suggestions: resolvedSuggestions
        });
      }
  
      return res.json({
        ok: true,
        mode: result.mode || 'local-fallback',
        reply: result.reply || 'Received.',
        traceId: nextTraceId,
        sessionId: sessionId || null,
        state: result.state || 'received',
        step: result.step || 'chat_received',
        suggestions: resolvedSuggestions
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'chat_agent_internal_error',
        reason: error?.message || 'chat failed',
        traceId
      });
    }
  });
  
  app.get('/api/chat/agent/health', requireRole('viewer'), async (req, res) => {
    try {
      const adapterInfo = typeof llmAdapter.info === 'function' ? llmAdapter.info() : {};
      const health = await llmAdapter.health();
      if (!health?.ok) {
        return res.status(503).json({
          ok: false,
          error: 'llm_unreachable',
          mode: health?.mode || 'remote',
          connected: false,
          reason: health?.reason || 'LLM health check failed',
          adapter: adapterInfo,
          traceId: req.traceId || ''
        });
      }
      return res.json({
        ok: true,
        mode: health.mode || 'local-fallback',
        connected: Boolean(health.connected),
        reason: health.reason || 'ok',
        adapter: adapterInfo,
        traceId: req.traceId || ''
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'llm_health_error',
        connected: false,
        reason: error?.message || 'LLM health failed',
        traceId: req.traceId || ''
      });
    }
  });
  
}



