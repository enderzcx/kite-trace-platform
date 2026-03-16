import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { lookupCommand } from './commandCatalog.js';
import { createEnvelope, maskApiKey, writeEnvelope } from './output.js';
import { resolveRuntimeConfig, writeLocalProfileConfig } from './runtimeConfig.js';
import { parseGlobalArgs } from './parsers/globalParsers.js';
import { parseAuthSessionArgs, parseSessionAuthorizeArgs } from './parsers/authParsers.js';
import { parseBuyRequestArgs, parseBuyDirectArgs } from './parsers/buyParsers.js';
import { parseTemplateListArgs, parseTemplateResolveArgs, parseTemplatePublishArgs } from './parsers/templateParsers.js';
import {
  parseProviderListArgs,
  parseProviderRegisterArgs,
  parseCapabilityListArgs,
  parseCapabilityPublishArgs
} from './parsers/providerParsers.js';
import { parseDiscoverySelectArgs, parseDiscoveryRecommendArgs } from './parsers/discoveryParsers.js';
import { parseJobCreateArgs, parseJobSubmitArgs, parseJobCompleteArgs, parseJobRejectArgs } from './parsers/jobParsers.js';
import {
  parseFlowHistoryArgs,
  parseTrustReputationArgs,
  parseTrustValidationsArgs,
  parseTrustPublicationsArgs,
  parseTrustPublishArgs,
  parseSystemStartFreshArgs,
  parseArtifactArgs,
  parseEvidenceGetArgs
} from './parsers/flowParsers.js';
import { createTemplateCommandHandlers } from './commands/templateCommands.js';
import { createProviderCommandHandlers } from './commands/providerCommands.js';
import { createDiscoveryCommandHandlers } from './commands/discoveryCommands.js';
import { createFlowCommandHandlers } from './commands/flowCommands.js';
import { createArtifactCommandHandlers } from './commands/artifactCommands.js';
import { createTrustCommandHandlers } from './commands/trustCommands.js';
import { createSystemCommandHandlers } from './commands/systemCommands.js';
import { createJobCommandHandlers } from './commands/jobCommands.js';
import { createAuthCommandHandlers } from './commands/authCommands.js';
import { createBuyCommandHandlers } from './commands/buyCommands.js';
import { createCommandExecutor } from './lib/commandDispatcher.js';
import { createCliError } from './lib/errors.js';
import {
  buildQueryPath,
  requestJson,
  requestOptionalJson,
  resolveAdminTransportApiKey,
  resolveAgentTransportApiKey,
  runPowerShellScript
} from './lib/httpRuntime.js';
import {
  ensureReference,
  normalizeBuyState,
  normalizeCapability,
  normalizeLifecycleState,
  readStructuredInput,
  selectBuyService,
  writeArtifactDownload
} from './lib/inputRuntime.js';
import {
  buildDisplayName,
  buildHelpText,
  createConfigEnvelope,
  createHelpEnvelope,
  createNotImplementedEnvelope,
  createVersionEnvelope,
  readPackageVersion
} from './lib/presentation.js';
import { resolveFlowReference } from './lib/flowRuntime.js';
import {
  buildSessionSnapshot,
  createSessionAuthorizationMessage,
  ensureUsableSession,
  normalizeSessionGrantAddress,
  normalizeSessionGrantPayload,
  normalizeWalletAddress,
  readCurrentIdentityProfile,
  readSessionSnapshot
} from './lib/sessionRuntime.js';

const {
  handleTemplateList,
  handleTemplateResolve,
  handleTemplateShow,
  handleTemplatePublish,
  handleTemplateRevoke,
  handleTemplateActivate,
  handleTemplateExpire
} = createTemplateCommandHandlers({
  parseTemplateListArgs,
  parseTemplateResolveArgs,
  parseTemplatePublishArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError,
  ensureReference,
  readStructuredInput,
  resolveAdminTransportApiKey
});

const {
  handleProviderList,
  handleProviderRegister,
  handleProviderShow,
  handleProviderIdentityChallenge,
  handleProviderRegisterIdentity,
  handleProviderImportIdentity,
  handleProviderApprove,
  handleProviderSuspend,
  handleCapabilityList,
  handleCapabilityPublish,
  handleCapabilityShow
} = createProviderCommandHandlers({
  parseProviderListArgs,
  parseProviderRegisterArgs,
  parseCapabilityListArgs,
  parseCapabilityPublishArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  ensureReference,
  readStructuredInput,
  resolveAdminTransportApiKey
});

const {
  handleDiscoverySelect,
  handleDiscoveryCompare,
  handleDiscoveryRecommendBuy
} = createDiscoveryCommandHandlers({
  parseDiscoverySelectArgs,
  parseDiscoveryRecommendArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError
});

const { handleSystemStartFresh } = createSystemCommandHandlers({
  parseSystemStartFreshArgs,
  fileURLToPath,
  runPowerShellScript,
  createEnvelope,
  importMetaUrl: import.meta.url
});

const { handleFlowStatus, handleFlowShow, handleFlowHistory } = createFlowCommandHandlers({
  parseFlowHistoryArgs,
  requestJson,
  requestOptionalJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  ensureReference,
  resolveFlowReference,
  normalizeLifecycleState
});

