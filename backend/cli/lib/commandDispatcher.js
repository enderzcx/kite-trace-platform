export function createCommandExecutor({ createConfigEnvelope, createNotImplementedEnvelope, handlers = {} } = {}) {
  const dispatchTable = new Map([
    ['auth:login', handlers.handleAuthLogin],
    ['auth:whoami', handlers.handleAuthWhoami],
    ['auth:session', handlers.handleAuthSession],
    ['session:authorize', handlers.handleSessionAuthorize],
    ['buy:request', handlers.handleBuyRequest],
    ['buy:direct', handlers.handleBuyDirect],
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
    ['job:submit', handlers.handleJobSubmit],
    ['job:show', handlers.handleJobShow],
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

    return createNotImplementedEnvelope(commandMeta, runtimeBundle.config);
  };
}
