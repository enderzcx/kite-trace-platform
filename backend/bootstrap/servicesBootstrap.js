import crypto from 'crypto';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import {
  fetchBinanceTicker24h,
  fetchBtcPriceQuote,
  fetchCoinGeckoBtcSnapshot,
  fetchJsonWithTimeout,
  normalizeBtcPriceParams
} from '../lib/priceFeed.js';
import { createMarketAnalysisHelpers } from '../lib/marketAnalysisHelpers.js';
import { createMarketAnalysisRuntime } from '../lib/marketAnalysisRuntime.js';
import { createCatalogHelpers } from '../lib/appRecordHelpers.js';
import { createOnchainAnchorHelpers } from '../lib/onchainAnchors.js';
import { createEscrowHelpers } from '../lib/escrowHelpers.js';
import { createXReaderDigestFetcher } from '../lib/httpFetch.js';
import { createServiceRoutingHelpers, isInfoAnalysisAction, isTechnicalAnalysisAction } from '../lib/serviceRouting.js';
import { createX402WorkflowHelpers } from '../lib/x402WorkflowHelpers.js';
import { createConsumerAuthorityHelpers } from '../lib/consumerAuthority.js';
import { parseAgentIdList } from '../lib/env.js';
import { jobLifecycleAnchorV2Abi } from '../lib/contracts/jobLifecycleAnchorV2Abi.js';
import { trustPublicationAnchorAbi } from '../lib/contracts/trustPublicationAnchorAbi.js';
import { createMessageProviderAnalysisService } from '../services/messageProviderAnalysisService.js';
import { createX402ReceiptService } from '../services/x402ReceiptService.js';
import { createAgent001ExecutionService } from '../services/agent001ExecutionService.js';
import { createAgent001PlanningService } from '../services/agent001PlanningService.js';
import { createAgent001Orchestrator } from '../services/agent001Orchestrator.js';
import {
  classifyAgent001IntentFallback,
  detectAgent001IntentOverrides,
  extractFirstUrlFromText,
  extractHorizonFromText,
  extractTradingSymbolFromText,
  isAgent001ForceOrderRequested,
  parseAgent001OrderDirectives,
  resolveAgent001Intent
} from '../services/agent001Intent.js';
import { createIdentityVerificationHelpers } from '../services/identityVerificationHelpers.js';
import { createPaymentPolicyHelpers } from '../services/paymentPolicyHelpers.js';
import { createRuntimeSupportHelpers } from '../services/runtimeSupportHelpers.js';
import { createNetworkCommandHelpers } from '../services/networkCommandHelpers.js';
import { createNetworkCommandExecutionHelpers } from '../services/networkCommandExecutionHelpers.js';
import { createRuntimeDecisionHelpers } from '../services/runtimeDecisionHelpers.js';
import { createServiceNetworkHelpers } from '../services/serviceNetworkHelpers.js';
import { createRuntimeTaskEnvelopeHelpers } from '../services/runtimeTaskEnvelopeHelpers.js';
import { createAgent001ReplyHelpers } from '../services/agent001ReplyHelpers.js';
import { createAgent001DispatchHelpers } from '../services/agent001DispatchHelpers.js';
import { createAgent001DispatchRecoveryHelpers } from '../services/agent001DispatchRecoveryHelpers.js';
import { createAgent001TradeFlowHelpers } from '../services/agent001TradeFlowHelpers.js';
import { createAgent001AnalysisFlowHelpers } from '../services/agent001AnalysisFlowHelpers.js';
import { createAgent001ConversationGateHelpers } from '../services/agent001ConversationGateHelpers.js';
import { createPolicyConfigHelpers } from '../lib/addressPolicyHelpers.js';

