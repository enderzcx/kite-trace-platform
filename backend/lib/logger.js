function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function looksSensitiveKey(key = '') {
  const normalized = normalizeText(key).toLowerCase();
  return (
    normalized.includes('api_key') ||
    normalized.includes('apikey') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('privatekey') ||
    normalized.includes('private_key') ||
    normalized.includes('authorization')
  );
}

function maskSecretValue(value = '') {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length <= 8) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function sanitizeValue(value, key = '') {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeValue(entryValue, entryKey)
    ]);
    return Object.fromEntries(entries);
  }
  if (typeof value === 'string') {
    const normalized = normalizeText(value);
    if (looksSensitiveKey(key)) {
      return maskSecretValue(normalized);
    }
    if (/^bearer\s+/i.test(normalized)) {
      return `Bearer ${maskSecretValue(normalized.slice(7))}`;
    }
    return value;
  }
  return value;
}

function writeLog(level = 'info', entry = {}) {
  const payload = {
    level,
    timestamp: new Date().toISOString(),
    requestId: normalizeText(entry.requestId),
    traceId: normalizeText(entry.traceId),
    component: normalizeText(entry.component),
    message: normalizeText(entry.message) || 'log',
    meta: sanitizeValue(entry.meta && typeof entry.meta === 'object' ? entry.meta : {})
  };

  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
    return;
  }
  if (level === 'warn') {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}

function createRequestLogger(component = '') {
  const normalizedComponent = normalizeText(component);

  function withRequestContext(entry = {}, req = null) {
    return {
      ...entry,
      requestId: normalizeText(entry.requestId || req?.requestId || req?.traceId),
      traceId: normalizeText(entry.traceId || req?.traceId),
      component: normalizeText(entry.component || normalizedComponent)
    };
  }

  return {
    info(message = '', meta = {}, req = null) {
      writeLog('info', withRequestContext({ message, meta }, req));
    },
    warn(message = '', meta = {}, req = null) {
      writeLog('warn', withRequestContext({ message, meta }, req));
    },
    error(message = '', meta = {}, req = null) {
      writeLog('error', withRequestContext({ message, meta }, req));
    }
  };
}

export { createRequestLogger, maskSecretValue };
