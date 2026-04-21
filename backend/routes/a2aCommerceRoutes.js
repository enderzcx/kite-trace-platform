/**
 * A2A Commerce Routes
 *
 * Unified A2A agent-to-agent commerce endpoint.
 * Payment + delivery are atomic: 402 → pay → 200 with result.
 * Results are returned via x402 HTTP 200 response, NOT via Synapse channel.
 *
 * Endpoints:
 *   POST /api/a2a/commerce/invoke            — initiate or complete A2A commerce
 *   GET  /api/a2a/commerce/:requestId         — get commerce request status
 *   GET  /api/a2a/commerce/:requestId/evidence — full evidence timeline
 *   GET  /api/a2a/discovery                   — merged agent + service discovery
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HASHKEY_SIGNING_CONTEXT = {
  rpcUrl: 'https://testnet.hsk.xyz',
  bundlerUrl: 'https://testnet.hsk.xyz/rpc',
  entryPointAddress: '0x0Cfe99621287c13533F6ebc3B93a9Ade6580a598',
  accountFactoryAddress: '0xF43E94E2163F14c4D62242D8DD45AbAacaa6DB5a',
  accountImplementationAddress: '0x2DbBfCdAd28b3A2094BD634Cce4326B1b3D0595C',
  chainId: 133
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_REGISTRY_PATH = resolve(__dirname, '../data/agent-registry.json');

function loadAgentRegistry() {
  try { return JSON.parse(readFileSync(AGENT_REGISTRY_PATH, 'utf-8')); } catch { return []; }
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
function isValidAddress(addr) {
  return typeof addr === 'string' && ETH_ADDRESS_RE.test(addr);
}

function buildA2AMetadata(sourceAgentWallet, targetAgentId, capability, traceId) {
  return {
    protocol: 'x402-a2a-v1',
    sourceAgentWallet: (sourceAgentWallet || '').toLowerCase(),
    targetAgentId: targetAgentId || '',
    capability: capability || '',
    traceId: traceId || '',
    timestamp: Date.now()
  };
}

export function registerA2aCommerceRoutes(app, deps) {
  const {
    createX402Request,
    buildPaymentRequiredResponse,
    readX402Requests,
    writeX402Requests,
    ensureServiceCatalog,
    validatePaymentProof,
    verifyProofOnChain,
    verifySessionPaymentEvent,
    appendNetworkAuditEvent,
    createTraceId,
    requireRole
  } = deps;

  // POST /api/a2a/commerce/invoke
  app.post('/api/a2a/commerce/invoke', async (req, res) => {
    // A2A agents call with session headers; payment proof verification is the trust boundary.
    try {
      const {
        sourceAgentWallet,
        targetAgentId,
        capability,
        task,
        traceId,
        requestId,
        paymentProof
      } = req.body;

      if (!sourceAgentWallet || !isValidAddress(sourceAgentWallet)) {
        return res.status(400).json({
          ok: false,
          error: 'invalid_field',
          reason: 'sourceAgentWallet must be a valid 0x-prefixed 20-byte address'
        });
      }
      if (!targetAgentId || typeof targetAgentId !== 'string') {
        return res.status(400).json({
          ok: false,
          error: 'missing_required_fields',
          reason: 'targetAgentId is required'
        });
      }
      if (!capability || typeof capability !== 'string') {
        return res.status(400).json({
          ok: false,
          error: 'missing_required_fields',
          reason: 'capability is required'
        });
      }

      // Find the target agent
      const agentRegistry = loadAgentRegistry();
      const targetAgent = agentRegistry.find(a => a.agentId === targetAgentId && a.active !== false);

      if (!targetAgent) {
        return res.status(404).json({
          ok: false,
          error: 'agent_not_found',
          reason: `Agent ${targetAgentId} is not registered or is offline`
        });
      }

      // Find service matching BOTH capability AND targetAgentId (provider routing)
      const services = ensureServiceCatalog();
      const service = services.find(s =>
        s.id === capability &&
        s.active !== false &&
        s.recipient &&
        (s.providerAgentId === targetAgentId || s.providerKey === targetAgentId)
      );

      if (!service) {
        return res.status(404).json({
          ok: false,
          error: 'capability_not_found',
          reason: `Service ${capability} not offered by agent ${targetAgentId}`
        });
      }

      const effectiveTraceId = traceId || createTraceId();

      // ── With paymentProof: validate, verify on-chain, settle, return result ──
      if (paymentProof && paymentProof.txHash) {
        const x402Requests = readX402Requests();
        const x402Req = x402Requests.find(r => r.requestId === (requestId || ''));
        if (!x402Req) {
          return res.status(400).json({
            ok: false,
            error: 'invalid_request_id',
            reason: 'No matching x402 request found for the provided requestId'
          });
        }

        // Idempotent: if already paid, return cached result
        if (x402Req.status === 'paid') {
          const a2aMeta = buildA2AMetadata(sourceAgentWallet, targetAgentId, capability, effectiveTraceId);
          return res.json({
            ok: true,
            paymentStatus: 'already_paid',
            a2a: a2aMeta,
            result: x402Req.cachedResult || { capability, status: 'delivered', data: { note: 'previously settled' } },
            receipt: x402Req.receipt || null
          });
        }

        // Expiry check
        if (x402Req.expiresAt && Date.now() > x402Req.expiresAt) {
          return res.status(410).json({
            ok: false,
            error: 'request_expired',
            reason: `Request ${x402Req.requestId} has expired. Please initiate a new commerce request.`
          });
        }

        // Validate payment proof structure
        const validationError = validatePaymentProof(x402Req, paymentProof);
        if (validationError) {
          return res.status(400).json({
            ok: false,
            error: 'payment_proof_invalid',
            reason: validationError
          });
        }

        // Verify payment proof on-chain (async)
        let onChainResult = { ok: true, details: null };
        if (typeof verifyProofOnChain === 'function') {
          try {
            onChainResult = await verifyProofOnChain(x402Req, paymentProof);
            // Fallback: some testnets omit ERC20 Transfer logs from receipts;
            // verify via SessionPaymentExecuted event instead
            if (!onChainResult.ok && typeof verifySessionPaymentEvent === 'function') {
              const sessionResult = await verifySessionPaymentEvent(x402Req, paymentProof);
              if (sessionResult.ok) onChainResult = sessionResult;
            }
          } catch (err) {
            // Transient RPC error — allow settlement with verification flag
            onChainResult = { ok: false, reason: `on-chain verification rpc error: ${err?.message || 'unknown'}`, transient: true };
          }
        }

        // Definitive on-chain rejection: transfer not found / reverted
        if (!onChainResult.ok && !onChainResult.transient) {
          return res.status(400).json({
            ok: false,
            error: 'payment_proof_rejected',
            reason: `On-chain verification failed: ${onChainResult.reason || 'no matching transfer found'}`
          });
        }

        // Mark as paid (allowed with transient failures, flagged onChainVerified=false)
        x402Req.status = 'paid';
        x402Req.paymentProof = paymentProof;
        x402Req.paidAt = Date.now();
        x402Req.onChainVerification = onChainResult;

        // Build A2A receipt from stored metadata (not from request body)
        const storedA2aMeta = x402Req.a2aMetadata || {};
        if (!storedA2aMeta.sourceAgentWallet) {
          return res.status(500).json({ ok: false, error: 'missing_a2a_metadata', reason: 'A2A metadata was not persisted on the 402 leg' });
        }
        const receipt = {
          protocol: 'x402-a2a-v1',
          requestId: x402Req.requestId,
          sourceAgentWallet: storedA2aMeta.sourceAgentWallet,
          targetAgentId: storedA2aMeta.targetAgentId,
          capability: storedA2aMeta.capability,
          amount: x402Req.amount,
          tokenAddress: x402Req.tokenAddress,
          recipient: x402Req.recipient,
          txHash: paymentProof.txHash,
          traceId: effectiveTraceId,
          paidAt: x402Req.paidAt,
          onChainVerified: onChainResult.ok
        };

        // Build service result (mock for demo — production calls the actual capability)
        const baseResult = {
          capability,
          status: 'delivered',
          data: {},
          receipt
        };

        if (capability === 'hotel-booking') {
          const checkIn = task?.checkIn || '2026-04-22';
          const nights = Number(task?.nights) || 1;
          const checkOutDate = new Date(checkIn);
          checkOutDate.setDate(checkOutDate.getDate() + nights);
          baseResult.data = {
            confirmationId: `HB-${Date.now().toString(36).toUpperCase()}`,
            hotelName: 'Hilton Beijing Wangfujing',
            roomType: task?.roomType || 'king',
            checkIn,
            checkOut: checkOutDate.toISOString().slice(0, 10),
            price: service.price || '0.001',
            currency: 'USDC',
            status: 'confirmed',
            guestNote: 'Breakfast included. Late check-out available on request.',
            timestamp: Date.now()
          };
        } else {
          baseResult.data = {
            symbol: task?.symbol || 'BTCUSDT',
            price: 94123.45,
            change24h: 2.34,
            volume24h: 42000000000,
            timestamp: Date.now()
          };
        }

        const serviceResult = baseResult;

        // Cache result for idempotency
        x402Req.cachedResult = serviceResult;
        x402Req.receipt = receipt;

        writeX402Requests(x402Requests);

        // Audit event
        appendNetworkAuditEvent({
          traceId: effectiveTraceId,
          event: 'a2a_commerce_settled',
          actor: sourceAgentWallet.toLowerCase(),
          meta: {
            capability,
            targetAgentId,
            amount: x402Req.amount,
            txHash: paymentProof.txHash,
            protocol: 'x402-a2a-v1',
            onChainVerified: onChainResult.ok
          }
        });

        const a2aMeta = buildA2AMetadata(
          storedA2aMeta.sourceAgentWallet,
          storedA2aMeta.targetAgentId,
          storedA2aMeta.capability,
          effectiveTraceId
        );

        return res.json({
          ok: true,
          paymentStatus: 'paid',
          a2a: a2aMeta,
          result: serviceResult,
          receipt
        });
      }

      // ── Without paymentProof: create x402 request, return 402 ──
      const payer = sourceAgentWallet.toLowerCase();
      const x402Req = createX402Request(
        JSON.stringify(task || {}),
        payer,
        service.action || capability,
        {
          amount: service.price || '0.0001',
          tokenAddress: service.tokenAddress,
          recipient: service.recipient
        }
      );

      // Persist A2A metadata on the 402 leg for binding
      x402Req.a2aMetadata = {
        sourceAgentWallet: payer,
        targetAgentId,
        capability,
        traceId: effectiveTraceId
      };

      // Persist the x402 request
      const x402Requests = readX402Requests();
      x402Requests.push(x402Req);
      writeX402Requests(x402Requests);

      // Build 402 response with A2A metadata
      const paymentResponse = buildPaymentRequiredResponse(x402Req, 'A2A commerce payment required');
      // Override signingContext to HashKey testnet for A2A commerce
      if (paymentResponse.x402?.accepts?.[0]?.signingContext) {
        paymentResponse.x402.accepts[0].signingContext = { ...HASHKEY_SIGNING_CONTEXT };
        paymentResponse.x402.accepts[0].network = 'hashkey_testnet';
      }
      const a2aMeta = buildA2AMetadata(sourceAgentWallet, targetAgentId, capability, effectiveTraceId);

      // Audit event
      appendNetworkAuditEvent({
        traceId: effectiveTraceId,
        event: 'a2a_commerce_payment_required',
        actor: payer,
        meta: {
          capability,
          targetAgentId,
          requestId: x402Req.requestId,
          amount: x402Req.amount
        }
      });

      return res.status(402).json({
        ...paymentResponse,
        a2a: a2aMeta
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: 'commerce_invoke_failed',
        reason: normalizeText(err?.message || 'internal error')
      });
    }
  });

  // GET /api/a2a/commerce/:requestId — get commerce request status (auth required)
  app.get('/api/a2a/commerce/:requestId', requireRole('viewer'), (req, res) => {
    try {
      const x402Requests = readX402Requests();
      const x402Req = x402Requests.find(r => r.requestId === req.params.requestId);
      if (!x402Req) {
        return res.status(404).json({ ok: false, error: 'request_not_found' });
      }
      // Redact sensitive internals
      const { a2aMetadata, cachedResult, paymentProof, onChainVerification, ...publicFields } = x402Req;
      res.json({ ok: true, request: publicFields });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'request_get_failed', reason: err?.message || 'internal error' });
    }
  });

  // GET /api/a2a/commerce/:requestId/evidence — full evidence timeline (auth required)
  app.get('/api/a2a/commerce/:requestId/evidence', requireRole('viewer'), (req, res) => {
    try {
      const x402Requests = readX402Requests();
      const x402Req = x402Requests.find(r => r.requestId === req.params.requestId);
      if (!x402Req) {
        return res.status(404).json({ ok: false, error: 'request_not_found' });
      }

      const evidence = {
        requestId: x402Req.requestId,
        status: x402Req.status,
        timeline: [
          { phase: 'request_created', timestamp: x402Req.createdAt, actor: x402Req.payer },
          ...(x402Req.paymentProof ? [{
            phase: 'payment_settled',
            timestamp: x402Req.paidAt || x402Req.createdAt,
            actor: x402Req.payer,
            txHash: x402Req.paymentProof.txHash,
            amount: x402Req.amount,
            recipient: x402Req.recipient,
            onChainVerified: x402Req.onChainVerification?.ok || false
          }] : [])
        ],
        receipt: x402Req.status === 'paid' ? {
          protocol: 'x402-a2a-v1',
          requestId: x402Req.requestId,
          amount: x402Req.amount,
          tokenAddress: x402Req.tokenAddress,
          recipient: x402Req.recipient,
          payer: x402Req.payer,
          txHash: x402Req.paymentProof?.txHash,
          action: x402Req.action,
          onChainVerified: x402Req.onChainVerification?.ok || false
        } : null
      };

      res.json({ ok: true, evidence });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'evidence_get_failed', reason: err?.message || 'internal error' });
    }
  });

  // GET /api/a2a/discovery — merged agent + service discovery
  app.get('/api/a2a/discovery', (req, res) => {
    try {
      const agents = loadAgentRegistry().filter(a => a.active !== false);
      const services = ensureServiceCatalog().filter(s =>
        s.active !== false && s.recipient && s.paymentMode === 'agent'
      );

      const capability = (req.query?.capability || '').toLowerCase().trim();
      const agentDiscovery = agents.map(agent => {
        const agentServices = services.filter(s => s.providerAgentId === agent.agentId || s.providerKey === agent.agentId);
        const filteredServices = capability
          ? agentServices.filter(s => s.id === capability || (s.tags || []).some(t => t.toLowerCase() === capability))
          : agentServices;
        return {
          agentId: agent.agentId,
          agentWallet: agent.agentWallet,
          name: agent.name,
          description: agent.description,
          sessionAuth: agent.sessionAuth ? {
            sessionAddress: agent.sessionAuth.sessionAddress,
            expiresAt: agent.sessionAuth.expiresAt
          } : null,
          endpoints: {
            x402: agent.endpoints?.x402 || '',
            channel: agent.endpoints?.channel || ''
          },
          capabilities: agent.capabilities,
          services: filteredServices.map(s => ({
            id: s.id,
            name: s.name,
            price: s.price,
            tokenAddress: s.tokenAddress,
            recipient: s.recipient,
            tags: s.tags || []
          }))
        };
      });

      res.json({
        ok: true,
        protocol: 'x402-a2a-v1',
        total: agentDiscovery.length,
        agents: agentDiscovery
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'a2a_discovery_failed', reason: err?.message || 'internal error' });
    }
  });
}