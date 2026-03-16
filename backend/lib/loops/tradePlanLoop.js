export function createAutoTradePlanLoop({
  state = null,
  intervalMs,
  symbol,
  horizonMin,
  prompt,
  handleRouterRuntimeTextMessage
} = {}) {
  const autoTradePlanState =
    state && typeof state === 'object'
      ? state
      : {
          enabled: false,
          intervalMs,
          symbol,
          horizonMin,
          prompt,
          startedAt: '',
          lastTickAt: '',
          lastStatus: '',
          lastDecision: '',
          lastSummary: '',
          lastRequestId: '',
          lastTxHash: '',
          lastError: '',
          runs: 0,
          orderRuns: 0,
          noOrderRuns: 0,
          failedRuns: 0
        };

  let autoTradePlanTimer = null;
  let autoTradePlanBusy = false;

  function getAutoTradePlanStatus() {
    return {
      ...autoTradePlanState,
      running: Boolean(autoTradePlanTimer),
      busy: autoTradePlanBusy
    };
  }

  function buildAutoTradePlanPrompt() {
    const customPrompt = String(autoTradePlanState.prompt || '').trim();
    if (customPrompt) return customPrompt;
    const nextSymbol = String(autoTradePlanState.symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
    const nextHorizonMin = Math.max(5, Math.min(Number(autoTradePlanState.horizonMin || 60), 1440));
    return `请基于技术面和消息面给出 ${nextSymbol} ${nextHorizonMin}m 交易计划，并按规则判定是否下单；不要强制下单。`;
  }

  function extractAutoTradePlanPaymentEvidence(replyText = '') {
    const lines = String(replyText || '')
      .split(/\r?\n/)
      .map((line) => String(line || '').trim())
      .filter(Boolean);
    for (const line of lines) {
      const directMatch = line.match(/^x402 requestId:\s*([^\s]+)\s*$/i);
      if (!directMatch) continue;
      const idx = lines.indexOf(line);
      const nextLine = idx >= 0 ? String(lines[idx + 1] || '').trim() : '';
      const txMatch = nextLine.match(/^x402 txHash:\s*([^\s]+)\s*$/i);
      return {
        requestId: String(directMatch[1] || '').trim(),
        txHash: txMatch ? String(txMatch[1] || '').trim() : ''
      };
    }
    const inlineMatch = String(replyText || '').match(/x402:\s*requestId=([^\s]+)\s+txHash=([^\s]+)/i);
    if (inlineMatch) {
      return {
        requestId: String(inlineMatch[1] || '').trim(),
        txHash: String(inlineMatch[2] || '').trim()
      };
    }
    return { requestId: '', txHash: '' };
  }

  function classifyAutoTradePlanOutcome(replyText = '') {
    const text = String(replyText || '').trim();
    const lines = text
      .split(/\r?\n/)
      .map((line) => String(line || '').trim())
      .filter(Boolean);
    const decisionLine =
      lines.find((line) => /^决策:\s*/i.test(line)) ||
      lines.find((line) => /^执行结果:\s*/i.test(line)) ||
      lines[0] ||
      '';

    if (/下单执行失败|交易链路中断|交易执行前置条件不足|交易计划生成失败|执行阻断/i.test(text)) {
      return {
        status: 'failed',
        decision: 'failed',
        summary: decisionLine || '交易计划执行失败。',
        reason: decisionLine || 'trade_plan_execution_failed'
      };
    }
    if (/下单执行:\s*已触发 Hyperliquid 测试网下单/i.test(text)) {
      return {
        status: 'ordered',
        decision: 'ordered',
        summary: decisionLine || '触发下单。',
        reason: ''
      };
    }
    if (/执行结果:\s*不满足自动下单条件，本轮不下单|决策:\s*不挂单/i.test(text)) {
      return {
        status: 'no-order',
        decision: 'no-order',
        summary: decisionLine || '本轮不下单。',
        reason: ''
      };
    }
    return {
      status: 'success',
      decision: 'unknown',
      summary: decisionLine || '交易计划已执行。',
      reason: ''
    };
  }

  async function runAutoTradePlanTick(reason = 'timer') {
    if (autoTradePlanBusy) return;
    autoTradePlanBusy = true;
    autoTradePlanState.lastTickAt = new Date().toISOString();
    autoTradePlanState.lastStatus = 'running';
    autoTradePlanState.lastError = '';

    let countedRun = false;
    try {
      const reply = await handleRouterRuntimeTextMessage({
        text: buildAutoTradePlanPrompt(),
        context: null
      });
      const replyText = String(reply || '').trim();
      if (!replyText) {
        throw new Error('auto_trade_plan_empty_reply');
      }
      autoTradePlanState.runs += 1;
      countedRun = true;

      const outcome = classifyAutoTradePlanOutcome(replyText);
      const payment = extractAutoTradePlanPaymentEvidence(replyText);
      autoTradePlanState.lastDecision = String(outcome.decision || '').trim();
      autoTradePlanState.lastSummary = String(outcome.summary || '').trim();
      autoTradePlanState.lastRequestId = String(payment.requestId || '').trim();
      autoTradePlanState.lastTxHash = String(payment.txHash || '').trim();
      autoTradePlanState.lastStatus = String(outcome.status || 'success').trim();
      autoTradePlanState.lastError = String(outcome.reason || '').trim();

      if (outcome.status === 'ordered') {
        autoTradePlanState.orderRuns += 1;
      } else if (outcome.status === 'no-order') {
        autoTradePlanState.noOrderRuns += 1;
      } else if (outcome.status === 'failed') {
        autoTradePlanState.failedRuns += 1;
      }
    } catch (error) {
      if (!countedRun) autoTradePlanState.runs += 1;
      autoTradePlanState.failedRuns += 1;
      autoTradePlanState.lastStatus = 'failed';
      autoTradePlanState.lastDecision = 'failed';
      autoTradePlanState.lastError = String(error?.message || 'auto_trade_plan_failed').trim();
      autoTradePlanState.lastSummary = '';
      autoTradePlanState.lastRequestId = '';
      autoTradePlanState.lastTxHash = '';
    } finally {
      autoTradePlanBusy = false;
      if (reason === 'startup' || reason === 'manual') {
        console.log(
          `[auto-trade-plan] tick ${autoTradePlanState.lastStatus} decision=${autoTradePlanState.lastDecision || '-'} requestId=${autoTradePlanState.lastRequestId || '-'}`
        );
      }
    }
  }

  function stopAutoTradePlanLoop() {
    if (autoTradePlanTimer) {
      clearInterval(autoTradePlanTimer);
      autoTradePlanTimer = null;
    }
    autoTradePlanState.enabled = false;
  }

  function startAutoTradePlanLoop(options = {}) {
    const nextIntervalMs = Math.max(60_000, Number(options.intervalMs || autoTradePlanState.intervalMs || 600_000));
    const nextHorizonMin = Math.max(5, Math.min(Number(options.horizonMin || autoTradePlanState.horizonMin || 60), 1440));
    const nextSymbol = String(options.symbol || autoTradePlanState.symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
    const nextPrompt = String(options.prompt || autoTradePlanState.prompt || '').trim();

    autoTradePlanState.intervalMs = nextIntervalMs;
    autoTradePlanState.symbol = nextSymbol;
    autoTradePlanState.horizonMin = nextHorizonMin;
    autoTradePlanState.prompt = nextPrompt;
    autoTradePlanState.enabled = true;
    autoTradePlanState.startedAt = new Date().toISOString();
    autoTradePlanState.lastError = '';
    autoTradePlanState.lastStatus = '';

    if (autoTradePlanTimer) clearInterval(autoTradePlanTimer);
    autoTradePlanTimer = setInterval(() => {
      runAutoTradePlanTick('timer').catch(() => {});
    }, nextIntervalMs);

    if (options.immediate !== false) {
      runAutoTradePlanTick(options.reason || 'manual').catch(() => {});
    }
  }

  return {
    autoTradePlanState,
    getAutoTradePlanStatus,
    runAutoTradePlanTick,
    startAutoTradePlanLoop,
    stopAutoTradePlanLoop
  };
}
