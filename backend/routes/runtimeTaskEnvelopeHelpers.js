export function createRuntimeTaskEnvelopeHelpers(deps = {}) {
  const {
    X_READER_MAX_CHARS_DEFAULT,
    buildBestServiceQuote,
    buildTaskPaymentFromIntent,
    buildTaskReceiptRef,
    createTraceId,
    fetchBtcPriceQuote,
    fetchXReaderDigest,
    getTaskEnvelopeInput,
    normalizeBtcPriceParams,
    normalizeRiskScoreParams,
    normalizeTaskFailure,
    normalizeXReaderParams,
    llmAdapter,
    runRiskScoreAnalysis
  } = deps;

  function clipText(value = '', maxLength = 280) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(1, maxLength - 3)).trim()}...`;
  }

  async function buildWorkerLlmSummary({
    agentId = '',
    sessionId = '',
    fallbackSummary = '',
    promptBody = ''
  } = {}) {
    const safeFallback = clipText(fallbackSummary, 320) || 'task completed.';
    if (!llmAdapter || typeof llmAdapter.chat !== 'function') {
      return {
        summary: safeFallback,
        llm: {
          used: false,
          model: '',
          reason: 'adapter_unavailable'
        }
      };
    }

    const adapterInfo = typeof llmAdapter.info === 'function' ? llmAdapter.info() : {};
    if (!adapterInfo?.hasRemote) {
      return {
        summary: safeFallback,
        llm: {
          used: false,
          model: '',
          reason: 'remote_llm_disabled'
        }
      };
    }

    const normalizedAgentId = String(agentId || '').trim().toLowerCase() || 'worker-agent';
    const normalizedSessionId = String(sessionId || '').trim() || `${normalizedAgentId}_task`;
    const traceId = typeof createTraceId === 'function' ? createTraceId(`${normalizedAgentId.replace(/[^a-z0-9]+/g, '_')}_llm`) : '';
    const prompt = [
      `You are ${normalizedAgentId}.`,
      'This message is sent via XMTP task-result and must be concise and concrete.',
      'Return plain text only in 1-2 short sentences.',
      `Must include this core fact: ${safeFallback}`,
      promptBody ? `Context: ${String(promptBody || '').trim()}` : ''
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const chat = await llmAdapter.chat({
        message: prompt,
        sessionId: normalizedSessionId,
        traceId,
        agent: normalizedAgentId
      });
      if (!chat?.ok) {
        return {
          summary: safeFallback,
          llm: {
            used: false,
            model: String(chat?.model || '').trim(),
            reason: String(chat?.reason || chat?.error || 'llm_unavailable').trim() || 'llm_unavailable'
          }
        };
      }
      const llmSummary = clipText(chat.reply, 320);
      return {
        summary: llmSummary || safeFallback,
        llm: {
          used: true,
          model: String(chat?.model || '').trim(),
          sessionId: normalizedSessionId,
          traceId,
          reason: ''
        }
      };
    } catch (error) {
      return {
        summary: safeFallback,
        llm: {
          used: false,
          model: '',
          reason: String(error?.message || 'llm_exception').trim() || 'llm_exception'
        }
      };
    }
  }

  async function handleRiskRuntimeTaskEnvelope({ envelope = {} } = {}) {
    const capability = String(envelope?.capability || '').trim().toLowerCase();
    const payment = buildTaskPaymentFromIntent(envelope);
    const receiptRef = buildTaskReceiptRef(payment);
    if (capability === 'service-quote') {
      const input = getTaskEnvelopeInput(envelope);
      const wantedCapability = String(input?.wantedCapability || 'technical-analysis-feed').trim().toLowerCase();
      const quote = buildBestServiceQuote({ wantedCapability, preferredAgentId: 'technical-agent' });
      const fallbackSummary = quote
        ? `technical quote ready: ${quote.serviceId} @ ${quote.price}`
        : `No quote available for capability ${wantedCapability}.`;
      const llmSummary = await buildWorkerLlmSummary({
        agentId: 'risk-agent',
        sessionId: 'risk-agent_quote',
        fallbackSummary,
        promptBody: quote
          ? `capability=${wantedCapability}, serviceId=${quote.serviceId}, price=${quote.price}, recipient=${quote.recipient}`
          : `capability=${wantedCapability}, quote missing`
      });
      return {
        status: quote ? 'done' : 'failed',
        result: {
          summary: llmSummary.summary,
          quote: quote || null,
          llm: llmSummary.llm
        },
        error: quote ? '' : 'quote_unavailable',
        payment,
        receiptRef
      };
    }
    if (!['risk-score-feed', 'volatility-snapshot', 'technical-analysis-feed'].includes(capability)) {
      return {
        status: 'done',
        result: {
          summary: capability ? `Risk agent acknowledged capability ${capability}.` : 'Risk agent heartbeat ok.'
        },
        payment,
        receiptRef
      };
    }
    const input = getTaskEnvelopeInput(envelope);
    const task = normalizeRiskScoreParams({
      symbol: input.symbol || input.pair || 'BTCUSDT',
      source: input.source || 'hyperliquid',
      horizonMin: input.horizonMin ?? 60
    });
    try {
      const result = await runRiskScoreAnalysis(task);
      const fallbackSummary = String(result?.summary || '').trim() || `technical analysis ready for ${task.symbol}`;
      const llmSummary = await buildWorkerLlmSummary({
        agentId: 'risk-agent',
        sessionId: 'risk-agent_analysis',
        fallbackSummary,
        promptBody: `symbol=${task.symbol}, horizonMin=${task.horizonMin}, source=${task.source}`
      });
      return {
        status: 'done',
        result: {
          ...result,
          summary: llmSummary.summary,
          analysisType: 'technical',
          analysis: result?.technical && typeof result.technical === 'object' ? result.technical : null,
          llm: llmSummary.llm
        },
        payment,
        receiptRef
      };
    } catch (error) {
      const failure = normalizeTaskFailure(error, 'technical_analysis_failed');
      return {
        status: 'failed',
        error: failure.code,
        result: {
          summary: `technical analysis failed: ${failure.reason}`,
          analysisType: 'technical',
          failure
        },
        payment,
        receiptRef
      };
    }
  }

  async function handleReaderRuntimeTaskEnvelope({ envelope = {} } = {}) {
    const capability = String(envelope?.capability || '').trim().toLowerCase();
    const payment = buildTaskPaymentFromIntent(envelope);
    const receiptRef = buildTaskReceiptRef(payment);
    if (capability === 'service-quote') {
      const input = getTaskEnvelopeInput(envelope);
      const wantedCapability = String(input?.wantedCapability || 'info-analysis-feed').trim().toLowerCase();
      const quote = buildBestServiceQuote({ wantedCapability, preferredAgentId: 'message-agent' });
      const fallbackSummary = quote
        ? `message quote ready: ${quote.serviceId} @ ${quote.price}`
        : `No quote available for capability ${wantedCapability}.`;
      const llmSummary = await buildWorkerLlmSummary({
        agentId: 'reader-agent',
        sessionId: 'reader-agent_quote',
        fallbackSummary,
        promptBody: quote
          ? `capability=${wantedCapability}, serviceId=${quote.serviceId}, price=${quote.price}, recipient=${quote.recipient}`
          : `capability=${wantedCapability}, quote missing`
      });
      return {
        status: quote ? 'done' : 'failed',
        result: {
          summary: llmSummary.summary,
          quote: quote || null,
          llm: llmSummary.llm
        },
        error: quote ? '' : 'quote_unavailable',
        payment,
        receiptRef
      };
    }
    if (!['x-reader-feed', 'url-digest', 'info-analysis-feed'].includes(capability)) {
      return {
        status: 'done',
        result: {
          summary: capability ? `Reader agent acknowledged capability ${capability}.` : 'Reader agent heartbeat ok.'
        },
        payment,
        receiptRef
      };
    }
    const input = getTaskEnvelopeInput(envelope);
    const task = normalizeXReaderParams({
      url: input.url || input.resourceUrl || '',
      topic: input.topic || input.query || input.keyword || '',
      mode: input.mode || input.source || 'auto',
      maxChars: input.maxChars ?? X_READER_MAX_CHARS_DEFAULT
    });
    try {
      const reader = await fetchXReaderDigest(task);
      const fallbackSummary =
        String(reader?.analysis?.summary || '').trim() ||
        `info digest ready: ${reader?.title || reader?.url || task.url}`;
      const llmSummary = await buildWorkerLlmSummary({
        agentId: 'reader-agent',
        sessionId: 'reader-agent_analysis',
        fallbackSummary,
        promptBody: `topic=${task.topic || ''}, url=${task.url || ''}, mode=${task.mode || 'auto'}`
      });
      return {
        status: 'done',
        result: {
          summary: llmSummary.summary,
          analysisType: 'info',
          info: reader?.analysis || null,
          reader,
          llm: llmSummary.llm
        },
        payment,
        receiptRef
      };
    } catch (error) {
      const failure = normalizeTaskFailure(error, 'info_analysis_failed');
      return {
        status: 'failed',
        error: failure.code,
        result: {
          summary: `info analysis failed: ${failure.reason}`,
          analysisType: 'info',
          failure
        },
        payment,
        receiptRef
      };
    }
  }

  async function handlePriceRuntimeTaskEnvelope({ envelope = {} } = {}) {
    const capability = String(envelope?.capability || '').trim().toLowerCase();
    const payment = buildTaskPaymentFromIntent(envelope);
    const receiptRef = buildTaskReceiptRef(payment);
    if (!['btc-price-feed', 'market-quote'].includes(capability)) {
      return {
        status: 'done',
        result: {
          summary: capability ? `Price agent acknowledged capability ${capability}.` : 'Price agent heartbeat ok.'
        },
        payment,
        receiptRef
      };
    }
    const input = getTaskEnvelopeInput(envelope);
    const task = normalizeBtcPriceParams({
      pair: input.pair || input.symbol || 'BTCUSDT',
      source: input.source || 'hyperliquid'
    });
    const quote = await fetchBtcPriceQuote(task);
    return {
      status: 'done',
      result: {
        summary: `BTC ${quote.pair} = $${quote.priceUsd} (${quote.provider})`,
        quote
      },
      payment,
      receiptRef
    };
  }

  async function handleExecutorRuntimeTaskEnvelope({ envelope = {} } = {}) {
    const capability = String(envelope?.capability || '').trim().toLowerCase();
    const payment = buildTaskPaymentFromIntent(envelope);
    const receiptRef = buildTaskReceiptRef(payment);
    if (!['execute-plan', 'result-aggregation'].includes(capability)) {
      return {
        status: 'done',
        result: {
          summary: capability ? `Executor acknowledged capability ${capability}.` : 'Executor heartbeat ok.'
        },
        payment,
        receiptRef
      };
    }
    const input = getTaskEnvelopeInput(envelope);
    const symbol = String(input.symbol || input.pair || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
    const source = String(input.source || 'hyperliquid').trim().toLowerCase() || 'hyperliquid';
    const horizonMin = Number.isFinite(Number(input.horizonMin)) ? Math.max(1, Math.round(Number(input.horizonMin))) : 60;
    const includeQuote = input.includeQuote !== false;
    const includeRisk = input.includeRisk !== false;
    const includeReader = input.includeReader === true || Boolean(String(input.url || '').trim());
    const warnings = [];

    let quote = null;
    let risk = null;
    let reader = null;

    if (includeQuote) {
      try {
        quote = await fetchBtcPriceQuote({ pair: symbol, source });
      } catch (error) {
        warnings.push(`quote_failed: ${error?.message || 'unknown'}`);
      }
    }
    if (includeRisk) {
      try {
        risk = await runRiskScoreAnalysis({ symbol, source, horizonMin });
      } catch (error) {
        warnings.push(`risk_failed: ${error?.message || 'unknown'}`);
      }
    }
    if (includeReader) {
      const url = String(input.url || input.resourceUrl || '').trim();
      if (!url) {
        warnings.push('reader_skipped: missing url');
      } else {
        try {
          reader = await fetchXReaderDigest({
            url,
            mode: input.mode || 'auto',
            maxChars: input.maxChars ?? X_READER_MAX_CHARS_DEFAULT
          });
        } catch (error) {
          warnings.push(`reader_failed: ${error?.message || 'unknown'}`);
        }
      }
    }

    const successCount = [quote, risk, reader].filter(Boolean).length;
    const status = successCount > 0 ? 'done' : 'failed';
    return {
      status,
      error: status === 'failed' ? 'executor_plan_failed' : '',
      result: {
        summary:
          status === 'done'
            ? `Executor plan completed (${successCount} result${successCount > 1 ? 's' : ''}).`
            : 'Executor plan failed (no successful result).',
        plan: {
          symbol,
          source,
          horizonMin,
          includeQuote,
          includeRisk,
          includeReader
        },
        quote,
        risk,
        reader,
        warnings
      },
      payment,
      receiptRef
    };
  }

  return {
    handleExecutorRuntimeTaskEnvelope,
    handlePriceRuntimeTaskEnvelope,
    handleReaderRuntimeTaskEnvelope,
    handleRiskRuntimeTaskEnvelope
  };
}

