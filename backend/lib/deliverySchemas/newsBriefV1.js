import * as z from 'zod/v4';

export const NEWS_BRIEF_V1_SCHEMA_ID = 'ktrace-news-brief-v1';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringArray(values = []) {
  return Array.isArray(values) ? values.map((item) => normalizeText(item)).filter(Boolean) : [];
}

function formatZodIssues(issues = []) {
  return (Array.isArray(issues) ? issues : []).map((issue) => ({
    path: Array.isArray(issue?.path) ? issue.path.join('.') : '',
    code: normalizeText(issue?.code || 'invalid'),
    message: normalizeText(issue?.message || 'invalid field')
  }));
}

const deliverySchema = z.object({
  schema: z.literal(NEWS_BRIEF_V1_SCHEMA_ID),
  summary: z.string().min(1),
  items: z.array(
    z.object({
      headline: z.string().min(1),
      sourceUrl: z.url()
    })
  ).min(1),
  newsTraceId: z.string().min(1),
  paymentTxHash: z.string().min(1),
  trustTxHash: z.string().min(1)
});

export function validateNewsBriefV1(delivery = null) {
  if (!isPlainObject(delivery)) {
    return {
      ok: false,
      schema: '',
      conformant: false,
      errors: [
        {
          path: '',
          code: 'invalid_type',
          message: 'delivery must be an object'
        }
      ]
    };
  }

  const schemaId = normalizeText(delivery.schema);
  if (schemaId && schemaId !== NEWS_BRIEF_V1_SCHEMA_ID) {
    return {
      ok: false,
      schema: schemaId,
      conformant: false,
      errors: [
        {
          path: 'schema',
          code: 'schema_mismatch',
          message: `expected ${NEWS_BRIEF_V1_SCHEMA_ID}`
        }
      ]
    };
  }

  const parsed = deliverySchema.safeParse(delivery);
  return {
    ok: parsed.success,
    schema: parsed.success ? NEWS_BRIEF_V1_SCHEMA_ID : (schemaId || NEWS_BRIEF_V1_SCHEMA_ID),
    conformant: parsed.success,
    value: parsed.success ? parsed.data : null,
    errors: parsed.success ? [] : formatZodIssues(parsed.error?.issues)
  };
}

export function normalizeNewsBriefEvidence(delivery = null, fallback = {}) {
  const source = isPlainObject(delivery) ? delivery : {};
  const fallbackEvidence = isPlainObject(fallback) ? fallback : {};
  const items = Array.isArray(source.items)
    ? source.items
        .map((item) => ({
          headline: normalizeText(item?.headline),
          sourceUrl: normalizeText(item?.sourceUrl)
        }))
        .filter((item) => item.headline || item.sourceUrl)
    : [];
  return {
    primaryTraceId: normalizeText(source.newsTraceId || fallbackEvidence.primaryTraceId || ''),
    primaryEvidenceRef: normalizeText(source.primaryEvidenceRef || fallbackEvidence.primaryEvidenceRef || ''),
    paymentRequestId: normalizeText(source.paymentRequestId || fallbackEvidence.paymentRequestId || ''),
    paymentTxHash: normalizeText(source.paymentTxHash || fallbackEvidence.paymentTxHash || ''),
    dataSourceTraceIds: normalizeStringArray(
      source.newsTraceId
        ? [source.newsTraceId, ...(Array.isArray(fallbackEvidence.dataSourceTraceIds) ? fallbackEvidence.dataSourceTraceIds : [])]
        : fallbackEvidence.dataSourceTraceIds
    ),
    receiptRefs: normalizeStringArray(source.receiptRefs || fallbackEvidence.receiptRefs),
    deliveredAt: normalizeText(source.deliveredAt || fallbackEvidence.deliveredAt || ''),
    trustTxHash: normalizeText(source.trustTxHash || fallbackEvidence.trustTxHash || ''),
    summary: normalizeText(source.summary || fallbackEvidence.summary || ''),
    sourceUrls: items.map((item) => item.sourceUrl).filter(Boolean),
    items
  };
}

export function buildNewsBriefDeliveryStandard({
  delivery = null,
  resultHash = '',
  outcomeAnchored = false,
  validatorApproved = false
} = {}) {
  const validation = validateNewsBriefV1(delivery);
  const hasDelivery = isPlainObject(delivery);
  return {
    version: 'ktrace-delivery-v1',
    definition: 'validator_approve + result_hash_submitted + outcome_anchor_onchain + schema_check',
    schema: validation.schema || normalizeText(delivery?.schema || ''),
    conformant: hasDelivery ? Boolean(validation.conformant) : null,
    errors: hasDelivery ? validation.errors : [],
    validatorApproved: Boolean(validatorApproved),
    resultHashSubmitted: Boolean(normalizeText(resultHash)),
    outcomeAnchored: Boolean(outcomeAnchored),
    satisfied:
      Boolean(validatorApproved) &&
      Boolean(normalizeText(resultHash)) &&
      Boolean(outcomeAnchored) &&
      (!hasDelivery || Boolean(validation.conformant))
  };
}

