import fs from 'fs';
import path from 'path';

export function cloneValue(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

export function persistenceKeyForPath(targetPath) {
  const base = String(path.basename(targetPath || '') || '').trim().toLowerCase();
  return `doc:${base}`;
}

export function ensureJsonFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, '[]', 'utf8');
  }
}

export function loadJsonArrayFromFile(targetPath) {
  ensureJsonFile(targetPath);
  try {
    const raw = fs.readFileSync(targetPath, 'utf8');
    const cleaned = raw.replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleaned || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeJsonArrayToFile(targetPath, records) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(Array.isArray(records) ? records : [], null, 2), 'utf8');
}

export function ensureJsonObjectFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, '{}', 'utf8');
  }
}

export function loadJsonObjectFromFile(targetPath) {
  ensureJsonObjectFile(targetPath);
  try {
    const raw = fs.readFileSync(targetPath, 'utf8');
    const cleaned = raw.replace(/^\uFEFF/, '');
    const parsed = JSON.parse(cleaned || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeJsonObjectToFile(targetPath, payload) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload || {}, null, 2), 'utf8');
}

export function createJsonPersistenceHelpers({
  persistenceStore,
  persistArrayCache,
  persistObjectCache,
  onPersistWriteError = (message) => console.error(message)
} = {}) {
  function queuePersistWrite(stateKey, payload) {
    if (!persistenceStore.isConnected()) return;
    persistenceStore.setDocument(stateKey, payload).catch((error) => {
      onPersistWriteError(`[persistence] failed writing ${stateKey}: ${error?.message || error}`);
    });
  }

  function readJsonArray(targetPath) {
    const stateKey = persistenceKeyForPath(targetPath);
    if (persistArrayCache.has(stateKey)) {
      return cloneValue(persistArrayCache.get(stateKey) || []);
    }
    const rows = loadJsonArrayFromFile(targetPath);
    persistArrayCache.set(stateKey, rows);
    queuePersistWrite(stateKey, rows);
    return cloneValue(rows);
  }

  function writeJsonArray(targetPath, records) {
    const stateKey = persistenceKeyForPath(targetPath);
    const rows = Array.isArray(records) ? records : [];
    persistArrayCache.set(stateKey, cloneValue(rows));
    writeJsonArrayToFile(targetPath, rows);
    queuePersistWrite(stateKey, rows);
  }

  function readJsonObject(targetPath) {
    const stateKey = persistenceKeyForPath(targetPath);
    if (persistObjectCache.has(stateKey)) {
      return cloneValue(persistObjectCache.get(stateKey) || {});
    }
    const payload = loadJsonObjectFromFile(targetPath);
    persistObjectCache.set(stateKey, payload);
    queuePersistWrite(stateKey, payload);
    return cloneValue(payload);
  }

  function writeJsonObject(targetPath, payload) {
    const stateKey = persistenceKeyForPath(targetPath);
    const normalized = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    persistObjectCache.set(stateKey, cloneValue(normalized));
    writeJsonObjectToFile(targetPath, normalized);
    queuePersistWrite(stateKey, normalized);
  }

  return {
    queuePersistWrite,
    readJsonArray,
    writeJsonArray,
    readJsonObject,
    writeJsonObject
  };
}
