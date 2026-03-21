export function createAgent001TradeFlowHelpers(deps = {}) {
  const {
    appendAgent001OrderExecutionLines,
    buildAgent001FailureReply,
    buildAgent001StrictPaymentPlan,
    buildAgent001TradePlan,
    buildTaskReceiptRef,
    coerceAgent001ForcedTradePlan,
    extractTradingSymbolFromText,
    hasStrictX402Evidence,
    isAgent001ForceOrderRequested,
    isAgent001TaskSuccessful,
    maybeSendAgent001ProgressDm,
    maybeSendAgent001TradePlanDm,
    normalizeAddress,
    parseAgent001OrderDirectives,
    readSessionRuntime,
    runAgent001DispatchTask,
    runAgent001QuoteNegotiation,
    selectAgent001ProviderPlan,
    upsertAgent001ResultRecord
  } = deps;

  async function handleAgent001TradeIntent({
    context = null,
    intent = {},
    rawText = '',
    waitMsLimit = 30_000
  } = {}) {
    const runtime = readSessionRuntime();
    const payer = normalizeAddress(runtime?.aaWallet || '');
    if (!payer) {
      return '交易执行前置条件不足：未配置可用 AA payer。请先在 Agent Settings 完成 Session/AA 同步。';
    }
    const orderDirectives = parseAgent001OrderDirectives(rawText);
    const directOrderMode = orderDirectives.explicitOrder === true;
    if (directOrderMode) {
      const baseDirectPlan = {
        text: ['直连下单模式', '说明: 检测到明确下单口令，已跳过消息面/技术面分析。'].join('\n'),
        symbol: String(intent?.symbol || extractTradingSymbolFromText(rawText) || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT',
        canPlaceOrder: false
      };
      const directPlan = coerceAgent001ForcedTradePlan({
        rawText,
        tradePlan: baseDirectPlan,
        technical: null,
        info: null,
        directives: orderDirectives
      });
      const lines = [String(directPlan?.text || '').trim() || '直连下单模式初始化失败。'];
      if (!directPlan?.canPlaceOrder) {
        lines.push(`执行阻断: ${String(directPlan?.forceOrderReason || '下单参数不足').trim()}`);
        lines.push('执行结果: 直连下单失败，请补充完整参数（side/orderType/size/price）。');
        const reply = lines.join('\n');
        await maybeSendAgent001TradePlanDm({
          context,
          tradePlanText: reply,
          infoPayment: null,
          technicalPayment: null
        });
        return reply;
      }

      const directExecution = await appendAgent001OrderExecutionLines({
        lines,
        plan: directPlan,
        payer,
        orderDirectives,
        orderTraceId: 'agent001_trade_order_direct',
        stopTraceId: 'agent001_trade_stop_direct',
        failureStage: 'trade_order_direct',
        resultSource: 'agent001_trade_direct'
      });
      if (directExecution.hardFailureReply) {
        return directExecution.hardFailureReply;
      }
      const reply = lines.join('\n');
      await maybeSendAgent001TradePlanDm({
        context,
        tradePlanText: reply,
        infoPayment: null,
        technicalPayment: null
      });
      return reply;
    }

    const [technicalProvider, infoProvider] = await Promise.all([
      selectAgent001ProviderPlan({ capability: 'technical-analysis-feed' }),
      selectAgent001ProviderPlan({ capability: 'info-analysis-feed' })
    ]);
    if (!technicalProvider?.ok || !infoProvider?.ok) {
      return [
        '交易链路中断：服务发现失败。',
        `技术面: ${technicalProvider?.reason || technicalProvider?.error || 'unavailable'}`,
        `消息面: ${infoProvider?.reason || infoProvider?.error || 'unavailable'}`
      ].join('\n');
    }

    const [technicalQuoteTask, infoQuoteTask] = await Promise.all([
      runAgent001QuoteNegotiation({
        toAgentId: technicalProvider.toAgentId,
        wantedCapability: 'technical-analysis-feed',
        rawText,
        intent,
        waitMsLimit: 12_000
      }),
      runAgent001QuoteNegotiation({
        toAgentId: infoProvider.toAgentId,
        wantedCapability: 'info-analysis-feed',
        rawText,
        intent,
        waitMsLimit: 12_000
      })
    ]);
    if (!isAgent001TaskSuccessful(technicalQuoteTask) || !isAgent001TaskSuccessful(infoQuoteTask)) {
      return [
        '交易链路中断：报价协商失败。',
        `technical quote: ${technicalQuoteTask?.reason || technicalQuoteTask?.error || 'failed'}`,
        `message quote: ${infoQuoteTask?.reason || infoQuoteTask?.error || 'failed'}`
      ].join('\n');
    }

    let infoPayPlan = null;
    let info = null;
    const infoQuote = infoQuoteTask?.taskResult?.result?.quote || null;
    try {
      infoPayPlan = await buildAgent001StrictPaymentPlan({
        capability: 'info-analysis-feed',
        rawText,
        intent,
        payer,
        targetAgentId: infoProvider.toAgentId
      });
    } catch (error) {
      return buildAgent001FailureReply({
        stage: 'trade_prebind',
        capability: 'info-analysis-feed',
        reason: error?.message || 'bind_failed'
      });
    }
    if (!hasStrictX402Evidence(infoPayPlan?.paymentIntent)) {
      return buildAgent001FailureReply({
        stage: 'trade_prebind',
        capability: 'info-analysis-feed',
        reason: 'x402 evidence missing after prebind',
        requestId: String(infoPayPlan?.paymentIntent?.requestId || '').trim(),
        txHash: String(infoPayPlan?.paymentIntent?.txHash || '').trim()
      });
    }
    upsertAgent001ResultRecord({
      requestId: infoPayPlan.paymentIntent.requestId,
      capability: 'info-analysis-feed',
      stage: 'prebind',
      status: 'paid',
      toAgentId: infoProvider.toAgentId,
      payer,
      input: infoPayPlan.normalizedTask,
      quote: infoQuote,
      payment: infoPayPlan.paymentIntent,
      receiptRef: {
        requestId: infoPayPlan.paymentIntent.requestId,
        txHash: infoPayPlan.paymentIntent.txHash,
        block: infoPayPlan.paymentIntent.block,
        status: infoPayPlan.paymentIntent.status,
        explorer: infoPayPlan.paymentIntent.explorer,
        verifiedAt: infoPayPlan.paymentIntent.verifiedAt,
        endpoint: `/api/receipt/${infoPayPlan.paymentIntent.requestId}`
      },
      warnings: infoPayPlan.warnings,
      source: 'agent001_trade'
    });
    info = await runAgent001DispatchTask({
      toAgentId: infoProvider.toAgentId,
      capability: 'info-analysis-feed',
      input: infoPayPlan.normalizedTask,
      paymentIntent: infoPayPlan.paymentIntent,
      waitMsLimit
    });
    if (!isAgent001TaskSuccessful(info)) {
      upsertAgent001ResultRecord({
        requestId: infoPayPlan.paymentIntent.requestId,
        capability: 'info-analysis-feed',
        stage: 'dispatch',
        status: 'failed',
        toAgentId: infoProvider.toAgentId,
        payer,
        input: infoPayPlan.normalizedTask,
        quote: infoQuote,
        payment: infoPayPlan.paymentIntent,
        error: info?.error || 'analysis_dispatch_failed',
        reason: info?.reason || info?.taskResult?.error || 'analysis dispatch failed',
        source: 'agent001_trade',
        dm: {
          delivered: false,
          taskId: String(info?.task?.taskId || '').trim(),
          traceId: String(info?.task?.traceId || '').trim(),
          reason: info?.reason || info?.error || ''
        }
      });
      return buildAgent001FailureReply({
        stage: 'trade_dispatch',
        capability: 'info-analysis-feed',
        reason: info?.reason || info?.error || info?.taskResult?.error || 'failed',
        requestId: infoPayPlan.paymentIntent.requestId,
        txHash: infoPayPlan.paymentIntent.txHash
      });
    }
    const infoPayment = info?.taskResult?.payment || infoPayPlan?.paymentIntent || null;
    if (!hasStrictX402Evidence(infoPayment)) {
      upsertAgent001ResultRecord({
        requestId: infoPayPlan.paymentIntent.requestId,
        capability: 'info-analysis-feed',
        stage: 'dispatch',
        status: 'failed',
        toAgentId: infoProvider.toAgentId,
        payer,
        input: infoPayPlan.normalizedTask,
        quote: infoQuote,
        payment: infoPayment || infoPayPlan.paymentIntent,
        error: 'x402_evidence_missing',
        reason: 'task-result missing strict x402 evidence',
        source: 'agent001_trade',
        dm: {
          delivered: false,
          taskId: String(info?.task?.taskId || '').trim(),
          traceId: String(info?.task?.traceId || '').trim(),
          reason: 'x402_evidence_missing'
        }
      });
      return buildAgent001FailureReply({
        stage: 'trade_dispatch',
        capability: 'info-analysis-feed',
        reason: 'task-result missing strict x402 evidence',
        requestId: String(infoPayPlan?.paymentIntent?.requestId || '').trim(),
        txHash: String(infoPayPlan?.paymentIntent?.txHash || '').trim()
      });
    }
    const infoProgressDm = await maybeSendAgent001ProgressDm({
      context,
      capability: 'info-analysis-feed',
      summary: String(info?.taskResult?.result?.summary || '').trim(),
      payment: infoPayment
    });
    upsertAgent001ResultRecord({
      requestId: infoPayment.requestId,
      capability: 'info-analysis-feed',
      stage: 'dispatch',
      status: 'done',
      toAgentId: infoProvider.toAgentId,
      payer,
      input: infoPayPlan.normalizedTask,
      quote: infoQuote,
      payment: infoPayment,
      receiptRef: buildTaskReceiptRef(infoPayment),
      result: info?.taskResult?.result || null,
      source: 'agent001_trade',
      dm: {
        delivered: Boolean(infoProgressDm?.ok),
        taskId: String(info?.task?.taskId || '').trim(),
        traceId: String(info?.task?.traceId || '').trim(),
        reason: String(infoProgressDm?.reason || '').trim()
      }
    });

    let technicalPayPlan = null;
    let technical = null;
    const technicalQuote = technicalQuoteTask?.taskResult?.result?.quote || null;
    try {
      technicalPayPlan = await buildAgent001StrictPaymentPlan({
        capability: 'technical-analysis-feed',
        rawText,
        intent,
        payer,
        targetAgentId: technicalProvider.toAgentId
      });
    } catch (error) {
      return buildAgent001FailureReply({
        stage: 'trade_prebind',
        capability: 'technical-analysis-feed',
        reason: error?.message || 'bind_failed'
      });
    }
    if (!hasStrictX402Evidence(technicalPayPlan?.paymentIntent)) {
      return buildAgent001FailureReply({
        stage: 'trade_prebind',
        capability: 'technical-analysis-feed',
        reason: 'x402 evidence missing after prebind',
        requestId: String(technicalPayPlan?.paymentIntent?.requestId || '').trim(),
        txHash: String(technicalPayPlan?.paymentIntent?.txHash || '').trim()
      });
    }
    upsertAgent001ResultRecord({
      requestId: technicalPayPlan.paymentIntent.requestId,
      capability: 'technical-analysis-feed',
      stage: 'prebind',
      status: 'paid',
      toAgentId: technicalProvider.toAgentId,
      payer,
      input: technicalPayPlan.normalizedTask,
      quote: technicalQuote,
      payment: technicalPayPlan.paymentIntent,
      receiptRef: {
        requestId: technicalPayPlan.paymentIntent.requestId,
        txHash: technicalPayPlan.paymentIntent.txHash,
        block: technicalPayPlan.paymentIntent.block,
        status: technicalPayPlan.paymentIntent.status,
        explorer: technicalPayPlan.paymentIntent.explorer,
        verifiedAt: technicalPayPlan.paymentIntent.verifiedAt,
        endpoint: `/api/receipt/${technicalPayPlan.paymentIntent.requestId}`
      },
      warnings: technicalPayPlan.warnings,
      source: 'agent001_trade'
    });
    technical = await runAgent001DispatchTask({
      toAgentId: technicalProvider.toAgentId,
      capability: 'technical-analysis-feed',
      input: technicalPayPlan.normalizedTask,
      paymentIntent: technicalPayPlan.paymentIntent,
      waitMsLimit
    });
    if (!isAgent001TaskSuccessful(technical)) {
      upsertAgent001ResultRecord({
        requestId: technicalPayPlan.paymentIntent.requestId,
        capability: 'technical-analysis-feed',
        stage: 'dispatch',
        status: 'failed',
        toAgentId: technicalProvider.toAgentId,
        payer,
        input: technicalPayPlan.normalizedTask,
        quote: technicalQuote,
        payment: technicalPayPlan.paymentIntent,
        error: technical?.error || 'analysis_dispatch_failed',
        reason: technical?.reason || technical?.taskResult?.error || 'analysis dispatch failed',
        source: 'agent001_trade',
        dm: {
          delivered: false,
          taskId: String(technical?.task?.taskId || '').trim(),
          traceId: String(technical?.task?.traceId || '').trim(),
          reason: technical?.reason || technical?.error || ''
        }
      });
      return buildAgent001FailureReply({
        stage: 'trade_dispatch',
        capability: 'technical-analysis-feed',
        reason: technical?.reason || technical?.error || technical?.taskResult?.error || 'failed',
        requestId: technicalPayPlan.paymentIntent.requestId,
        txHash: technicalPayPlan.paymentIntent.txHash
      });
    }
    const technicalPayment = technical?.taskResult?.payment || technicalPayPlan?.paymentIntent || null;
    if (!hasStrictX402Evidence(technicalPayment)) {
      upsertAgent001ResultRecord({
        requestId: technicalPayPlan.paymentIntent.requestId,
        capability: 'technical-analysis-feed',
        stage: 'dispatch',
        status: 'failed',
        toAgentId: technicalProvider.toAgentId,
        payer,
        input: technicalPayPlan.normalizedTask,
        quote: technicalQuote,
        payment: technicalPayment || technicalPayPlan.paymentIntent,
        error: 'x402_evidence_missing',
        reason: 'task-result missing strict x402 evidence',
        source: 'agent001_trade',
        dm: {
          delivered: false,
          taskId: String(technical?.task?.taskId || '').trim(),
          traceId: String(technical?.task?.traceId || '').trim(),
          reason: 'x402_evidence_missing'
        }
      });
      return buildAgent001FailureReply({
        stage: 'trade_dispatch',
        capability: 'technical-analysis-feed',
        reason: 'task-result missing strict x402 evidence',
        requestId: String(technicalPayPlan?.paymentIntent?.requestId || '').trim(),
        txHash: String(technicalPayPlan?.paymentIntent?.txHash || '').trim()
      });
    }
    const technicalProgressDm = await maybeSendAgent001ProgressDm({
      context,
      capability: 'technical-analysis-feed',
      summary: String(technical?.taskResult?.result?.summary || '').trim(),
      payment: technicalPayment
    });
    upsertAgent001ResultRecord({
      requestId: technicalPayment.requestId,
      capability: 'technical-analysis-feed',
      stage: 'dispatch',
      status: 'done',
      toAgentId: technicalProvider.toAgentId,
      payer,
      input: technicalPayPlan.normalizedTask,
      quote: technicalQuote,
      payment: technicalPayment,
      receiptRef: buildTaskReceiptRef(technicalPayment),
      result: technical?.taskResult?.result || null,
      source: 'agent001_trade',
      dm: {
        delivered: Boolean(technicalProgressDm?.ok),
        taskId: String(technical?.task?.taskId || '').trim(),
        traceId: String(technical?.task?.traceId || '').trim(),
        reason: String(technicalProgressDm?.reason || '').trim()
      }
    });

    const tradePlan = buildAgent001TradePlan({
      rawText,
      intent,
      technical,
      info,
      returnObject: true
    });
    const forceOrderRequested = isAgent001ForceOrderRequested(rawText) || orderDirectives.forceExecute;
    const explicitOrderRequested = orderDirectives.explicitOrder;
    const shouldCoercePlan = forceOrderRequested || explicitOrderRequested;
    const effectiveTradePlan = shouldCoercePlan
      ? coerceAgent001ForcedTradePlan({ rawText, tradePlan, technical, info, directives: orderDirectives })
      : tradePlan;
    const lines = [
      String(effectiveTradePlan?.text || '').trim() || '交易计划生成失败。',
      '',
      '报价协商:',
      `technical: ${technicalQuote?.serviceId || '-'} @ ${technicalQuote?.price || '-'} | SLA ${technicalQuote?.slaMs || '-'}ms`,
      `message: ${infoQuote?.serviceId || '-'} @ ${infoQuote?.price || '-'} | SLA ${infoQuote?.slaMs || '-'}ms`,
      '',
      '分析段 x402 证据:',
      `technical requestId: ${String(technicalPayment?.requestId || '').trim() || '-'}`,
      `technical txHash: ${String(technicalPayment?.txHash || '').trim() || '-'}`,
      `message requestId: ${String(infoPayment?.requestId || '').trim() || '-'}`,
      `message txHash: ${String(infoPayment?.txHash || '').trim() || '-'}`
    ];

    if (!effectiveTradePlan?.canPlaceOrder) {
      if (String(effectiveTradePlan?.forceOrderReason || '').trim()) {
        lines.push(`执行阻断: ${String(effectiveTradePlan.forceOrderReason).trim()}`);
      }
      lines.push('执行结果: 不满足自动下单条件，本轮不下单。');
      const tradeReply = lines.join('\n');
      await maybeSendAgent001TradePlanDm({
        context,
        tradePlanText: tradeReply,
        infoPayment,
        technicalPayment
      });
      return tradeReply;
    }

    const execution = await appendAgent001OrderExecutionLines({
      lines,
      plan: effectiveTradePlan,
      payer,
      orderDirectives,
      orderTraceId: 'agent001_trade_order',
      stopTraceId: 'agent001_trade_stop',
      failureStage: 'trade_order',
      resultSource: 'agent001_trade'
    });
    if (execution.hardFailureReply) {
      return execution.hardFailureReply;
    }
    const tradeReply = lines.join('\n');
    await maybeSendAgent001TradePlanDm({
      context,
      tradePlanText: tradeReply,
      infoPayment,
      technicalPayment
    });
    return tradeReply;
  }

  return {
    handleAgent001TradeIntent
  };
}
