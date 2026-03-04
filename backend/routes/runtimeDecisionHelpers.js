export function createRuntimeDecisionHelpers(deps = {}) {
  const {
    KITE_AGENT2_AA_ADDRESS,
    SETTLEMENT_TOKEN,
    computeServiceReputation,
    defaultAgentIdByCapability,
    mapServiceReceipt,
    readServiceInvocations,
    readWorkflows,
    readX402Requests,
    selectServiceCandidatesByCapability,
    toPriceNumber
  } = deps;

  function getTaskEnvelopeInput(envelope = {}) {
    return envelope?.input && typeof envelope.input === 'object' && !Array.isArray(envelope.input)
      ? envelope.input
      : {};
  }

  function buildTaskPaymentFromIntent(envelope = {}) {
    const paymentIntent =
      envelope?.paymentIntent && typeof envelope.paymentIntent === 'object' && !Array.isArray(envelope.paymentIntent)
        ? envelope.paymentIntent
        : {};
    const requestId = String(paymentIntent.requestId || envelope?.requestId || '').trim();
    const txHash = String(paymentIntent.txHash || '').trim();
    const block = Number.isFinite(Number(paymentIntent.block)) ? Number(paymentIntent.block) : null;
    const status = String(paymentIntent.status || '').trim().toLowerCase();
    const explorer = String(paymentIntent.explorer || '').trim();
    const verifiedAt = String(paymentIntent.verifiedAt || '').trim();
    return {
      mode: String(paymentIntent.mode || 'mock').trim().toLowerCase() || 'mock',
      requestId,
      txHash,
      block,
      status,
      explorer,
      verifiedAt
    };
  }

  function buildTaskReceiptRef(payment = {}) {
    const requestId = String(payment?.requestId || '').trim();
    const txHash = String(payment?.txHash || '').trim();
    const block = Number.isFinite(Number(payment?.block)) ? Number(payment.block) : null;
    const status = String(payment?.status || '').trim().toLowerCase();
    const explorer = String(payment?.explorer || '').trim();
    const verifiedAt = String(payment?.verifiedAt || '').trim();
    return {
      requestId,
      txHash,
      block,
      status,
      explorer,
      verifiedAt,
      endpoint: requestId ? `/api/receipt/${requestId}` : ''
    };
  }

  function normalizeTaskFailure(error = null, fallbackCode = 'task_failed') {
    const code = String(error?.code || fallbackCode || 'task_failed').trim().toLowerCase() || 'task_failed';
    const reason = String(error?.message || code).trim() || code;
    return { code, reason };
  }

  function pickBestServiceByReputationAndPrice(services = []) {
    const rows = Array.isArray(services) ? services : [];
    if (rows.length === 0) return null;
    const priceValues = rows.map((item) => toPriceNumber(item?.service?.price, NaN)).filter((value) => Number.isFinite(value) && value > 0);
    const minPrice = priceValues.length > 0 ? Math.min(...priceValues) : NaN;
    const maxPrice = priceValues.length > 0 ? Math.max(...priceValues) : NaN;

    const ranked = rows.map((item) => {
      const reputation = Number(item?.reputation?.score ?? 0);
      const price = toPriceNumber(item?.service?.price, NaN);
      let priceScore = 100;
      if (Number.isFinite(price) && Number.isFinite(minPrice) && Number.isFinite(maxPrice) && maxPrice > minPrice) {
        priceScore = ((maxPrice - price) / (maxPrice - minPrice)) * 100;
      }
      const finalScore = Number((reputation * 0.7 + priceScore * 0.3).toFixed(4));
      return {
        ...item,
        metrics: {
          reputationScore: Number(reputation.toFixed(4)),
          priceScore: Number(priceScore.toFixed(4)),
          finalScore
        }
      };
    });

    ranked.sort((a, b) => {
      const diff = Number(b?.metrics?.finalScore || 0) - Number(a?.metrics?.finalScore || 0);
      if (Math.abs(diff) > 1e-9) return diff > 0 ? 1 : -1;
      const slaA = Number(a?.service?.slaMs || 0);
      const slaB = Number(b?.service?.slaMs || 0);
      return slaA - slaB;
    });
    return ranked[0] || null;
  }

  function buildBestServiceQuote({ wantedCapability = '', preferredAgentId = '' } = {}) {
    const services = selectServiceCandidatesByCapability(wantedCapability);
    if (services.length === 0) return null;
    const invocations = readServiceInvocations();
    const workflows = readWorkflows();
    const workflowByTraceId = new Map(workflows.map((item) => [String(item?.traceId || '').trim(), item]));
    const requests = readX402Requests();
    const requestById = new Map(requests.map((item) => [String(item?.requestId || '').trim(), item]));
    const preferred = String(preferredAgentId || '').trim().toLowerCase();

    const rows = services.map((service) => {
      const perServiceInv = invocations.filter(
        (item) => String(item?.serviceId || '').trim() === String(service?.id || '').trim()
      );
      const receipts = perServiceInv.map((item) => mapServiceReceipt(item, workflowByTraceId, requestById));
      const reputation = computeServiceReputation(service, receipts);
      const providerAgentId = String(service?.providerAgentId || '').trim().toLowerCase();
      return {
        service,
        reputation,
        providerAgentId
      };
    });

    const filtered = preferred ? rows.filter((item) => item.providerAgentId === preferred) : rows;
    const picked = pickBestServiceByReputationAndPrice(filtered.length > 0 ? filtered : rows);
    if (!picked?.service) return null;
    return {
      serviceId: String(picked.service.id || '').trim(),
      providerAgentId: String(picked.service.providerAgentId || defaultAgentIdByCapability(wantedCapability)).trim(),
      capability: String(wantedCapability || '').trim().toLowerCase(),
      price: String(picked.service.price || '').trim(),
      tokenAddress: String(picked.service.tokenAddress || SETTLEMENT_TOKEN || '').trim(),
      recipient: String(picked.service.recipient || KITE_AGENT2_AA_ADDRESS || '').trim(),
      slaMs: Number.isFinite(Number(picked.service.slaMs)) ? Number(picked.service.slaMs) : 12000,
      validForSec: 180,
      metrics: picked.metrics
    };
  }

  function parseJsonObjectFromText(text = '') {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      try {
        const parsed = JSON.parse(String(fenced[1] || '').trim());
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {}
    }
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        const parsed = JSON.parse(raw.slice(first, last + 1));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return null;
  }

  return {
    buildBestServiceQuote,
    buildTaskPaymentFromIntent,
    buildTaskReceiptRef,
    getTaskEnvelopeInput,
    normalizeTaskFailure,
    parseJsonObjectFromText,
    pickBestServiceByReputationAndPrice
  };
}
