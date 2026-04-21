// Minimal LLM client wrappers for A2A agent negotiation demo.
// Two providers are wired up:
//   - Ollama Cloud (https://ollama.com/api) — used by Agent A (traveler) with kimi-k2.6:cloud
//   - BEEF API    (https://beefapi.com/v1) — used by Agent B (hotel) with gpt-5.4-mini
//
// Each returns plain assistant text. Errors are thrown — callers decide whether
// to fallback to a scripted message.

async function ollamaChat({ model, messages, maxTokens = 1200, temperature = 0.7, timeoutMs = 90_000, think = false }) {
  const key = process.env.OLLAMA_KEY;
  if (!key) throw new Error('OLLAMA_KEY missing');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch('https://ollama.com/api/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        // Kimi K2.6 uses visible chain-of-thought by default which eats token budget
        // before the user-visible content is produced. Disabling `think` gives direct answers.
        think,
        options: { temperature, num_predict: maxTokens }
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`ollama_http_${resp.status}: ${text.slice(0, 200)}`);
    }
    const json = await resp.json();
    const content = json?.message?.content || '';
    if (!content) throw new Error(`ollama_empty_response (done_reason=${json?.done_reason}): ${JSON.stringify(json).slice(0, 200)}`);
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function beefChat({ model, messages, maxTokens = 800, temperature = 0.7, timeoutMs = 60_000 }) {
  const key = process.env.BEEF_key || process.env.BEEF_KEY;
  const base = process.env.BEEF_url || process.env.BEEF_URL || 'https://beefapi.com';
  if (!key) throw new Error('BEEF_key missing');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // BEEF's proxy ignores `stream: false` and always returns SSE. Force stream:true
    // and collect deltas ourselves — that matches its actual behaviour.
    const resp = await fetch(`${base.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: true
      }),
      signal: controller.signal
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`beef_http_${resp.status}: ${text.slice(0, 200)}`);
    }
    const raw = await resp.text();
    const content = parseSseDeltas(raw);
    if (!content) throw new Error(`beef_empty_response: raw=${raw.slice(0, 200)}`);
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

// Parse an OpenAI-style SSE body and concatenate `choices[0].delta.content`.
function parseSseDeltas(sseBody) {
  let out = '';
  for (const line of sseBody.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const obj = JSON.parse(payload);
      const delta = obj?.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') out += delta;
    } catch {
      // ignore malformed chunks
    }
  }
  return out;
}

// Agent A (travel buyer) — Ollama Cloud + Kimi K2.6
export async function agentAChat(messages, opts = {}) {
  return ollamaChat({
    model: process.env.AGENT_A_LLM_MODEL || 'kimi-k2.6:cloud',
    messages,
    ...opts
  });
}

// Agent B (hotel front desk) — BEEF API + gpt-5.4-mini
export async function agentBChat(messages, opts = {}) {
  return beefChat({
    model: process.env.AGENT_B_LLM_MODEL || 'gpt-5.4-mini',
    messages,
    ...opts
  });
}

// Try to extract a trailing JSON object from a free-form message.
// Agent B is instructed to include a decision JSON block — this pulls it out.
export function extractDecisionJSON(text) {
  if (!text || typeof text !== 'string') return null;
  // Prefer code-fenced ```json blocks
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }
  // Otherwise grab the last {...} block
  const lastOpen = text.lastIndexOf('{');
  const lastClose = text.lastIndexOf('}');
  if (lastOpen !== -1 && lastClose > lastOpen) {
    const candidate = text.slice(lastOpen, lastClose + 1);
    try { return JSON.parse(candidate); } catch {}
  }
  return null;
}
