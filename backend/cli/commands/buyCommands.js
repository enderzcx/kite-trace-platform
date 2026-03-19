export function createBuyCommandHandlers({
  parseBuyRequestArgs,
  parseBuyDirectArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError,
  normalizeCapability,
  normalizeWalletAddress,
  readStructuredInput,
  ensureUsableSession,
  selectBuyService,
  normalizeBuyState
}) {
  function emitProgress(runtime, message = '') {
    const text = String(message || '').trim();
    if (!text) return;
    const outputMode = String(runtime?.outputMode || '').trim().toLowerCase();
    const prefix = outputMode === 'json' ? '[ktrace]' : 'ktrace';
    console.error(`${prefix} ${text}`);
  }

  function describeBuyStage(state = '', traceId = '') {
    const normalizedState = normalizeBuyState(state);
    if (normalizedState === 'completed') {
      return `result ready${traceId ? ` for ${traceId}` : ''}.`;
    }
    if (normalizedState === 'failed') {
      return `buy failed${traceId ? ` for ${traceId}` : ''}.`;
    }
    if (normalizedState === 'payment_pending') {
      return `payment in flight; waiting for result${traceId ? ` for ${traceId}` : ''}.`;
    }
    if (normalizedState === 'fulfilling') {
      return `payment accepted; waiting for provider result${traceId ? ` for ${traceId}` : ''}.`;
    }
    if (normalizedState) {
      return `${normalizedState}${traceId ? ` for ${traceId}` : ''}.`;
    }
    return `waiting for backend completion${traceId ? ` for ${traceId}` : ''}.`;
  }

  function createClientTraceId(prefix = 'purchase') {
    const safePrefix = String(prefix || 'purchase').trim() || 'purchase';
    const random = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
    return `${safePrefix}_${Date.now()}_${random}`;
  }

  function sleep(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
  }

  async function lookupFlowByTraceId(runtime, traceId = '') {
    const normalizedTraceId = String(traceId || '').trim();
    if (!normalizedTraceId) return null;
    const apiKey = resolveAgentTransportApiKey(runtime);
    const [purchasesPayload, invocationsPayload] = await Promise.all([
      requestJson(runtime, {
        pathname: buildQueryPath('/api/purchases', { traceId: normalizedTraceId, limit: '1' }),
        apiKey,
        timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 30_000)
      }).catch(() => null),
      requestJson(runtime, {
        pathname: buildQueryPath('/api/service-invocations', { traceId: normalizedTraceId, limit: '1' }),
        apiKey,
        timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 30_000)
      }).catch(() => null)
    ]);

    const purchase = Array.isArray(purchasesPayload?.items) ? purchasesPayload.items[0] || null : null;
    if (purchase) {
      return {
        kind: 'purchase',
        state: normalizeBuyState(purchase?.state || ''),
        requestId: String(purchase?.paymentId || '').trim(),
        txHash: String(purchase?.paymentTxHash || '').trim(),
        summary: String(purchase?.summary || '').trim(),
        error: String(purchase?.error || '').trim(),
        purchase
      };
    }

    const invocation = Array.isArray(invocationsPayload?.items) ? invocationsPayload.items[0] || null : null;
    if (invocation) {
      return {
        kind: 'invocation',
        state: normalizeBuyState(invocation?.state || ''),
        requestId: String(invocation?.requestId || '').trim(),
        txHash: String(invocation?.txHash || '').trim(),
        summary: String(invocation?.summary || '').trim(),
        error: String(invocation?.error || '').trim(),
        invocation
      };
    }

    return null;
  }

  async function pollFlowByTraceId(runtime, traceId = '', timeoutMs = 240_000) {
    const normalizedTraceId = String(traceId || '').trim();
    if (!normalizedTraceId) return null;
    const startedAt = Date.now();
    let lastState = '';
    emitProgress(runtime, `backend is still processing; polling trace ${normalizedTraceId}.`);
    while (Date.now() - startedAt <= Math.max(15_000, Number(timeoutMs || 0))) {
      const flow = await lookupFlowByTraceId(runtime, normalizedTraceId);
      if (flow) {
        const state = String(flow?.state || '').trim();
        if (state && state !== lastState) {
          emitProgress(runtime, describeBuyStage(state, normalizedTraceId));
          lastState = state;
        }
        if (['completed', 'failed'].includes(state)) {
          const receipt =
            flow?.requestId
              ? await requestJson(runtime, {
                  pathname: `/api/receipt/${encodeURIComponent(String(flow.requestId || '').trim())}`,
                  apiKey: resolveAgentTransportApiKey(runtime),
                  timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 30_000)
                }).catch(() => null)
              : null;
          return {
            purchase: flow?.purchase || null,
            invocation: flow?.invocation || null,
            receipt: receipt?.receipt || null
          };
        }
      }
      await sleep(5000);
    }
    return null;
  }

  async function handleBuyRequest(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseBuyRequestArgs(commandArgs);
    const provider = String(options.provider || '').trim();
    const capability = normalizeCapability(options.capability);
    if (!provider) {
      throw createCliError('A provider is required. Pass --provider <provider-agent-id>.', {
        code: 'provider_required'
      });
    }
    if (!capability) {
      throw createCliError('A capability is required. Pass --capability <capability>.', {
        code: 'capability_required'
      });
    }

    const wallet = normalizeWalletAddress(runtime.wallet);
    const input = await readStructuredInput(options.input);
    const traceId = String(options.traceId || createClientTraceId('buyreq')).trim();
    const preflight = await ensureUsableSession(runtime, {
      wallet,
      strategy: runtime.sessionStrategy
    });
    const servicesPayload = await requestJson(runtime, { pathname: '/api/services' });
    const service = selectBuyService(servicesPayload?.items || [], { provider, capability });
    if (!service) {
      throw createCliError(`No active service matched provider=${provider} capability=${capability}.`, {
        code: 'service_not_found',
        data: {
          provider,
          capability,
          available: Array.isArray(servicesPayload?.items)
            ? servicesPayload.items.map((item) => ({
                id: String(item?.id || '').trim(),
                providerAgentId: String(item?.providerAgentId || '').trim(),
                action: String(item?.action || '').trim()
              }))
            : []
        }
      });
    }

    const intentId = String(options.intentId || '').trim();
    const invokePayload = {
      ...input,
      traceId,
      ...(intentId ? { intentId } : {}),
      ...(wallet ? { payer: wallet } : {})
    };
    let invokeResult;
    try {
      invokeResult = await requestJson(runtime, {
        method: 'POST',
        pathname: `/api/services/${encodeURIComponent(String(service.id || '').trim())}/invoke`,
        apiKey: resolveAgentTransportApiKey(runtime),
        body: invokePayload,
        timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 90_000)
      });
    } catch (error) {
      if (String(error?.code || '').trim() === 'request_timeout') {
        const polled = await pollFlowByTraceId(runtime, traceId, 240_000);
        if (polled?.purchase || polled?.invocation) {
          const purchase = polled?.purchase || null;
          const invocation = polled?.invocation || null;
          const state = normalizeBuyState(purchase?.state || invocation?.state || '');
          invokeResult = {
            ok: state !== 'failed',
            invocationId: String(invocation?.invocationId || purchase?.purchaseId || '').trim(),
            traceId: String(invocation?.traceId || purchase?.traceId || traceId).trim(),
            requestId: String(invocation?.requestId || purchase?.paymentId || '').trim(),
            state,
            txHash: String(invocation?.txHash || purchase?.paymentTxHash || '').trim(),
            reason: String(invocation?.error || purchase?.error || invocation?.summary || purchase?.summary || '').trim(),
            workflow: null,
            receipt: polled.receipt
          };
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    const workflow = invokeResult?.workflow || {};
    const receipt = invokeResult?.receipt || {};
    const resolvedTraceId = String(invokeResult?.traceId || workflow?.traceId || traceId || '').trim();
    const requestId = String(invokeResult?.requestId || workflow?.requestId || '').trim();
    const state = normalizeBuyState(invokeResult?.state || workflow?.state || '');
    const summary = String(
      workflow?.result?.summary ||
        receipt?.result?.summary ||
        receipt?.query ||
        invokeResult?.reason ||
        ''
    ).trim();

    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'buy', action: 'request', display: 'ktrace buy request' },
      runtime,
      data: {
        preflight: {
          checked: Boolean(preflight?.checked),
          created: Boolean(preflight?.created),
          reused: Boolean(preflight?.reused),
          sessionStrategy: String(preflight?.sessionStrategy || runtime.sessionStrategy || 'managed').trim(),
          traceId: String(preflight?.traceId || '').trim()
        },
        buy: {
          lane: 'buy',
          provider: String(service?.providerAgentId || provider).trim(),
          capability: String(service?.id || service?.action || capability).trim(),
          serviceId: String(service?.id || '').trim(),
          invocationId: String(invokeResult?.invocationId || '').trim(),
          traceId: resolvedTraceId,
          state,
          quoteId: '',
          paymentRequestId: requestId,
          txHash: String(invokeResult?.txHash || workflow?.txHash || '').trim(),
          summary
        },
        workflow: workflow && typeof workflow === 'object' ? workflow : null,
        receipt: receipt && typeof receipt === 'object' ? receipt : null
      },
      message:
        summary ||
        (state === 'failed'
          ? `Buy lane failed via ${String(service?.id || '').trim()}.`
          : `Started buy lane via ${String(service?.id || '').trim()}.`)
    });
  }

  async function handleBuyDirect(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseBuyDirectArgs(commandArgs);
    const traceId = String(options.traceId || createClientTraceId('purchase')).trim();
    let templateId = String(options.templateId || '').trim();
    if (!templateId) {
      const provider = String(options.provider || '').trim();
      const capability = String(options.capability || '').trim();
      if (!provider && !capability) {
        throw createCliError('A template id or provider/capability pair is required for direct buy.', {
          code: 'template_required'
        });
      }
      const resolution = await requestJson(runtime, {
        pathname: buildQueryPath('/api/templates/resolve', {
          provider,
          capability
        }),
        apiKey: resolveAgentTransportApiKey(runtime)
      });
      templateId = String(resolution?.template?.templateId || '').trim();
      if (!templateId) {
        throw createCliError('No active template resolved for the requested provider/capability.', {
          code: 'template_not_found'
        });
      }
    }

    const wallet = normalizeWalletAddress(runtime.wallet);
    const intentId = String(options.intentId || '').trim();
    const preflight = await ensureUsableSession(runtime, {
      wallet,
      strategy: runtime.sessionStrategy
    });
    const body = {
      traceId,
      ...(intentId ? { intentId } : {}),
      ...(wallet ? { payer: wallet } : {})
    };
    if (options.input) {
      body.input = await readStructuredInput(options.input);
    }
    let payload;
    try {
      payload = await requestJson(runtime, {
        method: 'POST',
        pathname: `/api/templates/${encodeURIComponent(templateId)}/buy`,
        apiKey: resolveAgentTransportApiKey(runtime),
        body,
        timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 90_000)
      });
    } catch (error) {
      if (String(error?.code || '').trim() === 'request_timeout') {
        const polled = await pollFlowByTraceId(runtime, traceId, 240_000);
        if (polled?.purchase || polled?.invocation) {
          const invocation = polled?.invocation || null;
          payload = {
            ok: normalizeBuyState(polled?.purchase?.state || invocation?.state || '') !== 'failed',
            purchase:
              polled?.purchase ||
              {
                purchaseId: '',
                traceId: String(invocation?.traceId || traceId || '').trim(),
                templateId,
                serviceId: String(invocation?.serviceId || '').trim(),
                paymentId: String(invocation?.requestId || '').trim(),
                resultId: String(invocation?.invocationId || '').trim(),
                state: String(invocation?.state || '').trim(),
                providerAgentId: String(invocation?.providerAgentId || '').trim(),
                capabilityId: String(invocation?.serviceId || invocation?.capability || '').trim(),
                paymentTxHash: String(invocation?.txHash || '').trim(),
                receiptRef: String(invocation?.requestId || '').trim()
                  ? `/api/receipt/${encodeURIComponent(String(invocation?.requestId || '').trim())}`
                  : '',
                evidenceRef: String(invocation?.traceId || traceId || '').trim()
                  ? `/api/evidence/export?traceId=${encodeURIComponent(String(invocation?.traceId || traceId || '').trim())}`
                  : '',
                summary: String(invocation?.summary || '').trim(),
                error: String(invocation?.error || '').trim()
              },
            workflow: null,
            receipt: polled.receipt
          };
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    const purchase = payload?.purchase || {};
    const workflow = payload?.workflow || {};
    const receipt = payload?.receipt || {};

    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'buy', action: 'direct', display: 'ktrace buy direct' },
      runtime,
      data: {
        preflight: {
          checked: Boolean(preflight?.checked),
          created: Boolean(preflight?.created),
          reused: Boolean(preflight?.reused),
          sessionStrategy: String(preflight?.sessionStrategy || runtime.sessionStrategy || 'managed').trim(),
          traceId: String(preflight?.traceId || '').trim()
        },
        purchase: {
          lane: 'buy',
          purchaseId: String(purchase?.purchaseId || '').trim(),
          traceId: String(purchase?.traceId || '').trim(),
          templateId: String(purchase?.templateId || templateId).trim(),
          serviceId: String(purchase?.serviceId || '').trim(),
          paymentId: String(purchase?.paymentId || '').trim(),
          resultId: String(purchase?.resultId || '').trim(),
          state: String(purchase?.state || '').trim(),
          providerAgentId: String(purchase?.providerAgentId || '').trim(),
          capabilityId: String(purchase?.capabilityId || '').trim(),
          paymentTxHash: String(purchase?.paymentTxHash || '').trim(),
          receiptRef: String(purchase?.receiptRef || '').trim(),
          evidenceRef: String(purchase?.evidenceRef || '').trim(),
          summary: String(purchase?.summary || '').trim(),
          error: String(purchase?.error || '').trim()
        },
        workflow: workflow && typeof workflow === 'object' ? workflow : null,
        receipt: receipt && typeof receipt === 'object' ? receipt : null
      },
      message: String(purchase?.summary || 'Direct buy completed.').trim()
    });
  }

  return {
    handleBuyRequest,
    handleBuyDirect
  };
}
