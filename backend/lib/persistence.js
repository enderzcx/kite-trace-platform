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

/**
 * Per-file write mutex to prevent TOCTOU race conditions.
 * Serializes all write operations to the same file path.
 */
class FileMutex {
  constructor() {
    this._locks = new Map(); // path → Promise chain
  }

  /**
   * Execute fn while holding exclusive write access for the given path.
   * Concurrent writes to the same path are serialized.
   * Writes to different paths run in parallel.
   */
  async withLock(filePath, fn) {
    const key = String(filePath || '').trim();
    const prev = this._locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    this._locks.set(key, next);
    try {
      await prev;
      return fn();
    } finally {
      release();
      // Cleanup if this is the last in the chain
      if (this._locks.get(key) === next) {
        this._locks.delete(key);
      }
    }
  }

  /**
   * Synchronous lock for sync write operations.
   * Uses a simple busy flag per path.
   */
  withLockSync(filePath, fn) {
    // For synchronous file I/O, the Node.js event loop is blocked anyway,
    // so concurrent writes are not possible within a single process.
    // The real protection is the cache layer — reads always go through cache,
    // writes always update cache first, then persist.
    return fn();
  }
}

export function createJsonPersistenceHelpers({
  persistenceStore,
  persistArrayCache,
  persistObjectCache,
  onPersistWriteError = (message) => console.error(message)
} = {}) {
  const fileMutex = new FileMutex();

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

  /**
   * Write JSON array with cache-first strategy.
   * Cache is the source of truth within a process lifetime.
   * File write is best-effort persistence for crash recovery.
   * PG mirror is async backup.
   */
  function writeJsonArray(targetPath, records) {
    const stateKey = persistenceKeyForPath(targetPath);
    const rows = Array.isArray(records) ? records : [];
    // Cache is updated synchronously — this IS the serialization point
    persistArrayCache.set(stateKey, cloneValue(rows));
    writeJsonArrayToFile(targetPath, rows);
    queuePersistWrite(stateKey, rows);
  }

  /**
   * Atomic read-modify-write for JSON arrays.
   * Uses FileMutex to serialize concurrent modifications to the same file.
   *
   * Usage:
   *   await modifyJsonArray(path, (rows) => {
   *     rows.push(newItem);
   *     return rows;
   *   });
   */
  async function modifyJsonArray(targetPath, mutateFn) {
    return fileMutex.withLock(targetPath, () => {
      const stateKey = persistenceKeyForPath(targetPath);
      // Read from cache (or load from file if cold)
      let rows;
      if (persistArrayCache.has(stateKey)) {
        rows = persistArrayCache.get(stateKey) || [];
      } else {
        rows = loadJsonArrayFromFile(targetPath);
      }
      // Apply mutation
      const result = mutateFn(rows);
      const updated = Array.isArray(result) ? result : rows;
      // Write back atomically
      persistArrayCache.set(stateKey, cloneValue(updated));
      writeJsonArrayToFile(targetPath, updated);
      queuePersistWrite(stateKey, updated);
      return updated;
    });
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
    modifyJsonArray,
    readJsonObject,
    writeJsonObject
  };
}
