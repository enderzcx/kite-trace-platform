import { registerCoreIdentityAgentChatRoutes } from './coreIdentityAgentChatRoutes.js';
import { registerCoreIdentityApprovalRoutes } from './coreIdentityApprovalRoutes.js';
import { registerCoreIdentityIdentityRoutes } from './coreIdentityIdentityRoutes.js';
import { registerCoreIdentitySessionRoutes } from './coreIdentitySessionRoutes.js';
import { deriveAaAccountCapabilities } from '../lib/aaConfig.js';

export function registerCoreIdentityChatRoutes(app, deps) {
  const {
    BACKEND_ENTRYPOINT_ADDRESS,
    BACKEND_RPC_URL,
    KITE_AA_ACCOUNT_IMPLEMENTATION,
    KITE_AA_FACTORY_ADDRESS,
    MERCHANT_ADDRESS,
    POLICY_DAILY_LIMIT_DEFAULT,
    POLICY_MAX_PER_TX_DEFAULT,
    ROUTER_WALLET_KEY_NORMALIZED,
    SETTLEMENT_TOKEN,
    ERC8183_ESCROW_ADDRESS,
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
    KITE_AA_JOB_LANE_REQUIRED_VERSION,
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
  const ACTIVE_ACCOUNT_FACTORY_ADDRESS = normalizeAddress(KITE_AA_FACTORY_ADDRESS || '');
  const ACTIVE_ACCOUNT_IMPLEMENTATION_ADDRESS = normalizeAddress(KITE_AA_ACCOUNT_IMPLEMENTATION || '');
  const KNOWN_BAD_FACTORY_ADDRESSES = new Set(
    String(process.env.KITE_AA_KNOWN_BAD_FACTORIES || '0x7112E8A6D6fC03fCab33E4FE3f8207F1eA9Be243')
      .split(',')
      .map((item) => normalizeAddress(item || ''))
      .filter(Boolean)
  );

  function createBackendRpcProvider() {
    const rpcRequest = new ethers.FetchRequest(BACKEND_RPC_URL);
    rpcRequest.timeout = Math.max(
      60_000,
      Number(process.env.KITE_BUNDLER_RPC_TIMEOUT_MS || 0) * 4,
      15_000
    );
    return new ethers.JsonRpcProvider(rpcRequest);
  }

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

  function verifySessionAuthorizationSignature({ payload = {}, userEoa = '', signature = '' } = {}) {
    const normalizedUserEoa = normalizeSessionGrantAddress(userEoa || '');
    const normalizedSignature = normalizeSessionGrantText(signature);
    if (!normalizedUserEoa || !normalizedSignature) {
      return {
        ok: false,
        recoveredAddress: ''
      };
    }
    const messages = [
      createSessionAuthorizationMessage({ payload, userEoa: normalizedUserEoa }),
      buildSessionGrantMessage(payload)
    ];
    for (const message of messages) {
      let recoveredAddress = '';
      try {
        recoveredAddress = normalizeSessionGrantAddress(ethers.verifyMessage(message, normalizedSignature));
      } catch {
        recoveredAddress = '';
      }
      if (recoveredAddress && recoveredAddress === normalizedUserEoa) {
        return {
          ok: true,
          recoveredAddress,
          message
        };
      }
    }
    return {
      ok: false,
      recoveredAddress: ''
    };
  }

  function hashSessionGrantPayload(payloadInput = {}) {
    const payload = normalizeSessionGrantPayload(payloadInput);
    return ethers.keccak256(ethers.toUtf8Bytes(buildSessionGrantMessage(payload)));
  }

  function deriveRuntimeHealth(runtime = {}) {
    const runtimeFactoryAddress = normalizeAddress(runtime.accountFactoryAddress || '');
    if (runtimeFactoryAddress && ACTIVE_ACCOUNT_FACTORY_ADDRESS && runtimeFactoryAddress === ACTIVE_ACCOUNT_FACTORY_ADDRESS) {
      return 'active_default';
    }
    if (runtimeFactoryAddress && KNOWN_BAD_FACTORY_ADDRESSES.has(runtimeFactoryAddress)) {
      return 'known_bad_factory';
    }
    if (runtimeFactoryAddress || normalizeAddress(runtime.aaWallet || '')) {
      return 'historical_non_default';
    }
    return '';
  }

  function clearSessionAuthorizationState(runtime = {}) {
    return {
      ...runtime,
      sessionAddress: '',
      sessionPrivateKey: '',
      sessionId: '',
      sessionTxHash: '',
      expiresAt: 0,
      authorizationPayload: null,
      authorizationPayloadHash: '',
      authorizationSignature: '',
      authorizationNonce: '',
      authorizationExpiresAt: 0,
      authorizedBy: '',
      authorizedAt: 0,
      authorizationMode: '',
      authorizedAgentId: '',
      authorizedAgentWallet: '',
      authorizationAudience: '',
      allowedCapabilities: [],
      allowedProviders: [],
      allowedRecipients: [],
      totalLimit: 0,
      authorityId: '',
      consumerAgentLabel: '',
      authorityExpiresAt: 0,
      authorityStatus: '',
      authorityRevokedAt: 0,
      authorityRevocationReason: '',
      authorityCreatedAt: 0,
      authorityUpdatedAt: 0
    };
  }

  function shouldResetRuntimeState(currentRuntime = {}, nextRuntime = {}) {
    const currentAaWallet = normalizeAddress(currentRuntime.aaWallet || '');
    const nextAaWallet = normalizeAddress(nextRuntime.aaWallet || currentAaWallet || '');
    const currentFactoryAddress = normalizeAddress(currentRuntime.accountFactoryAddress || '');
    const nextFactoryAddress = normalizeAddress(
      nextRuntime.accountFactoryAddress || currentFactoryAddress || ACTIVE_ACCOUNT_FACTORY_ADDRESS || ''
    );
    return Boolean(
      (currentAaWallet && nextAaWallet && currentAaWallet !== nextAaWallet) ||
        (currentFactoryAddress && nextFactoryAddress && currentFactoryAddress !== nextFactoryAddress) ||
        deriveRuntimeHealth(currentRuntime) === 'known_bad_factory'
    );
  }

  function buildSessionRuntimeBase(currentRuntime = {}, overrides = {}) {
    const runtimeVersionSnapshot = deriveAaAccountCapabilities({
      accountVersion: String(overrides.accountVersion ?? currentRuntime.accountVersion ?? '').trim(),
      accountVersionTag: String(
        overrides.accountVersionTag ??
          overrides.accountVersion ??
          currentRuntime.accountVersionTag ??
          currentRuntime.accountVersion ??
          ''
      ).trim(),
      accountCapabilities:
        overrides.accountCapabilities ??
        currentRuntime.accountCapabilities ??
        {},
      requiredForJobLane:
        overrides.requiredForJobLane ??
        currentRuntime.requiredForJobLane ??
        ''
    });
    const previewRuntime = {
      owner: normalizeAddress(overrides.owner || currentRuntime.owner || ''),
      aaWallet: normalizeAddress(overrides.aaWallet || currentRuntime.aaWallet || ''),
      tokenAddress: normalizeAddress(overrides.tokenAddress || currentRuntime.tokenAddress || ''),
      gatewayRecipient: normalizeAddress(
        overrides.gatewayRecipient || currentRuntime.gatewayRecipient || ''
      ),
      accountFactoryAddress: normalizeAddress(
        overrides.accountFactoryAddress ||
          currentRuntime.accountFactoryAddress ||
          ACTIVE_ACCOUNT_FACTORY_ADDRESS ||
          ''
      ),
      accountImplementationAddress: normalizeAddress(
        overrides.accountImplementationAddress ||
          currentRuntime.accountImplementationAddress ||
          ACTIVE_ACCOUNT_IMPLEMENTATION_ADDRESS ||
          ''
      ),
      maxPerTx: Number(
        overrides.maxPerTx ?? currentRuntime.maxPerTx ?? 0
      ),
      dailyLimit: Number(
        overrides.dailyLimit ?? currentRuntime.dailyLimit ?? 0
      ),
      accountVersion: String(
        overrides.accountVersion ?? currentRuntime.accountVersion ?? ''
      ).trim(),
      accountVersionTag: runtimeVersionSnapshot.accountVersionTag,
      accountCapabilities: runtimeVersionSnapshot.accountCapabilities,
      requiredForJobLane: runtimeVersionSnapshot.requiredForJobLane,
      runtimePurpose:
        normalizeSessionGrantText(
          overrides.runtimePurpose,
          currentRuntime.runtimePurpose || 'consumer'
        ) || 'consumer',
      source: normalizeSessionGrantText(
        overrides.source,
        currentRuntime.source || ''
      ),
      updatedAt: Number(overrides.updatedAt || Date.now())
    };
    const baseRuntime = shouldResetRuntimeState(currentRuntime, previewRuntime)
      ? clearSessionAuthorizationState(currentRuntime)
      : { ...currentRuntime };
    const nextRuntime = {
      ...baseRuntime,
      ...previewRuntime,
      ...Object.fromEntries(
        Object.entries(overrides).filter(([key]) =>
          ![
            'owner',
            'aaWallet',
            'tokenAddress',
            'gatewayRecipient',
            'accountFactoryAddress',
            'accountImplementationAddress',
            'maxPerTx',
            'dailyLimit',
            'accountVersion',
            'accountVersionTag',
            'accountCapabilities',
            'requiredForJobLane',
            'runtimePurpose',
            'source',
            'updatedAt'
          ].includes(key)
        )
      )
    };
    nextRuntime.runtimeHealth = deriveRuntimeHealth(nextRuntime);
    return nextRuntime;
  }

  function buildSessionRuntimePayload(runtime = {}) {
    const runtimeFactoryAddress = normalizeAddress(runtime.accountFactoryAddress || '');
    const runtimeHealth = deriveRuntimeHealth(runtime);
    const runtimeVersionSnapshot = deriveAaAccountCapabilities({
      accountVersion: runtime.accountVersion,
      accountVersionTag: runtime.accountVersionTag,
      accountCapabilities: runtime.accountCapabilities,
      requiredForJobLane: runtime.requiredForJobLane
    });
    return {
      ...runtime,
      accountVersionTag: runtimeVersionSnapshot.accountVersionTag || String(runtime.accountVersion || '').trim(),
      accountCapabilities: runtimeVersionSnapshot.accountCapabilities,
      requiredForJobLane: runtimeVersionSnapshot.requiredForJobLane,
      activeAccountFactoryAddress: ACTIVE_ACCOUNT_FACTORY_ADDRESS,
      activeAccountImplementationAddress: ACTIVE_ACCOUNT_IMPLEMENTATION_ADDRESS,
      activeEscrowAddress: normalizeAddress(ERC8183_ESCROW_ADDRESS || ''),
      activeSettlementTokenAddress: normalizeAddress(runtime.tokenAddress || SETTLEMENT_TOKEN || ''),
      isDefaultFactoryRuntime: Boolean(
        runtimeFactoryAddress &&
          ACTIVE_ACCOUNT_FACTORY_ADDRESS &&
          runtimeFactoryAddress === ACTIVE_ACCOUNT_FACTORY_ADDRESS
      ),
      runtimeHealth,
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
    const fallback =
      String(audience || '').trim() ||
      String(process.env.BACKEND_PUBLIC_URL || '').trim() ||
      `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`;
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
      String(audience || '').trim() ||
      String(process.env.BACKEND_PUBLIC_URL || '').trim() ||
      `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`;
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

  async function finalizeSessionAuthorization({ body = {}, traceId = '', approvalRequest = null } = {}) {
    const rawPayload =
      body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : approvalRequest?.payload && typeof approvalRequest.payload === 'object' && !Array.isArray(approvalRequest.payload)
          ? approvalRequest.payload
          : {};
    const runtimeInput =
      body?.runtime && typeof body.runtime === 'object' && !Array.isArray(body.runtime)
        ? body.runtime
        : {};
    const executionModeRaw = normalizeSessionGrantText(
      body?.executionMode,
      approvalRequest?.executionMode || 'managed'
    ).toLowerCase();
    const executionMode =
      executionModeRaw === 'external' ||
      executionModeRaw === 'self-custodial' ||
      executionModeRaw === 'self_custodial'
        ? 'external'
        : 'managed';

    const fallbackRuntime =
      resolveSessionRuntime({
        owner:
          normalizeSessionGrantAddress(runtimeInput.owner || '') ||
          normalizeSessionGrantAddress(body?.owner || '') ||
          normalizeSessionGrantAddress(approvalRequest?.userEoa || '') ||
          normalizeSessionGrantAddress(body?.userEoa || ''),
        aaWallet: normalizeSessionGrantAddress(runtimeInput.aaWallet || body?.aaWallet || ''),
        sessionId: normalizeSessionGrantText(runtimeInput.sessionId || body?.sessionId || '')
      }) || readSessionRuntime();

    let defaultIdentityProfile = null;
    const missingIdentityFields =
      !String(rawPayload.agentId || '').trim() ||
      !normalizeAddress(rawPayload.agentWallet || '') ||
      !normalizeAddress(rawPayload.identityRegistry || '');
    if (missingIdentityFields) {
      try {
        defaultIdentityProfile = await readIdentityProfile({});
      } catch {
        defaultIdentityProfile = null;
      }
    }

    const fallbackPayload = {
      agentId:
        rawPayload.agentId ||
        String(defaultIdentityProfile?.configured?.agentId || defaultIdentityProfile?.agentId || '').trim() ||
        (ERC8004_AGENT_ID !== null ? String(ERC8004_AGENT_ID) : ''),
      agentWallet:
        rawPayload.agentWallet ||
        normalizeAddress(defaultIdentityProfile?.agentWallet || '') ||
        backendSigner?.address ||
        '',
      identityRegistry:
        rawPayload.identityRegistry ||
        normalizeAddress(defaultIdentityProfile?.configured?.registry || defaultIdentityProfile?.registry || '') ||
        ERC8004_IDENTITY_REGISTRY ||
        '',
      chainId: rawPayload.chainId || process.env.BACKEND_CHAIN_ID || '',
      payerAaWallet:
        rawPayload.payerAaWallet || runtimeInput.aaWallet || body?.aaWallet || fallbackRuntime?.aaWallet || '',
      tokenAddress: rawPayload.tokenAddress || runtimeInput.tokenAddress || fallbackRuntime?.tokenAddress || SETTLEMENT_TOKEN || '',
      gatewayRecipient:
        rawPayload.gatewayRecipient ||
        runtimeInput.gatewayRecipient ||
        fallbackRuntime?.gatewayRecipient ||
        MERCHANT_ADDRESS ||
        '',
      audience:
        rawPayload.audience ||
        String(process.env.BACKEND_PUBLIC_URL || '').trim() ||
        `http://127.0.0.1:${String(PORT || '').trim() || '3001'}`,
      singleLimit: rawPayload.singleLimit || runtimeInput.maxPerTx || fallbackRuntime?.maxPerTx || POLICY_MAX_PER_TX_DEFAULT,
      dailyLimit: rawPayload.dailyLimit || runtimeInput.dailyLimit || fallbackRuntime?.dailyLimit || POLICY_DAILY_LIMIT_DEFAULT,
      allowedCapabilities:
        rawPayload.allowedCapabilities ??
        runtimeInput.allowedCapabilities ??
        fallbackRuntime?.allowedCapabilities ??
        [],
      nonce: rawPayload.nonce || `0x${crypto.randomBytes(16).toString('hex')}`,
      issuedAt: rawPayload.issuedAt || Date.now(),
      expiresAt: rawPayload.expiresAt || Date.now() + 24 * 60 * 60 * 1000
    };
    const payload = normalizeSessionGrantPayload(rawPayload, fallbackPayload);
    const userEoa = normalizeSessionGrantAddress(
      body?.userEoa ||
        approvalRequest?.userEoa ||
        runtimeInput.owner ||
        fallbackRuntime?.owner ||
        ''
    );
    if (!userEoa) {
      const error = new Error('A valid userEoa is required for session authorization.');
      error.statusCode = 400;
      error.code = 'session_authorize_user_eoa_required';
      throw error;
    }
    if (!payload.agentId || !payload.agentWallet || !payload.identityRegistry) {
      const error = new Error('Session authorization payload is missing ERC-8004 identity fields.');
      error.statusCode = 400;
      error.code = 'session_authorize_identity_missing';
      error.data = { payload };
      throw error;
    }
    if (!payload.singleLimit || !payload.dailyLimit) {
      const error = new Error('Session authorization requires positive singleLimit and dailyLimit values.');
      error.statusCode = 400;
      error.code = 'session_authorize_limits_required';
      error.data = { payload };
      throw error;
    }
    if (!payload.expiresAt || Number(payload.expiresAt) <= Date.now()) {
      const error = new Error('Session authorization payload is already expired.');
      error.statusCode = 400;
      error.code = 'session_authorize_payload_expired';
      error.data = { payload };
      throw error;
    }

    const authorizationId = createTraceId('auth');
    const authorizedAt = Date.now();
    const authorizationPayloadHash = hashSessionGrantPayload(payload);
    const forceNewSession = /^(1|true|yes|on)$/i.test(String(body?.forceNewSession || '').trim());
    let ensured = { created: false, reused: false, runtime: fallbackRuntime };
    let nextRuntime;
    let authorizationMode = 'backend_managed_session';
    let userSignature = normalizeSessionGrantText(
      body?.userSignature || body?.authorizationSignature || runtimeInput.authorizationSignature || ''
    );

    if (executionMode === 'external') {
      if (!userSignature) {
        const error = new Error('userSignature is required for self-custodial session authorization.');
        error.statusCode = 400;
        error.code = 'session_authorize_signature_required';
        throw error;
      }
      const signatureCheck = verifySessionAuthorizationSignature({
        payload,
        userEoa,
        signature: userSignature
      });
      if (!signatureCheck.ok) {
        const error = new Error('userSignature does not match the supplied userEoa.');
        error.statusCode = 400;
        error.code = 'session_authorize_signature_invalid';
        error.data = {
          recoveredAddress: signatureCheck.recoveredAddress,
          userEoa,
          payloadHash: authorizationPayloadHash
        };
        throw error;
      }
      const runtimeBase = buildSessionRuntimeBase(fallbackRuntime, {
        owner: normalizeSessionGrantAddress(runtimeInput.owner || body?.owner || fallbackRuntime?.owner || userEoa),
        aaWallet: normalizeSessionGrantAddress(
          runtimeInput.aaWallet || body?.aaWallet || payload.payerAaWallet || fallbackRuntime?.aaWallet || ''
        ),
        tokenAddress: normalizeSessionGrantAddress(
          runtimeInput.tokenAddress || payload.tokenAddress || fallbackRuntime?.tokenAddress || ''
        ),
        gatewayRecipient: normalizeSessionGrantAddress(
          runtimeInput.gatewayRecipient || payload.gatewayRecipient || fallbackRuntime?.gatewayRecipient || ''
        ),
        accountFactoryAddress: ACTIVE_ACCOUNT_FACTORY_ADDRESS,
        accountImplementationAddress: ACTIVE_ACCOUNT_IMPLEMENTATION_ADDRESS,
        maxPerTx: runtimeInput.maxPerTx || fallbackRuntime?.maxPerTx || payload.singleLimit,
        dailyLimit: runtimeInput.dailyLimit || fallbackRuntime?.dailyLimit || payload.dailyLimit,
        source: normalizeSessionGrantText(
          runtimeInput.source,
          fallbackRuntime?.source || 'api-v1-session-authorize-external'
        ),
        updatedAt: authorizedAt
      });
      const verifiedRuntime = await verifyExternalSessionRuntime({
        runtime: {
          ...runtimeBase,
          ...runtimeInput,
          owner: runtimeBase.owner,
          aaWallet: runtimeBase.aaWallet,
          sessionAddress: normalizeSessionGrantAddress(
            runtimeInput.sessionAddress ||
              body?.sessionAddress ||
              approvalRequest?.sessionAddress ||
              runtimeBase.sessionAddress ||
              ''
          ),
          sessionId: normalizeSessionGrantText(runtimeInput.sessionId || body?.sessionId || runtimeBase.sessionId || ''),
          sessionTxHash: normalizeSessionGrantText(
            runtimeInput.sessionTxHash || body?.sessionTxHash || runtimeBase.sessionTxHash || ''
          ),
          gatewayRecipient: runtimeBase.gatewayRecipient,
          maxPerTx: runtimeBase.maxPerTx,
          dailyLimit: runtimeBase.dailyLimit,
          tokenAddress: runtimeBase.tokenAddress,
          source: runtimeBase.source
        },
        payload,
        userEoa
      });
      nextRuntime = writeSessionRuntime({
        ...runtimeBase,
        ...verifiedRuntime,
        tokenAddress: payload.tokenAddress,
        expiresAt: Number(payload.expiresAt || 0),
        authorizedBy: userEoa,
        authorizedAt,
        authorizationMode: 'user_grant_self_custodial',
        authorizationPayload: payload,
        authorizationPayloadHash,
        authorizationSignature: userSignature,
        authorizationNonce: payload.nonce,
        authorizationExpiresAt: payload.expiresAt,
        authorizedAgentId: payload.agentId,
        authorizedAgentWallet: payload.agentWallet,
        authorizationAudience: payload.audience,
        allowedCapabilities: payload.allowedCapabilities,
        runtimeHealth: deriveRuntimeHealth({
          ...runtimeBase,
          ...verifiedRuntime,
          accountFactoryAddress: ACTIVE_ACCOUNT_FACTORY_ADDRESS
        }),
        updatedAt: authorizedAt
      });
      ensured = { created: false, reused: true, runtime: nextRuntime };
      authorizationMode = 'user_grant_self_custodial';
    } else {
      if (userSignature) {
        const signatureCheck = verifySessionAuthorizationSignature({
          payload,
          userEoa,
          signature: userSignature
        });
        if (!signatureCheck.ok) {
          const error = new Error('userSignature does not match the supplied userEoa.');
          error.statusCode = 400;
          error.code = 'session_authorize_signature_invalid';
          error.data = {
            recoveredAddress: signatureCheck.recoveredAddress,
            userEoa,
            payloadHash: authorizationPayloadHash
          };
          throw error;
        }
      }
      ensured = await ensureBackendSessionRuntime({
        owner: normalizeSessionGrantAddress(body?.owner || fallbackRuntime?.owner || userEoa),
        singleLimit: payload.singleLimit,
        dailyLimit: payload.dailyLimit,
        tokenAddress: payload.tokenAddress,
        gatewayRecipient: payload.gatewayRecipient,
        forceNewSession
      });
      nextRuntime = writeSessionRuntime({
        ...ensured.runtime,
        tokenAddress: payload.tokenAddress,
        expiresAt: Number(payload.expiresAt || 0),
        authorizedBy: userEoa,
        authorizedAt,
        authorizationMode: 'backend_managed_session',
        authorizationPayload: payload,
        authorizationPayloadHash,
        authorizationSignature: userSignature,
        authorizationNonce: payload.nonce,
        authorizationExpiresAt: payload.expiresAt,
        authorizedAgentId: payload.agentId,
        authorizedAgentWallet: payload.agentWallet,
        authorizationAudience: payload.audience,
        allowedCapabilities: payload.allowedCapabilities,
        runtimeHealth: deriveRuntimeHealth(ensured.runtime),
        updatedAt: authorizedAt
      });
      ensured = { ...ensured, runtime: nextRuntime };
      authorizationMode = 'backend_managed_session';
      userSignature = '';
    }

    const authorizationRecord = appendSessionAuthorizationRecord({
      authorizationId,
      traceId: String(traceId || approvalRequest?.traceId || '').trim(),
      executionMode,
      authorizationMode,
      userEoa,
      userSignature,
      authorizedAt,
      authorizationPayloadHash,
      payload,
      runtime: nextRuntime,
      source:
        approvalRequest?.approvalRequestId
          ? 'approval_request'
          : executionMode === 'external'
            ? 'api-v1-session-authorize-external'
            : 'api-v1-session-authorize-managed'
    });

    return {
      authorizationId,
      authorizedAt,
      authorizationMode,
      authorizationPayloadHash,
      authorizationRecord,
      ensured,
      executionMode,
      nextRuntime,
      payload,
      userEoa,
      userSignature
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
    const provider = backendSigner?.provider || createBackendRpcProvider();
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

    let aaVersion = '';
    try {
      aaVersion = String(await withRpcReadRetry(() => account.version())).trim();
    } catch {
      aaVersion = '';
    }
    if (KITE_REQUIRE_AA_V2) {
      if (aaVersion !== AA_V2_VERSION_TAG) {
        throw new Error(
          `AA version mismatch for session payments. required=${AA_V2_VERSION_TAG}, current=${aaVersion || 'unknown_or_legacy'}`
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
    const normalizedTokenAddress = normalizeAddress(
      payload?.tokenAddress || runtime.tokenAddress || SETTLEMENT_TOKEN || ''
    );
    if (!normalizedTokenAddress || !ethers.isAddress(normalizedTokenAddress)) {
      throw new Error(
        `A valid tokenAddress is required for self-custodial session import. got=${payload?.tokenAddress || runtime.tokenAddress || SETTLEMENT_TOKEN || ''}`
      );
    }
    const gatewayRecipient = normalizeAddress(
      runtime.gatewayRecipient || payload?.gatewayRecipient || MERCHANT_ADDRESS || ''
    );
    if (!gatewayRecipient || !ethers.isAddress(gatewayRecipient)) {
      throw new Error('A valid gatewayRecipient is required for self-custodial session import.');
    }

    return {
      aaWallet,
      owner: resolvedOwner,
      tokenAddress: normalizedTokenAddress,
      sessionAddress,
      sessionPrivateKey: hasSessionPrivateKey ? sessionPrivateKey : '',
      sessionId,
      sessionTxHash,
      expiresAt: Number(runtime.expiresAt || 0),
      maxPerTx: maxPerTx.numeric,
      dailyLimit: dailyLimit.numeric,
      gatewayRecipient,
      accountFactoryAddress: normalizeAddress(runtime.accountFactoryAddress || KITE_AA_FACTORY_ADDRESS || ''),
      accountImplementationAddress: normalizeAddress(
        runtime.accountImplementationAddress || KITE_AA_ACCOUNT_IMPLEMENTATION || ''
      ),
      accountVersion: aaVersion || 'unknown_or_legacy',
      source: String(runtime.source || (hasSessionPrivateKey ? 'api-v1-session-authorize-external' : 'api-v1-session-authorize-agent-first')).trim(),
      updatedAt: Date.now()
    };
  }

  async function prepareSelfServeSessionRuntime({
    owner = '',
    singleLimit = '',
    dailyLimit = '',
    tokenAddress = '',
    gatewayRecipient = ''
  } = {}) {
    const provider = backendSigner?.provider || createBackendRpcProvider();
    const requestedOwner = normalizeAddress(owner || '');
    if (!ethers.isAddress(requestedOwner)) {
      throw new Error('A valid owner address is required for self-serve session setup.');
    }

    const saltRaw = String(process.env.KITECLAW_AA_SALT ?? '0').trim();
    let salt = 0n;
    try {
      salt = BigInt(saltRaw || '0');
    } catch {
      throw new Error(`Invalid salt: ${saltRaw}`);
    }

    const sdk = new deps.GokiteAASDK({
      network: 'kite_testnet',
      rpcUrl: BACKEND_RPC_URL,
      bundlerUrl: deps.BACKEND_BUNDLER_URL,
      entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
      accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
      accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION
    });
    const selectedSalt = salt;
    const aaWallet = normalizeAddress(await sdk.resolveAccountAddress(requestedOwner, selectedSalt));
    const currentCode = await provider.getCode(aaWallet);
    const deployed = Boolean(currentCode && currentCode !== '0x');
    let accountVersion = '';
    if (deployed) {
      try {
        const account = new ethers.Contract(aaWallet, AA_SESSION_ABI, provider);
        accountVersion = String(await withRpcReadRetry(() => account.version())).trim();
      } catch {
        accountVersion = '';
      }
      const requiredSelfServeVersion = String(
        KITE_AA_JOB_LANE_REQUIRED_VERSION || AA_V2_VERSION_TAG || ''
      ).trim();
      if (requiredSelfServeVersion && accountVersion !== requiredSelfServeVersion) {
        throw new Error(
          `AA version mismatch for self-serve wallet setup. required=${requiredSelfServeVersion}, current=${accountVersion || 'unknown_or_legacy'}`
        );
      }
    }
    const currentRuntime = resolveSessionRuntime({ owner: requestedOwner });
    const normalizedTokenAddress = normalizeAddress(
      tokenAddress || currentRuntime.tokenAddress || SETTLEMENT_TOKEN || ''
    );
    if (!ethers.isAddress(normalizedTokenAddress)) {
      throw new Error(`Invalid token address: ${tokenAddress || currentRuntime.tokenAddress || SETTLEMENT_TOKEN || ''}`);
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
    const latestBlock = await provider.getBlock('latest');
    const nowTs = Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000));
    const rules = [
      {
        timeWindow: '0',
        budget: String(ethers.parseUnits(maxPerTx.text, 18)),
        initialWindowStartTime: 0,
        targetProviders: []
      },
      {
        timeWindow: '86400',
        budget: String(ethers.parseUnits(dailyBudget.text, 18)),
        initialWindowStartTime: Math.max(0, nowTs - 1),
        targetProviders: []
      }
    ];

    const preparedRuntime = buildSessionRuntimeBase(currentRuntime, {
      owner: requestedOwner,
      aaWallet: aaWallet || currentRuntime.aaWallet || '',
      tokenAddress: normalizedTokenAddress,
      gatewayRecipient: normalizedGatewayRecipient,
      accountFactoryAddress: ACTIVE_ACCOUNT_FACTORY_ADDRESS,
      accountImplementationAddress: ACTIVE_ACCOUNT_IMPLEMENTATION_ADDRESS,
      accountVersion: accountVersion || (deployed ? 'unknown_or_legacy' : ''),
      maxPerTx: maxPerTx.numeric,
      dailyLimit: dailyBudget.numeric,
      runtimePurpose: currentRuntime.runtimePurpose || 'consumer',
      source: currentRuntime.source || 'self_serve_wallet_prepare',
      updatedAt: Date.now()
    });

    return {
      owner: requestedOwner,
      aaWallet,
      deployed,
      lifecycleStage: deployed ? 'deployed' : 'predicted_not_deployed',
      salt: selectedSalt.toString(),
      accountFactoryAddress: sdk.config.accountFactoryAddress,
      accountImplementationAddress: normalizeAddress(KITE_AA_ACCOUNT_IMPLEMENTATION || ''),
      entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
      tokenAddress: normalizedTokenAddress,
      gatewayRecipient: normalizedGatewayRecipient,
      singleLimit: maxPerTx.text,
      dailyLimit: dailyBudget.text,
      chainId: 'kite-testnet',
      accountVersion: accountVersion || (deployed ? 'unknown_or_legacy' : ''),
      currentBlockTimestamp: nowTs,
      sessionRules: rules,
      runtime: buildSessionRuntimePayload(preparedRuntime)
    };
  }

  async function finalizeSelfServeSessionRuntime({
    owner = '',
    runtime = {},
    singleLimit = '',
    dailyLimit = '',
    tokenAddress = '',
    gatewayRecipient = '',
    userEoa = ''
  } = {}) {
    const prepared = await prepareSelfServeSessionRuntime({
      owner,
      singleLimit,
      dailyLimit,
      tokenAddress,
      gatewayRecipient
    });
    const suppliedAaWallet = normalizeAddress(runtime.aaWallet || '');
    if (!suppliedAaWallet || suppliedAaWallet !== normalizeAddress(prepared.aaWallet || '')) {
      throw new Error(
        `AA wallet mismatch. expected=${prepared.aaWallet || '-'} supplied=${suppliedAaWallet || '-'}`
      );
    }

    const fallbackRuntime = resolveSessionRuntime({ owner: prepared.owner });
    const runtimeBase = buildSessionRuntimeBase(fallbackRuntime, {
      owner: prepared.owner,
      aaWallet: prepared.aaWallet,
      tokenAddress: prepared.tokenAddress,
      gatewayRecipient: prepared.gatewayRecipient,
      accountFactoryAddress: ACTIVE_ACCOUNT_FACTORY_ADDRESS,
      accountImplementationAddress: ACTIVE_ACCOUNT_IMPLEMENTATION_ADDRESS,
      accountVersion: prepared.accountVersion || (prepared.deployed ? 'unknown_or_legacy' : ''),
      maxPerTx: Number(prepared.singleLimit || fallbackRuntime.maxPerTx || 0),
      dailyLimit: Number(prepared.dailyLimit || fallbackRuntime.dailyLimit || 0),
      runtimePurpose: normalizeSessionGrantText(runtime.runtimePurpose, fallbackRuntime.runtimePurpose || 'consumer'),
      source: normalizeSessionGrantText(runtime.source, 'self_serve_wallet'),
      updatedAt: Date.now()
    });
    const verifiedRuntime = await verifyExternalSessionRuntime({
      runtime: {
        ...runtimeBase,
        ...runtime,
        owner: prepared.owner,
        aaWallet: prepared.aaWallet,
        gatewayRecipient: prepared.gatewayRecipient,
        maxPerTx: prepared.singleLimit,
        dailyLimit: prepared.dailyLimit,
        runtimePurpose: normalizeSessionGrantText(runtime.runtimePurpose, fallbackRuntime.runtimePurpose || 'consumer'),
        source: normalizeSessionGrantText(runtime.source, 'self_serve_wallet')
      },
      payload: {
        payerAaWallet: prepared.aaWallet,
        singleLimit: prepared.singleLimit,
        dailyLimit: prepared.dailyLimit,
        gatewayRecipient: prepared.gatewayRecipient,
        tokenAddress: prepared.tokenAddress
      },
      userEoa: normalizeSessionGrantAddress(userEoa || owner || prepared.owner)
    });

    const nextRuntime = writeSessionRuntime({
      ...runtimeBase,
      ...verifiedRuntime,
      tokenAddress: prepared.tokenAddress,
      gatewayRecipient: prepared.gatewayRecipient,
      accountFactoryAddress: ACTIVE_ACCOUNT_FACTORY_ADDRESS,
      accountImplementationAddress: ACTIVE_ACCOUNT_IMPLEMENTATION_ADDRESS,
      maxPerTx: Number(prepared.singleLimit || verifiedRuntime.maxPerTx || 0),
      dailyLimit: Number(prepared.dailyLimit || verifiedRuntime.dailyLimit || 0),
      runtimePurpose: normalizeSessionGrantText(runtime.runtimePurpose, verifiedRuntime.runtimePurpose || 'consumer') || 'consumer',
      source: 'self_serve_wallet',
      runtimeHealth: deriveRuntimeHealth({
        ...runtimeBase,
        ...verifiedRuntime,
        accountFactoryAddress: ACTIVE_ACCOUNT_FACTORY_ADDRESS
      }),
      updatedAt: Date.now()
    });

    return {
      prepared,
      runtime: nextRuntime
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
    const provider = backendSigner?.provider || createBackendRpcProvider();
    const fallbackRouterOwner = normalizeAddress(XMTP_ROUTER_DERIVED_ADDRESS || '');
    const currentRuntime = resolveSessionRuntime({ owner });
    const requestedOwner = normalizeAddress(owner || currentRuntime.owner || fallbackRouterOwner || '');
    if (!ethers.isAddress(requestedOwner)) {
      throw new Error('A valid owner address is required for session creation.');
    }

    const managedOwnerKey = String(resolveSessionOwnerPrivateKey?.(requestedOwner) || '').trim();
    if (!managedOwnerKey) {
      throw new Error(
        `Self-serve session creation is not enabled for owner ${requestedOwner}. This server can only create sessions for backend-managed demo owners.`
      );
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
    let aaVersion = '';
    try {
      aaVersion = String(await account.version()).trim();
    } catch {
      aaVersion = '';
    }

    if (!forceNewSession) {
      const canReuse =
        normalizeAddress(currentRuntime.owner || '') === requestedOwner &&
        normalizeAddress(currentRuntime.aaWallet || '') === normalizeAddress(ensured.accountAddress || '') &&
        currentRuntime.sessionPrivateKey &&
        currentRuntime.sessionAddress &&
        currentRuntime.sessionId;
      if (canReuse && (await isSessionRuntimeReadyOnchain(currentRuntime, account))) {
        const refreshedRuntime = writeSessionRuntime(buildSessionRuntimeBase(currentRuntime, {
          aaWallet: ensured.accountAddress,
          owner: requestedOwner,
          tokenAddress: normalizeAddress(tokenAddress || currentRuntime.tokenAddress || SETTLEMENT_TOKEN || ''),
          gatewayRecipient: normalizeAddress(
            gatewayRecipient || currentRuntime.gatewayRecipient || MERCHANT_ADDRESS || ''
          ),
          accountFactoryAddress: ACTIVE_ACCOUNT_FACTORY_ADDRESS,
          accountImplementationAddress: ACTIVE_ACCOUNT_IMPLEMENTATION_ADDRESS,
          accountVersion: aaVersion || currentRuntime.accountVersion || (ensured.deployed ? 'unknown_or_legacy' : ''),
          source: currentRuntime.source || 'api-session-runtime-ensure',
          updatedAt: Date.now()
        }));
        return {
          created: false,
          reused: true,
          tokenAddress: normalizeAddress(tokenAddress || SETTLEMENT_TOKEN || ''),
          runtime: refreshedRuntime
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

    const runtimeBase = buildSessionRuntimeBase(currentRuntime, {
      aaWallet: ensured.accountAddress,
      owner: requestedOwner,
      tokenAddress: normalizedTokenAddress,
      gatewayRecipient: normalizedGatewayRecipient,
      accountFactoryAddress: ACTIVE_ACCOUNT_FACTORY_ADDRESS,
      accountImplementationAddress: ACTIVE_ACCOUNT_IMPLEMENTATION_ADDRESS,
      accountVersion: aaVersion || (ensured.deployed ? 'unknown_or_legacy' : ''),
      maxPerTx: maxPerTx.numeric,
      dailyLimit: dailyBudget.numeric,
      runtimePurpose: currentRuntime.runtimePurpose || 'consumer',
      source: 'api-session-runtime-ensure',
      updatedAt: Date.now()
    });
    const nextRuntime = writeSessionRuntime({
      ...runtimeBase,
      sessionAddress: sessionWallet.address,
      sessionPrivateKey: sessionWallet.privateKey,
      sessionId,
      sessionTxHash: tx.hash,
      expiresAt: 0,
      runtimeHealth: deriveRuntimeHealth(runtimeBase),
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
  
    const provider = createBackendRpcProvider();
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
  
    const routeContext = {
    app,
    deps,
    helpers: {
      appendSessionApprovalRequest,
      assertApprovalInboxAccess,
      buildApprovalListMeta,
      buildApprovalReadResponse,
      buildApprovalRequestToken,
      buildApprovalRequestUrl,
      buildIdentitySummary,
      buildSessionApprovalRequestPayload,
      buildSessionRuntimePayload,
      buildUnifiedApprovalPayload,
      createIdentityChallengeMessage,
      ensureBackendSessionRuntime,
      finalizeSelfServeSessionRuntime,
      filterUnifiedApprovalRows,
      finalizeSessionApprovalRecord,
      finalizeSessionAuthorization,
      getBackendSignerState,
      getLatestIdentityChallengeSnapshot,
      getSessionApprovalRecordOrThrow,
      isIdentitySignatureRequired,
      listSessionApprovalRequests,
      normalizeIdentityChallengeRows,
      normalizeSessionGrantAddress,
      normalizeSessionGrantPayload,
      normalizeSessionGrantText,
      prepareSelfServeSessionRuntime,
      readIdentityProfile,
      rejectSessionApprovalRecord
    }
  };

  registerCoreIdentitySessionRoutes(routeContext);
  registerCoreIdentityApprovalRoutes(routeContext);
  registerCoreIdentityIdentityRoutes(routeContext);
  registerCoreIdentityAgentChatRoutes(routeContext);
}
