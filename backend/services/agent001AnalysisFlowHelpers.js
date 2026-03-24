export function createAgent001AnalysisFlowHelpers(deps = {}) {
  const {
    AGENT001_REQUIRE_X402,
    applyAgent001LocalFallback,
    buildAgent001DispatchSummary,
    buildAgent001FailureReply,
    buildAgent001StrictPaymentPlan,
    buildAgent001TradePlan,
    buildTaskReceiptRef,
    extractFirstUrlFromText,
    hasStrictX402Evidence,
    isAgent001TaskSuccessful,
    maybePolishAgent001Reply,
    maybeSendAgent001ProgressDm,
    maybeSendAgent001TradePlanDm,
    normalizeAddress,
    readSessionRuntime,
    runAgent001DispatchTask,
    runAgent001QuoteNegotiation,
    selectAgent001ProviderPlan,
    upsertAgent001ResultRecord
  } = deps;

  async function handleAgent001AnalysisIntent({ context = null, intent = {}, rawText = '', runTrade = false, waitMsLimit = 30_000 } = {}) {
  const runTechnical = runTrade || intent.intent === 'technical' || intent.intent === 'both';
  const runInfo = runTrade || intent.intent === 'info' || intent.intent === 'both';
  if (!runTechnical && !runInfo && AGENT001_REQUIRE_X402) {
    return '当前已开启强制计费：除 help/status 外均需 x402 支付。请发送技术面或消息面分析请求。';
  }

  let technical = null;
  let info = null;
  let technicalPayPlan = null;
  let infoPayPlan = null;
  let technicalProvider = null;
  let infoProvider = null;
  let technicalQuoteTask = null;
  let infoQuoteTask = null;
  const runtime = readSessionRuntime();
  const payer = normalizeAddress(runtime?.aaWallet || '');

  if ((runTechnical || runInfo) && AGENT001_REQUIRE_X402 && !payer) {
    return '计费模式已开启，但未配置 AA payer。请先同步 Session/AA 钱包后再发起分析。';
  }

  if (AGENT001_REQUIRE_X402) {
    if (runInfo) {
      infoProvider = await selectAgent001ProviderPlan({ capability: 'info-analysis-feed' });
      if (!infoProvider?.ok) {
        return buildAgent001FailureReply({
          stage: 'analysis_quote_discovery',
          capability: 'info-analysis-feed',
          reason: infoProvider?.reason || infoProvider?.error || 'service_unavailable'
        });
      }
      infoQuoteTask = await runAgent001QuoteNegotiation({
        toAgentId: infoProvider.toAgentId,
        wantedCapability: 'info-analysis-feed',
        rawText,
        intent,
        waitMsLimit: 12_000
      });
      if (!isAgent001TaskSuccessful(infoQuoteTask)) {
        return buildAgent001FailureReply({
          stage: 'analysis_quote_negotiation',
          capability: 'info-analysis-feed',
          reason: infoQuoteTask?.reason || infoQuoteTask?.error || 'quote_failed'
        });
      }
    }
    if (runTechnical) {
      technicalProvider = await selectAgent001ProviderPlan({ capability: 'technical-analysis-feed' });
      if (!technicalProvider?.ok) {
        return buildAgent001FailureReply({
          stage: 'analysis_quote_discovery',
          capability: 'technical-analysis-feed',
          reason: technicalProvider?.reason || technicalProvider?.error || 'service_unavailable'
        });
      }
      technicalQuoteTask = await runAgent001QuoteNegotiation({
        toAgentId: technicalProvider.toAgentId,
        wantedCapability: 'technical-analysis-feed',
        rawText,
        intent,
        waitMsLimit: 12_000
      });
      if (!isAgent001TaskSuccessful(technicalQuoteTask)) {
        return buildAgent001FailureReply({
          stage: 'analysis_quote_negotiation',
          capability: 'technical-analysis-feed',
          reason: technicalQuoteTask?.reason || technicalQuoteTask?.error || 'quote_failed'
        });
      }
    }
  }

  if (runInfo) {
    if (AGENT001_REQUIRE_X402) {
      const infoQuote = infoQuoteTask?.taskResult?.result?.quote || null;
      try {
        infoPayPlan = await buildAgent001StrictPaymentPlan({
          capability: 'info-analysis-feed',
          rawText,
          intent,
          payer,
          targetAgentId: infoProvider?.toAgentId || 'message-agent'
        });
      } catch (error) {
        return buildAgent001FailureReply({
          stage: 'analysis_prebind',
          capability: 'info-analysis-feed',
          reason: error?.message || 'bind_failed'
        });
      }
      if (!hasStrictX402Evidence(infoPayPlan?.paymentIntent)) {
        return buildAgent001FailureReply({
          stage: 'analysis_prebind',
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
        toAgentId: infoProvider?.toAgentId || 'message-agent',
        payer,
        input: infoPayPlan.normalizedTask,
        quote: infoQuote,
        payment: infoPayPlan.paymentIntent,
        receiptRef: buildTaskReceiptRef(infoPayPlan.paymentIntent),
        warnings: infoPayPlan.warnings,
        source: 'agent001_analysis'
      });
      info = await runAgent001DispatchTask({
        toAgentId: infoProvider?.toAgentId || 'message-agent',
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
          toAgentId: infoProvider?.toAgentId || 'message-agent',
          payer,
          input: infoPayPlan.normalizedTask,
          quote: infoQuote,
          payment: infoPayPlan.paymentIntent,
          error: info?.error || 'analysis_dispatch_failed',
          reason: info?.reason || info?.taskResult?.error || 'analysis dispatch failed',
          source: 'agent001_analysis',
          dm: {
            delivered: false,
            taskId: String(info?.task?.taskId || '').trim(),
            traceId: String(info?.task?.traceId || '').trim(),
            reason: info?.reason || info?.error || ''
          }
        });
        return buildAgent001FailureReply({
          stage: 'analysis_dispatch',
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
          toAgentId: infoProvider?.toAgentId || 'message-agent',
          payer,
          input: infoPayPlan.normalizedTask,
          quote: infoQuote,
          payment: infoPayment || infoPayPlan.paymentIntent,
          error: 'x402_evidence_missing',
          reason: 'task-result missing strict x402 evidence',
          source: 'agent001_analysis',
          dm: {
            delivered: false,
            taskId: String(info?.task?.taskId || '').trim(),
            traceId: String(info?.task?.traceId || '').trim(),
            reason: 'x402_evidence_missing'
          }
        });
        return buildAgent001FailureReply({
          stage: 'analysis_dispatch',
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
        toAgentId: infoProvider?.toAgentId || 'message-agent',
        payer,
        input: infoPayPlan.normalizedTask,
        quote: infoQuote,
        payment: infoPayment,
        receiptRef: buildTaskReceiptRef(infoPayment),
        result: info?.taskResult?.result || null,
        source: 'agent001_analysis',
        dm: {
          delivered: Boolean(infoProgressDm?.ok),
          taskId: String(info?.task?.taskId || '').trim(),
          traceId: String(info?.task?.traceId || '').trim(),
          reason: String(infoProgressDm?.reason || '').trim()
        }
      });
    } else {
      info = await runAgent001DispatchTask({
        toAgentId: 'message-agent',
        capability: 'info-analysis-feed',
        input: {
          url: intent.topic || extractFirstUrlFromText(rawText) || rawText,
          mode: 'news',
          maxChars: 900
        },
        waitMsLimit
      });
    }
  }

  if (runTechnical) {
    if (AGENT001_REQUIRE_X402) {
      const technicalQuote = technicalQuoteTask?.taskResult?.result?.quote || null;
      try {
        technicalPayPlan = await buildAgent001StrictPaymentPlan({
          capability: 'technical-analysis-feed',
          rawText,
          intent,
          payer,
          targetAgentId: technicalProvider?.toAgentId || 'technical-agent'
        });
      } catch (error) {
        return buildAgent001FailureReply({
          stage: 'analysis_prebind',
          capability: 'technical-analysis-feed',
          reason: error?.message || 'bind_failed'
        });
      }
      if (!hasStrictX402Evidence(technicalPayPlan?.paymentIntent)) {
        return buildAgent001FailureReply({
          stage: 'analysis_prebind',
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
        toAgentId: technicalProvider?.toAgentId || 'technical-agent',
        payer,
        input: technicalPayPlan.normalizedTask,
        quote: technicalQuote,
        payment: technicalPayPlan.paymentIntent,
        receiptRef: buildTaskReceiptRef(technicalPayPlan.paymentIntent),
        warnings: technicalPayPlan.warnings,
        source: 'agent001_analysis'
      });
      technical = await runAgent001DispatchTask({
        toAgentId: technicalProvider?.toAgentId || 'technical-agent',
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
          toAgentId: technicalProvider?.toAgentId || 'technical-agent',
          payer,
          input: technicalPayPlan.normalizedTask,
          quote: technicalQuote,
          payment: technicalPayPlan.paymentIntent,
          error: technical?.error || 'analysis_dispatch_failed',
          reason: technical?.reason || technical?.taskResult?.error || 'analysis dispatch failed',
          source: 'agent001_analysis',
          dm: {
            delivered: false,
            taskId: String(technical?.task?.taskId || '').trim(),
            traceId: String(technical?.task?.traceId || '').trim(),
            reason: technical?.reason || technical?.error || ''
          }
        });
        return buildAgent001FailureReply({
          stage: 'analysis_dispatch',
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
          toAgentId: technicalProvider?.toAgentId || 'technical-agent',
          payer,
          input: technicalPayPlan.normalizedTask,
          quote: technicalQuote,
          payment: technicalPayment || technicalPayPlan.paymentIntent,
          error: 'x402_evidence_missing',
          reason: 'task-result missing strict x402 evidence',
          source: 'agent001_analysis',
          dm: {
            delivered: false,
            taskId: String(technical?.task?.taskId || '').trim(),
            traceId: String(technical?.task?.traceId || '').trim(),
            reason: 'x402_evidence_missing'
          }
        });
        return buildAgent001FailureReply({
          stage: 'analysis_dispatch',
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
        toAgentId: technicalProvider?.toAgentId || 'technical-agent',
        payer,
        input: technicalPayPlan.normalizedTask,
        quote: technicalQuote,
        payment: technicalPayment,
        receiptRef: buildTaskReceiptRef(technicalPayment),
        result: technical?.taskResult?.result || null,
        source: 'agent001_analysis',
        dm: {
          delivered: Boolean(technicalProgressDm?.ok),
          taskId: String(technical?.task?.taskId || '').trim(),
          traceId: String(technical?.task?.traceId || '').trim(),
          reason: String(technicalProgressDm?.reason || '').trim()
        }
      });
    } else {
      technical = await runAgent001DispatchTask({
        toAgentId: 'technical-agent',
        capability: 'technical-analysis-feed',
        input: {
          symbol: intent.symbol || 'BTCUSDT',
          source: intent.source || 'hyperliquid',
          horizonMin: intent.horizonMin || 60
        },
        waitMsLimit
      });
    }
  }

  let technicalResolved = technical;
  let infoResolved = info;
  if (!AGENT001_REQUIRE_X402) {
    const fallbackResolved = await applyAgent001LocalFallback({
      rawText,
      intent,
      runTechnical,
      runInfo,
      technical,
      info
    });
    technicalResolved = fallbackResolved.technical;
    infoResolved = fallbackResolved.info;
  }
  if (runTrade) {
    return buildAgent001TradePlan({
      rawText,
      intent,
      technical: technicalResolved,
      info: infoResolved
    });
  }
  const summary = buildAgent001DispatchSummary({ technical: technicalResolved, info: infoResolved });
  if (!summary) {
    return 'AGENT001 调度完成，但未拿到可读结果。请稍后重试。';
  }
  if (AGENT001_REQUIRE_X402) {
    const lines = [summary];
    if (runInfo) {
      const infoQuote = infoQuoteTask?.taskResult?.result?.quote || null;
      if (infoQuote) {
        lines.push(`消息面 quote: service=${String(infoQuote?.serviceId || '-').trim() || '-'} price=${String(infoQuote?.price || '-').trim() || '-'} slaMs=${Number.isFinite(Number(infoQuote?.slaMs)) ? Number(infoQuote.slaMs) : '-'}`);
      }
    }
    if (runTechnical) {
      const technicalQuote = technicalQuoteTask?.taskResult?.result?.quote || null;
      if (technicalQuote) {
        lines.push(`技术面 quote: service=${String(technicalQuote?.serviceId || '-').trim() || '-'} price=${String(technicalQuote?.price || '-').trim() || '-'} slaMs=${Number.isFinite(Number(technicalQuote?.slaMs)) ? Number(technicalQuote.slaMs) : '-'}`);
      }
    }
    if (runInfo) {
      const infoPayment = info?.taskResult?.payment || infoPayPlan?.paymentIntent || null;
      lines.push(`消息面 x402: requestId=${String(infoPayment?.requestId || '-').trim() || '-'} txHash=${String(infoPayment?.txHash || '-').trim() || '-'}`);
      if (String(infoPayment?.requestId || '').trim()) {
        lines.push(`消息面 pull: /api/agent001/results/${String(infoPayment.requestId).trim()}`);
      }
    }
    if (runTechnical) {
      const technicalPayment = technical?.taskResult?.payment || technicalPayPlan?.paymentIntent || null;
      lines.push(`技术面 x402: requestId=${String(technicalPayment?.requestId || '-').trim() || '-'} txHash=${String(technicalPayment?.txHash || '-').trim() || '-'}`);
      if (String(technicalPayment?.requestId || '').trim()) {
        lines.push(`技术面 pull: /api/agent001/results/${String(technicalPayment.requestId).trim()}`);
      }
    }
    if (runInfo && runTechnical) {
      const tradePlanText = buildAgent001TradePlan({
        rawText,
        intent,
        technical: technicalResolved,
        info: infoResolved
      });
      await maybeSendAgent001TradePlanDm({
        context,
        tradePlanText: String(tradePlanText || '').trim(),
        infoPayment: info?.taskResult?.payment || infoPayPlan?.paymentIntent || null,
        technicalPayment: technical?.taskResult?.payment || technicalPayPlan?.paymentIntent || null
      });
      lines.push('');
      lines.push('AGENT001 交易计划:');
      lines.push(String(tradePlanText || '').trim() || '交易计划生成失败。');
    }
    return lines.join('\n');
  }
  const polished = await maybePolishAgent001Reply(rawText, summary);
  return polished || summary;
  }

  return {
    handleAgent001AnalysisIntent
  };
}
