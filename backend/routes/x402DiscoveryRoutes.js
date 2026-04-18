/**
 * x402 V2 Discovery Routes
 *
 * Exposes a public, unauthenticated service catalog in x402 V2 format so that
 * external Facilitators and AI Agents can auto-discover available services,
 * understand pricing, and initiate payments without prior knowledge of the API.
 *
 * Public endpoints (no API key required):
 *   GET /.well-known/x402.json   — standard x402 crawl path
 *   GET /api/x402/discovery      — rich filtered API (?tag=btc&limit=20)
 */

function normalizeText(value = '') {
  return String(value || '').trim();
}

/**
 * Resolve the public base URL for this server.
 * Mirrors the logic in mcp/mcpServer.js buildPublicBaseUrl().
 */
function resolveBaseUrl(req) {
  const configured = normalizeText(process.env.BACKEND_PUBLIC_URL || '');
  if (configured) return configured.replace(/\/+$/, '');
  const proto =
    normalizeText(req.headers['x-forwarded-proto'] || '') || req.protocol || 'http';
  const host =
    normalizeText(req.headers['x-forwarded-host'] || '') ||
    req.get('host') ||
    `127.0.0.1:${normalizeText(process.env.PORT || '3399') || '3399'}`;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

/**
 * Map a single service catalog entry to an x402 V2 Service Descriptor.
 * Intentionally omits internal fields (providerAgentId, allowlistPayers, etc.).
 */
function buildX402ServiceDescriptor(service, baseUrl) {
  const id = normalizeText(service.id || '');
  const endpoint = `${baseUrl}/api/services/${id}/invoke`;
  const slaMs = Number(service.slaMs) || 30000;

  return {
    id,
    name: normalizeText(service.name || ''),
    description: normalizeText(service.description || ''),
    endpoint,
    accepts: [
      {
        scheme: 'exact',
        network: 'kite_testnet',
        asset: normalizeText(service.tokenAddress || ''),
        maxAmountRequired: normalizeText(service.price || '0'),
        payTo: normalizeText(service.recipient || ''),
        maxTimeoutSeconds: Math.ceil(slaMs / 1000),
        mimeType: 'application/json',
        resource: endpoint
      }
    ],
    tags: Array.isArray(service.tags)
      ? service.tags.map(t => normalizeText(t)).filter(t => t && t !== 'x402')
      : [],
    inputSchema: service.exampleInput ? { example: service.exampleInput } : {},
    slaMs,
    rateLimitPerMinute: Number(service.rateLimitPerMinute) || 10,
    paymentMode: normalizeText(service.paymentMode || 'agent'),
    agentIdentity: {
      agentId: normalizeText(service.providerAgentId || ''),
      agentWallet: normalizeText(service.recipient || ''),
      identityRegistry: '0x901A2b1c67daB5AC09A4e02bE9c1c8D52Cce650B'
    }
  };
}

export function registerX402DiscoveryRoutes(app, deps) {
  const { ensureServiceCatalog } = deps;

  function handle(req, res) {
    try {
      const tag = normalizeText(req.query?.tag || '').toLowerCase();
      const rawLimit = Number(req.query?.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
      const baseUrl = resolveBaseUrl(req);

      // Include services that are active and x402-capable:
      // paymentMode === 'agent' (newly added field) OR has 'x402' tag (legacy services on disk)
      // Also require a recipient address to ensure payment info is present.
      let services = ensureServiceCatalog()
        .filter(s => {
          if (s.active === false) return false;
          if (!normalizeText(s.id || '')) return false;
          const pm = normalizeText(s.paymentMode || '').toLowerCase();
          const hasX402Tag = Array.isArray(s.tags) && s.tags.some(t => normalizeText(t).toLowerCase() === 'x402');
          const hasRecipient = Boolean(normalizeText(s.recipient || ''));
          return (pm === 'agent' || hasX402Tag) && hasRecipient;
        })
        .map(s => buildX402ServiceDescriptor(s, baseUrl));

      if (tag) {
        services = services.filter(s => s.tags.includes(tag));
      }

      services = services.slice(0, limit);

      res.json({
        x402Version: '2.0',
        publishedAt: new Date().toISOString(),
        publisher: 'kite-trace',
        network: 'kite_testnet',
        total: services.length,
        services
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: 'discovery_failed',
        reason: normalizeText(err?.message || 'internal error')
      });
    }
  }

  // Standard x402 well-known crawl path
  app.get('/.well-known/x402.json', handle);

  // Rich filtered API endpoint
  app.get('/api/x402/discovery', handle);
}
