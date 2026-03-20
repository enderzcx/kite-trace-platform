export function maskApiKey(apiKey = '') {
  const text = String(apiKey || '').trim();
  if (!text) return '';
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function createEnvelope({
  ok,
  command,
  runtime,
  data = null,
  error = '',
  message = '',
  exitCode = 0
}) {
  return {
    ok: Boolean(ok),
    exitCode,
    command,
    runtime: {
      profile: runtime.profile,
      baseUrl: runtime.baseUrl,
      chain: runtime.chain,
      walletAddress: runtime.wallet || '',
      authMode: runtime.authMode,
      sessionMode: runtime.sessionMode,
      sessionStrategy: runtime.sessionStrategy,
      outputMode: runtime.outputMode
    },
    error: error || undefined,
    message: message || undefined,
    data
  };
}

function printConfigShow(envelope) {
  const config = envelope?.data?.config || {};
  const meta = envelope?.data?.meta || {};
  console.log('ktrace config show');
  console.log(`profile: ${config.profile || '-'}`);
  console.log(`baseUrl: ${config.baseUrl || '-'}`);
  console.log(`chain: ${config.chain || '-'}`);
  console.log(`wallet: ${config.walletAddress || '-'}`);
  console.log(`authMode: ${config.authMode || '-'}`);
  console.log(`sessionMode: ${config.sessionMode || '-'}`);
  console.log(`sessionStrategy: ${config.sessionStrategy || '-'}`);
  console.log(`outputMode: ${config.defaultOutputMode || '-'}`);
  console.log(`configPath: ${meta.configPath || '-'}`);
  console.log(`profileExists: ${meta.profileExists ? 'yes' : 'no'}`);
}

function printAuthLogin(envelope) {
  const login = envelope?.data?.login || {};
  const auth = envelope?.data?.auth || {};
  console.log('ktrace auth login');
  console.log(`profile: ${login.profile || envelope?.runtime?.profile || '-'}`);
  console.log(`wallet: ${login.walletAddress || envelope?.runtime?.walletAddress || '-'}`);
  console.log(`baseUrl: ${login.baseUrl || envelope?.runtime?.baseUrl || '-'}`);
  console.log(`chain: ${login.chain || envelope?.runtime?.chain || '-'}`);
  console.log(`role: ${auth.role || '-'}`);
  console.log(`authConfigured: ${auth.authConfigured ? 'yes' : 'no'}`);
  console.log(`configPath: ${login.configPath || '-'}`);
}

function printAuthWhoami(envelope) {
  const auth = envelope?.data?.auth || {};
  const identity = envelope?.data?.identity || {};
  const session = envelope?.data?.session || {};
  console.log('ktrace auth whoami');
  console.log(`profile: ${envelope?.runtime?.profile || '-'}`);
  console.log(`baseUrl: ${envelope?.runtime?.baseUrl || '-'}`);
  console.log(`role: ${auth.role || '-'}`);
  console.log(`wallet: ${identity.walletAddress || envelope?.runtime?.walletAddress || '-'}`);
  console.log(`owner: ${identity.ownerAddress || '-'}`);
  console.log(`aaWallet: ${session.aaWallet || '-'}`);
  console.log(`sessionReady: ${session.ready ? 'yes' : 'no'}`);
  console.log(`sessionAddress: ${session.sessionAddress || '-'}`);
  console.log(`sessionId: ${session.sessionId || '-'}`);
  console.log(`sessionStrategy: ${envelope?.runtime?.sessionStrategy || '-'}`);
}

function printAuthSession(envelope) {
  const session = envelope?.data?.session || {};
  const traceId = envelope?.data?.traceId || '';
  console.log('ktrace auth session');
  console.log(`status: ${session.created ? 'created' : session.reused ? 'ready' : session.checked ? 'checked' : 'updated'}`);
  console.log(`sessionStrategy: ${session.sessionStrategy || envelope?.runtime?.sessionStrategy || '-'}`);
  console.log(`owner: ${session.owner || '-'}`);
  console.log(`aaWallet: ${session.aaWallet || '-'}`);
  console.log(`sessionAddress: ${session.sessionAddress || '-'}`);
  console.log(`sessionId: ${session.sessionId || '-'}`);
  console.log(`sessionTxHash: ${session.sessionTxHash || '-'}`);
  console.log(`maxPerTx: ${session.maxPerTx || '-'}`);
  console.log(`dailyLimit: ${session.dailyLimit || '-'}`);
  console.log(`gatewayRecipient: ${session.gatewayRecipient || '-'}`);
  console.log(`authorizedBy: ${session.authorizedBy || '-'}`);
  console.log(`authorizationMode: ${session.authorizationMode || '-'}`);
  console.log(`traceId: ${traceId || '-'}`);
}

function printSessionAuthorize(envelope) {
  const authorization = envelope?.data?.authorization || {};
  const session = envelope?.data?.session || {};
  const localRuntime = envelope?.data?.localRuntime || {};
  console.log('ktrace session authorize');
  console.log(`authorizationId: ${authorization.authorizationId || '-'}`);
  console.log(`authorizedBy: ${authorization.authorizedBy || '-'}`);
  console.log(`executionMode: ${authorization.executionMode || envelope?.runtime?.sessionStrategy || '-'}`);
  console.log(`authorizationMode: ${authorization.authorizationMode || '-'}`);
  console.log(`authorizedAgentId: ${authorization.authorizedAgentId || '-'}`);
  console.log(`authorizedAgentWallet: ${authorization.authorizedAgentWallet || '-'}`);
  console.log(`authorizationPayloadHash: ${authorization.authorizationPayloadHash || '-'}`);
  console.log(`authorizationNonce: ${authorization.authorizationNonce || '-'}`);
  console.log(`authorizationExpiresAt: ${authorization.authorizationExpiresAt || '-'}`);
  console.log(`aaWallet: ${session.aaWallet || '-'}`);
  console.log(`sessionAddress: ${session.sessionAddress || '-'}`);
  console.log(`sessionId: ${session.sessionId || '-'}`);
  console.log(`sessionTxHash: ${session.sessionTxHash || '-'}`);
  console.log(`localAccountCreated: ${localRuntime.accountCreatedNow ? 'yes' : 'no'}`);
  console.log(`localAccountTxHash: ${localRuntime.accountTxHash || '-'}`);
  console.log(`summary: ${envelope?.message || '-'}`);
}

function printSessionRequest(envelope) {
  const approvalRequest = envelope?.data?.approvalRequest || {};
  console.log('ktrace session request');
  console.log(`approvalRequestId: ${approvalRequest.approvalRequestId || '-'}`);
  console.log(`status: ${approvalRequest.status || '-'}`);
  console.log(`userEoa: ${approvalRequest.userEoa || '-'}`);
  console.log(`sessionAddress: ${approvalRequest.sessionAddress || '-'}`);
  console.log(`approvalUrl: ${approvalRequest.approvalUrl || '-'}`);
  console.log(`qrText: ${approvalRequest.qrText || '-'}`);
  console.log(`createdAt: ${approvalRequest.createdAt || '-'}`);
  console.log(`summary: ${envelope?.message || '-'}`);
}

function printSessionWait(envelope) {
  const approvalRequest = envelope?.data?.approvalRequest || {};
  const session = envelope?.data?.session || {};
  console.log('ktrace session wait');
  console.log(`approvalRequestId: ${approvalRequest.approvalRequestId || '-'}`);
  console.log(`status: ${approvalRequest.status || '-'}`);
  console.log(`authorizationId: ${approvalRequest.authorizationId || envelope?.data?.authorization?.authorizationId || '-'}`);
  console.log(`aaWallet: ${session.aaWallet || '-'}`);
  console.log(`sessionAddress: ${session.sessionAddress || '-'}`);
  console.log(`sessionId: ${session.sessionId || '-'}`);
  console.log(`sessionTxHash: ${session.sessionTxHash || '-'}`);
  console.log(`localRuntimeSynced: ${envelope?.data?.localRuntimeSynced ? 'yes' : 'no'}`);
  console.log(`summary: ${envelope?.message || '-'}`);
}

function printSessionApprove(envelope) {
  const approvalRequest = envelope?.data?.approvalRequest || {};
  const session = envelope?.data?.session || {};
  console.log('ktrace session approve');
  console.log(`approvalRequestId: ${approvalRequest.approvalRequestId || '-'}`);
  console.log(`status: ${approvalRequest.status || '-'}`);
  console.log(`authorizedBy: ${envelope?.data?.authorization?.authorizedBy || session.authorizedBy || '-'}`);
  console.log(`aaWallet: ${session.aaWallet || envelope?.data?.aaWallet || '-'}`);
  console.log(`sessionAddress: ${session.sessionAddress || '-'}`);
  console.log(`sessionId: ${session.sessionId || '-'}`);
  console.log(`sessionTxHash: ${session.sessionTxHash || '-'}`);
  console.log(`summary: ${envelope?.message || '-'}`);
}

function printBuyRequest(envelope) {
  const buy = envelope?.data?.buy || {};
  const preflight = envelope?.data?.preflight || {};
  console.log('ktrace buy request');
  console.log(`lane: ${buy.lane || 'buy'}`);
  console.log(`provider: ${buy.provider || '-'}`);
  console.log(`capability: ${buy.capability || '-'}`);
  console.log(`serviceId: ${buy.serviceId || '-'}`);
  console.log(`invocationId: ${buy.invocationId || '-'}`);
  console.log(`traceId: ${buy.traceId || '-'}`);
  console.log(`state: ${buy.state || '-'}`);
  console.log(`paymentRequestId: ${buy.paymentRequestId || '-'}`);
  console.log(`txHash: ${buy.txHash || '-'}`);
  console.log(`summary: ${buy.summary || envelope?.message || '-'}`);
  console.log(`sessionPreflight: ${preflight.created ? 'created' : preflight.reused ? 'ready' : 'checked'}`);
  console.log(`sessionStrategy: ${preflight.sessionStrategy || envelope?.runtime?.sessionStrategy || '-'}`);
}

function printBuyDirect(envelope) {
  const purchase = envelope?.data?.purchase || {};
  const preflight = envelope?.data?.preflight || {};
  console.log('ktrace buy direct');
  console.log(`purchaseId: ${purchase.purchaseId || '-'}`);
  console.log(`traceId: ${purchase.traceId || '-'}`);
  console.log(`templateId: ${purchase.templateId || '-'}`);
  console.log(`serviceId: ${purchase.serviceId || '-'}`);
  console.log(`providerAgentId: ${purchase.providerAgentId || '-'}`);
  console.log(`capabilityId: ${purchase.capabilityId || '-'}`);
  console.log(`state: ${purchase.state || '-'}`);
  console.log(`paymentId: ${purchase.paymentId || '-'}`);
  console.log(`paymentTxHash: ${purchase.paymentTxHash || '-'}`);
  console.log(`receiptRef: ${purchase.receiptRef || '-'}`);
  console.log(`evidenceRef: ${purchase.evidenceRef || '-'}`);
  console.log(`sessionPreflight: ${preflight.created ? 'created' : preflight.reused ? 'ready' : preflight.checked ? 'checked' : '-'}`);
  console.log(`sessionStrategy: ${preflight.sessionStrategy || envelope?.runtime?.sessionStrategy || '-'}`);
  console.log(`summary: ${purchase.summary || envelope?.message || '-'}`);
  console.log(`error: ${purchase.error || '-'}`);
}

function printAgentInvoke(envelope) {
  const selection = envelope?.data?.selection || {};
  const template = envelope?.data?.template || {};
  const purchase = envelope?.data?.purchase || {};
  const evidence = envelope?.data?.evidence || {};
  const runtimeSession = evidence?.runtimeSnapshot || evidence?.runtimeSession || {};
  console.log('ktrace agent invoke');
  console.log(`providerId: ${selection?.provider?.providerId || purchase?.providerAgentId || '-'}`);
  console.log(`capabilityId: ${selection?.capability?.capabilityId || purchase?.capabilityId || '-'}`);
  console.log(`templateId: ${template?.templateId || purchase?.templateId || '-'}`);
  console.log(`traceId: ${purchase?.traceId || '-'}`);
  console.log(`state: ${purchase?.state || '-'}`);
  console.log(`paymentTxHash: ${purchase?.paymentTxHash || '-'}`);
  console.log(`authorizedBy: ${runtimeSession.authorizedBy || '-'}`);
  console.log(`summary: ${purchase?.summary || envelope?.message || '-'}`);
  console.log(`error: ${purchase?.error || '-'}`);
}

function printTemplateList(envelope) {
  const templates = Array.isArray(envelope?.data?.templates) ? envelope.data.templates : [];
  console.log('ktrace template list');
  console.log(`count: ${templates.length}`);
  for (const item of templates) {
    console.log(
      `- ${item.templateId || '-'} | v${item.templateVersion || 0} | ${item.providerAgentId || '-'} | ${item.capabilityId || '-'} | ${item.amount || '-'} | ${item.status || '-'}`
    );
  }
}

function printTemplateResolve(envelope) {
  const template = envelope?.data?.template || {};
  const service = envelope?.data?.service || {};
  console.log('ktrace template resolve');
  console.log(`templateId: ${template.templateId || '-'}`);
  console.log(`templateVersion: ${template.templateVersion || '-'}`);
  console.log(`providerAgentId: ${template.providerAgentId || '-'}`);
  console.log(`capabilityId: ${template.capabilityId || '-'}`);
  console.log(`serviceId: ${template.serviceId || service?.id || '-'}`);
  console.log(`status: ${template.status || '-'}`);
}

function printTemplateShow(envelope) {
  const template = envelope?.data?.template || {};
  const service = envelope?.data?.service || {};
  console.log('ktrace template show');
  console.log(`templateId: ${template.templateId || '-'}`);
  console.log(`templateVersion: ${template.templateVersion || '-'}`);
  console.log(`name: ${template.name || '-'}`);
  console.log(`providerAgentId: ${template.providerAgentId || '-'}`);
  console.log(`capabilityId: ${template.capabilityId || '-'}`);
  console.log(`serviceId: ${template.serviceId || '-'}`);
  console.log(`status: ${template.status || '-'}`);
  console.log(`active: ${template.active === false ? 'no' : 'yes'}`);
  console.log(`amount: ${template?.pricingTerms?.amount || '-'}`);
  console.log(`paymentMode: ${template?.settlementTerms?.paymentMode || '-'}`);
  console.log(`fulfillmentMode: ${template.fulfillmentMode || '-'}`);
  console.log(`validFrom: ${template.validFrom || '-'}`);
  console.log(`validUntil: ${template.validUntil || '-'}`);
  console.log(`linkedService: ${service?.id || '-'}`);
}

function printTemplatePublish(envelope) {
  const template = envelope?.data?.template || {};
  console.log('ktrace template publish');
  console.log(`mode: ${envelope?.data?.mode || '-'}`);
  console.log(`templateId: ${template.templateId || '-'}`);
  console.log(`templateVersion: ${template.templateVersion || '-'}`);
  console.log(`serviceId: ${template.serviceId || '-'}`);
  console.log(`providerAgentId: ${template.providerAgentId || '-'}`);
  console.log(`capabilityId: ${template.capabilityId || '-'}`);
  console.log(`status: ${template.status || '-'}`);
}

function printTemplateToggle(envelope) {
  const template = envelope?.data?.template || {};
  const display = envelope?.command?.display || 'ktrace template';
  console.log(display);
  console.log(`templateId: ${template.templateId || '-'}`);
  console.log(`templateVersion: ${template.templateVersion || '-'}`);
  console.log(`status: ${template.status || '-'}`);
  console.log(`active: ${template.active === false ? 'no' : 'yes'}`);
}

function printTemplateExpire(envelope) {
  const template = envelope?.data?.template || {};
  console.log('ktrace template expire');
  console.log(`templateId: ${template.templateId || '-'}`);
  console.log(`templateVersion: ${template.templateVersion || '-'}`);
  console.log(`status: ${template.status || '-'}`);
  console.log(`validUntil: ${template.validUntil || '-'}`);
}

function printProviderList(envelope) {
  const providers = Array.isArray(envelope?.data?.providers) ? envelope.data.providers : [];
  console.log('ktrace provider list');
  console.log(`count: ${providers.length}`);
  for (const item of providers) {
    console.log(
      `- ${item.providerId || '-'} | ${item.role || '-'} | ${item.mode || '-'} | ${item.active === false ? 'inactive' : 'active'} | ${(item.capabilities || []).join(',') || '-'}`
    );
  }
}

function printProviderRegister(envelope) {
  const provider = envelope?.data?.provider || {};
  console.log('ktrace provider register');
  console.log(`mode: ${envelope?.data?.mode || '-'}`);
  console.log(`providerId: ${provider.providerId || '-'}`);
  console.log(`name: ${provider.name || '-'}`);
  console.log(`role: ${provider.role || '-'}`);
  console.log(`modeValue: ${provider.mode || '-'}`);
  console.log(`active: ${provider.active === false ? 'no' : 'yes'}`);
}

function printProviderShow(envelope) {
  const provider = envelope?.data?.provider || {};
  console.log('ktrace provider show');
  console.log(`providerId: ${provider.providerId || '-'}`);
  console.log(`name: ${provider.name || '-'}`);
  console.log(`role: ${provider.role || '-'}`);
  console.log(`mode: ${provider.mode || '-'}`);
  console.log(`active: ${provider.active === false ? 'no' : 'yes'}`);
  console.log(`identityRegistry: ${provider?.identity?.registry || '-'}`);
  console.log(`identityAgentId: ${provider?.identity?.agentId || '-'}`);
  console.log(`xmtpAddress: ${provider?.runtime?.xmtpAddress || '-'}`);
  console.log(`aaAddress: ${provider?.runtime?.aaAddress || '-'}`);
  console.log(`capabilities: ${Array.isArray(provider?.capabilities) ? provider.capabilities.join(', ') || '-' : '-'}`);
}

function printCapabilityList(envelope) {
  const capabilities = Array.isArray(envelope?.data?.capabilities) ? envelope.data.capabilities : [];
  console.log('ktrace capability list');
  console.log(`count: ${capabilities.length}`);
  for (const item of capabilities) {
    console.log(
      `- ${item.capabilityId || '-'} | ${item.providerId || '-'} | ${item.action || '-'} | ${item.active === false ? 'inactive' : 'active'} | ${item?.pricing?.amount || '-'}`
    );
  }
}

function printCapabilityPublish(envelope) {
  const capability = envelope?.data?.capability || {};
  console.log('ktrace capability publish');
  console.log(`mode: ${envelope?.data?.mode || '-'}`);
  console.log(`capabilityId: ${capability.capabilityId || '-'}`);
  console.log(`providerId: ${capability.providerId || '-'}`);
  console.log(`action: ${capability.action || '-'}`);
  console.log(`active: ${capability.active === false ? 'no' : 'yes'}`);
}

function printCapabilityShow(envelope) {
  const capability = envelope?.data?.capability || {};
  console.log('ktrace capability show');
  console.log(`capabilityId: ${capability.capabilityId || '-'}`);
  console.log(`providerId: ${capability.providerId || '-'}`);
  console.log(`action: ${capability.action || '-'}`);
  console.log(`laneType: ${capability.laneType || '-'}`);
  console.log(`price: ${capability?.pricing?.amount || '-'}`);
  console.log(`tokenAddress: ${capability?.pricing?.tokenAddress || '-'}`);
  console.log(`recipient: ${capability?.settlement?.recipient || '-'}`);
  console.log(`tags: ${Array.isArray(capability?.discovery?.tags) ? capability.discovery.tags.join(', ') || '-' : '-'}`);
  console.log(`active: ${capability.active === false ? 'no' : 'yes'}`);
}

function printDiscoverySelect(envelope) {
  const items = Array.isArray(envelope?.data?.items) ? envelope.data.items : [];
  console.log('ktrace discovery select');
  console.log(`count: ${items.length}`);
  for (const item of items) {
    console.log(
      `- ${item?.provider?.providerId || '-'} | ${item?.capability?.capabilityId || '-'} | score=${item?.selectionScore ?? 0} | directBuyReady=${item?.directBuyReady ? 'yes' : 'no'}`
    );
  }
}

function printDiscoveryCompare(envelope) {
  const items = Array.isArray(envelope?.data?.items) ? envelope.data.items : [];
  const top = envelope?.data?.top || null;
  console.log('ktrace discovery compare');
  console.log(`count: ${items.length}`);
  console.log(`topProvider: ${top?.provider?.providerId || '-'}`);
  console.log(`topCapability: ${top?.capability?.capabilityId || '-'}`);
  console.log(`topTemplate: ${top?.template?.templateId || '-'}`);
  for (const item of items) {
    console.log(
      `- ${item?.provider?.providerId || '-'} | ${item?.capability?.capabilityId || '-'} | score=${item?.selectionScore ?? 0} | verified=${item?.rationale?.providerVerified ? 'yes' : 'no'} | discoverable=${item?.rationale?.providerDiscoverable ? 'yes' : 'no'} | directBuyReady=${item?.directBuyReady ? 'yes' : 'no'}`
    );
  }
}

function printDiscoveryRecommendBuy(envelope) {
  const selection = envelope?.data?.selection || {};
  const template = envelope?.data?.template || {};
  console.log('ktrace discovery recommend-buy');
  console.log(`providerId: ${selection?.provider?.providerId || '-'}`);
  console.log(`capabilityId: ${selection?.capability?.capabilityId || '-'}`);
  console.log(`selectionScore: ${selection?.selectionScore ?? 0}`);
  console.log(`templateId: ${template?.templateId || '-'}`);
  console.log(`templateVersion: ${template?.templateVersion || '-'}`);
  console.log(`purchaseReady: ${envelope?.data?.purchaseReady ? 'yes' : 'no'}`);
}

function printSystemStartFresh(envelope) {
  const data = envelope?.data || {};
  console.log('ktrace system start-fresh');
  console.log(`port: ${data.port || '-'}`);
  console.log(`dryRun: ${data.dryRun ? 'yes' : 'no'}`);
  console.log(`suggestedBaseUrl: ${data.suggestedBaseUrl || '-'}`);
  console.log(`stdout: ${data.stdout || '-'}`);
  if (data.stderr) {
    console.log(`stderr: ${data.stderr}`);
  }
}

function printJobCreate(envelope) {
  const job = envelope?.data?.job || {};
  console.log('ktrace job create');
  console.log(`jobId: ${job.jobId || '-'}`);
  console.log(`traceId: ${job.traceId || '-'}`);
  console.log(`state: ${job.state || '-'}`);
  console.log(`provider: ${job.provider || '-'}`);
  console.log(`capability: ${job.capability || '-'}`);
  console.log(`budget: ${job.budget || '-'}`);
  console.log(`payer: ${job.payer || '-'}`);
  console.log(`executor: ${job.executor || '-'}`);
  console.log(`validator: ${job.validator || '-'}`);
  console.log(`escrowAmount: ${job.escrowAmount || '-'}`);
  console.log(`templateId: ${job.templateId || '-'}`);
  console.log(`evaluator: ${job.evaluator || '-'}`);
  console.log(`expiresAt: ${job.expiresAt || '-'}`);
  console.log(`createAnchorId: ${job.createAnchorId || '-'}`);
  console.log(`createAnchorTxHash: ${job.createAnchorTxHash || '-'}`);
  console.log(`summary: ${envelope?.message || '-'}`);
}

function printJobFund(envelope) {
  const job = envelope?.data?.job || {};
  const preflight = envelope?.data?.preflight || {};
  console.log('ktrace job fund');
  console.log(`jobId: ${job.jobId || '-'}`);
  console.log(`traceId: ${job.traceId || '-'}`);
  console.log(`state: ${job.state || '-'}`);
  console.log(`fundingRef: ${job.fundingRef || '-'}`);
  console.log(`paymentRequestId: ${job.paymentRequestId || '-'}`);
  console.log(`paymentTxHash: ${job.paymentTxHash || '-'}`);
  console.log(`escrowState: ${job.escrowState || '-'}`);
  console.log(`escrowFundTxHash: ${job.escrowFundTxHash || '-'}`);
  console.log(`signerMode: ${job.signerMode || '-'}`);
  console.log(`fundingAnchorId: ${job.fundingAnchorId || '-'}`);
  console.log(`fundingAnchorTxHash: ${job.fundingAnchorTxHash || '-'}`);
  console.log(`sessionPreflight: ${preflight.created ? 'created' : preflight.reused ? 'ready' : 'checked'}`);
  console.log(`sessionStrategy: ${preflight.sessionStrategy || envelope?.runtime?.sessionStrategy || '-'}`);
  console.log(`summary: ${envelope?.message || '-'}`);
}

function printJobSubmit(envelope) {
  const job = envelope?.data?.job || {};
  const preflight = envelope?.data?.preflight || {};
  console.log('ktrace job submit');
  console.log(`jobId: ${job.jobId || '-'}`);
  console.log(`traceId: ${job.traceId || '-'}`);
  console.log(`state: ${job.state || '-'}`);
  console.log(`provider: ${job.provider || '-'}`);
  console.log(`capability: ${job.capability || '-'}`);
  console.log(`serviceId: ${job.serviceId || '-'}`);
  console.log(`paymentRequestId: ${job.paymentRequestId || '-'}`);
  console.log(`paymentTxHash: ${job.paymentTxHash || '-'}`);
  console.log(`submissionRef: ${job.submissionRef || '-'}`);
  console.log(`submissionHash: ${job.submissionHash || '-'}`);
  console.log(`resultRef: ${job.resultRef || '-'}`);
  console.log(`resultHash: ${job.resultHash || '-'}`);
  console.log(`receiptRef: ${job.receiptRef || '-'}`);
  console.log(`evidenceRef: ${job.evidenceRef || '-'}`);
  console.log(`submitAnchorId: ${job.submitAnchorId || '-'}`);
  console.log(`submitAnchorTxHash: ${job.submitAnchorTxHash || '-'}`);
  console.log(`submitAnchorConfirmedAt: ${job.submitAnchorConfirmedAt || '-'}`);
  console.log(`escrowSubmitTxHash: ${job.escrowSubmitTxHash || '-'}`);
  console.log(`sessionPreflight: ${preflight.created ? 'created' : preflight.reused ? 'ready' : preflight.checked ? 'checked' : '-'}`);
  console.log(`sessionStrategy: ${preflight.sessionStrategy || envelope?.runtime?.sessionStrategy || '-'}`);
  console.log(`summary: ${job.summary || envelope?.message || '-'}`);
  console.log(`error: ${job.error || '-'}`);
}

function printJobShow(envelope) {
  const job = envelope?.data?.job || {};
  console.log('ktrace job show');
  console.log(`jobId: ${job.jobId || '-'}`);
  console.log(`traceId: ${job.traceId || '-'}`);
  console.log(`state: ${job.state || '-'}`);
  console.log(`provider: ${job.provider || '-'}`);
  console.log(`capability: ${job.capability || '-'}`);
  console.log(`budget: ${job.budget || '-'}`);
  console.log(`payer: ${job.payer || '-'}`);
  console.log(`executor: ${job.executor || '-'}`);
  console.log(`validator: ${job.validator || '-'}`);
  console.log(`escrowAmount: ${job.escrowAmount || '-'}`);
  console.log(`escrowState: ${job.escrowState || '-'}`);
  console.log(`escrowAddress: ${job.escrowAddress || '-'}`);
  console.log(`templateId: ${job.templateId || '-'}`);
  console.log(`serviceId: ${job.serviceId || '-'}`);
  console.log(`paymentRequestId: ${job.paymentRequestId || '-'}`);
  console.log(`paymentTxHash: ${job.paymentTxHash || '-'}`);
  console.log(`submissionRef: ${job.submissionRef || '-'}`);
  console.log(`submissionHash: ${job.submissionHash || '-'}`);
  console.log(`resultRef: ${job.resultRef || '-'}`);
  console.log(`resultHash: ${job.resultHash || '-'}`);
  console.log(`receiptRef: ${job.receiptRef || '-'}`);
  console.log(`evidenceRef: ${job.evidenceRef || '-'}`);
  console.log(`evaluator: ${job.evaluator || '-'}`);
  console.log(`evaluatorRef: ${job.evaluatorRef || '-'}`);
  console.log(`validationId: ${job.validationId || '-'}`);
  console.log(`anchorRegistry: ${job.anchorRegistry || '-'}`);
  console.log(`createAnchorId: ${job.createAnchorId || '-'}`);
  console.log(`fundingAnchorId: ${job.fundingAnchorId || '-'}`);
  console.log(`acceptAnchorId: ${job.acceptAnchorId || '-'}`);
  console.log(`submitAnchorId: ${job.submitAnchorId || '-'}`);
  console.log(`submitAnchorConfirmedAt: ${job.submitAnchorConfirmedAt || '-'}`);
  console.log(`guardConfigured: ${typeof job.guardConfigured === 'boolean' ? String(job.guardConfigured) : '-'}`);
  console.log(`guardAddress: ${job.guardAddress || '-'}`);
  console.log(`verificationMode: ${job.verificationMode || '-'}`);
  console.log(
    `verifiedOnchain: ${typeof job.verifiedOnchain === 'boolean' ? String(job.verifiedOnchain) : job.verifiedOnchain === null ? 'unknown' : '-'}`
  );
  console.log(`latestAnchorIdOnChain: ${job.latestAnchorIdOnChain || '-'}`);
  console.log(`outcomeAnchorId: ${job.outcomeAnchorId || '-'}`);
  console.log(`escrowFundTxHash: ${job.escrowFundTxHash || '-'}`);
  console.log(`escrowAcceptTxHash: ${job.escrowAcceptTxHash || '-'}`);
  console.log(`escrowSubmitTxHash: ${job.escrowSubmitTxHash || '-'}`);
  console.log(`escrowValidateTxHash: ${job.escrowValidateTxHash || '-'}`);
  console.log(`rejectionReason: ${job.rejectionReason || '-'}`);
  console.log(`expiresAt: ${job.expiresAt || '-'}`);
  console.log(`summary: ${job.summary || envelope?.message || '-'}`);
  console.log(`error: ${job.error || '-'}`);
}

function printJobAudit(envelope) {
  const audit = envelope?.data?.audit || {};
  const summary = audit?.summary || {};
  const traceAnchor = audit?.traceAnchor || {};
  const anchor = traceAnchor?.anchor || {};
  console.log('ktrace job audit');
  console.log(`jobId: ${audit?.jobId || '-'}`);
  console.log(`traceId: ${audit?.traceId || '-'}`);
  console.log(`state: ${summary?.state || '-'}`);
  console.log(`provider: ${summary?.provider || '-'}`);
  console.log(`capability: ${summary?.capability || '-'}`);
  console.log(`requester: ${summary?.requester || '-'}`);
  console.log(`executor: ${summary?.executor || '-'}`);
  console.log(`validator: ${summary?.validator || '-'}`);
  console.log(`escrowAddress: ${summary?.escrowAddress || '-'}`);
  console.log(`expiresAt: ${summary?.expiresAt || '-'}`);
  console.log(`guardConfigured: ${typeof traceAnchor?.guardConfigured === 'boolean' ? String(traceAnchor.guardConfigured) : '-'}`);
  console.log(`guardAddress: ${traceAnchor?.guardAddress || '-'}`);
  console.log(`verificationMode: ${traceAnchor?.verificationMode || '-'}`);
  console.log(`submitAnchorId: ${anchor?.anchorId || '-'}`);
  console.log(`submitAnchorTxHash: ${anchor?.txHash || '-'}`);
  console.log(`submitAnchorConfirmedAt: ${anchor?.anchoredAt || '-'}`);
  console.log(
    `verifiedOnchain: ${
      typeof anchor?.verifiedOnchain === 'boolean'
        ? String(anchor.verifiedOnchain)
        : anchor?.verifiedOnchain === null
          ? 'unknown'
          : '-'
    }`
  );
  console.log(`latestAnchorIdOnChain: ${anchor?.latestAnchorIdOnChain || '-'}`);
  console.log(`summary: ${envelope?.message || 'Job audit loaded.'}`);
}

function printJobLifecycleAction(envelope) {
  const job = envelope?.data?.job || {};
  const display = envelope?.command?.display || 'ktrace job';
  console.log(display);
  console.log(`jobId: ${job.jobId || '-'}`);
  console.log(`traceId: ${job.traceId || '-'}`);
  console.log(`state: ${job.state || '-'}`);
  console.log(`summary: ${job.summary || envelope?.message || '-'}`);
  console.log(`evaluator: ${job.evaluator || '-'}`);
  console.log(`validationId: ${job.validationId || '-'}`);
  console.log(`escrowState: ${job.escrowState || '-'}`);
  console.log(`escrowValidateTxHash: ${job.escrowValidateTxHash || '-'}`);
  console.log(`outcomeAnchorId: ${job.outcomeAnchorId || '-'}`);
  console.log(`outcomeAnchorTxHash: ${job.outcomeAnchorTxHash || '-'}`);
  console.log(`rejectionReason: ${job.rejectionReason || '-'}`);
  console.log(`resultRef: ${job.resultRef || '-'}`);
  console.log(`expiresAt: ${job.expiresAt || '-'}`);
}

function printFlowStatus(envelope) {
  const flow = envelope?.data?.flow || {};
  console.log('ktrace flow status');
  console.log(`traceId: ${flow.traceId || '-'}`);
  console.log(`lane: ${flow.lane || '-'}`);
  console.log(`state: ${flow.state || '-'}`);
  console.log(`provider: ${flow.provider || '-'}`);
  console.log(`capability: ${flow.capability || '-'}`);
  console.log(`serviceId: ${flow.serviceId || '-'}`);
  console.log(`invocationId: ${flow.invocationId || '-'}`);
  console.log(`paymentRequestId: ${flow.paymentRequestId || '-'}`);
  console.log(`updatedAt: ${flow.updatedAt || '-'}`);
  console.log(`summary: ${flow.summary || envelope?.message || '-'}`);
}

function printFlowShow(envelope) {
  const flow = envelope?.data?.flow || {};
  const audit = flow.audit || {};
  const receipt = flow.receipt || {};
  const evidence = flow.evidence || {};
  const runtimeSession = evidence?.runtimeSnapshot || evidence?.runtimeSession || {};
  console.log('ktrace flow show');
  console.log(`traceId: ${flow.traceId || '-'}`);
  console.log(`lane: ${flow.lane || '-'}`);
  console.log(`state: ${flow.state || '-'}`);
  console.log(`provider: ${flow.provider || '-'}`);
  console.log(`capability: ${flow.capability || '-'}`);
  console.log(`serviceId: ${flow.serviceId || '-'}`);
  console.log(`serviceName: ${flow.serviceName || '-'}`);
  console.log(`invocationId: ${flow.invocationId || '-'}`);
  console.log(`paymentRequestId: ${flow.paymentRequestId || '-'}`);
  console.log(`txHash: ${flow.txHash || '-'}`);
  console.log(`summary: ${flow.summary || '-'}`);
  console.log(`error: ${flow.error || '-'}`);
  console.log(`workflowState: ${flow.workflow?.state || '-'}`);
  console.log(`auditEvents: ${Array.isArray(audit?.events) ? audit.events.length : 0}`);
  console.log(`receiptAvailable: ${receipt && Object.keys(receipt).length ? 'yes' : 'no'}`);
  console.log(`evidenceAvailable: ${evidence && Object.keys(evidence).length ? 'yes' : 'no'}`);
  console.log(`authorizedBy: ${runtimeSession.authorizedBy || '-'}`);
}

function printFlowHistory(envelope) {
  const history = Array.isArray(envelope?.data?.history) ? envelope.data.history : [];
  console.log('ktrace flow history');
  console.log(`count: ${history.length}`);
  for (const item of history) {
    console.log(
      `- ${item.traceId || '-'} | ${item.state || '-'} | ${item.provider || '-'} | ${item.capability || '-'} | ${item.summary || '-'}`
    );
  }
}

function printArtifactReceipt(envelope) {
  const requestId = envelope?.data?.requestId || '';
  const receipt = envelope?.data?.receipt || {};
  console.log('ktrace artifact receipt');
  console.log(`requestId: ${requestId || '-'}`);
  console.log(`downloadPath: ${envelope?.data?.downloadPath || '-'}`);
  console.log(`traceId: ${receipt?.traceId || '-'}`);
  console.log(`txHash: ${receipt?.txHash || receipt?.payment?.txHash || '-'}`);
  console.log(`amount: ${receipt?.amount || receipt?.payment?.amount || '-'}`);
  console.log(`summary: ${receipt?.result?.summary || envelope?.message || '-'}`);
}

function printArtifactEvidence(envelope) {
  const traceId = envelope?.data?.traceId || '';
  const evidence = envelope?.data?.evidence || {};
  const runtimeSession = evidence?.runtimeSnapshot || evidence?.runtimeSession || {};
  console.log('ktrace artifact evidence');
  console.log(`traceId: ${traceId || '-'}`);
  console.log(`downloadPath: ${envelope?.data?.downloadPath || '-'}`);
  console.log(`requestId: ${evidence?.requestId || '-'}`);
  console.log(`receiptRef: ${evidence?.receiptRef || '-'}`);
  console.log(`events: ${Array.isArray(evidence?.events) ? evidence.events.length : 0}`);
  console.log(`authorizedBy: ${runtimeSession.authorizedBy || '-'}`);
  console.log(`authorizationMode: ${runtimeSession.authorizationMode || '-'}`);
  console.log(`summary: ${envelope?.message || `Evidence loaded for ${traceId || '-'}.`}`);
}

function printEvidenceGet(envelope) {
  const traceId = envelope?.data?.traceId || '';
  const evidence = envelope?.data?.evidence || {};
  console.log('ktrace evidence get');
  console.log(`traceId: ${traceId || '-'}`);
  console.log(`downloadPath: ${envelope?.data?.downloadPath || '-'}`);
  console.log(`state: ${evidence?.state || '-'}`);
  console.log(`authorizedBy: ${evidence?.authorizedBy || '-'}`);
  console.log(`authorizationMode: ${evidence?.authorizationMode || '-'}`);
  console.log(`jobAnchorTxHash: ${evidence?.jobAnchorTxHash || '-'}`);
  console.log(`anchorContract: ${evidence?.anchorContract || '-'}`);
  console.log(`anchorNetwork: ${evidence?.anchorNetwork || '-'}`);
  console.log(`evidenceRef: ${evidence?.evidenceRef || '-'}`);
  console.log(`summary: ${envelope?.message || `Public evidence loaded for ${traceId || '-'}.`}`);
}

function printTrustReputation(envelope) {
  const aggregate = envelope?.data?.aggregate || {};
  const items = Array.isArray(envelope?.data?.items) ? envelope.data.items : [];
  console.log('ktrace trust reputation');
  console.log(`count: ${aggregate.count || 0}`);
  console.log(`positive: ${aggregate.positive || 0}`);
  console.log(`negative: ${aggregate.negative || 0}`);
  console.log(`averageScore: ${aggregate.averageScore ?? 0}`);
  for (const item of items) {
    console.log(
      `- ${item.agentId || '-'} | ${item.verdict || '-'} | ${item.sourceLane || '-'} | ${item.referenceId || '-'} | ${item.summary || '-'}`
    );
  }
}

function printTrustValidations(envelope) {
  const items = Array.isArray(envelope?.data?.items) ? envelope.data.items : [];
  console.log('ktrace trust validations');
  console.log(`count: ${items.length}`);
  for (const item of items) {
    console.log(
      `- ${item.agentId || '-'} | ${item.status || '-'} | ${item.referenceType || '-'} | ${item.referenceId || '-'} | ${item.evaluator || '-'}`
    );
  }
}

function printNotImplemented(envelope) {
  const command = envelope?.command?.display || 'ktrace';
  const message = envelope?.message || 'Command is not implemented yet.';
  console.error(command);
  console.error(message);
}

function printError(envelope) {
  const command = envelope?.command?.display || 'ktrace';
  const data = envelope?.data || null;
  const reason = String(envelope?.message || '').trim();
  const errorCode = String(envelope?.error || '').trim();
  console.error(command);
  if (envelope?.error) {
    console.error(`error: ${envelope.error}`);
  }
  if (envelope?.message) {
    console.error(`reason: ${envelope.message}`);
  }
  if (reason === 'identity_registry_not_configured') {
    console.error('hint: set ERC8004_IDENTITY_REGISTRY in backend/.env before running live buy/job flows.');
  }
  if (reason === 'agent_id_not_configured') {
    console.error('hint: set ERC8004_AGENT_ID in backend/.env to the registered agent id.');
  }
  if (reason.includes('Router owner key unavailable')) {
    console.error('hint: set XMTP_ROUTER_WALLET_KEY in backend/.env for AA session creation.');
  }
  if (reason.includes('Backend signer unavailable')) {
    console.error('hint: set KITECLAW_BACKEND_SIGNER_PRIVATE_KEY in backend/.env for AA account deployment.');
  }
  if (errorCode === 'external_session_missing') {
    console.error('hint: sessionStrategy=external only validates an existing session; it does not create one for the other agent.');
  }
  if (errorCode === 'external_session_not_usable') {
    console.error('hint: the external agent session exists but is not currently usable; refresh it in the owning agent before retrying.');
  }
  if (errorCode === 'service_not_found') {
    console.error('hint: inspect available services with the backend /api/services route before choosing provider/capability.');
  }
  if (Array.isArray(data?.available) && data.available.length > 0) {
    const preview = data.available
      .slice(0, 5)
      .map((item) => [item?.providerAgentId, item?.action].filter(Boolean).join('/'))
      .filter(Boolean)
      .join(', ');
    if (preview) {
      console.error(`available: ${preview}`);
    }
  }
}

export function writeEnvelope(envelope, helpText = '') {
  if (envelope?.runtime?.outputMode === 'json') {
    console.log(JSON.stringify(envelope, null, 2));
    return;
  }

  if (envelope?.command?.kind === 'help') {
    console.log(helpText.trimEnd());
    return;
  }

  if (envelope?.error === 'not_implemented') {
    printNotImplemented(envelope);
    return;
  }

  if (!envelope?.ok) {
    printError(envelope);
    return;
  }

  if (envelope?.command?.family === 'config' && envelope?.command?.action === 'show') {
    printConfigShow(envelope);
    return;
  }

  if (envelope?.command?.family === 'auth' && envelope?.command?.action === 'login') {
    printAuthLogin(envelope);
    return;
  }

  if (envelope?.command?.family === 'auth' && envelope?.command?.action === 'whoami') {
    printAuthWhoami(envelope);
    return;
  }

  if (envelope?.command?.family === 'auth' && envelope?.command?.action === 'session') {
    printAuthSession(envelope);
    return;
  }

  if (envelope?.command?.family === 'session' && envelope?.command?.action === 'authorize') {
    printSessionAuthorize(envelope);
    return;
  }

  if (envelope?.command?.family === 'session' && envelope?.command?.action === 'request') {
    printSessionRequest(envelope);
    return;
  }

  if (envelope?.command?.family === 'session' && envelope?.command?.action === 'wait') {
    printSessionWait(envelope);
    return;
  }

  if (envelope?.command?.family === 'session' && envelope?.command?.action === 'approve') {
    printSessionApprove(envelope);
    return;
  }

  if (envelope?.command?.family === 'buy' && envelope?.command?.action === 'request') {
    printBuyRequest(envelope);
    return;
  }

  if (envelope?.command?.family === 'buy' && envelope?.command?.action === 'direct') {
    printBuyDirect(envelope);
    return;
  }

  if (envelope?.command?.family === 'agent' && envelope?.command?.action === 'invoke') {
    printAgentInvoke(envelope);
    return;
  }

  if (envelope?.command?.family === 'template' && envelope?.command?.action === 'list') {
    printTemplateList(envelope);
    return;
  }

  if (envelope?.command?.family === 'template' && envelope?.command?.action === 'resolve') {
    printTemplateResolve(envelope);
    return;
  }

  if (envelope?.command?.family === 'template' && envelope?.command?.action === 'show') {
    printTemplateShow(envelope);
    return;
  }

  if (envelope?.command?.family === 'template' && envelope?.command?.action === 'publish') {
    printTemplatePublish(envelope);
    return;
  }

  if (
    envelope?.command?.family === 'template' &&
    (envelope?.command?.action === 'revoke' || envelope?.command?.action === 'activate')
  ) {
    printTemplateToggle(envelope);
    return;
  }

  if (envelope?.command?.family === 'template' && envelope?.command?.action === 'expire') {
    printTemplateExpire(envelope);
    return;
  }

  if (envelope?.command?.family === 'provider' && envelope?.command?.action === 'list') {
    printProviderList(envelope);
    return;
  }

  if (envelope?.command?.family === 'provider' && envelope?.command?.action === 'register') {
    printProviderRegister(envelope);
    return;
  }

  if (envelope?.command?.family === 'provider' && envelope?.command?.action === 'show') {
    printProviderShow(envelope);
    return;
  }

  if (envelope?.command?.family === 'capability' && envelope?.command?.action === 'list') {
    printCapabilityList(envelope);
    return;
  }

  if (envelope?.command?.family === 'capability' && envelope?.command?.action === 'publish') {
    printCapabilityPublish(envelope);
    return;
  }

  if (envelope?.command?.family === 'capability' && envelope?.command?.action === 'show') {
    printCapabilityShow(envelope);
    return;
  }

  if (envelope?.command?.family === 'discovery' && envelope?.command?.action === 'select') {
    printDiscoverySelect(envelope);
    return;
  }

  if (envelope?.command?.family === 'discovery' && envelope?.command?.action === 'compare') {
    printDiscoveryCompare(envelope);
    return;
  }

  if (envelope?.command?.family === 'discovery' && envelope?.command?.action === 'recommend-buy') {
    printDiscoveryRecommendBuy(envelope);
    return;
  }

  if (envelope?.command?.family === 'job' && envelope?.command?.action === 'create') {
    printJobCreate(envelope);
    return;
  }

  if (envelope?.command?.family === 'job' && envelope?.command?.action === 'fund') {
    printJobFund(envelope);
    return;
  }

  if (envelope?.command?.family === 'job' && envelope?.command?.action === 'accept') {
    printJobLifecycleAction(envelope);
    return;
  }

  if (envelope?.command?.family === 'job' && envelope?.command?.action === 'submit') {
    printJobSubmit(envelope);
    return;
  }

  if (envelope?.command?.family === 'job' && envelope?.command?.action === 'show') {
    printJobShow(envelope);
    return;
  }

  if (envelope?.command?.family === 'job' && envelope?.command?.action === 'audit') {
    printJobAudit(envelope);
    return;
  }

  if (
    envelope?.command?.family === 'job' &&
    ['validate', 'complete', 'reject', 'expire'].includes(envelope?.command?.action)
  ) {
    printJobLifecycleAction(envelope);
    return;
  }

  if (envelope?.command?.family === 'flow' && envelope?.command?.action === 'status') {
    printFlowStatus(envelope);
    return;
  }

  if (envelope?.command?.family === 'flow' && envelope?.command?.action === 'show') {
    printFlowShow(envelope);
    return;
  }

  if (envelope?.command?.family === 'flow' && envelope?.command?.action === 'history') {
    printFlowHistory(envelope);
    return;
  }

  if (envelope?.command?.family === 'artifact' && envelope?.command?.action === 'receipt') {
    printArtifactReceipt(envelope);
    return;
  }

  if (envelope?.command?.family === 'artifact' && envelope?.command?.action === 'evidence') {
    printArtifactEvidence(envelope);
    return;
  }

  if (envelope?.command?.family === 'evidence' && envelope?.command?.action === 'get') {
    printEvidenceGet(envelope);
    return;
  }

  if (envelope?.command?.family === 'trust' && envelope?.command?.action === 'reputation') {
    printTrustReputation(envelope);
    return;
  }

  if (envelope?.command?.family === 'trust' && envelope?.command?.action === 'validations') {
    printTrustValidations(envelope);
    return;
  }

  if (envelope?.command?.family === 'system' && envelope?.command?.action === 'start-fresh') {
    printSystemStartFresh(envelope);
    return;
  }

  if (envelope?.message) {
    console.log(envelope.message);
  }
}
