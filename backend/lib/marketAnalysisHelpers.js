export function createMarketAnalysisHelpers({
  analysisProvider,
  normalizeBtcPriceParams,
  xReaderMaxCharsDefault
}) {
  function normalizeReactiveParams(actionParams = {}) {
    const symbol = String(actionParams.symbol || '').trim().toUpperCase();
    const takeProfitRaw = Number(actionParams.takeProfit);
    const stopLossRaw = Number(actionParams.stopLoss);
    const quantityText = String(actionParams.quantity ?? '').trim();
    const hasQuantity = quantityText !== '';
    const quantityRaw = hasQuantity ? Number(quantityText) : null;
    if (!symbol) {
      throw new Error('Reactive action requires symbol.');
    }
    if (!Number.isFinite(takeProfitRaw) || takeProfitRaw <= 0) {
      throw new Error('Reactive action requires a valid takeProfit.');
    }
    if (!Number.isFinite(stopLossRaw) || stopLossRaw <= 0) {
      throw new Error('Reactive action requires a valid stopLoss.');
    }
    if (hasQuantity && (!Number.isFinite(quantityRaw) || quantityRaw <= 0)) {
      throw new Error('Reactive action requires a valid quantity when quantity is provided.');
    }
    return {
      symbol,
      takeProfit: takeProfitRaw,
      stopLoss: stopLossRaw,
      ...(hasQuantity ? { quantity: quantityRaw } : {})
    };
  }

  function normalizeRiskScoreParams(input = {}) {
    const rawSymbol = String(input.symbol || input.pair || 'BTCUSDT').trim().toUpperCase();
    const symbolCompact = rawSymbol.replace(/[-_\s]/g, '');
    const symbolBase = symbolCompact.startsWith('ETH') ? 'ETH' : symbolCompact.startsWith('BTC') ? 'BTC' : '';
    if (!symbolBase) {
      throw new Error('Risk-score task requires symbol BTC/ETH (BTCUSDT/BTCUSD/ETHUSDT/ETHUSD).');
    }
    const horizonMinRaw = Number(input.horizonMin ?? input.horizonMins ?? 60);
    const horizonMin = Number.isFinite(horizonMinRaw) ? Math.max(5, Math.min(Math.round(horizonMinRaw), 240)) : 60;
    const normalizedBtc = normalizeBtcPriceParams({ source: input.source || 'hyperliquid', pair: rawSymbol });
    return {
      symbol: normalizedBtc.pair,
      horizonMin,
      source: normalizedBtc.source,
      sourceRequested: normalizedBtc.sourceRequested,
      providers: normalizedBtc.providers
    };
  }

  function normalizeXReaderParams(input = {}) {
    const rawInput = String(
      input.url || input.resourceUrl || input.targetUrl || input.topic || input.query || input.keyword || ''
    ).trim();
    if (!rawInput) {
      throw new Error('info-analysis task requires url or topic.');
    }
    let normalizedUrl = '';
    let topic = '';
    let inputType = 'url';
    try {
      const parsed = new URL(rawInput);
      if (!['http:', 'https:'].includes(String(parsed.protocol || '').toLowerCase())) {
        throw new Error('invalid protocol');
      }
      normalizedUrl = parsed.toString();
      const host = String(parsed.hostname || '').replace(/^www\./i, '').trim();
      topic = host ? `market sentiment for ${host}` : normalizedUrl;
      inputType = 'url';
    } catch {
      normalizedUrl = '';
      topic = rawInput;
      inputType = 'topic';
    }

    const requestedMode = String(input.mode || input.source || 'auto').trim().toLowerCase();
    const modeAliases = {
      market: 'market-data',
      marketdata: 'market-data',
      legacy: 'market-data',
      fallback: 'market-data',
      news: 'auto',
      xreader: 'auto',
      jina: 'auto',
      opennewsmcp: 'opennews',
      opennews: 'opennews',
      twitter: 'opentwitter',
      opentwittermcp: 'opentwitter',
      opentwitter: 'opentwitter',
      mcp: 'multi-provider',
      multiprovider: 'multi-provider'
    };
    const rawMode = modeAliases[requestedMode] || requestedMode;
    if (!['auto', 'market-data', 'opennews', 'opentwitter', 'multi-provider'].includes(rawMode)) {
      throw new Error('info-analysis task mode must be one of auto/market-data/opennews/opentwitter/multi-provider.');
    }
    const maxCharsRaw = Number(input.maxChars ?? input.maxLength ?? xReaderMaxCharsDefault);
    const maxChars = Number.isFinite(maxCharsRaw)
      ? Math.max(200, Math.min(Math.round(maxCharsRaw), 20000))
      : xReaderMaxCharsDefault;

    return {
      url: normalizedUrl,
      topic,
      inputType,
      mode: rawMode,
      maxChars
    };
  }

  function parseExcerptMaxChars(input, fallback = 8000) {
    const value = Number(input ?? fallback);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(200, Math.min(Math.round(value), 20000));
  }

  function extractXReaderDigest(rawText = '', maxChars = xReaderMaxCharsDefault) {
    const normalized = String(rawText || '').replace(/\r/g, '').trim();
    if (!normalized) {
      return {
        title: '',
        excerpt: ''
      };
    }
    const lines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const contentLines = lines.filter((line) => {
      const lower = line.toLowerCase();
      if (lower.startsWith('url source:')) return false;
      if (lower.startsWith('markdown content:')) return false;
      return true;
    });
    const title =
      contentLines.find((line) => {
        const lower = line.toLowerCase();
        if (lower.startsWith('title:')) return false;
        if (line.length < 6) return false;
        return true;
      }) || '';
    const excerpt = contentLines.join('\n').slice(0, maxChars);
    return {
      title: String(title || '').replace(/^title:\s*/i, '').trim(),
      excerpt
    };
  }

  function clampNumber(value, min, max, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  function normalizeStringArray(values = [], limit = 12) {
    const source = Array.isArray(values)
      ? values
      : String(values || '')
          .split('\n')
          .map((item) => String(item || '').trim())
          .filter(Boolean);
    return source
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, Math.max(1, Number(limit) || 12));
  }

  function normalizeFreshIsoTimestamp(primaryValue = '', fallbackValue = '') {
    const now = Date.now();
    const maxAgeMs = 1000 * 60 * 60 * 24 * 7;
    const futureSkewMs = 1000 * 60 * 10;
    const candidates = [primaryValue, fallbackValue];
    for (const candidate of candidates) {
      const raw = String(candidate || '').trim();
      if (!raw) continue;
      const ts = Date.parse(raw);
      if (!Number.isFinite(ts)) continue;
      const ageMs = now - ts;
      const tooOld = ageMs > maxAgeMs;
      const tooFuture = ts - now > futureSkewMs;
      if (tooOld || tooFuture) continue;
      return new Date(ts).toISOString();
    }
    return new Date(now).toISOString();
  }

  function normalizeInfoAnalysisResult(raw = {}, task = {}) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const candidateHeadlines = normalizeStringArray(
      source.headlines || source.news || source.items || source.facts || []
    );
    const candidateFactors = normalizeStringArray(source.keyFactors || source.factors || source.signals || []);
    const summary =
      String(source.summary || source.excerpt || source.text || source.digest || '').trim() ||
      candidateFactors[0] ||
      candidateHeadlines[0] ||
      `Info analysis ready for ${String(task.url || task.topic || 'resource').trim()}`;
    const topic = String(source.topic || task.topic || task.url || '').trim() || 'market-context';
    const confidence = clampNumber(source.confidence, 0, 1, 0.5);
    const sentimentScore = clampNumber(source.sentimentScore ?? source.sentiment ?? 0, -1, 1, 0);
    return {
      provider: String(source.provider || analysisProvider).trim() || analysisProvider,
      traceId: String(source.traceId || task.traceId || '').trim(),
      topic,
      sentimentScore: Number(sentimentScore.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      headlines: candidateHeadlines,
      keyFactors: candidateFactors,
      summary,
      asOf: normalizeFreshIsoTimestamp(source.asOf || source.timestamp || source.fetchedAt || '')
    };
  }

  function normalizeTechnicalAnalysisResult(raw = {}, task = {}) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const quoteSource =
      source.quote && typeof source.quote === 'object' && !Array.isArray(source.quote) ? source.quote : {};
    const symbol = String(source.symbol || source.pair || task.symbol || 'BTCUSDT').trim().toUpperCase() || 'BTCUSDT';
    const timeframe =
      String(source.timeframe || source.interval || '').trim() || `${Math.max(5, Number(task.horizonMin || 60))}m`;
    const confidence = clampNumber(source.confidence, 0, 1, 0.5);
    const defaultBias = confidence >= 0.65 ? 'bullish' : confidence <= 0.35 ? 'bearish' : 'neutral';
    const indicatorsSource =
      source.indicators && typeof source.indicators === 'object' && !Array.isArray(source.indicators)
        ? source.indicators
        : {};
    const signalsSource =
      source.signals && typeof source.signals === 'object' && !Array.isArray(source.signals)
        ? source.signals
        : {};
    const riskBandSource =
      source.riskBand && typeof source.riskBand === 'object' && !Array.isArray(source.riskBand)
        ? source.riskBand
        : {};
    const summary =
      String(source.summary || source.text || source.digest || '').trim() ||
      `Technical analysis ready for ${symbol} (${timeframe}).`;
    const riskScoreRaw = Number(source.riskScore ?? source.score ?? source?.risk?.score ?? NaN);
    const riskScore = Number.isFinite(riskScoreRaw) ? Math.max(5, Math.min(95, Math.round(riskScoreRaw))) : null;

    const quotePriceRaw = Number(quoteSource.priceUsd ?? source.priceUsd ?? source.price ?? NaN);
    const quotePair = String(quoteSource.pair || symbol).trim().toUpperCase() || symbol;
    const quoteProvider =
      String(quoteSource.provider || source.quoteProvider || source.provider || analysisProvider)
        .trim()
        .toLowerCase() || analysisProvider;
    const normalizedAsOf = normalizeFreshIsoTimestamp(
      source.asOf || source.timestamp || source.fetchedAt || '',
      quoteSource.fetchedAt || ''
    );
    const normalizedQuoteFetchedAt = normalizeFreshIsoTimestamp(
      quoteSource.fetchedAt || '',
      source.asOf || source.timestamp || source.fetchedAt || ''
    );
    const quote =
      Number.isFinite(quotePriceRaw) && quotePriceRaw > 0
        ? {
            provider: quoteProvider,
            pair: quotePair,
            priceUsd: Number(quotePriceRaw.toFixed(6)),
            fetchedAt: normalizedQuoteFetchedAt,
            sourceRequested: String(task.sourceRequested || task.source || '').trim().toLowerCase() || 'auto',
            attemptedProviders: normalizeStringArray(quoteSource.attemptedProviders || [quoteProvider], 6)
          }
        : null;

    return {
      provider: String(source.provider || analysisProvider).trim() || analysisProvider,
      traceId: String(source.traceId || task.traceId || '').trim(),
      symbol,
      timeframe,
      indicators: {
        rsi: Number.isFinite(Number(indicatorsSource.rsi)) ? Number(indicatorsSource.rsi) : null,
        macd: Number.isFinite(Number(indicatorsSource.macd)) ? Number(indicatorsSource.macd) : null,
        emaFast: Number.isFinite(Number(indicatorsSource.emaFast)) ? Number(indicatorsSource.emaFast) : null,
        emaSlow: Number.isFinite(Number(indicatorsSource.emaSlow)) ? Number(indicatorsSource.emaSlow) : null,
        atr: Number.isFinite(Number(indicatorsSource.atr)) ? Number(indicatorsSource.atr) : null
      },
      signals: {
        trend: String(signalsSource.trend || 'sideways').trim().toLowerCase() || 'sideways',
        momentum: String(signalsSource.momentum || 'neutral').trim().toLowerCase() || 'neutral',
        volatility: String(signalsSource.volatility || 'normal').trim().toLowerCase() || 'normal',
        bias: String(signalsSource.bias || defaultBias).trim().toLowerCase() || defaultBias
      },
      confidence: Number(confidence.toFixed(4)),
      riskBand: {
        stopLossPct: Number(
          clampNumber(
            riskBandSource.stopLossPct,
            0.1,
            30,
            Number.isFinite(Number(task.stopLossPct)) ? Number(task.stopLossPct) : 1.5
          ).toFixed(4)
        ),
        takeProfitPct: Number(
          clampNumber(
            riskBandSource.takeProfitPct,
            0.1,
            60,
            Number.isFinite(Number(task.takeProfitPct)) ? Number(task.takeProfitPct) : 3
          ).toFixed(4)
        )
      },
      riskScore,
      summary,
      asOf: normalizedAsOf,
      quote
    };
  }

  function averageNumbers(values = []) {
    const items = values.filter((item) => Number.isFinite(Number(item)));
    if (items.length === 0) return NaN;
    return items.reduce((sum, item) => sum + Number(item), 0) / items.length;
  }

  function computeEma(values = [], period = 14) {
    const list = values.map((item) => Number(item)).filter((item) => Number.isFinite(item));
    if (list.length < period || period < 2) return NaN;
    const k = 2 / (period + 1);
    let ema = list.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
    for (let i = period; i < list.length; i += 1) {
      ema = list[i] * k + ema * (1 - k);
    }
    return ema;
  }

  function computeRsi(values = [], period = 14) {
    const list = values.map((item) => Number(item)).filter((item) => Number.isFinite(item));
    if (list.length <= period) return NaN;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i += 1) {
      const delta = list[i] - list[i - 1];
      if (delta >= 0) gain += delta;
      else loss += Math.abs(delta);
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    for (let i = period + 1; i < list.length; i += 1) {
      const delta = list[i] - list[i - 1];
      const up = delta > 0 ? delta : 0;
      const down = delta < 0 ? Math.abs(delta) : 0;
      avgGain = (avgGain * (period - 1) + up) / period;
      avgLoss = (avgLoss * (period - 1) + down) / period;
    }
    if (avgLoss <= 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  function computeMacd(values = [], fast = 12, slow = 26) {
    const fastEma = computeEma(values, fast);
    const slowEma = computeEma(values, slow);
    if (!Number.isFinite(fastEma) || !Number.isFinite(slowEma)) return NaN;
    return fastEma - slowEma;
  }

  function computeAtr(highs = [], lows = [], closes = [], period = 14) {
    const h = highs.map((item) => Number(item));
    const l = lows.map((item) => Number(item));
    const c = closes.map((item) => Number(item));
    const len = Math.min(h.length, l.length, c.length);
    if (len <= period) return NaN;
    const trs = [];
    for (let i = 1; i < len; i += 1) {
      const high = h[i];
      const low = l[i];
      const prevClose = c[i - 1];
      if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevClose)) continue;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }
    if (trs.length < period) return NaN;
    let atr = trs.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
    for (let i = period; i < trs.length; i += 1) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
  }

  function toRiskLevel(score = 50) {
    if (score >= 80) return 'high';
    if (score >= 60) return 'elevated';
    if (score >= 35) return 'medium';
    return 'low';
  }

  function buildRiskScoreSummary(score, level, symbol, quote) {
    return `${symbol} risk score ${score}/100 (${level}) at $${quote.priceUsd} [${quote.provider}]`;
  }

  return {
    normalizeReactiveParams,
    normalizeRiskScoreParams,
    normalizeXReaderParams,
    parseExcerptMaxChars,
    extractXReaderDigest,
    clampNumber,
    normalizeStringArray,
    normalizeFreshIsoTimestamp,
    normalizeInfoAnalysisResult,
    normalizeTechnicalAnalysisResult,
    averageNumbers,
    computeEma,
    computeRsi,
    computeMacd,
    computeAtr,
    toRiskLevel,
    buildRiskScoreSummary
  };
}
