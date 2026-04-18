import { registerAutomationX402Routes } from '../routes/automationX402Routes.js';
import { registerWorkflowA2aRoutes } from '../routes/workflowA2aRoutes.js';
import { registerCoreIdentityChatRoutes } from '../routes/coreIdentityChatRoutes.js';
import { registerMarketAgentServiceRoutes } from '../routes/marketAgentServiceRoutes.js';
import { registerJobLaneRoutes } from '../routes/jobLaneRoutes.js';
import { registerDataFeedRoutes } from '../routes/dataFeedRoutes.js';
import { registerDailyNewsRoutes } from '../routes/dailyNewsRoutes.js';
import { registerTemplateRoutes } from '../routes/templateRoutes.js';
import { registerTrustSignalRoutes } from '../routes/trustSignalRoutes.js';
import { registerPlatformV1Routes } from '../routes/platformV1Routes.js';
import { registerAgentCardRoutes } from '../routes/agentCardRoutes.js';
import { registerSynthesisRoutes } from '../routes/synthesisRoutes.js';
import { registerMcpRoutes } from '../mcp/mcpServer.js';
import { registerX402DiscoveryRoutes } from '../routes/x402DiscoveryRoutes.js';
import { registerA2aAgentRegistryRoutes } from '../routes/a2aAgentRegistryRoutes.js';
import { registerA2aCommerceRoutes } from '../routes/a2aCommerceRoutes.js';
import { createRuntimeServerLifecycle } from '../runtime/server.js';
import { initTracing } from '../lib/paytrace/instrument.js';

function assertRouteDependencies(routeName = '', deps = {}, requiredKeys = []) {
  const missing = requiredKeys.filter((key) => typeof deps[key] === 'undefined');
  if (missing.length > 0) {
    throw new Error(
      `Missing required route dependencies for ${routeName}: ${missing.sort().join(', ')}`
    );
  }
}