export function validateNewsBriefJobDelivery({
  job = {},
  readServiceInvocations,
  readTrustPublications,
  readWorkflows,
  readX402Requests
} = {}) {
  const delivery = isPlainObject(job?.delivery) ? job.delivery : {};
  const shapeValidation = validateNewsBriefV1(delivery);
  if (!shapeValidation.ok) {
    return {
      ok: false,
      code: 'invalid_delivery_payload',
      summary: 'delivery payload did not match ktrace-news-brief-v1',
      errors: shapeValidation.errors
    };
  }

  const newsTraceId = normalizeText(delivery.newsTraceId);
  const paymentTxHash = normalizeText(delivery.paymentTxHash).toLowerCase();
  const trustTxHash = normalizeText(delivery.trustTxHash).toLowerCase();

  const invocations = typeof readServiceInvocations === 'function' ? readServiceInvocations() : [];
  const invocation = invocations.find((item) => normalizeText(item?.traceId) === newsTraceId) || null;
  const workflows = typeof readWorkflows === 'function' ? readWorkflows() : [];
  const workflow = workflows.find((item) => normalizeText(item?.traceId) === newsTraceId) || null;
  if (!invocation && !workflow) {
    return {
      ok: false,
      code: 'news_trace_not_found',
      summary: `newsTraceId ${newsTraceId} did not resolve to a workflow or invocation`
    };
  }

  const normalizedServiceId = normalizeText(invocation?.serviceId || '');
  const normalizedAction = normalizeText(invocation?.action || workflow?.type || '').toLowerCase();
  const isNewsSignal =
    normalizedServiceId === 'cap-news-signal' ||
    normalizedAction === 'news-signal' ||
    normalizeText(job?.capability || '').toLowerCase() === 'cap-news-signal';
  if (!isNewsSignal) {
    return {
      ok: false,
      code: 'unexpected_news_capability',
      summary: `newsTraceId ${newsTraceId} did not resolve to cap-news-signal`
    };
  }

  const requestId = normalizeText(invocation?.requestId || workflow?.requestId || '');
  const resolvedPaymentTxHash = normalizeText(invocation?.txHash || workflow?.txHash || '').toLowerCase();
  if (!resolvedPaymentTxHash || resolvedPaymentTxHash !== paymentTxHash) {
    return {
      ok: false,
      code: 'payment_tx_mismatch',
      summary: 'paymentTxHash did not match the cap-news-signal invocation'
    };
  }

  const trustPublications = typeof readTrustPublications === 'function' ? readTrustPublications() : [];
  const matchingTrustPublication =
    trustPublications.find((item) => {
      const anchorTxHash = normalizeText(item?.anchorTxHash || '').toLowerCase();
      if (!anchorTxHash || anchorTxHash !== trustTxHash) return false;
      const publicationTraceId = normalizeText(item?.traceId || '');
      const referenceId = normalizeText(item?.referenceId || '');
      return publicationTraceId === newsTraceId || (requestId && referenceId === requestId);
    }) || null;
  if (!matchingTrustPublication) {
    return {
      ok: false,
      code: 'trust_tx_mismatch',
      summary: 'trustTxHash did not match a trust publication for the cap-news-signal call'
    };
  }

  const x402Requests = typeof readX402Requests === 'function' ? readX402Requests() : [];
  const x402Request =
    x402Requests.find((item) => {
      const candidateRequestId = normalizeText(item?.requestId || '');
      const candidateTraceId = normalizeText(item?.a2a?.traceId || item?.traceId || '');
      return (requestId && candidateRequestId === requestId) || candidateTraceId === newsTraceId;
    }) || null;
  if (!x402Request) {
    return {
      ok: false,
      code: 'news_request_not_found',
      summary: 'newsTraceId did not resolve to an x402 request'
    };
  }

  const previewArticles = Array.isArray(x402Request?.previewResult?.external?.data?.articles)
    ? x402Request.previewResult.external.data.articles
    : [];
  const previewUrls = new Set(
    previewArticles.map((item) => normalizeText(item?.sourceUrl)).filter(Boolean)
  );
  if (previewUrls.size === 0) {
    return {
      ok: false,
      code: 'news_preview_missing',
      summary: 'cap-news-signal request did not expose preview articles with sourceUrl'
    };
  }

  const missingSourceUrl = delivery.items.find((item) => !previewUrls.has(normalizeText(item?.sourceUrl)));
  if (missingSourceUrl) {
    return {
      ok: false,
      code: 'source_url_mismatch',
      summary: `sourceUrl ${normalizeText(missingSourceUrl?.sourceUrl)} was not present in the cap-news-signal result`
    };
  }

  return {
    ok: true,
    code: 'validated',
    summary: `Validated hourly news brief against ${newsTraceId}.`,
    detail: {
      requestId,
      newsTraceId,
      paymentTxHash: normalizeText(invocation?.txHash || workflow?.txHash || ''),
      trustTxHash: normalizeText(matchingTrustPublication?.anchorTxHash || ''),
      matchedSourceCount: delivery.items.length
    }
  };
}
