import { createHash } from 'crypto';

export function createApiRateLimit({
  extractApiKey,
  rateLimitMax,
  rateLimitWindowMs
} = {}) {
  const rateLimitStore = new Map();

  function getRateKey(req) {
    const key = extractApiKey(req);
    // Finding 9 fix: use hash of full API key to avoid prefix collisions
    if (key) {
      return `k:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    }
    return `ip:${String(req.ip || req.socket?.remoteAddress || 'unknown')}`;
  }

  // Finding 4 fix: periodic cleanup of expired rate limit entries
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitStore) {
      if (now - value.startMs >= rateLimitWindowMs * 2) {
        rateLimitStore.delete(key);
      }
    }
  }, rateLimitWindowMs * 2);
  if (cleanupInterval.unref) cleanupInterval.unref();

  return function apiRateLimit(req, res, next) {
    const now = Date.now();
    const key = getRateKey(req);
    const current = rateLimitStore.get(key);
    if (!current || now - current.startMs >= rateLimitWindowMs) {
      rateLimitStore.set(key, { startMs: now, count: 1 });
      return next();
    }
    current.count += 1;
    if (current.count > rateLimitMax) {
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        reason: 'Too many API requests',
        traceId: req.traceId || ''
      });
    }
    return next();
  };
}

export function applyRuntimeServerMiddleware(app, deps = {}) {
  const {
    cors,
    createTraceId,
    express,
    allowedOrigins = [],
    adminKey = ''
  } = deps;
  const fallbackPublicOrigin = (() => {
    try {
      const raw = String(process.env.BACKEND_PUBLIC_URL || '').trim();
      return raw ? new URL(raw).origin : '';
    } catch {
      return '';
    }
  })();
  const normalizedAllowedOrigins = Array.isArray(allowedOrigins)
    ? Array.from(
        new Set(
          [
            ...allowedOrigins.map((item) => String(item || '').trim()).filter(Boolean),
            fallbackPublicOrigin
          ].filter(Boolean)
        )
      )
    : fallbackPublicOrigin
      ? [fallbackPublicOrigin]
      : [];

  app.use(
    cors((req, callback) => {
      const origin = String(req.headers.origin || '').trim();
      const path = String(req.path || req.originalUrl || '').trim();
      const isApprovalSurface = path.startsWith('/api/approvals');

      let corsOptions;
      if (!origin) {
        corsOptions = {
          origin: false,
          credentials: false,
          exposedHeaders: ['x-trace-id', 'x-request-id']
        };
      } else if (normalizedAllowedOrigins.includes(origin)) {
        corsOptions = {
          origin: true,
          credentials: true,
          exposedHeaders: ['x-trace-id', 'x-request-id']
        };
      } else if (adminKey && isApprovalSurface) {
        corsOptions = {
          origin: false,
          credentials: false,
          exposedHeaders: ['x-trace-id', 'x-request-id']
        };
      } else {
        corsOptions = {
          origin: false,
          credentials: false,
          exposedHeaders: ['x-trace-id', 'x-request-id']
        };
      }

      callback(null, corsOptions);
    })
  );
  app.use(express.json());
  app.use((req, res, next) => {
    // Finding 8 fix: validate incoming traceId (alphanumeric + hyphens + underscores, max 128 chars)
    const TRACE_ID_PATTERN = /^[a-zA-Z0-9_\-:.]{1,128}$/;
    const rawIncoming =
      String(req.headers['x-trace-id'] || '').trim() ||
      String(req.query.traceId || '').trim() ||
      String(req.body?.traceId || '').trim();
    const incoming = rawIncoming && TRACE_ID_PATTERN.test(rawIncoming) ? rawIncoming : '';
    const traceId = incoming || createTraceId('req');
    req.traceId = traceId;
    req.requestId = traceId;
    res.setHeader('x-trace-id', traceId);
    res.setHeader('x-request-id', traceId);
    next();
  });
}

export function registerHealthRoutes(app, deps = {}) {
  const {
    getAutoJobExpiryStatus,
    kiteNetworkName,
    packageVersion,
    startedAtMs
  } = deps;

  const buildPayload = (req) => ({
    ok: true,
    version: packageVersion,
    uptime: Math.max(0, Math.round(process.uptime())),
    network: kiteNetworkName,
    publicUrl: String(process.env.BACKEND_PUBLIC_URL || '').trim(),
    startedAt: new Date(startedAtMs).toISOString(),
    traceId: String(req.traceId || '').trim(),
    autoJobExpiry: getAutoJobExpiryStatus?.() || null
  });

  app.get('/health', (req, res) => {
    res.json(buildPayload(req));
  });

  app.get('/api/public/health', (req, res) => {
    res.json(buildPayload(req));
  });
}

export function createRuntimeServerLifecycle(deps = {}) {
  const {
    app,
    autoTradePlan,
    persistenceStore,
    port,
    stopAutoJobExpiryLoop,
    stopAutoTradePlanLoop
  } = deps;

  let httpServer = null;

  async function startServer() {
    await deps.initializePersistence();
    deps.ensureServiceCatalog();
    deps.ensureTemplateCatalog();
    deps.ensureNetworkAgents();
    httpServer = app.listen(port, () => {
      console.log(`Backend listening on http://localhost:${port}`);
      if (autoTradePlan.enabled) {
        autoTradePlan.start({
          intervalMs: autoTradePlan.intervalMs,
          symbol: autoTradePlan.symbol,
          horizonMin: autoTradePlan.horizonMin,
          prompt: autoTradePlan.prompt,
          immediate: true,
          reason: 'startup'
        });
        console.log(
          `[auto-trade-plan] enabled intervalMs=${autoTradePlan.intervalMs} symbol=${autoTradePlan.symbol} horizon=${autoTradePlan.horizonMin}m`
        );
      }
      if (deps.autoJobExpiry.enabled) {
        deps.autoJobExpiry.start({
          intervalMs: deps.autoJobExpiry.intervalMs,
          immediate: true,
          reason: 'startup'
        });
        console.log(`[auto-job-expiry] enabled intervalMs=${deps.autoJobExpiry.intervalMs}`);
      }
    });
  }

  async function shutdownServer() {
    stopAutoTradePlanLoop();
    stopAutoJobExpiryLoop();
    try {
      if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
        httpServer = null;
      }
    } catch {
      // ignore server close errors
    }
    await persistenceStore.close();
  }

  return {
    startServer,
    shutdownServer
  };
}
