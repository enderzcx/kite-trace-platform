export function createAgent001DispatchRecoveryHelpers(deps = {}) {
  const { normalizeRiskScoreParams, runRiskScoreAnalysis } = deps;

  function isLegacyBtcOnlyTechnicalFailure(taskResult = null, capability = '', input = {}) {
    const normalizedCapability = String(capability || '').trim().toLowerCase();
    if (normalizedCapability !== 'technical-analysis-feed' && normalizedCapability !== 'risk-score-feed') return false;
    const symbol = String(input?.symbol || input?.pair || '')
      .trim()
      .toUpperCase()
      .replace(/[-_\s]/g, '');
    if (!symbol.startsWith('ETH')) return false;
    const status = String(taskResult?.status || '').trim().toLowerCase();
    if (!['failed', 'error', 'rejected'].includes(status)) return false;
    const combined = [
      String(taskResult?.error || '').trim(),
      String(taskResult?.result?.summary || '').trim(),
      String(taskResult?.result?.failure?.reason || '').trim()
    ]
      .join(' ')
      .toLowerCase();
    return combined.includes('risk-score task requires symbol') && combined.includes('btc/btcusdt/btcusd');
  }

  async function buildLocalTechnicalRecoveryDispatch({
    capability = '',
    input = {},
    sent = null,
    task = {},
    attempt = 1,
    recovery = []
  } = {}) {
    const technicalTask = normalizeRiskScoreParams({
      symbol: input?.symbol || input?.pair || 'BTCUSDT',
      source: input?.source || 'hyperliquid',
      horizonMin: input?.horizonMin ?? 60
    });
    const local = await runRiskScoreAnalysis(technicalTask);
    return {
      ok: true,
      sent,
      task,
      resultEvent: null,
      taskResult: {
        kind: 'task-result',
        protocolVersion: 'kite-agent-task-v1',
        status: 'done',
        result: {
          ...local,
          analysisType: 'technical',
          analysis: local?.technical && typeof local.technical === 'object' ? local.technical : null
        },
        error: '',
        fallback: 'local-technical-recovery'
      },
      attempt,
      recovery: Array.isArray(recovery) ? recovery : []
    };
  }

  return {
    buildLocalTechnicalRecoveryDispatch,
    isLegacyBtcOnlyTechnicalFailure
  };
}