export async function servicesBootstrap(ctx) {
  const {
    ANALYSIS_PROVIDER, X_READER_MAX_CHARS_DEFAULT,
    BACKEND_RPC_URL, BACKEND_BUNDLER_URL, BACKEND_ENTRYPOINT_ADDRESS,
    KITE_AA_FACTORY_ADDRESS, KITE_AA_ACCOUNT_IMPLEMENTATION,
    BUNDLER_RPC_BACKOFF_POLICY, KITE_BUNDLER_RPC_TIMEOUT_MS, KITE_BUNDLER_RPC_RETRIES,
    KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS, KTRACE_ESCROW_USEROP_SUBMIT_TIMEOUT_MS,
    KTRACE_ESCROW_USEROP_WAIT_TIMEOUT_MS, KTRACE_ESCROW_USEROP_POLL_INTERVAL_MS,
    AA_V2_VERSION_TAG, KITE_AA_JOB_LANE_REQUIRED_VERSION, KITE_REQUIRE_AA_V2, KITE_MIN_NATIVE_GAS,
    SETTLEMENT_TOKEN, MERCHANT_ADDRESS, HYPERLIQUID_ORDER_RECIPIENT,
    KITE_AGENT2_AA_ADDRESS, KITE_AGENT2_ID,
    X402_BTC_PRICE, X402_HYPERLIQUID_ORDER_PRICE, X402_INFO_PRICE, X402_REACTIVE_PRICE,
    X402_RISK_SCORE_PRICE, X402_TECHNICAL_PRICE, X402_X_READER_PRICE, X402_PRICE,
    X402_UNIFIED_SERVICE_PRICE, X402_TTL_MS, ERC8004_IDENTITY_REGISTRY, ERC8004_AGENT_ID,
    ERC8004_TRUST_ANCHOR_REGISTRY, ERC8183_JOB_ANCHOR_REGISTRY, ERC8183_ESCROW_ADDRESS,
    PROOF_RPC_TIMEOUT_MS, PROOF_RPC_RETRIES, PROOF_RECEIPT_WAIT_MS, PROOF_RECEIPT_POLL_INTERVAL_MS,
    IDENTITY_CHALLENGE_TTL_MS, IDENTITY_CHALLENGE_MAX_ROWS, IDENTITY_VERIFY_MODE,
    POLICY_MAX_PER_TX_DEFAULT, POLICY_DAILY_LIMIT_DEFAULT, POLICY_ALLOWED_RECIPIENTS_DEFAULT,
    API_KEY_ADMIN, API_KEY_AGENT, API_KEY_VIEWER, PORT, KITE_AGENT1_ID,
    AGENT001_REQUIRE_X402, AGENT001_PREBIND_ONLY, AGENT001_BIND_TIMEOUT_MS,
    OPENNEWS_API_BASE, OPENNEWS_TOKEN, OPENNEWS_TIMEOUT_MS, OPENNEWS_RETRY, OPENNEWS_MAX_ROWS,
    OPENTWITTER_API_BASE, OPENTWITTER_TOKEN, OPENTWITTER_TIMEOUT_MS, OPENTWITTER_RETRY,
    OPENTWITTER_MAX_ROWS,
    MESSAGE_PROVIDER_DEFAULT_KEYWORDS, MESSAGE_PROVIDER_MARKET_DATA_FALLBACK,
    GokiteAASDK, policyConfigPath,
    // From infra
    createTraceId, waitMs, getUtcDateKey, broadcastEvent,
    normalizeAddress, normalizeAddresses,
    backendSigner, llmAdapter,
    readX402Requests, writeX402Requests, readWorkflows, writeWorkflows,
    readAgent001Results, writeAgent001Results, readIdentityChallenges, writeIdentityChallenges,
    readJobs, readServiceInvocations, readTrustPublications,
    readNetworkAgents, writeNetworkAgents, readPublishedServices, writePublishedServices,
    readTemplates, writeTemplates, readNetworkCommands, writeNetworkCommands,
    readConsumerIntents, writeConsumerIntents, readSessionRuntime,
    resolveSessionRuntime, writeSessionRuntime, resolveSessionOwnerByAaWallet,
    resolveSessionOwnerPrivateKey, readPolicyFailures, writePolicyFailures,
    toAuditText, appendNetworkAuditEvent,
    getInternalAgentApiKey, isAgent001TaskSuccessful,
    KITE_NETWORK_AUDIT_MAX_EVENTS
  } = ctx;

  // ── Utility functions specific to services layer ──────────────────────────

  function createServiceId() {
    return `svc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  }

  function createTemplateId() {
    return `tpl_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  }

  function resolveWorkflowTraceId(requestedTraceId = '') {
    const input = String(requestedTraceId || '').trim();
    if (!input) return createTraceId('workflow');
    const exists = ctx.readWorkflows().some((item) => String(item?.traceId || '') === input);
    return exists ? createTraceId('workflow') : input;
  }

  // ── X402 workflow ─────────────────────────────────────────────────────────

  const {
    computeX402StatusCounts, expireStaleX402PendingRequests, scheduleX402PendingCleanup,
    upsertAgent001ResultRecord, upsertWorkflow, createX402Request, buildPaymentRequiredResponse
  } = createX402WorkflowHelpers({
    crypto, normalizeAddress, createTraceId, toAuditText, appendNetworkAuditEvent,
    readX402Requests, writeX402Requests, readAgent001Results, writeAgent001Results,
    readWorkflows, writeWorkflows,
    x402Price: X402_PRICE, x402TtlMs: X402_TTL_MS,
    settlementToken: SETTLEMENT_TOKEN, merchantAddress: MERCHANT_ADDRESS,
    kiteNetworkAuditMaxEvents: KITE_NETWORK_AUDIT_MAX_EVENTS,
    erc8004IdentityRegistry: ERC8004_IDENTITY_REGISTRY, erc8004AgentId: ERC8004_AGENT_ID,
    rpcUrl: BACKEND_RPC_URL,
    bundlerUrl: BACKEND_BUNDLER_URL,
    entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
    accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
    accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION,
    chainId: 2368
  });

  // ── Identity verification ─────────────────────────────────────────────────

  const {
    assertBackendSigner, ensureWorkflowIdentityVerified, getLatestIdentityChallengeSnapshot,
    issueIdentityChallenge, readIdentityProfile, verifyIdentityChallengeResponse
  } = createIdentityVerificationHelpers({
    BACKEND_RPC_URL, ERC8004_AGENT_ID, ERC8004_IDENTITY_REGISTRY,
    IDENTITY_CHALLENGE_MAX_ROWS, IDENTITY_CHALLENGE_TTL_MS, IDENTITY_VERIFY_MODE,
    createTraceId, crypto, ethers,
    getBackendSigner: () => backendSigner,
    normalizeAddress, readIdentityChallenges: ctx.readIdentityChallenges,
    writeIdentityChallenges: ctx.writeIdentityChallenges
  });

  // ── X402 receipt service ──────────────────────────────────────────────────

  const x402ReceiptService = createX402ReceiptService({ readX402Requests, readWorkflows });
  const {
    mapX402Item, buildLatestWorkflowByRequestId, buildDemoPriceSeries,
    normalizeExecutionState, buildA2AReceipt, listA2AReceipts, buildA2ANetworkGraph,
    computeDashboardKpi
  } = x402ReceiptService;

  // ── Market analysis ───────────────────────────────────────────────────────

  const {
    normalizeReactiveParams, normalizeRiskScoreParams, normalizeXReaderParams,
    parseExcerptMaxChars, extractXReaderDigest, clampNumber, normalizeStringArray,
    normalizeFreshIsoTimestamp, normalizeInfoAnalysisResult, normalizeTechnicalAnalysisResult,
    averageNumbers, computeEma, computeRsi, computeMacd, computeAtr, toRiskLevel,
    buildRiskScoreSummary
  } = createMarketAnalysisHelpers({
    analysisProvider: ANALYSIS_PROVIDER,
    normalizeBtcPriceParams,
    xReaderMaxCharsDefault: X_READER_MAX_CHARS_DEFAULT
  });

  const {
    fetchFearGreedIndex, fetchBinanceKlines, runMarketInfoAnalysis,
    buildFallbackTechnicalFromQuote, runMarketTechnicalAnalysis, runRiskScoreAnalysis
  } = createMarketAnalysisRuntime({
    averageNumbers, buildDemoPriceSeries, buildRiskScoreSummary, clampNumber,
    computeAtr, computeEma, computeMacd, computeRsi,
    fetchBtcPriceQuote, fetchBinanceTicker24h, fetchCoinGeckoBtcSnapshot, fetchJsonWithTimeout,
    normalizeInfoAnalysisResult, normalizeRiskScoreParams, normalizeTechnicalAnalysisResult,
    normalizeXReaderParams, toRiskLevel
  });

  // ── Runtime support ───────────────────────────────────────────────────────

  const {
    buildInfoPaymentIntentForTask, buildInternalAgentHeaders, buildRiskScorePaymentIntentForTask,
    fetchJsonResponseWithTimeout, hasStrictX402Evidence, isTransientTransportError
  } = createRuntimeSupportHelpers({
    AGENT001_BIND_TIMEOUT_MS, AGENT001_PREBIND_ONLY,
    API_KEY_ADMIN, API_KEY_AGENT, API_KEY_VIEWER,
    KITE_AGENT1_ID, KITE_AGENT2_ID, PORT, X_READER_MAX_CHARS_DEFAULT,
    buildLatestWorkflowByRequestId, createTraceId, normalizeAddress,
    normalizeRiskScoreParams, normalizeXReaderParams, readWorkflows, readX402Requests,
    resolveWorkflowTraceId
  });

  const buildXReaderPaymentIntentForTask = buildInfoPaymentIntentForTask;

  // ── Routing + policy ──────────────────────────────────────────────────────

  const {
    resolveTechnicalSettlementRecipient, resolveInfoSettlementRecipient, getActionConfig
  } = createServiceRoutingHelpers({
    ethers, hyperliquidOrderRecipient: HYPERLIQUID_ORDER_RECIPIENT,
    kiteAgent2AaAddress: KITE_AGENT2_AA_ADDRESS, merchantAddress: MERCHANT_ADDRESS,
    normalizeAddress, x402BtcPrice: X402_BTC_PRICE,
    x402HyperliquidOrderPrice: X402_HYPERLIQUID_ORDER_PRICE, x402InfoPrice: X402_INFO_PRICE,
    x402ReactivePrice: X402_REACTIVE_PRICE, x402RiskScorePrice: X402_RISK_SCORE_PRICE,
    x402TechnicalPrice: X402_TECHNICAL_PRICE, x402XReaderPrice: X402_X_READER_PRICE,
    x402Price: X402_PRICE
  });

  const {
    getCoreAllowedRecipients, mergeAllowedRecipients, sanitizePolicy,
    ensurePolicyFile, readPolicyConfig, writePolicyConfig
  } = createPolicyConfigHelpers({
    fs, path, policyConfigPath,
    policyMaxPerTxDefault: POLICY_MAX_PER_TX_DEFAULT,
    policyDailyLimitDefault: POLICY_DAILY_LIMIT_DEFAULT,
    policyAllowedRecipientsDefault: POLICY_ALLOWED_RECIPIENTS_DEFAULT,
    merchantAddress: MERCHANT_ADDRESS, kiteAgent2AaAddress: KITE_AGENT2_AA_ADDRESS,
    resolveTechnicalSettlementRecipient, resolveInfoSettlementRecipient
  });

  const {
    buildA2ACapabilities, buildPolicySnapshot, buildResponseHash, digestStableObject,
    evaluateTransferPolicy, extractUserOpHashFromReason, logPolicyFailure,
    sendSessionTransferViaEoaRelay, shouldFallbackToEoaRelay, signResponseHash,
    validatePaymentProof, verifyProofOnChain, withSessionUserOpLock
  } = createPaymentPolicyHelpers({
    BACKEND_RPC_URL, HYPERLIQUID_ORDER_RECIPIENT, KITE_AGENT2_AA_ADDRESS, KITE_AGENT2_ID,
    MERCHANT_ADDRESS, PROOF_RECEIPT_POLL_INTERVAL_MS, PROOF_RECEIPT_WAIT_MS,
    PROOF_RPC_RETRIES, PROOF_RPC_TIMEOUT_MS, SETTLEMENT_TOKEN,
    X402_BTC_PRICE, X402_HYPERLIQUID_ORDER_PRICE, X402_INFO_PRICE, X402_REACTIVE_PRICE,
    X402_RISK_SCORE_PRICE, X402_TECHNICAL_PRICE,
    crypto, ethers,
    getBackendSigner: () => backendSigner,
    normalizeAddress, readPolicyConfig, readPolicyFailures,
    resolveInfoSettlementRecipient, resolveTechnicalSettlementRecipient,
    waitMs, writePolicyFailures
  });

  // ── On-chain + escrow ─────────────────────────────────────────────────────

  const {
    checkAnchorExistsOnChain, publishTrustPublicationOnChain,
    publishJobLifecycleAnchorOnChain, readLatestAnchorIdOnChain
  } = createOnchainAnchorHelpers({
    backendSigner, backendRpcUrl: BACKEND_RPC_URL, digestStableObject,
    erc8004TrustAnchorRegistry: ERC8004_TRUST_ANCHOR_REGISTRY,
    erc8004IdentityRegistry: ERC8004_IDENTITY_REGISTRY,
    erc8183JobAnchorRegistry: ERC8183_JOB_ANCHOR_REGISTRY,
    ethers, jobLifecycleAnchorAbi: jobLifecycleAnchorV2Abi,
    trustPublicationAnchorAbi, resolveSessionRuntime,
    resolveSessionOwnerByAaWallet, resolveSessionOwnerPrivateKey,
    GokiteAASDK, bundlerUrl: BACKEND_BUNDLER_URL,
    entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS,
    accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
    accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION
  });

  const {
    beginConsumerIntent, buildAuthorityPublicSummary, buildAuthoritySnapshot,
    buildPolicySnapshotHash, finalizeConsumerIntent, findConsumerIntent,
    materializeAuthority, revokeConsumerAuthorityPolicy, validateConsumerAuthority,
    writeConsumerAuthorityPolicy
  } = createConsumerAuthorityHelpers({
    crypto, normalizeAddress, readPolicyConfig, buildPolicySnapshot,
    evaluateTransferPolicy, logPolicyFailure, markSessionPayFailure: ctx.markSessionPayFailure,
    readX402Requests, readConsumerIntents, writeConsumerIntents,
    readSessionRuntime, resolveSessionRuntime, writeSessionRuntime
  });

  const escrowHelpers = createEscrowHelpers({
    backendSigner, ethers, escrowAddress: ERC8183_ESCROW_ADDRESS,
    settlementToken: SETTLEMENT_TOKEN, resolveSessionRuntime,
    resolveSessionOwnerByAaWallet, resolveSessionOwnerPrivateKey,
    rpcUrl: BACKEND_RPC_URL, bundlerUrl: BACKEND_BUNDLER_URL,
    entryPointAddress: BACKEND_ENTRYPOINT_ADDRESS, accountFactoryAddress: KITE_AA_FACTORY_ADDRESS,
    accountImplementationAddress: KITE_AA_ACCOUNT_IMPLEMENTATION,
    bundlerRpcTimeoutMs: KITE_BUNDLER_RPC_TIMEOUT_MS, bundlerRpcRetries: KITE_BUNDLER_RPC_RETRIES,
    bundlerRpcBackoffBaseMs: BUNDLER_RPC_BACKOFF_POLICY.baseMs,
    bundlerRpcBackoffMaxMs: BUNDLER_RPC_BACKOFF_POLICY.maxMs,
    bundlerRpcBackoffFactor: BUNDLER_RPC_BACKOFF_POLICY.factor,
    bundlerRpcBackoffJitterMs: BUNDLER_RPC_BACKOFF_POLICY.jitterMs,
    bundlerReceiptPollIntervalMs: KITE_BUNDLER_RECEIPT_POLL_INTERVAL_MS,
    escrowUserOpSubmitTimeoutMs: KTRACE_ESCROW_USEROP_SUBMIT_TIMEOUT_MS,
    escrowUserOpWaitTimeoutMs: KTRACE_ESCROW_USEROP_WAIT_TIMEOUT_MS,
    escrowUserOpPollIntervalMs: KTRACE_ESCROW_USEROP_POLL_INTERVAL_MS,
    aaVersionTag: AA_V2_VERSION_TAG,
    jobLaneRequiredAaVersionTag: KITE_AA_JOB_LANE_REQUIRED_VERSION,
    requireAaV2: KITE_REQUIRE_AA_V2, kiteMinNativeGas: KITE_MIN_NATIVE_GAS
  });
  const {
    preflightJobLaneCapability, prepareEscrowFunding, lockEscrowFunds,
    claimEscrowJob, acceptEscrowJob, submitEscrowResult, validateEscrowJob,
    expireEscrowJob, getEscrowJob
  } = escrowHelpers;

  // ── Service network ───────────────────────────────────────────────────────

  const {
    buildServiceStatus, computeServiceReputation, defaultAgentIdByCapability,
    ensureNetworkAgents, ensureServiceCatalog, evaluateServiceInvokeGuard,
    findNetworkAgentById, mapServiceReceipt, resolveAgentAddressesByIds,
    resolveAnalysisErrorStatus, sanitizeNetworkAgentRecord, sanitizeServiceRecord,
    selectServiceCandidatesByCapability, toPriceNumber
  } = createServiceNetworkHelpers({
    ERC8004_AGENT_ID, ERC8004_IDENTITY_REGISTRY, ethers,
    HYPERLIQUID_ORDER_RECIPIENT, KITE_AGENT2_AA_ADDRESS, KITE_AGENT2_ID,
    MERCHANT_ADDRESS, SETTLEMENT_TOKEN, X402_BTC_PRICE, X402_HYPERLIQUID_ORDER_PRICE,
    X402_INFO_PRICE, X402_RISK_SCORE_PRICE, X402_TECHNICAL_PRICE, X402_UNIFIED_SERVICE_PRICE,
    X_READER_MAX_CHARS_DEFAULT, getUtcDateKey, isInfoAnalysisAction, isTechnicalAnalysisAction,
    normalizeAddress, normalizeAddresses, normalizeBtcPriceParams,
    normalizeRiskScoreParams, normalizeXReaderParams, parseAgentIdList,
    readNetworkAgents, readPublishedServices, resolveInfoSettlementRecipient,
    resolveTechnicalSettlementRecipient, writeNetworkAgents, writePublishedServices
  });

  const { buildTemplateRecordFromService, ensureTemplateCatalog } = createCatalogHelpers({
    ensureServiceCatalog, readTemplates, writeTemplates, createTemplateId
  });

  // ── Message provider + x-reader ──────────────────────────────────────────

  const messageProviderAnalysisService = createMessageProviderAnalysisService({
    analysisProvider: ANALYSIS_PROVIDER,
    messageProviderDefaultKeywords: MESSAGE_PROVIDER_DEFAULT_KEYWORDS,
    messageProviderMarketDataFallback: MESSAGE_PROVIDER_MARKET_DATA_FALLBACK,
    openNews: {
      baseUrl: OPENNEWS_API_BASE, token: OPENNEWS_TOKEN,
      timeoutMs: OPENNEWS_TIMEOUT_MS, retries: OPENNEWS_RETRY, maxRows: OPENNEWS_MAX_ROWS
    },
    openTwitter: {
      baseUrl: OPENTWITTER_API_BASE, token: OPENTWITTER_TOKEN,
      timeoutMs: OPENTWITTER_TIMEOUT_MS, retries: OPENTWITTER_RETRY, maxRows: OPENTWITTER_MAX_ROWS
    },
    clampNumber, normalizeFreshIsoTimestamp, normalizeStringArray,
    normalizeInfoAnalysisResult, averageNumbers, normalizeXReaderParams, runMarketInfoAnalysis
  });
  const { runInfoAnalysis } = messageProviderAnalysisService;
  const fetchXReaderDigest = createXReaderDigestFetcher({
    analysisProvider: ANALYSIS_PROVIDER, normalizeXReaderParams, runInfoAnalysis
  });

  // ── Network command helpers ───────────────────────────────────────────────

  const {
    appendNetworkCommandEvent, createCommandId, extractNetworkCommandRefs,
    findNetworkCommandById, normalizeNetworkCommandPayload, normalizeNetworkCommandType,
    parseNetworkCommandFilterList, summarizeNetworkCommandExecution, upsertNetworkCommandRecord
  } = createNetworkCommandHelpers({
    createTraceId, normalizeAddresses, parseAgentIdList, readNetworkCommands, writeNetworkCommands
  });

  const { executeNetworkCommand } = createNetworkCommandExecutionHelpers({
    PORT, appendNetworkCommandEvent, extractNetworkCommandRefs, fetchImpl: fetch,
    getInternalAgentApiKey, normalizeNetworkCommandPayload, normalizeNetworkCommandType,
    summarizeNetworkCommandExecution, upsertNetworkCommandRecord
  });

  // ── Runtime decision helpers ──────────────────────────────────────────────

  const {
    buildBestServiceQuote, buildTaskPaymentFromIntent, buildTaskReceiptRef,
    getTaskEnvelopeInput, normalizeTaskFailure, parseJsonObjectFromText,
    pickBestServiceByReputationAndPrice
  } = createRuntimeDecisionHelpers({
    KITE_AGENT2_AA_ADDRESS, SETTLEMENT_TOKEN, computeServiceReputation,
    defaultAgentIdByCapability, mapServiceReceipt, readServiceInvocations,
    readWorkflows, readX402Requests, selectServiceCandidatesByCapability, toPriceNumber
  });

  // ── Agent001 orchestration chain ─────────────────────────────────────────

  const {
    buildLocalTechnicalRecoveryDispatch, isLegacyBtcOnlyTechnicalFailure
  } = createAgent001DispatchRecoveryHelpers({ normalizeRiskScoreParams, runRiskScoreAnalysis });

  const { runAgent001DispatchTask } = createAgent001DispatchHelpers({
    buildLocalTechnicalRecoveryDispatch, createTraceId, findNetworkAgentById,
    isLegacyBtcOnlyTechnicalFailure, normalizeAddress, waitMs
  });

  const {
    applyAgent001LocalFallback, buildAgent001DispatchSummary, maybePolishAgent001Reply
  } = createAgent001ReplyHelpers({
    createTraceId, extractFirstUrlFromText, extractHorizonFromText, extractTradingSymbolFromText,
    fetchXReaderDigest, normalizeStringArray, normalizeXReaderParams, llmAdapter, runRiskScoreAnalysis
  });

  const agent001Orchestrator = createAgent001Orchestrator({
    normalizeAddress, readIdentityProfile, defaultAgentIdByCapability, ensureNetworkAgents,
    findNetworkAgentById, selectServiceCandidatesByCapability, readServiceInvocations,
    readWorkflows, readX402Requests, mapServiceReceipt, computeServiceReputation,
    pickBestServiceByReputationAndPrice, runAgent001DispatchTask,
    extractTradingSymbolFromText, extractHorizonFromText, extractFirstUrlFromText,
    buildRiskScorePaymentIntentForTask, buildInfoPaymentIntentForTask,
    createTraceId
  });

  const agent001ExecutionService = createAgent001ExecutionService({
    fetchJsonResponseWithTimeout, buildInternalAgentHeaders,
    createTraceId, isTransientTransportError, waitMs,
    hasStrictX402Evidence, upsertAgent001ResultRecord, normalizeAddress, port: PORT
  });

  const agent001PlanningService = createAgent001PlanningService({
    parseAgent001OrderDirectives, extractTradingSymbolFromText, extractHorizonFromText,
    clampNumber, toRiskLevel
  });

  const { selectAgent001ProviderPlan, runAgent001QuoteNegotiation, buildAgent001StrictPaymentPlan } =
    agent001Orchestrator;
  const {
    appendAgent001OrderExecutionLines, buildAgent001FailureReply, maybeSendAgent001ProgressDm,
    maybeSendAgent001TradePlanDm, runAgent001HyperliquidOrderWorkflow, runAgent001StopOrderWorkflow
  } = agent001ExecutionService;
  const { buildAgent001TradePlan, coerceAgent001ForcedTradePlan } = agent001PlanningService;

  const { handleAgent001TradeIntent } = createAgent001TradeFlowHelpers({
    appendAgent001OrderExecutionLines, buildAgent001FailureReply, buildAgent001StrictPaymentPlan,
    buildAgent001TradePlan, buildTaskReceiptRef, coerceAgent001ForcedTradePlan,
    extractTradingSymbolFromText, hasStrictX402Evidence, isAgent001ForceOrderRequested,
    isAgent001TaskSuccessful, maybeSendAgent001ProgressDm, maybeSendAgent001TradePlanDm,
    normalizeAddress, parseAgent001OrderDirectives, readSessionRuntime,
    runAgent001DispatchTask, runAgent001QuoteNegotiation, selectAgent001ProviderPlan,
    upsertAgent001ResultRecord
  });

  const { handleAgent001AnalysisIntent } = createAgent001AnalysisFlowHelpers({
    AGENT001_REQUIRE_X402, applyAgent001LocalFallback, buildAgent001DispatchSummary,
    buildAgent001FailureReply, buildAgent001StrictPaymentPlan, buildAgent001TradePlan,
    buildTaskReceiptRef, extractFirstUrlFromText, hasStrictX402Evidence,
    isAgent001TaskSuccessful, maybePolishAgent001Reply, maybeSendAgent001ProgressDm,
    maybeSendAgent001TradePlanDm, normalizeAddress, readSessionRuntime,
    runAgent001DispatchTask, runAgent001QuoteNegotiation, selectAgent001ProviderPlan,
    upsertAgent001ResultRecord
  });

  const { resolveAgent001ConversationEntry } = createAgent001ConversationGateHelpers({
    AGENT001_REQUIRE_X402, classifyAgent001IntentFallback, createTraceId,
    detectAgent001IntentOverrides, llmAdapter, parseJsonObjectFromText, resolveAgent001Intent
  });

  // ── Task envelope handlers ────────────────────────────────────────────────

  const {
    handleExecutorRuntimeTaskEnvelope, handlePriceRuntimeTaskEnvelope,
    handleReaderRuntimeTaskEnvelope, handleRiskRuntimeTaskEnvelope
  } = createRuntimeTaskEnvelopeHelpers({
    X_READER_MAX_CHARS_DEFAULT, buildBestServiceQuote, buildTaskPaymentFromIntent,
    buildTaskReceiptRef, checkAnchorExistsOnChain, createTraceId, fetchBtcPriceQuote,
    fetchXReaderDigest, getTaskEnvelopeInput, normalizeBtcPriceParams,
    normalizeRiskScoreParams, normalizeTaskFailure, normalizeXReaderParams,
    llmAdapter, runRiskScoreAnalysis
  });

  // ── Populate ctx ──────────────────────────────────────────────────────────

  Object.assign(ctx, {
    // Normalizers
    normalizeBtcPriceParams, normalizeReactiveParams, normalizeRiskScoreParams,
    normalizeXReaderParams, normalizeStringArray, normalizeFreshIsoTimestamp,
    parseExcerptMaxChars, parseAgent001OrderDirectives, parseJsonObjectFromText,
    parseNetworkCommandFilterList, parseAgentIdList,
    // Market analysis
    runMarketInfoAnalysis, runMarketTechnicalAnalysis, runRiskScoreAnalysis,
    fetchBtcPriceQuote, fetchBinanceTicker24h, fetchFearGreedIndex,
    buildDemoPriceSeries, buildFallbackTechnicalFromQuote,
    averageNumbers, clampNumber, toRiskLevel, buildRiskScoreSummary,
    // X402
    computeX402StatusCounts, expireStaleX402PendingRequests, scheduleX402PendingCleanup,
    upsertAgent001ResultRecord, upsertWorkflow, createX402Request, buildPaymentRequiredResponse,
    mapX402Item, buildLatestWorkflowByRequestId, normalizeExecutionState,
    buildA2AReceipt, listA2AReceipts, buildA2ANetworkGraph, computeDashboardKpi,
    // Identity
    assertBackendSigner, ensureWorkflowIdentityVerified, getLatestIdentityChallengeSnapshot,
    issueIdentityChallenge, readIdentityProfile, verifyIdentityChallengeResponse,
    // Routing
    resolveTechnicalSettlementRecipient, resolveInfoSettlementRecipient, getActionConfig,
    isInfoAnalysisAction, isTechnicalAnalysisAction,
    // Policy
    readPolicyConfig, writePolicyConfig, getCoreAllowedRecipients,
    buildA2ACapabilities, buildPolicySnapshot, buildResponseHash, digestStableObject,
    evaluateTransferPolicy, extractUserOpHashFromReason, logPolicyFailure,
    sendSessionTransferViaEoaRelay, shouldFallbackToEoaRelay, signResponseHash,
    validatePaymentProof, verifyProofOnChain, withSessionUserOpLock, buildPolicySnapshotHash,
    // On-chain
    checkAnchorExistsOnChain, publishTrustPublicationOnChain,
    publishJobLifecycleAnchorOnChain, readLatestAnchorIdOnChain,
    // Consumer authority
    beginConsumerIntent, buildAuthorityPublicSummary, buildAuthoritySnapshot,
    finalizeConsumerIntent, findConsumerIntent, materializeAuthority,
    revokeConsumerAuthorityPolicy, validateConsumerAuthority, writeConsumerAuthorityPolicy,
    // Escrow
    preflightJobLaneCapability, prepareEscrowFunding, lockEscrowFunds,
    claimEscrowJob, acceptEscrowJob, submitEscrowResult, validateEscrowJob,
    expireEscrowJob, getEscrowJob,
    // Service network
    buildServiceStatus, computeServiceReputation, defaultAgentIdByCapability,
    ensureNetworkAgents, ensureServiceCatalog, evaluateServiceInvokeGuard,
    findNetworkAgentById, mapServiceReceipt, resolveAgentAddressesByIds,
    resolveAnalysisErrorStatus, sanitizeNetworkAgentRecord, sanitizeServiceRecord,
    selectServiceCandidatesByCapability, toPriceNumber,
    buildTemplateRecordFromService, ensureTemplateCatalog,
    // Message provider
    runInfoAnalysis, fetchXReaderDigest,
    // Network commands
    appendNetworkCommandEvent, createCommandId, extractNetworkCommandRefs,
    findNetworkCommandById, normalizeNetworkCommandPayload, normalizeNetworkCommandType,
    summarizeNetworkCommandExecution, upsertNetworkCommandRecord, executeNetworkCommand,
    // Runtime decision
    buildBestServiceQuote, buildTaskPaymentFromIntent, buildTaskReceiptRef,
    getTaskEnvelopeInput, normalizeTaskFailure, pickBestServiceByReputationAndPrice,
    // Runtime support
    buildInfoPaymentIntentForTask, buildInternalAgentHeaders, buildRiskScorePaymentIntentForTask,
    buildXReaderPaymentIntentForTask, fetchJsonResponseWithTimeout,
    hasStrictX402Evidence, isTransientTransportError, resolveWorkflowTraceId,
    // Agent001
    buildLocalTechnicalRecoveryDispatch, isLegacyBtcOnlyTechnicalFailure,
    runAgent001DispatchTask, applyAgent001LocalFallback, buildAgent001DispatchSummary,
    maybePolishAgent001Reply, selectAgent001ProviderPlan, runAgent001QuoteNegotiation,
    buildAgent001StrictPaymentPlan, appendAgent001OrderExecutionLines, buildAgent001FailureReply,
    maybeSendAgent001ProgressDm, maybeSendAgent001TradePlanDm,
    runAgent001HyperliquidOrderWorkflow, runAgent001StopOrderWorkflow,
    buildAgent001TradePlan, coerceAgent001ForcedTradePlan,
    handleAgent001TradeIntent, handleAgent001AnalysisIntent, resolveAgent001ConversationEntry,
    // agent001Intent exports
    classifyAgent001IntentFallback, detectAgent001IntentOverrides,
    extractFirstUrlFromText, extractHorizonFromText, extractTradingSymbolFromText,
    isAgent001ForceOrderRequested, resolveAgent001Intent,
    // Task envelope handlers
    handleExecutorRuntimeTaskEnvelope, handlePriceRuntimeTaskEnvelope,
    handleReaderRuntimeTaskEnvelope, handleRiskRuntimeTaskEnvelope,
    // Utilities
    createServiceId, createTemplateId,
    // ABIs
    trustPublicationAnchorAbi, jobLifecycleAnchorV2Abi
  });
}
