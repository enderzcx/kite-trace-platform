import fs from 'fs';
import path from 'path';

export function resolveSharedTokenFromMarkdown(repoRoot = '') {
  const normalizedRoot = String(repoRoot || '').trim();
  if (!normalizedRoot) return '';
  const explicitCandidates = [
    path.resolve(normalizedRoot, '重要信息.md'),
    path.resolve(normalizedRoot, 'IMPORTANT.md'),
    path.resolve(normalizedRoot, 'IMPORTANT_INFO.md')
  ];
  const visited = new Set();
  for (const targetPath of explicitCandidates) {
    const normalizedPath = path.normalize(targetPath);
    if (visited.has(normalizedPath)) continue;
    visited.add(normalizedPath);
    try {
      if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isFile()) continue;
      const lines = fs.readFileSync(normalizedPath, 'utf8').split(/\r?\n/);
      const matchedLines = lines
        .map((line) => String(line || '').trim())
        .filter((line) => /^OPENNEWS_TOKEN\/TWITTER_TOKEN\s*=/.test(line));
      const matched = matchedLines.length > 0 ? matchedLines[matchedLines.length - 1] : '';
      if (!matched) continue;
      const token = String(matched.split('=', 2)[1] || '').trim();
      if (token) return token;
    } catch {
      // ignore token file read failure
    }
  }
  try {
    const mdFiles = fs
      .readdirSync(normalizedRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
      .map((entry) => path.resolve(normalizedRoot, entry.name));
    for (const mdPath of mdFiles) {
      const normalizedPath = path.normalize(mdPath);
      if (visited.has(normalizedPath)) continue;
      visited.add(normalizedPath);
      try {
        const lines = fs.readFileSync(normalizedPath, 'utf8').split(/\r?\n/);
        const matchedLines = lines
          .map((line) => String(line || '').trim())
          .filter((line) => /^OPENNEWS_TOKEN\/TWITTER_TOKEN\s*=/.test(line));
        const matched = matchedLines.length > 0 ? matchedLines[matchedLines.length - 1] : '';
        if (!matched) continue;
        const token = String(matched.split('=', 2)[1] || '').trim();
        if (token) return token;
      } catch {
        // ignore per-file read failures
      }
    }
  } catch {
    // ignore root read failures
  }
  return '';
}

export function hydrateMessageProviderTokenFromLocalDocs() {
  const hasOpenNewsToken = Boolean(String(process.env.OPENNEWS_TOKEN || '').trim());
  const hasTwitterToken = Boolean(String(process.env.TWITTER_TOKEN || '').trim());
  const hasSharedToken = Boolean(String(process.env.KITE_MESSAGE_PROVIDER_TOKEN || '').trim());
  if (hasOpenNewsToken || hasTwitterToken || hasSharedToken) return;
  const repoRoot = path.resolve(process.cwd(), '..');
  const token = resolveSharedTokenFromMarkdown(repoRoot);
  if (!token) return;
  process.env.OPENNEWS_TOKEN = token;
  process.env.TWITTER_TOKEN = token;
}

export function toBoundedIntEnv(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.max(min, Math.min(rounded, max));
}

export function normalizeBackoffPolicy({
  baseMs = 0,
  maxMs = 0,
  jitterMs = 0,
  factor = 2,
  maxFactor = 6
} = {}) {
  const base = Math.max(0, Number(baseMs) || 0);
  const max = Math.max(base, Number(maxMs) || 0);
  const jitter = Math.min(max, Math.max(0, Number(jitterMs) || 0));
  const boundedMaxFactor = Math.max(1, Number(maxFactor) || 6);
  const retryFactor = Math.max(1, Math.min(Number(factor) || 1, boundedMaxFactor));
  return {
    baseMs: base,
    maxMs: max,
    jitterMs: jitter,
    factor: retryFactor
  };
}

export function parseEnvCsvList(raw = '') {
  return String(raw || '')
    .split(/[,\|]/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

export function parseEnvAgentModelMap(raw = '') {
  const map = {};
  const text = String(raw || '').trim();
  if (!text) return map;
  const pairs = text.split(/[;,]/);
  for (const pair of pairs) {
    const [left, right] = String(pair || '').split('=', 2);
    const key = String(left || '').trim().toLowerCase();
    const value = String(right || '').trim();
    if (!key || !value) continue;
    map[key] = value;
  }
  return map;
}

export function parseEnvAgentFallbackModelMap(raw = '') {
  const map = {};
  const text = String(raw || '').trim();
  if (!text) return map;
  const pairs = text.split(';');
  for (const pair of pairs) {
    const [left, right] = String(pair || '').split('=', 2);
    const key = String(left || '').trim().toLowerCase();
    const values = parseEnvCsvList(right);
    if (!key || values.length === 0) continue;
    map[key] = values;
  }
  return map;
}

export function parseAgentIdList(input = '') {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
  }
  return String(input || '')
    .split(',')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
}
