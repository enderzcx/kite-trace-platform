export function createXmtpRouterService({
  handleAgent001AnalysisIntent,
  handleAgent001TradeIntent,
  resolveAgent001ConversationEntry
}) {
  async function handleRouterRuntimeTextMessage({ text = '', context = null } = {}) {
    const gate = await resolveAgent001ConversationEntry({ text });
    if (gate.handled) return gate.response;
    const rawText = gate.rawText;
    const intent = gate.intent;

    const waitMsLimit = 30_000;
    const runTrade = intent.intent === 'trade';
    if (runTrade) {
      return handleAgent001TradeIntent({
        context,
        intent,
        rawText,
        waitMsLimit
      });
    }

    return handleAgent001AnalysisIntent({
      context,
      intent,
      rawText,
      runTrade,
      waitMsLimit
    });
  }

  return {
    handleRouterRuntimeTextMessage
  };
}
