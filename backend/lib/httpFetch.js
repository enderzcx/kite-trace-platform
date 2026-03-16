export async function fetchTextWithTimeout(url, timeoutMs = 8000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const method = String(options?.method || 'GET').trim().toUpperCase() || 'GET';
    const headers = options?.headers || {};
    const reqInit = {
      method,
      headers,
      signal: controller.signal
    };
    if (options?.body !== undefined) {
      reqInit.body = options.body;
    }
    const resp = await fetch(url, reqInit);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

export function createXReaderDigestFetcher({
  analysisProvider,
  normalizeXReaderParams,
  runInfoAnalysis
}) {
  return async function fetchXReaderDigest(params = {}) {
    const task = normalizeXReaderParams(params);
    const info = await runInfoAnalysis({
      ...task,
      traceId: String(params?.traceId || '').trim()
    });
    const providerRaw = String(info?.provider || analysisProvider).trim().toLowerCase() || analysisProvider;
    const attemptedProviders = providerRaw
      .split('+')
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    const headline = Array.isArray(info.headlines) && info.headlines.length > 0 ? info.headlines[0] : '';
    const factor = Array.isArray(info.keyFactors) && info.keyFactors.length > 0 ? info.keyFactors[0] : '';
    const excerpt = String(info.summary || factor || headline || '').trim().slice(0, task.maxChars);
    return {
      provider: info.provider || analysisProvider,
      backend: providerRaw || analysisProvider,
      url: task.url,
      topic: task.topic,
      inputType: task.inputType,
      title: String(headline || '').trim(),
      excerpt,
      contentLength: excerpt.length,
      fetchedAt: info.asOf || new Date().toISOString(),
      mode: task.mode,
      maxChars: task.maxChars,
      sourceRequested: task.mode,
      attemptedProviders: attemptedProviders.length > 0 ? attemptedProviders : [analysisProvider],
      analysis: info
    };
  };
}
