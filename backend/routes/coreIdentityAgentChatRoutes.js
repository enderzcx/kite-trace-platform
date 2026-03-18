export function registerCoreIdentityAgentChatRoutes(ctx = {}) {
  const { app, deps = {} } = ctx;
  const {
    KITE_AGENT1_ID,
    KITE_AGENT2_ID,
    PORT,
    crypto,
    getInternalAgentApiKey,
    llmAdapter,
    normalizeReactiveParams,
    readSessionRuntime,
    requireRole
  } = deps;

  app.post('/api/chat/agent', requireRole('agent'), async (req, res) => {
    const message = String(req.body?.message || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();
    const traceId = String(req.body?.traceId || `trace_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`).trim();
    const agent = String(req.body?.agent || '').trim();
    const history = Array.isArray(req.body?.history)
      ? req.body.history
          .slice(-20)
          .map((item) => ({
            role: String(item?.role || '').trim(),
            content: String(item?.content || item?.text || item?.message || '').trim()
          }))
          .filter((item) => item.content)
      : [];

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: 'message_required',
        reason: 'message is required',
        traceId
      });
    }

    try {
      const runtime = readSessionRuntime();
      const inferStopOrderIntent = ({ text = '', suggestions = [] }) => {
        const fromSuggestions = Array.isArray(suggestions)
          ? suggestions.find((item) => {
              const action = String(item?.action || '').trim().toLowerCase();
              const endpoint = String(item?.endpoint || '').trim().toLowerCase();
              return (
                action === 'place_stop_order' ||
                action === 'reactive-stop-orders' ||
                endpoint.includes('/workflow/stop-order/run') ||
                endpoint.includes('/a2a/tasks/stop-orders')
              );
            })
          : null;

        if (fromSuggestions) {
          try {
            const params = fromSuggestions?.params || fromSuggestions?.task || {};
            return normalizeReactiveParams(params);
          } catch {
            // fall through to text parser
          }
        }

        const raw = String(text || '').trim();
        if (!raw) return null;
        const triggerLike = /(stop[\s-]*order|reactive\s*stop|a2a|agent\s*to\s*agent|a\s*to\s*a|tp|sl)/i.test(raw);
        if (!triggerLike) return null;

        const symbolCandidates = Array.from(
          raw.matchAll(/\b([A-Za-z]{2,10}\s*[-/]\s*[A-Za-z]{2,10})\b/g),
          (m) => String(m?.[1] || '').replace(/\s+/g, '').replace('/', '-').toUpperCase()
        ).filter(Boolean);
        const symbolFromText =
          symbolCandidates.find((s) => /(USDT|USD|BTC|ETH|BNB|SOL)$/.test(s.split('-')[1] || '')) ||
          symbolCandidates.find((s) => s !== 'STOP-ORDER' && s !== 'TAKE-PROFIT' && s !== 'STOP-LOSS') ||
          '';
        const tpMatch = raw.match(/(?:\btp\b|take\s*profit)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        const slMatch = raw.match(/(?:\bsl\b|stop\s*loss)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        const qtyMatch = raw.match(/(?:\bqty\b|quantity|size|amount)\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
        if (!tpMatch || !slMatch) return null;

        try {
          const parsed = {
            symbol: symbolFromText || 'BTC-USDT',
            takeProfit: Number(tpMatch[1]),
            stopLoss: Number(slMatch[1])
          };
          if (qtyMatch) {
            parsed.quantity = Number(qtyMatch[1]);
          }
          return normalizeReactiveParams(parsed);
        } catch {
          return null;
        }
      };

      const runStopOrderWorkflow = async ({ intent, workflowTraceId }) => {
        const internalApiKey = getInternalAgentApiKey();
        const headers = { 'Content-Type': 'application/json' };
        if (internalApiKey) {
          headers['x-api-key'] = internalApiKey;
        }
        const payer = deps.normalizeAddress(req.body?.payer || runtime?.aaWallet || '');
        const sourceAgentId = String(req.body?.sourceAgentId || KITE_AGENT1_ID).trim();
        const targetAgentId = String(req.body?.targetAgentId || KITE_AGENT2_ID).trim();
        const workflowResp = await fetch(`http://127.0.0.1:${PORT}/api/workflow/stop-order/run`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            symbol: intent.symbol,
            takeProfit: intent.takeProfit,
            stopLoss: intent.stopLoss,
            ...(Number.isFinite(intent.quantity) ? { quantity: intent.quantity } : {}),
            payer,
            sourceAgentId,
            targetAgentId,
            traceId: workflowTraceId
          })
        });
        const workflowBody = await workflowResp.json().catch(() => ({}));
        return {
          ok: workflowResp.ok && Boolean(workflowBody?.ok),
          status: workflowResp.status,
          body: workflowBody
        };
      };

      const fallbackIntent = inferStopOrderIntent({ text: message, suggestions: [] });
      let result = await llmAdapter.chat({
        message,
        sessionId,
        traceId,
        history,
        agent,
        context: {
          aaWallet: runtime?.aaWallet || '',
          owner: runtime?.owner || '',
          runtimeReady: Boolean(runtime?.sessionAddress && runtime?.sessionPrivateKey)
        }
      });

      if (!result?.ok && fallbackIntent) {
        result = {
          ok: true,
          mode: 'intent-fallback',
          reply: 'Intent recognized. Running x402 stop-order workflow now.',
          traceId,
          state: 'intent_recognized',
          step: 'intent_parsed',
          suggestions: [
            {
              action: 'place_stop_order',
              endpoint: '/api/workflow/stop-order/run',
              params: fallbackIntent
            }
          ]
        };
      }

      if (!result?.ok) {
        return res.status(result?.statusCode || 503).json({
          ok: false,
          error: result?.error || 'llm_adapter_error',
          reason: result?.reason || 'LLM adapter failed',
          traceId: result?.traceId || traceId
        });
      }

      const resolvedSuggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
      const intent = inferStopOrderIntent({ text: message, suggestions: resolvedSuggestions });
      const nextTraceId = String(result.traceId || traceId).trim() || traceId;

      if (intent) {
        const workflow = await runStopOrderWorkflow({
          intent,
          workflowTraceId: nextTraceId
        });
        if (!workflow.ok) {
          return res.status(workflow.status || 500).json({
            ok: false,
            mode: 'x402',
            error: workflow.body?.error || 'workflow_failed',
            reason: workflow.body?.reason || `workflow failed: HTTP ${workflow.status}`,
            traceId: nextTraceId,
            state: workflow.body?.state || 'failed',
            step: 'workflow_failed'
          });
        }

        return res.json({
          ok: true,
          mode: 'x402',
          reply:
            workflow.body?.state === 'unlocked'
              ? `A2A stop-order unlocked: ${intent.symbol} TP ${intent.takeProfit} SL ${intent.stopLoss}${
                Number.isFinite(intent.quantity) ? ` QTY ${intent.quantity}` : ''
              }`
              : (result.reply || 'Workflow accepted.'),
          traceId: nextTraceId,
          sessionId: sessionId || null,
          state: workflow.body?.state || 'unlocked',
          step: workflow.body?.state === 'unlocked' ? 'workflow_unlocked' : 'workflow_running',
          requestId: workflow.body?.requestId || workflow.body?.workflow?.requestId || '',
          txHash: workflow.body?.txHash || workflow.body?.workflow?.txHash || '',
          userOpHash: workflow.body?.userOpHash || workflow.body?.workflow?.userOpHash || '',
          suggestions: resolvedSuggestions
        });
      }

      return res.json({
        ok: true,
        mode: result.mode || 'local-fallback',
        reply: result.reply || 'Received.',
        traceId: nextTraceId,
        sessionId: sessionId || null,
        state: result.state || 'received',
        step: result.step || 'chat_received',
        suggestions: resolvedSuggestions
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'chat_agent_internal_error',
        reason: error?.message || 'chat failed',
        traceId
      });
    }
  });

  app.get('/api/chat/agent/health', requireRole('viewer'), async (req, res) => {
    try {
      const adapterInfo = typeof llmAdapter.info === 'function' ? llmAdapter.info() : {};
      const health = await llmAdapter.health();
      if (!health?.ok) {
        return res.status(503).json({
          ok: false,
          error: 'llm_unreachable',
          mode: health?.mode || 'remote',
          connected: false,
          reason: health?.reason || 'LLM health check failed',
          adapter: adapterInfo,
          traceId: req.traceId || ''
        });
      }
      return res.json({
        ok: true,
        mode: health.mode || 'local-fallback',
        connected: Boolean(health.connected),
        reason: health.reason || 'ok',
        adapter: adapterInfo,
        traceId: req.traceId || ''
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'llm_health_error',
        connected: false,
        reason: error?.message || 'LLM health failed',
        traceId: req.traceId || ''
      });
    }
  });
}
