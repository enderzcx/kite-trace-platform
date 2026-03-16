import { spawn } from 'node:child_process';
import { createCliError } from './errors.js';

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
  { method = 'GET', pathname = '', body, apiKey = '', timeoutMs: requestedTimeoutMs, omitRuntimeApiKey = false } = {}
) {
  const url = new URL(String(pathname || '').replace(/^\/+/, ''), `${runtime.baseUrl}/`);
  const headers = {
    Accept: 'application/json'
  };
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
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
