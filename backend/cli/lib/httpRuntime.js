import { spawn } from 'node:child_process';
import { createCliError } from './errors.js';

function shouldRetryCliTransportError(error = null) {
  const text = [
    String(error?.message || ''),
    String(error?.code || ''),
    String(error?.cause?.message || ''),
    String(error?.cause?.code || '')
  ]
    .join(' ')
    .trim()
    .toLowerCase();
  if (!text) return false;
  return (
    text.includes('fetch failed') ||
    text.includes('timeout') ||
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('und_err_socket') ||
    text.includes('und_err_connect_timeout') ||
    text.includes('socket') ||
    text.includes('network') ||
    text.includes('tls')
  );
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

export function resolveAdminTransportApiKey(runtime = {}) {
  const configuredKey = String(runtime?.apiKey || '').trim();
  const envAdmin = String(process.env.KITECLAW_API_KEY_ADMIN || '').trim();
  const envAgent = String(process.env.KITECLAW_API_KEY_AGENT || '').trim();
  const envViewer = String(process.env.KITECLAW_API_KEY_VIEWER || '').trim();

  if (!envAdmin) {
    return configuredKey;
  }

  if (!configuredKey || configuredKey === envViewer || configuredKey === envAgent) {
    return envAdmin;
  }

  return configuredKey;
}

export function resolveAgentTransportApiKey(runtime = {}) {
  const configuredKey = String(runtime?.apiKey || '').trim();
  const envAdmin = String(process.env.KITECLAW_API_KEY_ADMIN || '').trim();
  const envAgent = String(process.env.KITECLAW_API_KEY_AGENT || '').trim();
  const envViewer = String(process.env.KITECLAW_API_KEY_VIEWER || '').trim();

  if (!configuredKey) {
    return envAgent || envAdmin || '';
  }
  if (configuredKey === envViewer) {
    return envAgent || envAdmin || configuredKey;
  }
  return configuredKey;
}

export async function requestJson(
  runtime,
  {
    method = 'GET',
    pathname = '',
    body,
    apiKey = '',
    timeoutMs: requestedTimeoutMs,
    omitRuntimeApiKey = false,
    headers: extraHeaders = {}
  } = {}
) {
  const normalizedMethod = String(method || 'GET').trim().toUpperCase() || 'GET';
  const url = new URL(String(pathname || '').replace(/^\/+/, ''), `${runtime.baseUrl}/`);
  const headers = {
    Accept: 'application/json'
  };
  for (const [key, value] of Object.entries(extraHeaders || {})) {
    const headerName = String(key || '').trim();
    const headerValue = String(value ?? '').trim();
    if (!headerName || !headerValue) continue;
    headers[headerName] = headerValue;
  }
  const transportApiKey = omitRuntimeApiKey
    ? String(apiKey || '').trim()
    : String(apiKey || runtime.apiKey || '').trim();
  if (transportApiKey) {
    headers['x-api-key'] = transportApiKey;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const timeoutMs = Number(requestedTimeoutMs || runtime.timeoutMs || 30000);
  let response;
  const maxAttempts = normalizedMethod === 'GET' ? 3 : 1;
  const retryBackoffMs = [250, 900];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(url, {
        method: normalizedMethod,
        headers,
        signal: controller.signal,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      break;
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      const retryable = normalizedMethod === 'GET' && shouldRetryCliTransportError(error);
      if (attempt < maxAttempts && retryable) {
        await wait(retryBackoffMs[Math.min(attempt - 1, retryBackoffMs.length - 1)]);
        continue;
      }
      if (timedOut) {
        throw createCliError(`Request timed out after ${timeoutMs}ms.`, {
          code: 'request_timeout'
        });
      }
      throw createCliError(`Request failed: ${error?.message || String(error || 'request_failed')}`, {
        code: 'request_failed'
      });
    } finally {
      clearTimeout(timer);
    }
  }

  let payload = {};
  const rawText = await response.text();
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = {
        ok: false,
        error: 'invalid_json',
        reason: rawText.slice(0, 240)
      };
    }
  }

  if (!response.ok || payload?.ok === false) {
    throw createCliError(payload?.reason || `HTTP ${response.status}`, {
      code: payload?.error || `http_${response.status}`,
      statusCode: response.status,
      data: payload
    });
  }

  return payload;
}

export async function requestOptionalJson(runtime, options = {}) {
  try {
    return await requestJson(runtime, options);
  } catch (error) {
    if (Number(error?.statusCode || 0) === 404) {
      return null;
    }
    throw error;
  }
}

export async function runPowerShellScript(scriptPath = '', args = []) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
      {
        windowsHide: true
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          createCliError(
            String(stderr || stdout || `PowerShell script failed with exit code ${code}.`).trim(),
            {
              code: 'script_failed',
              data: {
                exitCode: code,
                stdout: String(stdout || '').trim(),
                stderr: String(stderr || '').trim()
              }
            }
          )
        );
        return;
      }
      resolve({
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim()
      });
    });
  });
}

export function buildQueryPath(pathname = '', query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    params.set(key, text);
  }
  const suffix = params.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}