export function routesBootstrap(ctx) {
  const {
    // Constants
    PACKAGE_VERSION, PORT,
    BACKEND_RPC_URL, BACKEND_BUNDLER_URL, BACKEND_ENTRYPOINT_ADDRESS,
    KITE_AA_FACTORY_ADDRESS, KITE_AA_ACCOUNT_IMPLEMENTATION,
    SETTLEMENT_TOKEN, MERCHANT_ADDRESS,
    POLICY_MAX_PER_TX_DEFAULT, POLICY_DAILY_LIMIT_DEFAULT,
    KITE_AGENT1_ID, KITE_AGENT2_ID, KITE_AGENT2_AA_ADDRESS,
    KITE_REQUIRE_AA_V2, AA_V2_VERSION_TAG, KITE_AA_JOB_LANE_REQUIRED_VERSION,
    KITE_MIN_NATIVE_GAS, KITE_BUNDLER_RPC_TIMEOUT_MS, KITE_BUNDLER_RPC_RETRIES,
    BUNDLER_RPC_BACKOFF_POLICY, KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
    KITE_SESSION_PAY_RETRIES, KITE_ALLOW_EOA_RELAY_FALLBACK, KITE_ALLOW_BACKEND_USEROP_SIGN,
    KTRACE_ADMIN_KEY, KTRACE_JOB_APPROVAL_THRESHOLD, KTRACE_JOB_APPROVAL_TTL_MS,
    BACKEND_PUBLIC_URL, KTRACE_APPROVAL_RULES,
    ERC8004_AGENT_ID, ERC8004_IDENTITY_REGISTRY,
    ERC8183_DEFAULT_JOB_TIMEOUT_SEC, ERC8183_ESCROW_ADDRESS,
    ERC8183_REQUESTER_AA_ADDRESS, ERC8183_REQUESTER_OWNER_ADDRESS,
    ERC8183_EXECUTOR_AA_ADDRESS, ERC8183_EXECUTOR_OWNER_ADDRESS, ERC8183_EXECUTOR_STAKE_DEFAULT,
    ERC8183_VALIDATOR_AA_ADDRESS, ERC8183_VALIDATOR_OWNER_ADDRESS,
    ERC8183_TRACE_ANCHOR_GUARD,
    ANALYSIS_PROVIDER,
    AUTH_DISABLED, API_KEY_ADMIN, API_KEY_AGENT, API_KEY_VIEWER,
    AGENT001_BIND_TIMEOUT_MS, AGENT001_PREBIND_ONLY, AGENT001_REQUIRE_X402,
    HYPERLIQUID_ORDER_RECIPIENT,
    IDENTITY_CHALLENGE_MAX_ROWS, IDENTITY_CHALLENGE_TTL_MS, IDENTITY_VERIFY_MODE,
    MESSAGE_PROVIDER_DEFAULT_KEYWORDS, MESSAGE_PROVIDER_DISABLE_CLAWFEED,
    MESSAGE_PROVIDER_MARKET_DATA_FALLBACK,
    OPENNEWS_API_BASE, OPENNEWS_MAX_ROWS, OPENNEWS_RETRY, OPENNEWS_TIMEOUT_MS, OPENNEWS_TOKEN,
    OPENTWITTER_API_BASE, OPENTWITTER_MAX_ROWS, OPENTWITTER_RETRY, OPENTWITTER_TIMEOUT_MS,
    OPENTWITTER_TOKEN,
    PROOF_RPC_TIMEOUT_MS, PROOF_RPC_RETRIES, PROOF_RECEIPT_WAIT_MS, PROOF_RECEIPT_POLL_INTERVAL_MS,
    X402_BTC_PRICE, X402_REACTIVE_PRICE, X402_RISK_SCORE_PRICE, X402_X_READER_PRICE,
    X402_TECHNICAL_PRICE, X402_INFO_PRICE, X402_HYPERLIQUID_ORDER_PRICE, X402_UNIFIED_SERVICE_PRICE,
    X_READER_MAX_CHARS_DEFAULT,
    // Runtime objects
    GokiteAASDK, crypto, ethers, path,
    app, llmAdapter, hyperliquidAdapter, persistenceStore, persistenceInitDone,
    x402Path, sessionRuntimePath,
    // Auth
    authConfigured, extractApiKey, resolveRoleByApiKey, resolveAuthRequest, requireRole,
    // Normalizers
    normalizeAddress, normalizeAddresses,
    normalizeBtcPriceParams, normalizeReactiveParams, normalizeRiskScoreParams, normalizeXReaderParams,
    normalizeStringArray, normalizeNetworkCommandPayload, normalizeNetworkCommandType, normalizeTaskFailure,
    maskSecret, parseAgentIdList, parseAgent001OrderDirectives, parseExcerptMaxChars,
    parseJsonObjectFromText, parseNetworkCommandFilterList,
    // Fetch helpers
    fetchBtcPriceQuote, fetchXReaderDigest,
    // ID creators
    createTraceId, createCommandId,
    // X402
    createX402Request, computeX402StatusCounts, expireStaleX402PendingRequests,
    scheduleX402PendingCleanup,
    // Reputation
    appendReputationSignal, appendTrustPublication, appendValidationRecord, appendWorkflowStep,
    appendNetworkAuditEvent, appendNetworkCommandEvent, appendAgent001OrderExecutionLines,
    // Broadcast
    broadcastEvent,
    // AA / signer
    assertBackendSigner, ensureAAAccountDeployment,
    // Catalog
    ensureNetworkAgents, ensureServiceCatalog, ensureTemplateCatalog,
    // Identity
    ensureWorkflowIdentityVerified,
    // Data reads
    readAgent001Results, readIdentityChallenges, readOnboardingChallenges, readIdentityProfile,
    readJobs, readNetworkAgents, readNetworkCommands, readPolicyConfig, readPolicyFailures,
    readPublishedServices, readPurchases, readRecords, readAccountApiKeys,
    readReputationSignals, readConsumerIntents, readServiceInvocations,
    readSessionApprovalRequests, readSessionAuthorizations, readSessionRuntime,
    readTrustPublications, readValidationRecords, readWorkflows, readX402Requests,
    // Data writes
    writeIdentityChallenges, writeOnboardingChallenges, writeJsonObject, writeNetworkAgents,
    writeNetworkCommands, writePolicyConfig, writePolicyFailures, writePublishedServices,
    writeAccountApiKeys, writeRecords, writeConsumerIntents,
    writeSessionApprovalRequests, writeSessionAuthorizations, writeSessionRuntime, writeTemplates,
    writeX402Requests,
    // Upserts
    upsertAgent001ResultRecord, upsertJobRecord, upsertNetworkCommandRecord,
    upsertPurchaseRecord, upsertServiceInvocation, upsertWorkflow,
    // Build helpers
    buildA2ACapabilities, buildA2AReceipt,
    buildAgent001DispatchSummary, buildAgent001FailureReply, buildAgent001StrictPaymentPlan,
    buildAgent001TradePlan,
    buildBestServiceQuote, buildInfoPaymentIntentForTask,
    buildLatestWorkflowByRequestId, buildAuthorityPublicSummary, buildAuthoritySnapshot,
    buildLocalTechnicalRecoveryDispatch, buildNetworkRunSummaries,
    buildPaymentRequiredResponse, buildPolicySnapshot, buildPolicySnapshotHash,
    buildResponseHash, buildRiskScorePaymentIntentForTask, buildServiceStatus,
    buildTaskPaymentFromIntent, buildTaskReceiptRef, buildWorkflowFallbackAuditEvents,
    buildXReaderPaymentIntentForTask,
    // Check / classify
    checkAnchorExistsOnChain, classifyAgent001IntentFallback, classifySessionPayFailure,
    coerceAgent001ForcedTradePlan,
    // Compute
    computeServiceReputation, computeX402StatusCounts: _cxsc,
    // Default / derive
    defaultAgentIdByCapability, deriveNegotiationTermsFromAuditEvents,
    detectAgent001IntentOverrides, digestStableObject,
    // Evaluate
    evaluateServiceInvokeGuard, evaluateTransferPolicy,
    // Apply / accept / claim
    applyAgent001LocalFallback, acceptEscrowJob, claimEscrowJob,
    executeNetworkCommand, expireEscrowJob,
    expireStaleX402PendingRequests: _esxpr,
    extractFirstUrlFromText, extractHorizonFromText, extractNetworkCommandRefs,
    extractTradingSymbolFromText, extractUserOpHashFromReason,
    // Find
    findNetworkAgentById, findConsumerIntent, findNetworkCommandById,
    // Get
    getActionConfig, getAutoTradePlanStatus, getEscrowJob, getInternalAgentApiKey,
    getLatestIdentityChallengeSnapshot, getServiceProviderBytes32,
    getSessionPayRetryBackoffMs, getTaskEnvelopeInput, getUtcDateKey,
    // Handle
    handleExecutorRuntimeTaskEnvelope, handlePriceRuntimeTaskEnvelope,
    handleReaderRuntimeTaskEnvelope, handleRiskRuntimeTaskEnvelope,
    // Has / is
    hasStrictX402Evidence, isAgent001ForceOrderRequested, isAgent001TaskSuccessful,
    isInfoAnalysisAction, isLegacyBtcOnlyTechnicalFailure, isTechnicalAnalysisAction,
    // Issue
    issueIdentityChallenge,
    // List
    listNetworkAuditEventsByTraceId,
    // Lock / prepare
    lockEscrowFunds, preflightJobLaneCapability, prepareEscrowFunding,
    // Log
    logPolicyFailure,
    // Map
    mapServiceReceipt,
    // Mark
    markSessionPayFailure, markSessionPayRetry, markSessionPayRetryDelay,
    // Maybe
    maybePolishAgent001Reply, maybeSendAgent001ProgressDm, maybeSendAgent001TradePlanDm,
    materializeAuthority,
    // Post / publish
    postSessionPayWithRetry, publishJobLifecycleAnchorOnChain, publishTrustPublicationOnChain,
    readLatestAnchorIdOnChain,
    // Resolve
    resolveAgent001Intent, resolveAgentAddressesByIds, resolveAnalysisErrorStatus,
    resolveAuditQuoteFromPaymentIntent, resolveInfoSettlementRecipient,
    resolveSessionOwnerByAaWallet, resolveSessionOwnerPrivateKey,
    resolveSessionRuntime, resolveTechnicalSettlementRecipient, resolveWorkflowTraceId,
    // Run
    runAgent001DispatchTask, runAgent001HyperliquidOrderWorkflow, runAgent001QuoteNegotiation,
    runRiskScoreAnalysis,
    // Sanitize / select
    sanitizeNetworkAgentRecord, sanitizeServiceRecord,
    selectAgent001ProviderPlan, selectServiceCandidatesByCapability,
    // Send / session
    sendSessionTransferViaEoaRelay, sessionPayConfigSnapshot, sessionPayMetrics,
    shouldFallbackToEoaRelay, shouldRetrySessionPayCategory, signResponseHash,
    // Start / stop loops
    startAutoTradePlanLoop, stopAutoTradePlanLoop,
    // Submit
    submitEscrowResult,
    // Summarize
    summarizeNetworkCommandExecution,
    // To
    toPriceNumber,
    // Validate / verify
    validateEscrowJob, validateConsumerAuthority, validatePaymentProof,
    verifyIdentityChallengeResponse, verifyProofOnChain,
    // Consumer authority
    beginConsumerIntent, finalizeConsumerIntent, revokeConsumerAuthorityPolicy,
    writeConsumerAuthorityPolicy,
    // Onboarding helpers (via proxy objects)
    onboardingSetupHelpers, claudeConnectorAuthHelpers,
    // Wait / lock
    waitMs, withSessionUserOpLock,
    // Persistence
    initializePersistence,
    // Lifecycle config
    AUTO_TRADE_PLAN_ENABLED, AUTO_TRADE_PLAN_HORIZON_MIN,
    AUTO_TRADE_PLAN_INTERVAL_MS, AUTO_TRADE_PLAN_PROMPT, AUTO_TRADE_PLAN_SYMBOL,
    KTRACE_AUTO_JOB_EXPIRY_ENABLED, KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS,
    startAutoJobExpiryLoop, stopAutoJobExpiryLoop,
    // Synthesis
    synthesisLoop
  } = ctx;

  // ── Route dependencies ────────────────────────────────────────────────────

  const routeDeps = Object.freeze({
    PACKAGE_VERSION,
    PORT,
    BACKEND_RPC_URL,
    BACKEND_BUNDLER_URL,
    BACKEND_ENTRYPOINT_ADDRESS,
    KITE_AA_FACTORY_ADDRESS,
    KITE_AA_ACCOUNT_IMPLEMENTATION,
    SETTLEMENT_TOKEN,
    MERCHANT_ADDRESS,
    POLICY_MAX_PER_TX_DEFAULT,
    POLICY_DAILY_LIMIT_DEFAULT,
    KITE_AGENT1_ID,
    KITE_AGENT2_ID,
    KITE_AGENT2_AA_ADDRESS,
    KITE_REQUIRE_AA_V2,
    AA_V2_VERSION_TAG,
    KITE_AA_JOB_LANE_REQUIRED_VERSION,
    KITE_MIN_NATIVE_GAS,
    KITE_BUNDLER_RPC_TIMEOUT_MS,
    KITE_BUNDLER_RPC_RETRIES,
    BUNDLER_RPC_BACKOFF_POLICY,
    KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
    KITE_SESSION_PAY_RETRIES,
    KITE_ALLOW_EOA_RELAY_FALLBACK,
    KITE_ALLOW_BACKEND_USEROP_SIGN,
    KTRACE_ADMIN_KEY,
    KTRACE_JOB_APPROVAL_THRESHOLD,
    KTRACE_JOB_APPROVAL_TTL_MS,
    BACKEND_PUBLIC_URL,
    KTRACE_APPROVAL_RULES,
    ERC8004_AGENT_ID,
    ERC8004_IDENTITY_REGISTRY,
    ERC8183_DEFAULT_JOB_TIMEOUT_SEC,
    ERC8183_ESCROW_ADDRESS,
    ERC8183_REQUESTER_AA_ADDRESS,
    ERC8183_REQUESTER_OWNER_ADDRESS,
    ERC8183_EXECUTOR_AA_ADDRESS,
    ERC8183_EXECUTOR_OWNER_ADDRESS,
    ERC8183_EXECUTOR_STAKE_DEFAULT,
    ERC8183_VALIDATOR_AA_ADDRESS,
    ERC8183_VALIDATOR_OWNER_ADDRESS,
    ANALYSIS_PROVIDER,
    AUTH_DISABLED,
    API_KEY_ADMIN,
    API_KEY_AGENT,
    API_KEY_VIEWER,
    AGENT001_BIND_TIMEOUT_MS,
    AGENT001_PREBIND_ONLY,
    AGENT001_REQUIRE_X402,
    HYPERLIQUID_ORDER_RECIPIENT,
    IDENTITY_CHALLENGE_MAX_ROWS,
    IDENTITY_CHALLENGE_TTL_MS,
    IDENTITY_VERIFY_MODE,
    MESSAGE_PROVIDER_DEFAULT_KEYWORDS,
    MESSAGE_PROVIDER_DISABLE_CLAWFEED,
    MESSAGE_PROVIDER_MARKET_DATA_FALLBACK,
    OPENNEWS_API_BASE,
    OPENNEWS_MAX_ROWS,
    OPENNEWS_RETRY,
    OPENNEWS_TIMEOUT_MS,
    OPENNEWS_TOKEN,
    OPENTWITTER_API_BASE,
    OPENTWITTER_MAX_ROWS,
    OPENTWITTER_RETRY,
    OPENTWITTER_TIMEOUT_MS,
    OPENTWITTER_TOKEN,
    PROOF_RPC_TIMEOUT_MS,
    PROOF_RPC_RETRIES,
    PROOF_RECEIPT_WAIT_MS,
    PROOF_RECEIPT_POLL_INTERVAL_MS,
    X402_BTC_PRICE,
    X402_REACTIVE_PRICE,
    X402_RISK_SCORE_PRICE,
    X402_X_READER_PRICE,
    X402_TECHNICAL_PRICE,
    X402_INFO_PRICE,
    X402_HYPERLIQUID_ORDER_PRICE,
    X402_UNIFIED_SERVICE_PRICE,
    X_READER_MAX_CHARS_DEFAULT,
    GokiteAASDK,
    crypto,
    ethers,
    path,
    llmAdapter,
    hyperliquidAdapter,
    persistenceStore,
    x402Path,
    sessionRuntimePath,
    authConfigured,
    extractApiKey,
    resolveRoleByApiKey,
    resolveAuthRequest,
    requireRole,
    normalizeAddress,
    normalizeAddresses,
    normalizeBtcPriceParams,
    normalizeReactiveParams,
    normalizeRiskScoreParams,
    normalizeXReaderParams,
    normalizeStringArray,
    normalizeNetworkCommandPayload,
    normalizeNetworkCommandType,
    normalizeTaskFailure,
    maskSecret,
    parseAgentIdList,
    parseAgent001OrderDirectives,
    parseExcerptMaxChars,
    parseJsonObjectFromText,
    parseNetworkCommandFilterList,
    fetchBtcPriceQuote,
    fetchXReaderDigest,
    createTraceId,
    createCommandId,
    createX402Request,
    appendReputationSignal,
    appendTrustPublication,
    appendValidationRecord,
    appendWorkflowStep,
    appendNetworkAuditEvent,
    appendNetworkCommandEvent,
    appendAgent001OrderExecutionLines,
    broadcastEvent,
    assertBackendSigner,
    ensureAAAccountDeployment,
    ensureNetworkAgents,
    ensureServiceCatalog,
    ensureTemplateCatalog,
    ensureWorkflowIdentityVerified,
    readAgent001Results,
    readIdentityChallenges,
    readOnboardingChallenges,
    readIdentityProfile,
    readJobs,
    readNetworkAgents,
    readNetworkCommands,
    readPolicyConfig,
    readPolicyFailures,
    readPublishedServices,
    readPurchases,
    readRecords,
    readAccountApiKeys,
    readReputationSignals,
    readConsumerIntents,
    readServiceInvocations,
    readSessionApprovalRequests,
    readSessionAuthorizations,
    readSessionRuntime,
    readTrustPublications,
    readValidationRecords,
    readWorkflows,
    readX402Requests,
    writeIdentityChallenges,
    writeOnboardingChallenges,
    writeJsonObject,
    writeNetworkAgents,
    writeNetworkCommands,
    writePolicyConfig,
    writePolicyFailures,
    writePublishedServices,
    writeAccountApiKeys,
    writeRecords,
    writeConsumerIntents,
    writeSessionApprovalRequests,
    writeSessionAuthorizations,
    writeSessionRuntime,
    writeTemplates,
    writeX402Requests,
    upsertAgent001ResultRecord,
    upsertJobRecord,
    upsertNetworkCommandRecord,
    upsertPurchaseRecord,
    upsertServiceInvocation,
    upsertWorkflow,
    buildA2ACapabilities,
    buildA2AReceipt,
    buildAgent001DispatchSummary,
    buildAgent001FailureReply,
    buildAgent001StrictPaymentPlan,
    buildAgent001TradePlan,
    buildBestServiceQuote,
    buildInfoPaymentIntentForTask,
    buildLatestWorkflowByRequestId,
    buildAuthorityPublicSummary,
    buildAuthoritySnapshot,
    buildLocalTechnicalRecoveryDispatch,
    buildNetworkRunSummaries,
    buildPaymentRequiredResponse,
    buildPolicySnapshot,
    buildPolicySnapshotHash,
    buildResponseHash,
    buildRiskScorePaymentIntentForTask,
    buildServiceStatus,
    buildTaskPaymentFromIntent,
    buildTaskReceiptRef,
    buildWorkflowFallbackAuditEvents,
    buildXReaderPaymentIntentForTask,
    checkAnchorExistsOnChain,
    classifyAgent001IntentFallback,
    classifySessionPayFailure,
    coerceAgent001ForcedTradePlan,
    computeServiceReputation,
    computeX402StatusCounts,
    defaultAgentIdByCapability,
    deriveNegotiationTermsFromAuditEvents,
    detectAgent001IntentOverrides,
    digestStableObject,
    evaluateServiceInvokeGuard,
    evaluateTransferPolicy,
    applyAgent001LocalFallback,
    acceptEscrowJob,
    claimEscrowJob,
    executeNetworkCommand,
    expireEscrowJob,
    expireStaleX402PendingRequests,
    extractFirstUrlFromText,
    extractHorizonFromText,
    extractNetworkCommandRefs,
    extractTradingSymbolFromText,
    extractUserOpHashFromReason,
    findNetworkAgentById,
    findConsumerIntent,
    findNetworkCommandById,
    getActionConfig,
    getAutoTradePlanStatus,
    getEscrowJob,
    getInternalAgentApiKey,
    getLatestIdentityChallengeSnapshot,
    getServiceProviderBytes32,
    getSessionPayRetryBackoffMs,
    getTaskEnvelopeInput,
    getUtcDateKey,
    handleExecutorRuntimeTaskEnvelope,
    handlePriceRuntimeTaskEnvelope,
    handleReaderRuntimeTaskEnvelope,
    handleRiskRuntimeTaskEnvelope,
    hasStrictX402Evidence,
    isAgent001ForceOrderRequested,
    isAgent001TaskSuccessful,
    isInfoAnalysisAction,
    isLegacyBtcOnlyTechnicalFailure,
    isTechnicalAnalysisAction,
    issueIdentityChallenge,
    listNetworkAuditEventsByTraceId,
    lockEscrowFunds,
    preflightJobLaneCapability,
    prepareEscrowFunding,
    logPolicyFailure,
    mapServiceReceipt,
    markSessionPayFailure,
    markSessionPayRetry,
    markSessionPayRetryDelay,
    maybePolishAgent001Reply,
    maybeSendAgent001ProgressDm,
    maybeSendAgent001TradePlanDm,
    materializeAuthority,
    postSessionPayWithRetry,
    publishJobLifecycleAnchorOnChain,
    publishTrustPublicationOnChain,
    readLatestAnchorIdOnChain,
    resolveAgent001Intent,
    resolveAgentAddressesByIds,
    resolveAnalysisErrorStatus,
    resolveAuditQuoteFromPaymentIntent,
    resolveInfoSettlementRecipient,
    resolveSessionOwnerByAaWallet,
    resolveSessionOwnerPrivateKey,
    resolveSessionRuntime,
    resolveTechnicalSettlementRecipient,
    resolveWorkflowTraceId,
    runAgent001DispatchTask,
    runAgent001HyperliquidOrderWorkflow,
    runAgent001QuoteNegotiation,
    runRiskScoreAnalysis,
    sanitizeNetworkAgentRecord,
    sanitizeServiceRecord,
    selectAgent001ProviderPlan,
    selectServiceCandidatesByCapability,
    sendSessionTransferViaEoaRelay,
    sessionPayConfigSnapshot,
    sessionPayMetrics,
    shouldFallbackToEoaRelay,
    shouldRetrySessionPayCategory,
    signResponseHash,
    startAutoTradePlanLoop,
    stopAutoTradePlanLoop,
    submitEscrowResult,
    summarizeNetworkCommandExecution,
    toPriceNumber,
    validateEscrowJob,
    validateConsumerAuthority,
    validatePaymentProof,
    verifyIdentityChallengeResponse,
    verifyProofOnChain,
    beginConsumerIntent,
    finalizeConsumerIntent,
    revokeConsumerAuthorityPolicy,
    writeConsumerAuthorityPolicy,
    createOnboardingChallengeMessage: onboardingSetupHelpers.createOnboardingChallengeMessage,
    issueOnboardingAuthChallenge: onboardingSetupHelpers.issueOnboardingAuthChallenge,
    verifyOnboardingAuthChallenge: onboardingSetupHelpers.verifyOnboardingAuthChallenge,
    writeOnboardingAuthCookie: onboardingSetupHelpers.writeOnboardingAuthCookie,
    clearOnboardingAuthCookie: onboardingSetupHelpers.clearOnboardingAuthCookie,
    findActiveAccountApiKey: onboardingSetupHelpers.findActiveAccountApiKey,
    generateAccountApiKey: onboardingSetupHelpers.generateAccountApiKey,
    revokeAccountApiKey: onboardingSetupHelpers.revokeAccountApiKey,
    buildAccountApiKeyPublicRecord: onboardingSetupHelpers.buildAccountApiKeyPublicRecord,
    findPendingClaudeConnectorInstallCode: claudeConnectorAuthHelpers.findPendingInstallCodeByOwner,
    findActiveClaudeConnectorGrant: claudeConnectorAuthHelpers.findActiveGrantByOwner,
    issueClaudeConnectorInstallCode: claudeConnectorAuthHelpers.issueInstallCode,
    issueSelfCustodialConnectorGrant: claudeConnectorAuthHelpers.issueSelfCustodialGrant,
    revokeClaudeConnectorGrant: claudeConnectorAuthHelpers.revokeGrant,
    resolveClaudeConnectorToken: claudeConnectorAuthHelpers.resolveConnectorToken,
    claimClaudeConnectorInstallCode: claudeConnectorAuthHelpers.claimInstallCode,
    touchClaudeConnectorGrantUsage: claudeConnectorAuthHelpers.touchGrantUsage,
    issueAgentConnectorCredential:
      claudeConnectorAuthHelpers.issueSessionConnector || claudeConnectorAuthHelpers.issueInstallCode,
    revokeAgentConnectorGrant: claudeConnectorAuthHelpers.revokeGrant,
    resolveAgentConnectorToken:
      claudeConnectorAuthHelpers.resolveAgentConnectorToken ||
      claudeConnectorAuthHelpers.resolveConnectorToken,
    claimAgentConnectorInstallCode: claudeConnectorAuthHelpers.claimInstallCode,
    touchAgentConnectorGrantUsage: claudeConnectorAuthHelpers.touchGrantUsage,
    buildClaudeConnectorInstallCodePublicRecord:
      claudeConnectorAuthHelpers.buildInstallCodePublicRecord,
    buildClaudeConnectorGrantPublicRecord: claudeConnectorAuthHelpers.buildGrantPublicRecord,
    waitMs,
    withSessionUserOpLock,
    ERC8183_TRACE_ANCHOR_GUARD,
    synthesisLoop
  });

  // ── PayTrace: initialize OTel tracing ─────────────────────────────────────
  initTracing({
    serviceName: 'ktrace-backend',
    serviceVersion: ctx?.PACKAGE_VERSION || '1.0.0',
    traceEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });

  // ── Route registrations ───────────────────────────────────────────────────

  const routeRegistrations = [
    {
      name: 'coreIdentityChatRoutes',
      register: registerCoreIdentityChatRoutes,
      requiredKeys: ['createTraceId', 'readSessionRuntime', 'requireRole', 'writeSessionRuntime']
    },
    {
      name: 'workflowA2aRoutes',
      register: registerWorkflowA2aRoutes,
      requiredKeys: [
        'appendReputationSignal',
        'appendTrustPublication',
        'buildPaymentRequiredResponse',
        'createX402Request',
        'ensureNetworkAgents',
        'publishTrustPublicationOnChain',
        'requireRole',
        'upsertWorkflow'
      ]
    },
    {
      name: 'marketAgentServiceRoutes',
      register: registerMarketAgentServiceRoutes,
      requiredKeys: [
        'appendReputationSignal',
        'appendTrustPublication',
        'createX402Request',
        'ensureNetworkAgents',
        'ensureServiceCatalog',
        'publishTrustPublicationOnChain',
        'requireRole',
        'upsertServiceInvocation'
      ]
    },
    {
      name: 'dataFeedRoutes',
      register: registerDataFeedRoutes,
      requiredKeys: ['requireRole']
    },
    {
      name: 'dailyNewsRoutes',
      register: registerDailyNewsRoutes,
      requiredKeys: ['requireRole']
    },
    {
      name: 'agentCardRoutes',
      register: registerAgentCardRoutes,
      requiredKeys: ['PACKAGE_VERSION', 'authConfigured']
    },
    {
      name: 'synthesisRoutes',
      register: registerSynthesisRoutes,
      requiredKeys: ['synthesisLoop', 'readJobs', 'PACKAGE_VERSION']
    },
    {
      name: 'platformV1Routes',
      register: registerPlatformV1Routes,
      requiredKeys: ['ensureNetworkAgents', 'ensureServiceCatalog', 'ensureTemplateCatalog', 'requireRole']
    },
    {
      name: 'templateRoutes',
      register: registerTemplateRoutes,
      requiredKeys: ['ensureServiceCatalog', 'ensureTemplateCatalog', 'requireRole', 'writeTemplates']
    },
    {
      name: 'jobLaneRoutes',
      register: registerJobLaneRoutes,
      requiredKeys: [
        'readJobs',
        'readSessionApprovalRequests',
        'requireRole',
        'upsertJobRecord',
        'writeSessionApprovalRequests'
      ]
    },
    {
      name: 'trustSignalRoutes',
      register: registerTrustSignalRoutes,
      requiredKeys: [
        'appendReputationSignal',
        'appendValidationRecord',
        'readReputationSignals',
        'readValidationRecords',
        'requireRole'
      ]
    },
    {
      name: 'automationX402Routes',
      register: registerAutomationX402Routes,
      requiredKeys: ['buildPolicySnapshot', 'readSessionRuntime', 'readX402Requests', 'requireRole']
    },
    {
      name: 'mcpRoutes',
      register: registerMcpRoutes,
      requiredKeys: [
        'PACKAGE_VERSION',
        'PORT',
        'authConfigured',
        'extractApiKey',
        'getInternalAgentApiKey',
        'resolveAuthRequest'
      ]
    },
    {
      name: 'x402DiscoveryRoutes',
      register: registerX402DiscoveryRoutes,
      requiredKeys: ['ensureServiceCatalog']
    },
    {
      name: 'a2aAgentRegistryRoutes',
      register: registerA2aAgentRegistryRoutes,
      requiredKeys: ['requireRole']
    },
    {
      name: 'a2aCommerceRoutes',
      register: registerA2aCommerceRoutes,
      requiredKeys: [
        'createX402Request',
        'buildPaymentRequiredResponse',
        'readX402Requests',
        'writeX402Requests',
        'ensureServiceCatalog',
        'validatePaymentProof',
        'verifyProofOnChain',
        'appendNetworkAuditEvent',
        'createTraceId',
        'requireRole'
      ]
    }
  ];

  for (const routeRegistration of routeRegistrations) {
    assertRouteDependencies(routeRegistration.name, routeDeps, routeRegistration.requiredKeys);
    routeRegistration.register(app, routeDeps);
  }

  scheduleX402PendingCleanup(5 * 60 * 1000);

  // ── Server lifecycle ──────────────────────────────────────────────────────

  const { startServer, shutdownServer } = createRuntimeServerLifecycle({
    app,
    autoJobExpiry: {
      enabled: KTRACE_AUTO_JOB_EXPIRY_ENABLED,
      intervalMs: KTRACE_AUTO_JOB_EXPIRY_INTERVAL_MS,
      start: startAutoJobExpiryLoop
    },
    autoTradePlan: {
      enabled: AUTO_TRADE_PLAN_ENABLED,
      horizonMin: AUTO_TRADE_PLAN_HORIZON_MIN,
      intervalMs: AUTO_TRADE_PLAN_INTERVAL_MS,
      prompt: AUTO_TRADE_PLAN_PROMPT,
      start: startAutoTradePlanLoop,
      symbol: AUTO_TRADE_PLAN_SYMBOL
    },
    ensureNetworkAgents,
    ensureServiceCatalog,
    ensureTemplateCatalog,
    initializePersistence,
    parseAgentIdList,
    persistenceStore,
    port: PORT,
    stopAutoJobExpiryLoop,
    stopAutoTradePlanLoop
  });

  return { startServer, shutdownServer };
}
