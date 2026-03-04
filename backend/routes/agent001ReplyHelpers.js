export function createAgent001ReplyHelpers(deps = {}) {
  const {
    createTraceId,
    extractFirstUrlFromText,
    extractHorizonFromText,
    extractTradingSymbolFromText,
    fetchXReaderDigest,
    isRecoverableXmtpFailure,
    normalizeStringArray,
    normalizeXReaderParams,
    llmAdapter,
    runRiskScoreAnalysis
  } = deps;

  function sanitizePlainText(value = '') {
    return String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function clipAgent001Line(text = '', maxLen = 140) {
    const raw = sanitizePlainText(String(text || '').trim());
    if (!raw) return '';
    if (raw.length <= maxLen) return raw;
    return `${raw.slice(0, maxLen - 3)}...`;
  }

  function extractAgent001TopHandles(keyFactors = [], limit = 3) {
    const rows = Array.isArray(keyFactors) ? keyFactors : [];
    const handles = [];
    for (const item of rows) {
      const text = String(item || '').trim();
      const matched = text.match(/x:@([A-Za-z0-9_]+)/);
      if (!matched) continue;
      const handle = `@${String(matched[1] || '').trim()}`;
      if (!handle || handles.includes(handle)) continue;
      handles.push(handle);
      if (handles.length >= limit) break;
    }
    return handles;
  }

  function buildAgent001InfoDetailLines(infoResult = {}) {
    const payload =
      infoResult?.info && typeof infoResult.info === 'object' && !Array.isArray(infoResult.info)
        ? infoResult.info
        : infoResult;
    const headlines = normalizeStringArray(payload?.headlines || infoResult?.headlines || [], 3)
      .map((item) => clipAgent001Line(item, 120))
      .filter(Boolean);
    const keyFactors = normalizeStringArray(payload?.keyFactors || infoResult?.keyFactors || [], 20);
    const handles = extractAgent001TopHandles(keyFactors, 3);
    const nonHandleFactors = keyFactors
      .filter((item) => !/^x:@/i.test(String(item || '').trim()))
      .slice(0, 3)
      .map((item) => clipAgent001Line(item, 80))
      .filter(Boolean);

    const lines = [];
    if (headlines.length > 0) {
      lines.push(`消息样本: ${headlines.map((item, index) => `${index + 1}) ${item}`).join(' | ')}`);
    }
    if (handles.length > 0) {
      lines.push(`重点账号: ${handles.join(', ')}`);
    }
    if (nonHandleFactors.length > 0) {
      lines.push(`关键因子: ${nonHandleFactors.join(' | ')}`);
    }
    return lines;
  }

  function buildAgent001DispatchSummary(results = {}) {
    const technical = results?.technical || null;
    const info = results?.info || null;
    const lines = [];

    if (technical?.ok && technical?.taskResult?.result?.summary) {
      lines.push(`技术面: ${String(technical.taskResult.result.summary).trim()}`);
    } else if (technical) {
      lines.push(`技术面失败: ${String(technical.reason || technical.error || 'unknown').trim()}`);
    }

    if (info?.ok && info?.taskResult?.result?.summary) {
      lines.push(`消息面: ${String(info.taskResult.result.summary).trim()}`);
      const infoDetailLines = buildAgent001InfoDetailLines(info?.taskResult?.result || {});
      if (infoDetailLines.length > 0) lines.push(...infoDetailLines);
    } else if (info) {
      lines.push(`消息面失败: ${String(info.reason || info.error || 'unknown').trim()}`);
    }

    return lines.join('\n').trim();
  }

  function shouldUseAgent001LocalFallback(result = null) {
    if (!result || result.ok) return false;
    return isRecoverableXmtpFailure(result?.error, result?.reason);
  }

  async function applyAgent001LocalFallback({
    rawText = '',
    intent = {},
    runTechnical = false,
    runInfo = false,
    technical = null,
    info = null
  } = {}) {
    let nextTechnical = technical;
    let nextInfo = info;
    const symbol = String(intent?.symbol || extractTradingSymbolFromText(rawText) || 'BTCUSDT')
      .trim()
      .toUpperCase() || 'BTCUSDT';
    const horizonMin = Number.isFinite(Number(intent?.horizonMin))
      ? Math.max(5, Math.min(Math.round(Number(intent.horizonMin)), 240))
      : extractHorizonFromText(rawText);

    if (runTechnical && shouldUseAgent001LocalFallback(technical)) {
      try {
        const localTechnical = await runRiskScoreAnalysis({
          symbol,
          source: String(intent?.source || 'hyperliquid').trim().toLowerCase() || 'hyperliquid',
          horizonMin
        });
        nextTechnical = {
          ok: true,
          fallback: 'local-analysis',
          taskResult: {
            result: {
              ...localTechnical,
              analysisType: 'technical',
              analysis:
                localTechnical?.technical && typeof localTechnical.technical === 'object'
                  ? localTechnical.technical
                  : null
            }
          }
        };
      } catch (error) {
        nextTechnical = {
          ...(technical && typeof technical === 'object' ? technical : {}),
          ok: false,
          error: technical?.error || 'technical_local_fallback_failed',
          reason: `${String(technical?.reason || technical?.error || 'dispatch_failed').trim()}; local=${String(
            error?.message || 'failed'
          ).trim()}`
        };
      }
    }

    if (runInfo && shouldUseAgent001LocalFallback(info)) {
      try {
        const infoTask = normalizeXReaderParams({
          url: intent?.topic || extractFirstUrlFromText(rawText) || rawText,
          mode: 'news',
          maxChars: 900
        });
        const reader = await fetchXReaderDigest(infoTask);
        nextInfo = {
          ok: true,
          fallback: 'local-analysis',
          taskResult: {
            result: {
              summary: String(reader?.analysis?.summary || reader?.excerpt || '').trim() || 'info digest ready',
              analysisType: 'info',
              info: reader?.analysis || null,
              reader
            }
          }
        };
      } catch (error) {
        nextInfo = {
          ...(info && typeof info === 'object' ? info : {}),
          ok: false,
          error: info?.error || 'info_local_fallback_failed',
          reason: `${String(info?.reason || info?.error || 'dispatch_failed').trim()}; local=${String(
            error?.message || 'failed'
          ).trim()}`
        };
      }
    }

    return { technical: nextTechnical, info: nextInfo };
  }

  async function maybePolishAgent001Reply(rawText = '', draft = '') {
    const cleanDraft = String(draft || '').trim();
    if (!cleanDraft) return '';

    const hasTechLine = /(?:技术面:|technical:)/i.test(cleanDraft);
    const hasInfoLine = /(?:消息面:|info:)/i.test(cleanDraft);

    const prompt = [
      '你是 AGENT001。',
      '请把以下执行结果整理成简洁中文回复。',
      '要求:',
      '- 保留关键结论',
      '- 不要编造',
      '- 不要输出 markdown 代码块',
      '- 如果同时包含技术面和消息面，请明确分成“技术面:”和“消息面:”两段',
      '',
      `用户原话: ${String(rawText || '').trim()}`,
      `执行结果: ${cleanDraft}`
    ].join('\n');

    const chat = await llmAdapter.chat({
      message: prompt,
      sessionId: 'agent001_polish',
      traceId: createTraceId('agent001_polish'),
      agent: 'router-agent'
    });

    if (!chat?.ok) return cleanDraft;

    const text = String(chat.reply || '').trim();
    if (hasTechLine && hasInfoLine) {
      const hasTechLabel = /(?:技术面[:：]|technical[:：])/i.test(text);
      const hasInfoLabel = /(?:消息面[:：]|info[:：])/i.test(text);
      if (!hasTechLabel || !hasInfoLabel) return cleanDraft;
    }

    return text || cleanDraft;
  }

  return {
    applyAgent001LocalFallback,
    buildAgent001DispatchSummary,
    maybePolishAgent001Reply
  };
}
