export function createCommandExecutor({ createConfigEnvelope, createNotImplementedEnvelope, handlers = {} } = {}) {
  void createNotImplementedEnvelope;
  const dispatchTable = new Map([
    ['auth:login', handlers.handleAuthLogin],
    ['auth:whoami', handlers.handleAuthWhoami],
    ['auth:session', handlers.handleAuthSession],
    ['auth:policy', handlers.handleAuthPolicy],
    ['auth:policy-set', handlers.handleAuthPolicySet],
    ['auth:policy-revoke', handlers.handleAuthPolicyRevoke],
    ['auth:validate', handlers.handleAuthValidate],
    ['session:authorize', handlers.handleSessionAuthorize],
    ['session:request', handlers.handleSessionRequest],
    ['session:wait', handlers.handleSessionWait],
    ['session:approve', handlers.handleSessionApprove],
    ['approval:list', handlers.handleApprovalList],
    ['approval:show', handlers.handleApprovalShow],
    ['approval:approve', handlers.handleApprovalApprove],
    ['approval:reject', handlers.handleApprovalReject],
    ['buy:request', handlers.handleBuyRequest],
    ['buy:direct', handlers.handleBuyDirect],
    ['agent:invoke', handlers.handleAgentInvoke],
    ['mcp:bridge', handlers.handleMcpBridge],
    ['template:list', handlers.handleTemplateList],
    ['template:resolve', handlers.handleTemplateResolve],
    ['template:show', handlers.handleTemplateShow],
    ['template:publish', handlers.handleTemplatePublish],
    ['template:revoke', handlers.handleTemplateRevoke],
    ['template:activate', handlers.handleTemplateActivate],
    ['template:expire', handlers.handleTemplateExpire],
    ['provider:list', handlers.handleProviderList],
    ['provider:register', handlers.handleProviderRegister],
    ['provider:show', handlers.handleProviderShow],
    ['provider:identity-challenge', handlers.handleProviderIdentityChallenge],
    ['provider:register-identity', handlers.handleProviderRegisterIdentity],
    ['provider:import-identity', handlers.handleProviderImportIdentity],
    ['provider:approve', handlers.handleProviderApprove],
    ['provider:suspend', handlers.handleProviderSuspend],
    ['capability:list', handlers.handleCapabilityList],
    ['capability:publish', handlers.handleCapabilityPublish],
    ['capability:show', handlers.handleCapabilityShow],
    ['discovery:select', handlers.handleDiscoverySelect],
    ['discovery:compare', handlers.handleDiscoveryCompare],
    ['discovery:recommend-buy', handlers.handleDiscoveryRecommendBuy],
    ['system:start-fresh', handlers.handleSystemStartFresh],
    ['job:create', handlers.handleJobCreate],
    ['job:fund', handlers.handleJobFund],
    ['job:accept', handlers.handleJobAccept],
    ['job:submit', handlers.handleJobSubmit],
    ['job:show', handlers.handleJobShow],
    ['job:audit', handlers.handleJobAudit],
    ['job:validate', handlers.handleJobValidate],
    ['job:complete', handlers.handleJobComplete],
    ['job:reject', handlers.handleJobReject],
    ['job:expire', handlers.handleJobExpire],
    ['flow:status', handlers.handleFlowStatus],
    ['flow:show', handlers.handleFlowShow],
    ['flow:history', handlers.handleFlowHistory],
    ['artifact:receipt', handlers.handleArtifactReceipt],
    ['artifact:evidence', handlers.handleArtifactEvidence],
    ['evidence:get', handlers.handleEvidenceGet],
    ['trust:reputation', handlers.handleTrustReputation],
    ['trust:validations', handlers.handleTrustValidations],
    ['trust:publications', handlers.handleTrustPublications],
    ['trust:publish', handlers.handleTrustPublish]
  ]);

  return async function executeCommand(commandMeta, runtimeBundle, commandArgs) {
    if (commandMeta.family === 'config' && commandMeta.action === 'show') {
      return createConfigEnvelope(runtimeBundle);
    }

    const handler = dispatchTable.get(`${commandMeta.family}:${commandMeta.action}`);
    if (handler) {
      return handler(runtimeBundle, commandArgs);
    }

    const error = new Error(`No handler is registered for ${commandMeta.family}:${commandMeta.action}.`);
    error.code = 'command_dispatch_missing';
    throw error;
  };
}
