export function createAgentCommandHandlers({
  parseAgentInvokeArgs,
  requestJson,
  buildQueryPath,
  resolveAgentTransportApiKey,
  createEnvelope,
  createCliError,
  normalizeCapability,
  handleBuyDirect,
  readStructuredInput,
  selectBuyService,
  sendLocalSessionPayment,
  ensureUsableSession
}) {
  function shouldRetryLocalPayment(error = null) {
    const code = String(error?.code || '').trim().toLowerCase();
    const text = [
      String(error?.message || ''),
      String(error?.data?.result?.reason || ''),
      String(error?.cause?.message || '')
    ]
      .join(' ')
      .trim()
      .toLowerCase();
    if (code !== 'local_payment_failed') return false;
    return (
      text.includes('timeout') ||
      text.includes('useroperation') ||
      text.includes('aborted') ||
      text.includes('fetch failed') ||
      text.includes('network') ||
      text.includes('socket') ||
      text.includes('tls')
    );
  }

  async function settleAgentFirstPayment(runtime, { service, quote, requestId }) {
    const maxAttempts = 2;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await sendLocalSessionPayment(runtime, {
          tokenAddress: String(quote?.tokenAddress || '').trim(),
          recipient: String(quote?.recipient || '').trim(),
          amount: String(quote?.amount || '').trim(),
          requestId,
          action: String(service?.action || service?.id || '').trim(),
          query: String(service?.name || service?.action || service?.id || '').trim()
        });
      } catch (error) {
        lastError = error;
        if (!shouldRetryLocalPayment(error) || attempt >= maxAttempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    throw lastError || createCliError('Local session payment failed.', {
      code: 'local_payment_failed'
    });
  }

  function shouldRetryProofSubmit(error = null) {
    const code = String(error?.code || '').trim().toLowerCase();
    const text = [
      String(error?.message || ''),
      String(error?.data?.reason || ''),
      String(error?.cause?.message || '')
    ]
      .join(' ')
      .trim()
      .toLowerCase();
    return (
      code === 'request_failed' ||
      code === 'request_timeout' ||
      text.includes('timeout') ||
      text.includes('aborted') ||
      text.includes('fetch failed') ||
      text.includes('network') ||
      text.includes('socket') ||
      text.includes('tls')
    );
  }

  async function submitAgentFirstProof(
    runtime,
    {
      service,
      invokeBody,
      requestId,
      payment
    } = {}
  ) {
    const maxAttempts = 2;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await requestJson(runtime, {
          method: 'POST',
          pathname: `/api/services/${encodeURIComponent(String(service?.id || '').trim())}/invoke`,
          apiKey: resolveAgentTransportApiKey(runtime),
          body: {
            ...invokeBody,
            requestId,
            paymentProof: payment?.paymentProof || null,
            paymentUserOpHash: String(payment?.payment?.userOpHash || '').trim()
          },
          timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 180_000)
        });
      } catch (error) {
        lastError = error;
        if (!shouldRetryProofSubmit(error) || attempt >= maxAttempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    throw lastError || createCliError('Agent-first proof submission failed.', {
      code: 'agent_first_proof_submit_failed'
    });
  }

  function createClientTraceId(prefix = 'service') {
    const safePrefix = String(prefix || 'service').trim() || 'service';
    const random = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
    return `${safePrefix}_${Date.now()}_${random}`;
  }

  async function tryLoadEvidence(runtime, traceId = '') {
    const normalizedTraceId = String(traceId || '').trim();
    if (!normalizedTraceId) return null;
    const transportApiKey = resolveAgentTransportApiKey(runtime);
    try {
      const payload = await requestJson(runtime, {
        pathname: buildQueryPath('/api/evidence/export', { traceId: normalizedTraceId }),
        apiKey: transportApiKey
      });
      return payload?.evidence || null;
    } catch {
      try {
        const payload = await requestJson(runtime, {
          pathname: `/api/public/evidence/${encodeURIComponent(normalizedTraceId)}`,
          omitRuntimeApiKey: true
        });
        return payload?.evidence || null;
      } catch {
        return null;
      }
    }
  }

  async function resolveAgentInvokeSelection(runtime, options = {}) {
    const provider = String(options.provider || '').trim();
    const capability = normalizeCapability(options.capability);
    if (provider) {
      try {
        const payload = await requestJson(runtime, {
          pathname: buildQueryPath('/api/v1/discovery/recommend-direct-buy', {
            provider,
            capability,
            verified: String(options.verified || '').trim(),
            discoverable: String(options.discoverable || '').trim()
          }),
          apiKey: resolveAgentTransportApiKey(runtime)
        });
        return {
          provider,
          selection: payload?.selection || null,
          template: payload?.template || null
        };
      } catch {
        return { provider, selection: null, template: null };
      }
    }

    const payload = await requestJson(runtime, {
      pathname: buildQueryPath('/api/v1/discovery/recommend-direct-buy', {
        capability,
        verified: String(options.verified || '').trim() || 'true',
        discoverable: String(options.discoverable || '').trim() || 'true'
      }),
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    const resolvedProvider = String(
      payload?.selection?.provider?.providerId || payload?.template?.providerAgentId || ''
    ).trim();
    return {
      provider: resolvedProvider,
      selection: payload?.selection || null,
      template: payload?.template || null
    };
  }

  function isAgentFirstEligible(runtime = {}, service = {}) {
    const strategy = String(runtime?.sessionStrategy || '').trim().toLowerCase();
    const provider = String(service?.providerKey || service?.providerAgentId || '').trim().toLowerCase();
    return strategy === 'external' && ['fundamental-agent-real', 'technical-agent-real', 'data-node-real'].includes(provider);
  }

  async function resolveService(runtime, { provider = '', capability = '', template = null } = {}) {
    if (template?.serviceId) {
      const servicePayload = await requestJson(runtime, {
        pathname: `/api/services/${encodeURIComponent(String(template.serviceId || '').trim())}`,
        apiKey: resolveAgentTransportApiKey(runtime)
      });
      return servicePayload?.service || null;
    }

    const servicesPayload = await requestJson(runtime, {
      pathname: '/api/services',
      apiKey: resolveAgentTransportApiKey(runtime)
    });
    return selectBuyService(servicesPayload?.items || [], {
      provider,
      capability
    });
  }

  async function invokeAgentFirst(runtime, { service, input, traceId = '', payer = '' } = {}) {
    const invokeBody = {
      ...(input && typeof input === 'object' ? input : {}),
      traceId,
      payer,
      x402Mode: 'agent'
    };

    try {
      return await requestJson(runtime, {
        method: 'POST',
        pathname: `/api/services/${encodeURIComponent(String(service?.id || '').trim())}/invoke`,
        apiKey: resolveAgentTransportApiKey(runtime),
        body: invokeBody,
        timeoutMs: Math.max(Number(runtime.timeoutMs || 0), 180_000)
      });
    } catch (error) {
      const payload = error?.data && typeof error.data === 'object' ? error.data : null;
      if (String(error?.code || '').trim() !== 'payment_required' && Number(error?.statusCode || 0) !== 402) {
        throw error;
      }
      const x402 = payload?.x402 && typeof payload.x402 === 'object' ? payload.x402 : null;
      const accepts = Array.isArray(x402?.accepts) ? x402.accepts : [];
      const quote = accepts[0] || {};
      const requestId = String(payload?.requestId || x402?.requestId || '').trim();
      if (!requestId || !quote?.tokenAddress || !quote?.recipient || !quote?.amount) {
        throw createCliError('Backend returned an incomplete agent-first x402 challenge.', {
          code: 'agent_first_payment_challenge_invalid',
          data: payload
        });
      }
      const payment = await settleAgentFirstPayment(runtime, {
        service,
        quote,
        requestId
      });
      return await submitAgentFirstProof(runtime, {
        service,
        invokeBody,
        requestId,
        payment
      });
    }
  }

  async function handleAgentInvoke(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseAgentInvokeArgs(commandArgs);
    const capability = normalizeCapability(options.capability);
    if (!capability && !String(options.provider || '').trim()) {
      throw createCliError('A capability or provider is required. Pass --capability <capability>.', {
        code: 'agent_invoke_inputs_required'
      });
    }

    const recommendation = await resolveAgentInvokeSelection(runtime, options);
    const provider = String(recommendation?.provider || options.provider || '').trim();
    if (!provider) {
      throw createCliError('No provider matched the requested capability.', {
        code: 'agent_invoke_provider_not_found',
        data: {
          capability,
          verified: String(options.verified || '').trim() || 'true',
          discoverable: String(options.discoverable || '').trim() || 'true'
        }
      });
    }

    const service = await resolveService(runtime, {
      provider,
      capability,
      template: recommendation?.template || null
    });
    if (!service) {
      throw createCliError('No active service matched the requested provider/capability.', {
        code: 'agent_invoke_service_not_found',
        data: {
          provider,
          capability
        }
      });
    }

    const traceId = String(options.traceId || createClientTraceId('service')).trim();
    const input = String(options.input || '').trim() ? await readStructuredInput(options.input) : {};
    const preflight = await ensureUsableSession(runtime, {
      wallet: '',
      strategy: runtime.sessionStrategy
    });

    if (!isAgentFirstEligible(runtime, service)) {
      const directArgs = [];
      const templateId = String(recommendation?.template?.templateId || '').trim();
      if (templateId) {
        directArgs.push('--template', templateId);
      } else {
        directArgs.push('--provider', provider);
        if (capability) {
          directArgs.push('--capability', capability);
        }
      }
      if (String(options.input || '').trim()) {
        directArgs.push('--input', String(options.input || '').trim());
      }
      if (traceId) {
        directArgs.push('--trace-id', traceId);
      }

      const buyEnvelope = await handleBuyDirect(runtimeBundle, directArgs);
      const purchase = buyEnvelope?.data?.purchase || {};
      const purchaseTraceId = String(purchase?.traceId || '').trim();
      const evidence = await tryLoadEvidence(runtime, purchaseTraceId);
      const paymentTxHash = String(
        purchase?.paymentTxHash ||
          buyEnvelope?.data?.receipt?.txHash ||
          evidence?.x402?.paymentProof?.txHash ||
          ''
      ).trim();
      return createEnvelope({
        ok: Boolean(buyEnvelope?.ok),
        exitCode: Number(buyEnvelope?.exitCode || 0),
        command: { family: 'agent', action: 'invoke', display: 'ktrace agent invoke' },
        runtime,
        data: {
          agentInvocation: {
            mode: 'backend-buy-fallback',
            provider,
            capabilityId: String(purchase?.capabilityId || capability || '').trim(),
            traceId: purchaseTraceId,
            state: String(purchase?.state || '').trim(),
            paymentTxHash: paymentTxHash || null,
            evidenceReady: Boolean(evidence)
          },
          selection: recommendation?.selection || null,
          template: recommendation?.template || null,
          service,
          preflight: buyEnvelope?.data?.preflight || preflight,
          purchase,
          workflow: buyEnvelope?.data?.workflow || null,
          receipt: buyEnvelope?.data?.receipt || null,
          evidence
        },
        message:
          String(purchase?.summary || '').trim() ||
          String(buyEnvelope?.message || '').trim() ||
          `Invoked ${capability || provider}.`
      });
    }

    const payer = String(preflight?.session?.aaWallet || service?.aaWallet || '').trim();
    const payload = await invokeAgentFirst(runtime, {
      service,
      input,
      traceId,
      payer
    });
    const evidence = await tryLoadEvidence(runtime, String(payload?.traceId || traceId).trim());

    return createEnvelope({
      ok: true,
      exitCode: 0,
      command: { family: 'agent', action: 'invoke', display: 'ktrace agent invoke' },
      runtime,
      data: {
        agentInvocation: {
          mode: 'agent-first',
          provider,
          capabilityId: String(service?.action || capability || service?.id || '').trim(),
          traceId: String(payload?.traceId || traceId).trim(),
          state: String(payload?.state || payload?.workflow?.state || '').trim(),
          paymentTxHash: String(payload?.txHash || payload?.receipt?.txHash || evidence?.x402?.paymentProof?.txHash || '').trim() || null,
          evidenceReady: Boolean(evidence)
        },
        selection: recommendation?.selection || null,
        template: recommendation?.template || null,
        service,
        preflight,
        invocation: {
          invocationId: String(payload?.invocationId || '').trim(),
          serviceId: String(payload?.serviceId || service?.id || '').trim(),
          requestId: String(payload?.requestId || '').trim(),
          txHash: String(payload?.txHash || '').trim(),
          userOpHash: String(payload?.userOpHash || '').trim()
        },
        workflow: payload?.workflow || null,
        receipt: payload?.receipt || null,
        result: payload?.result || null,
        evidence,
        cliGuide: {
          purpose: 'Agent-first invoke with local AA session signing',
          followups: traceId
            ? [`ktrace artifact evidence ${String(payload?.traceId || traceId).trim()}`]
            : ['ktrace discovery select --capability <capability-id>'],
          notes: [
            'This invoke used a local session key; the backend only verified proof and served the result.',
            'Use session request plus session wait to complete the agent-first approval flow before the first invoke.'
          ]
        }
      },
      message:
        String(payload?.receipt?.result?.summary || payload?.workflow?.result?.summary || '').trim() ||
        `Invoked ${capability || provider}.`
    });
  }

  return {
    handleAgentInvoke
  };
}
