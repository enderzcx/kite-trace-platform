export function createMarketAnalysisRuntime({
  averageNumbers,
  buildDemoPriceSeries,
  buildRiskScoreSummary,
  clampNumber,
  computeAtr,
  computeEma,
  computeMacd,
  computeRsi,
  fetchBtcPriceQuote,
  fetchBinanceTicker24h,
  fetchCoinGeckoBtcSnapshot,
  fetchJsonWithTimeout,
  normalizeInfoAnalysisResult,
  normalizeRiskScoreParams,
  normalizeTechnicalAnalysisResult,
  normalizeXReaderParams,
  toRiskLevel
}) {
  async function fetchFearGreedIndex() {
    const body = await fetchJsonWithTimeout('https://api.alternative.me/fng/?limit=1', 8000);
    const row = Array.isArray(body?.data) ? body.data[0] || {} : {};
    const value = Number(row?.value);
    if (!Number.isFinite(value)) throw new Error('invalid fear_and_greed value');
    return {
      provider: 'alternative-me',
      value: Math.max(0, Math.min(100, value)),
      classification: String(row?.value_classification || '').trim() || 'Unknown',
      timestamp: String(row?.timestamp || '').trim()
    };
  }

  async function fetchBinanceKlines(pair = 'BTCUSDT', interval = '1m', limit = 180) {
    const safeLimit = Math.max(30, Math.min(Number(limit || 180), 500));
    const body = await fetchJsonWithTimeout(
      `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${safeLimit}`,
      8000
    );
    if (!Array.isArray(body) || body.length === 0) throw new Error('empty klines');
    return body
      .map((row) => ({
        openTime: Number(row?.[0]),
        open: Number(row?.[1]),
        high: Number(row?.[2]),
        low: Number(row?.[3]),
        close: Number(row?.[4]),
        closeTime: Number(row?.[6])
      }))
      .filter(
        (item) =>
          Number.isFinite(item.openTime) &&
          Number.isFinite(item.closeTime) &&
          Number.isFinite(item.high) &&
          Number.isFinite(item.low) &&
          Number.isFinite(item.close) &&
          item.close > 0
      );
  }

  async function runMarketInfoAnalysis(params = {}) {
    const task = normalizeXReaderParams(params);
    const topic = String(params?.topic || task.topic || task.url || 'BTC market sentiment').trim();
    const traceId = String(params?.traceId || '').trim();
    const failures = [];

    const [binanceRes, geckoRes, fearGreedRes] = await Promise.allSettled([
      fetchBinanceTicker24h('BTCUSDT'),
      fetchCoinGeckoBtcSnapshot(),
      fetchFearGreedIndex()
    ]);

    const headlines = [];
    const keyFactors = [];
    const sentimentParts = [];

    if (binanceRes.status === 'fulfilled') {
      const changePct = Number(binanceRes.value.changePct);
      const lastPrice = Number(binanceRes.value.lastPrice);
      if (Number.isFinite(changePct)) {
        headlines.push(`Binance BTC 24h ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`);
        keyFactors.push(`Binance last ${lastPrice.toFixed(2)} USD`);
        sentimentParts.push(clampNumber(changePct / 10, -1, 1, 0));
      }
    } else {
      failures.push(`binance:${String(binanceRes.reason?.message || binanceRes.reason || 'failed').trim()}`);
    }

    if (geckoRes.status === 'fulfilled') {
      const change24h = Number(geckoRes.value.change24h);
      const currentUsd = Number(geckoRes.value.currentUsd);
      if (Number.isFinite(change24h)) {
        headlines.push(`CoinGecko BTC 24h ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`);
        keyFactors.push(`CoinGecko spot ${currentUsd.toFixed(2)} USD`);
        sentimentParts.push(clampNumber(change24h / 10, -1, 1, 0));
      }
    } else {
      failures.push(`coingecko:${String(geckoRes.reason?.message || geckoRes.reason || 'failed').trim()}`);
    }

    if (fearGreedRes.status === 'fulfilled') {
      const value = Number(fearGreedRes.value.value);
      const classification = String(fearGreedRes.value.classification || '').trim();
      if (Number.isFinite(value)) {
        headlines.push(`Fear&Greed ${Math.round(value)} (${classification || 'n/a'})`);
        keyFactors.push(`Sentiment index=${Math.round(value)} /100`);
        sentimentParts.push(clampNumber((value - 50) / 50, -1, 1, 0));
      }
    } else {
      failures.push(`feargreed:${String(fearGreedRes.reason?.message || fearGreedRes.reason || 'failed').trim()}`);
    }

    if (headlines.length === 0 && keyFactors.length === 0) {
      throw new Error(`market_info_unavailable (${failures.join('; ') || 'no data source'})`);
    }

    const sentimentScore = Number.isFinite(averageNumbers(sentimentParts))
      ? averageNumbers(sentimentParts)
      : 0;
    const confidence = clampNumber(0.35 + headlines.length * 0.12 + keyFactors.length * 0.08, 0.35, 0.92, 0.5);
    const summary = `${topic}: sentiment ${sentimentScore >= 0 ? '偏多' : '偏空'} (${sentimentScore.toFixed(2)}), confidence ${confidence.toFixed(2)}; data=binance/coingecko/feargreed`;

    return normalizeInfoAnalysisResult(
      {
        provider: 'market-data',
        traceId,
        topic,
        sentimentScore,
        confidence,
        headlines,
        keyFactors,
        summary,
        asOf: new Date().toISOString()
      },
      {
        ...task,
        traceId
      }
    );
  }

  function buildFallbackTechnicalFromQuote(task = {}, quote = null, reason = '') {
    const safeQuote =
      quote && Number.isFinite(Number(quote?.priceUsd)) && Number(quote.priceUsd) > 0
        ? quote
        : {
            provider: 'fallback',
            pair: String(task.symbol || 'BTCUSDT').trim().toUpperCase(),
            priceUsd: 0,
            fetchedAt: new Date().toISOString(),
            sourceRequested: String(task.sourceRequested || task.source || 'auto').trim().toLowerCase() || 'auto',
            attemptedProviders: []
          };
    const horizonPoints = Math.max(3, Math.min(Number(task.horizonMin || 60), 60));
    const series = buildDemoPriceSeries(horizonPoints).series;
    const prices = series.map((item) => Number(item.priceUsd)).filter((item) => Number.isFinite(item) && item > 0);
    const baselinePrice =
      prices.length > 0 ? averageNumbers(prices) : Number.isFinite(Number(safeQuote.priceUsd)) ? Number(safeQuote.priceUsd) : 0;
    const minPrice = prices.length > 0 ? Math.min(...prices) : baselinePrice;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : baselinePrice;
    const rangePct = baselinePrice > 0 ? ((maxPrice - minPrice) / baselinePrice) * 100 : 0;
    const deviationPct =
      baselinePrice > 0 ? (Math.abs(Number(safeQuote.priceUsd) - baselinePrice) / baselinePrice) * 100 : 0;
    const rawScore = 24 + rangePct * 11 + deviationPct * 8;
    const bounded = Math.max(5, Math.min(95, Math.round(rawScore)));
    const level = toRiskLevel(bounded);
    const technical = normalizeTechnicalAnalysisResult(
      {
        provider: 'market-data-fallback',
        symbol: task.symbol,
        timeframe: `${task.horizonMin}m`,
        confidence: clampNumber(1 - Math.min(0.85, rangePct / 22), 0.1, 0.9, 0.5),
        summary: buildRiskScoreSummary(bounded, level, task.symbol, safeQuote),
        riskScore: bounded,
        signals: {
          trend: deviationPct >= 1.8 ? 'directional' : 'sideways',
          momentum: deviationPct >= 1.2 ? 'active' : 'neutral',
          volatility: rangePct >= 1.8 ? 'elevated' : 'normal',
          bias: level === 'high' || level === 'elevated' ? 'defensive' : 'balanced'
        },
        indicators: {
          rsi: null,
          macd: null,
          emaFast: null,
          emaSlow: null,
          atr: Number(rangePct.toFixed(6))
        },
        riskBand: {
          stopLossPct: Number(Math.max(0.8, Math.min(3.5, 1.1 + rangePct / 3)).toFixed(4)),
          takeProfitPct: Number(Math.max(1.2, Math.min(8, 2 + rangePct * 1.8)).toFixed(4))
        },
        quote: safeQuote,
        asOf: safeQuote.fetchedAt
      },
      task
    );
    technical.rangePct = Number(rangePct.toFixed(4));
    technical.deviationPct = Number(deviationPct.toFixed(4));
    technical.sampleSize = prices.length;
    if (reason) {
      technical.summary = `${technical.summary} (fallback reason: ${String(reason).slice(0, 180)})`;
      technical.fallbackReason = String(reason).slice(0, 280);
    }
    return technical;
  }

  async function runMarketTechnicalAnalysis(task = {}, input = {}) {
    const traceId = String(input?.traceId || '').trim();
    const quote = await fetchBtcPriceQuote({
      pair: task.symbol,
      source: task.sourceRequested
    });
    const klines = await fetchBinanceKlines(task.symbol, '1m', Math.max(90, Number(task.horizonMin || 60) * 3));
    if (klines.length < 30) throw new Error('market_data_technical_klines_insufficient');

    const closes = klines.map((item) => Number(item.close)).filter((item) => Number.isFinite(item) && item > 0);
    const highs = klines.map((item) => Number(item.high)).filter((item) => Number.isFinite(item) && item > 0);
    const lows = klines.map((item) => Number(item.low)).filter((item) => Number.isFinite(item) && item > 0);
    if (closes.length < 30 || highs.length < 30 || lows.length < 30) {
      throw new Error('market_data_technical_series_invalid');
    }

    const rsi = computeRsi(closes, 14);
    const macd = computeMacd(closes, 12, 26);
    const emaFast = computeEma(closes, 12);
    const emaSlow = computeEma(closes, 26);
    const atr = computeAtr(highs, lows, closes, 14);
    const spot =
      Number.isFinite(Number(quote.priceUsd)) && Number(quote.priceUsd) > 0 ? Number(quote.priceUsd) : closes[closes.length - 1];

    const lookback = Math.max(20, Math.min(Number(task.horizonMin || 60), closes.length));
    const window = closes.slice(-lookback);
    const avgPrice = averageNumbers(window);
    const minPrice = window.length > 0 ? Math.min(...window) : spot;
    const maxPrice = window.length > 0 ? Math.max(...window) : spot;
    const rangePct = avgPrice > 0 ? ((maxPrice - minPrice) / avgPrice) * 100 : 0;
    const deviationPct = avgPrice > 0 ? (Math.abs(spot - avgPrice) / avgPrice) * 100 : 0;
    const volatilityPct = spot > 0 && Number.isFinite(atr) ? (atr / spot) * 100 : rangePct / 2;

    const trend =
      Number.isFinite(emaFast) && Number.isFinite(emaSlow)
        ? emaFast > emaSlow * 1.0005
          ? 'uptrend'
          : emaFast < emaSlow * 0.9995
            ? 'downtrend'
            : 'sideways'
        : 'sideways';
    const momentum =
      Number.isFinite(rsi) ? (rsi >= 60 ? 'bullish' : rsi <= 40 ? 'bearish' : 'neutral') : 'neutral';
    const volatility =
      volatilityPct >= 1.5 ? 'elevated' : volatilityPct <= 0.6 ? 'compressed' : 'normal';
    const bias =
      trend === 'uptrend' && momentum !== 'bearish'
        ? 'bullish'
        : trend === 'downtrend' && momentum !== 'bullish'
          ? 'bearish'
          : 'neutral';
    const confidence = clampNumber(
      0.45 +
        (Number.isFinite(rsi) ? 0.12 : 0) +
        (Number.isFinite(macd) ? 0.12 : 0) +
        (Number.isFinite(emaFast) && Number.isFinite(emaSlow) ? 0.14 : 0) +
        (Number.isFinite(atr) ? 0.09 : 0),
      0.35,
      0.92,
      0.55
    );
    const rawScore =
      20 +
      rangePct * 9 +
      deviationPct * 6 +
      (Number.isFinite(rsi) ? Math.abs(rsi - 50) * 0.45 : 8) +
      (Number.isFinite(macd) && spot > 0 ? Math.min(8, Math.abs((macd / spot) * 10000)) : 0);
    const riskScore = Math.max(5, Math.min(95, Math.round(rawScore)));
    const level = toRiskLevel(riskScore);

    const technical = normalizeTechnicalAnalysisResult(
      {
        provider: 'market-data',
        traceId,
        symbol: task.symbol,
        timeframe: `${task.horizonMin}m`,
        indicators: {
          rsi: Number.isFinite(rsi) ? Number(rsi.toFixed(4)) : null,
          macd: Number.isFinite(macd) ? Number(macd.toFixed(8)) : null,
          emaFast: Number.isFinite(emaFast) ? Number(emaFast.toFixed(6)) : null,
          emaSlow: Number.isFinite(emaSlow) ? Number(emaSlow.toFixed(6)) : null,
          atr: Number.isFinite(atr) ? Number(atr.toFixed(6)) : null
        },
        signals: {
          trend,
          momentum,
          volatility,
          bias
        },
        confidence,
        riskBand: {
          stopLossPct: Number(Math.max(0.5, Math.min(4.5, volatilityPct * 1.8)).toFixed(4)),
          takeProfitPct: Number(Math.max(1.2, Math.min(10, volatilityPct * 3.1)).toFixed(4))
        },
        riskScore,
        summary: `${task.symbol} technical risk ${riskScore}/100 (${level}), trend=${trend}, momentum=${momentum}, volatility=${volatility}`,
        asOf: new Date().toISOString(),
        quote
      },
      task
    );
    technical.rangePct = Number(rangePct.toFixed(4));
    technical.deviationPct = Number(deviationPct.toFixed(4));
    technical.sampleSize = window.length;
    return technical;
  }

  async function runRiskScoreAnalysis(input = {}) {
    const task = normalizeRiskScoreParams(input);
    let technical = null;
    let fallbackReason = '';
    try {
      technical = await runMarketTechnicalAnalysis(task, input);
    } catch (error) {
      fallbackReason = String(error?.message || 'market_data_technical_unavailable').trim();
      const quote = await fetchBtcPriceQuote({
        pair: task.symbol,
        source: task.sourceRequested
      });
      technical = buildFallbackTechnicalFromQuote(task, quote, fallbackReason);
    }

    const quote =
      technical?.quote && Number.isFinite(Number(technical.quote.priceUsd)) && Number(technical.quote.priceUsd) > 0
        ? technical.quote
        : await fetchBtcPriceQuote({
            pair: task.symbol,
            source: task.sourceRequested
          });
    const scoreRaw = Number(technical?.riskScore ?? NaN);
    const bounded = Number.isFinite(scoreRaw)
      ? Math.max(5, Math.min(95, Math.round(scoreRaw)))
      : Math.max(5, Math.min(95, Math.round(Number(technical?.confidence || 0.5) * 100)));
    const level = toRiskLevel(bounded);

    return {
      summary: String(technical?.summary || buildRiskScoreSummary(bounded, level, task.symbol, quote)).trim(),
      risk: {
        symbol: task.symbol,
        score: bounded,
        level,
        horizonMin: task.horizonMin,
        rangePct: Number(
          Number.isFinite(Number(technical?.rangePct))
            ? Number(technical.rangePct)
            : Number(technical?.indicators?.atr || 0)
        ),
        deviationPct: Number(
          Number.isFinite(Number(technical?.deviationPct))
            ? Number(technical.deviationPct)
            : Number(technical?.confidence ? Math.abs(0.5 - Number(technical.confidence)) * 2.5 : 0)
        ),
        sampleSize: Number.isFinite(Number(technical?.sampleSize)) ? Number(technical.sampleSize) : 0,
        provider: String(quote?.provider || technical?.provider || 'legacy').trim().toLowerCase()
      },
      quote,
      technical: {
        ...technical,
        ...(fallbackReason && !technical?.fallbackReason ? { fallbackReason } : {})
      }
    };
  }

  return {
    fetchFearGreedIndex,
    fetchBinanceKlines,
    runMarketInfoAnalysis,
    buildFallbackTechnicalFromQuote,
    runMarketTechnicalAnalysis,
    runRiskScoreAnalysis
  };
}
