export function createDataStoreAccessors({
  paths = {},
  readJsonArray,
  writeJsonArray,
  loadJsonArrayFromFile,
  persistenceKeyForPath,
  persistArrayCache,
  queuePersistWrite,
  writeJsonArrayToFile
} = {}) {
  const xmtpEventsState = {
    loaded: false,
    rows: []
  };

  function readRecords() {
    return readJsonArray(paths.dataPath);
  }

  function writeRecords(records) {
    writeJsonArray(paths.dataPath, records);
  }

  function readX402Requests() {
    return readJsonArray(paths.x402Path);
  }

  function writeX402Requests(records) {
    writeJsonArray(paths.x402Path, records);
  }

  function readPolicyFailures() {
    return readJsonArray(paths.policyFailurePath);
  }

  function writePolicyFailures(records) {
    writeJsonArray(paths.policyFailurePath, records);
  }

  function readWorkflows() {
    return readJsonArray(paths.workflowPath);
  }

  function writeWorkflows(records) {
    writeJsonArray(paths.workflowPath, records);
  }

  function readIdentityChallenges() {
    return readJsonArray(paths.identityChallengePath);
  }

  function writeIdentityChallenges(records) {
    writeJsonArray(paths.identityChallengePath, records);
  }

  function readOnboardingChallenges() {
    return readJsonArray(paths.onboardingChallengesPath);
  }

  function writeOnboardingChallenges(records) {
    writeJsonArray(paths.onboardingChallengesPath, records);
  }

  function readAccountApiKeys() {
    return readJsonArray(paths.accountApiKeysPath);
  }

  function writeAccountApiKeys(records) {
    writeJsonArray(paths.accountApiKeysPath, records);
  }

  function readConnectorInstallCodes() {
    return readJsonArray(paths.connectorInstallCodesPath);
  }

  function writeConnectorInstallCodes(records) {
    writeJsonArray(paths.connectorInstallCodesPath, records);
  }

  function readConnectorGrants() {
    return readJsonArray(paths.connectorGrantsPath);
  }

  function writeConnectorGrants(records) {
    writeJsonArray(paths.connectorGrantsPath, records);
  }

  function readPublishedServices() {
    return readJsonArray(paths.servicesPath);
  }

  function writePublishedServices(records) {
    writeJsonArray(paths.servicesPath, records);
  }

  function readTemplates() {
    return readJsonArray(paths.templatesPath);
  }

  function writeTemplates(records) {
    writeJsonArray(paths.templatesPath, records);
  }

  function readServiceInvocations() {
    return readJsonArray(paths.serviceInvocationsPath);
  }

  function writeServiceInvocations(records) {
    writeJsonArray(paths.serviceInvocationsPath, records);
  }

  function readPurchases() {
    return readJsonArray(paths.purchasesPath);
  }

  function writePurchases(records) {
    writeJsonArray(paths.purchasesPath, records);
  }

  function readJobs() {
    return readJsonArray(paths.jobsPath);
  }

  function writeJobs(records) {
    writeJsonArray(paths.jobsPath, records);
  }

  function readConsumerIntents() {
    return readJsonArray(paths.consumerIntentsPath);
  }

  function writeConsumerIntents(records) {
    writeJsonArray(paths.consumerIntentsPath, records);
  }

  function readReputationSignals() {
    return readJsonArray(paths.reputationSignalsPath);
  }

  function writeReputationSignals(records) {
    writeJsonArray(paths.reputationSignalsPath, records);
  }

  function readValidationRecords() {
    return readJsonArray(paths.validationRecordsPath);
  }

  function writeValidationRecords(records) {
    writeJsonArray(paths.validationRecordsPath, records);
  }

  function readTrustPublications() {
    return readJsonArray(paths.trustPublicationsPath);
  }

  function writeTrustPublications(records) {
    writeJsonArray(paths.trustPublicationsPath, records);
  }

  function readNetworkAgents() {
    return readJsonArray(paths.networkAgentsPath);
  }

  function writeNetworkAgents(records) {
    writeJsonArray(paths.networkAgentsPath, records);
  }

  function ensureXmtpEventsStateLoaded() {
    if (xmtpEventsState.loaded) return;
    const rows = loadJsonArrayFromFile(paths.xmtpEventsPath);
    xmtpEventsState.rows = Array.isArray(rows) ? rows : [];
    const stateKey = persistenceKeyForPath(paths.xmtpEventsPath);
    persistArrayCache.set(stateKey, xmtpEventsState.rows);
    xmtpEventsState.loaded = true;
  }

  function readXmtpEvents() {
    ensureXmtpEventsStateLoaded();
    return xmtpEventsState.rows;
  }

  function writeXmtpEvents(records) {
    ensureXmtpEventsStateLoaded();
    const rows = Array.isArray(records) ? records : [];
    xmtpEventsState.rows = rows;
    const stateKey = persistenceKeyForPath(paths.xmtpEventsPath);
    persistArrayCache.set(stateKey, rows);
    writeJsonArrayToFile(paths.xmtpEventsPath, rows);
    queuePersistWrite(stateKey, rows);
  }

  function readXmtpGroups() {
    return readJsonArray(paths.xmtpGroupsPath);
  }

  function writeXmtpGroups(records) {
    writeJsonArray(paths.xmtpGroupsPath, records);
  }

  function readNetworkCommands() {
    return readJsonArray(paths.networkCommandsPath);
  }

  function writeNetworkCommands(records) {
    writeJsonArray(paths.networkCommandsPath, records);
  }

  function readNetworkAuditEvents() {
    return readJsonArray(paths.networkAuditPath);
  }

  function writeNetworkAuditEvents(records) {
    writeJsonArray(paths.networkAuditPath, records);
  }

  function readAgent001Results() {
    return readJsonArray(paths.agent001ResultsPath);
  }

  function writeAgent001Results(records) {
    writeJsonArray(paths.agent001ResultsPath, records);
  }

  return {
    readRecords,
    writeRecords,
    readX402Requests,
    writeX402Requests,
    readPolicyFailures,
    writePolicyFailures,
    readWorkflows,
    writeWorkflows,
    readIdentityChallenges,
    writeIdentityChallenges,
    readOnboardingChallenges,
    writeOnboardingChallenges,
    readAccountApiKeys,
    writeAccountApiKeys,
    readConnectorInstallCodes,
    writeConnectorInstallCodes,
    readConnectorGrants,
    writeConnectorGrants,
    readPublishedServices,
    writePublishedServices,
    readTemplates,
    writeTemplates,
    readServiceInvocations,
    writeServiceInvocations,
    readPurchases,
    writePurchases,
    readJobs,
    writeJobs,
    readConsumerIntents,
    writeConsumerIntents,
    readReputationSignals,
    writeReputationSignals,
    readValidationRecords,
    writeValidationRecords,
    readTrustPublications,
    writeTrustPublications,
    readNetworkAgents,
    writeNetworkAgents,
    ensureXmtpEventsStateLoaded,
    readXmtpEvents,
    writeXmtpEvents,
    readXmtpGroups,
    writeXmtpGroups,
    readNetworkCommands,
    writeNetworkCommands,
    readNetworkAuditEvents,
    writeNetworkAuditEvents,
    readAgent001Results,
    writeAgent001Results
  };
}