const { handleArtifactReceipt, handleArtifactEvidence, handleEvidenceGet } = createArtifactCommandHandlers({
  parseArtifactArgs,
  parseEvidenceGetArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError,
  ensureReference,
  resolveFlowReference,
  writeArtifactDownload
});

const {
  handleTrustReputation,
  handleTrustValidations,
  handleTrustPublications,
  handleTrustPublish
} = createTrustCommandHandlers({
  parseTrustReputationArgs,
  parseTrustValidationsArgs,
  parseTrustPublicationsArgs,
  parseTrustPublishArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  readStructuredInput,
  resolveAdminTransportApiKey
});

const {
  handleJobCreate,
  handleJobFund,
  handleJobSubmit,
  handleJobShow,
  handleJobComplete,
  handleJobReject,
  handleJobExpire
} = createJobCommandHandlers({
  parseJobCreateArgs,
  parseJobSubmitArgs,
  parseJobCompleteArgs,
  parseJobRejectArgs,
  requestJson,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError,
  ensureReference,
  readStructuredInput,
  ensureUsableSession,
  normalizeWalletAddress,
  normalizeCapability
});

const {
  handleAuthLogin,
  handleAuthWhoami,
  handleAuthSession,
  handleSessionAuthorize
} = createAuthCommandHandlers({
  parseAuthSessionArgs,
  parseSessionAuthorizeArgs,
  requestJson,
  writeLocalProfileConfig,
  normalizeWalletAddress,
  createCliError,
  createEnvelope,
  maskApiKey,
  ensureUsableSession,
  normalizeSessionGrantAddress,
  readCurrentIdentityProfile,
  readSessionSnapshot,
  buildSessionSnapshot,
  normalizeSessionGrantPayload,
  createSessionAuthorizationMessage,
  resolveAdminTransportApiKey,
  randomBytes,
  ethers
});

const { handleBuyRequest, handleBuyDirect } = createBuyCommandHandlers({
  parseBuyRequestArgs,
  parseBuyDirectArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError,
  normalizeCapability,
  normalizeWalletAddress,
  readStructuredInput,
  ensureUsableSession,
  selectBuyService,
  normalizeBuyState
});

const executeCommand = createCommandExecutor({
  createConfigEnvelope,
  createNotImplementedEnvelope,
  handlers: {
    handleAuthLogin,
    handleAuthWhoami,
    handleAuthSession,
    handleSessionAuthorize,
    handleBuyRequest,
    handleBuyDirect,
    handleTemplateList,
    handleTemplateResolve,
    handleTemplateShow,
    handleTemplatePublish,
    handleTemplateRevoke,
    handleTemplateActivate,
    handleTemplateExpire,
    handleProviderList,
    handleProviderRegister,
    handleProviderShow,
    handleProviderIdentityChallenge,
    handleProviderRegisterIdentity,
    handleProviderImportIdentity,
    handleProviderApprove,
    handleProviderSuspend,
    handleCapabilityList,
    handleCapabilityPublish,
    handleCapabilityShow,
    handleDiscoverySelect,
    handleDiscoveryCompare,
    handleDiscoveryRecommendBuy,
    handleSystemStartFresh,
    handleJobCreate,
    handleJobFund,
    handleJobSubmit,
    handleJobShow,
    handleJobComplete,
    handleJobReject,
    handleJobExpire,
    handleFlowStatus,
    handleFlowShow,
    handleFlowHistory,
    handleArtifactReceipt,
    handleArtifactEvidence,
    handleEvidenceGet,
    handleTrustReputation,
    handleTrustValidations,
    handleTrustPublications,
    handleTrustPublish
  }
});

async function runParsedKtraceCli({ options = {}, passthrough = [] } = {}) {
  const runtimeBundle = await resolveRuntimeConfig(options);
  const version = await readPackageVersion();
  const helpText = buildHelpText(version);
  const runtime = runtimeBundle.config;

  let envelope;

  if (options.version) {
    envelope = createVersionEnvelope(version, runtime);
  } else if (options.help || passthrough.length === 0 || passthrough[0] === 'help') {
    envelope = createHelpEnvelope(runtime, helpText);
  } else {
    const [family = '', action = '', ...commandArgs] = passthrough;
    const commandMeta = lookupCommand(family, action);
    if (!commandMeta) {
      envelope = createEnvelope({
        ok: false,
        exitCode: 1,
        command: { family, action, display: buildDisplayName(family, action) },
        runtime,
        error: 'unknown_command',
        message: `Unknown command: ${buildDisplayName(family, action)}`
      });
    } else {
      try {
        envelope = await executeCommand(commandMeta, runtimeBundle, commandArgs);
      } catch (error) {
        envelope = createEnvelope({
          ok: false,
          exitCode: 1,
          command: {
            family: commandMeta.family,
            action: commandMeta.action,
            display: buildDisplayName(commandMeta.family, commandMeta.action)
          },
          runtime,
          error: error?.code || 'command_failed',
          message: error?.message || 'Command failed.',
          data: error?.data || null
        });
      }
    }
  }

  writeEnvelope(envelope, helpText);
  return envelope;
}

async function runKtraceCli(argv = []) {
  const { options, passthrough } = parseGlobalArgs(argv);
  return runParsedKtraceCli({ options, passthrough });
}

export { executeCommand, runParsedKtraceCli, runKtraceCli };
