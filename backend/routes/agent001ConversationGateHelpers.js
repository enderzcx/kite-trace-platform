export function createAgent001ConversationGateHelpers(deps = {}) {
  const {
    AGENT001_REQUIRE_X402,
    classifyAgent001IntentFallback,
    createTraceId,
    detectAgent001IntentOverrides,
    getAllXmtpRuntimeStatuses,
    llmAdapter,
    parseJsonObjectFromText,
    resolveAgent001Intent
  } = deps;

  function buildAgent001HelpText() {
    return [
      'AGENT001 在线，可直接自然语言下单给我：',
      '1) 技术面：例如 “分析 BTCUSDT 技术面 60m” 或 “分析 ETHUSDT 技术面 60m”',
      '2) 消息面：例如 “分析 btc market sentiment today” 或发送 URL',
      '3) 联合分析：例如 “给我 BTC 的消息+技术联合结论”',
      '4) 交易执行：例如 “市价下单 BTCUSDT 买入 size=0.001 止盈 90000 止损 82000” 或 “限价下单 BTCUSDT 卖出 price=95000 size=0.001”',
      '我会自动与 technical-agent / message-agent 通过 XMTP 协作，再回你结果。'
    ].join('\n');
  }

  async function classifyAgent001IntentByLlm(text = '') {
    const rawText = String(text || '').trim();
    if (!rawText) return { intent: 'help', symbol: 'BTCUSDT', horizonMin: 60, source: 'hyperliquid', topic: '' };
    const prompt = [
      'You are AGENT001 intent router.',
      'Return ONLY JSON with schema:',
      '{"intent":"technical|info|both|trade|chat|help","symbol":"BTCUSDT","horizonMin":60,"source":"hyperliquid","topic":""}',
      'Rules:',
      '- intent=technical for technical/risk analysis requests',
      '- intent=info for news/sentiment/info requests',
      '- intent=both for combined info+technical requests',
      '- intent=trade for order/plan/entry/exit/place-order requests',
      '- intent=help for capability/help requests',
      '- topic should keep user query text for info intent',
      '- symbol should default BTCUSDT',
      '',
      `User text: ${rawText}`
    ].join('\n');
    const chat = await llmAdapter.chat({
      message: prompt,
      sessionId: 'agent001_intent',
      traceId: createTraceId('agent001_intent'),
      agent: 'router-agent'
    });
    if (!chat?.ok) return null;
    const parsed = parseJsonObjectFromText(chat.reply || '');
    if (!parsed) return null;
    return {
      intent: String(parsed.intent || '').trim().toLowerCase() || '',
      symbol: String(parsed.symbol || '').trim().toUpperCase() || 'BTCUSDT',
      horizonMin: Number.isFinite(Number(parsed.horizonMin))
        ? Math.max(5, Math.min(Math.round(Number(parsed.horizonMin)), 240))
        : 60,
      source: String(parsed.source || 'hyperliquid').trim().toLowerCase() || 'hyperliquid',
      topic: String(parsed.topic || '').trim()
    };
  }

  async function resolveAgent001ConversationEntry({ text = '' } = {}) {
    const rawText = String(text || '').trim();
    if (!rawText) {
      return {
        handled: true,
        response: buildAgent001HelpText(),
        rawText: '',
        intent: null
      };
    }

    if (/(help|功能|怎么用|命令|示例)/i.test(rawText)) {
      return {
        handled: true,
        response: buildAgent001HelpText(),
        rawText,
        intent: null
      };
    }

    if (/(status|状态|在线|running)/i.test(rawText)) {
      const runtime = getAllXmtpRuntimeStatuses();
      return {
        handled: true,
        response: [
          'AGENT001 状态:',
          `router: ${runtime.router.running ? 'running' : 'stopped'}`,
          `technical(risk): ${runtime.risk.running ? 'running' : 'stopped'}`,
          `message(reader): ${runtime.reader.running ? 'running' : 'stopped'}`
        ].join('\n'),
        rawText,
        intent: null
      };
    }

    const llmIntent = await classifyAgent001IntentByLlm(rawText);
    const hardOverrides = detectAgent001IntentOverrides(rawText);
    let intent = resolveAgent001Intent(rawText, llmIntent);
    if (hardOverrides.infoOnly && !hardOverrides.technicalOnly) {
      intent.intent = 'info';
      if (!String(intent.topic || '').trim()) intent.topic = rawText;
    }
    if (hardOverrides.technicalOnly && !hardOverrides.infoOnly) {
      intent.intent = 'technical';
    }
    if (intent.intent === 'chat' && AGENT001_REQUIRE_X402) {
      const fallbackIntent = classifyAgent001IntentFallback(rawText);
      if (['info', 'technical', 'both', 'trade'].includes(fallbackIntent.intent)) {
        intent = {
          ...intent,
          ...fallbackIntent,
          intent: fallbackIntent.intent,
          topic: String(intent.topic || fallbackIntent.topic || rawText).trim()
        };
      }
    }

    if (intent.intent === 'help') {
      return {
        handled: true,
        response: buildAgent001HelpText(),
        rawText,
        intent
      };
    }

    if (intent.intent === 'chat') {
      if (AGENT001_REQUIRE_X402) {
        return {
          handled: true,
          response:
            '当前已开启强制计费：除 help/status 外均需 x402 支付。请发送“分析 BTCUSDT/ETHUSDT 技术面 60m”或“分析 btc market sentiment today”。',
          rawText,
          intent
        };
      }
      const chat = await llmAdapter.chat({
        message: `你是 AGENT001，请用简洁中文回复用户。\n用户消息: ${rawText}`,
        sessionId: 'agent001_chat',
        traceId: createTraceId('agent001_chat'),
        agent: 'router-agent'
      });
      return {
        handled: true,
        response:
          (chat?.ok && String(chat.reply || '').trim())
            ? String(chat.reply || '').trim()
            : 'AGENT001 已收到。可直接说“分析 BTC 技术面 60m”或“分析 btc market sentiment today”。',
        rawText,
        intent
      };
    }

    return {
      handled: false,
      response: '',
      rawText,
      intent
    };
  }

  return {
    resolveAgent001ConversationEntry
  };
}

