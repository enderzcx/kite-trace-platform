/**
 * A2A Agent Registry Routes
 *
 * Manages agent registration for the A2A commerce demo.
 * Agents register their identity (AA wallet), capabilities, and session auth
 * so other agents can discover them and initiate commerce.
 *
 * Endpoints:
 *   GET  /api/a2a/agents              — list agents (with ?capability= filter)
 *   GET  /api/a2a/agents/:agentId     — single agent profile
 *   POST /api/a2a/agents/register     — register or update agent
 *   POST /api/a2a/agents/:agentId/session — update session auth info
 *   DELETE /api/a2a/agents/:agentId   — deregister (go offline)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_REGISTRY_PATH = resolve(__dirname, '../data/agent-registry.json');

function loadAgentRegistry() {
  try {
    return JSON.parse(readFileSync(AGENT_REGISTRY_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveAgentRegistry(registry) {
  writeFileSync(AGENT_REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function isValidAddress(addr) {
  return typeof addr === 'string' && ETH_ADDRESS_RE.test(addr);
}

function sanitizeAgentPublic(agent) {
  const { sessionAuth, registeredBy, ...publicFields } = agent;
  return {
    ...publicFields,
    sessionAuth: sessionAuth
      ? { sessionAddress: sessionAuth.sessionAddress, expiresAt: sessionAuth.expiresAt }
      : null
  };
}

function validateSessionAuth(sessionAuth) {
  if (!sessionAuth || typeof sessionAuth !== 'object') return null;
  return {
    sessionAddress: isValidAddress(sessionAuth.sessionAddress)
      ? sessionAuth.sessionAddress.toLowerCase() : '',
    sessionId: String(sessionAuth.sessionId || ''),
    expiresAt: Number(sessionAuth.expiresAt) || 0
  };
}

function getAuthWallet(req) {
  const wallet = (req.headers['x-ktrace-aa-wallet'] || '').toLowerCase();
  return wallet;
}

export function registerA2aAgentRegistryRoutes(app, deps) {
  const { requireRole } = deps;

  // GET /api/a2a/agents — list agents (public, redacted)
  app.get('/api/a2a/agents', (req, res) => {
    try {
      let agents = loadAgentRegistry().filter(a => a.active !== false);
      const capability = (req.query?.capability || '').toLowerCase().trim();
      if (capability) {
        agents = agents.filter(a =>
          Array.isArray(a.capabilities) &&
          a.capabilities.some(c => c.toLowerCase() === capability)
        );
      }
      res.json({ ok: true, total: agents.length, agents: agents.map(sanitizeAgentPublic) });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'agent_list_failed', reason: err?.message || 'internal error' });
    }
  });

  // GET /api/a2a/agents/:agentId — single agent profile (public, redacted)
  app.get('/api/a2a/agents/:agentId', (req, res) => {
    try {
      const registry = loadAgentRegistry();
      const agent = registry.find(a => a.agentId === req.params.agentId);
      if (!agent) {
        return res.status(404).json({ ok: false, error: 'agent_not_found' });
      }
      res.json({ ok: true, agent: sanitizeAgentPublic(agent) });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'agent_get_failed', reason: err?.message || 'internal error' });
    }
  });

  // POST /api/a2a/agents/register — register or update agent (auth required)
  app.post('/api/a2a/agents/register', requireRole('agent'), (req, res) => {
    try {
      const { agentId, agentWallet, identityRegistry, name, description, capabilities, endpoints } = req.body;
      if (!agentId || typeof agentId !== 'string') {
        return res.status(400).json({ ok: false, error: 'missing_required_fields', reason: 'agentId is required' });
      }
      if (!agentWallet || !isValidAddress(agentWallet)) {
        return res.status(400).json({ ok: false, error: 'invalid_field', reason: 'agentWallet must be a valid 0x-prefixed 20-byte address' });
      }
      if (capabilities && !Array.isArray(capabilities)) {
        return res.status(400).json({ ok: false, error: 'invalid_field', reason: 'capabilities must be an array of strings' });
      }

      const registry = loadAgentRegistry();
      const existing = registry.findIndex(a => a.agentId === agentId);

      // Ownership check: only the registering wallet can update an existing agent
      const authWallet = getAuthWallet(req);
      if (existing >= 0) {
        const existingAgent = registry[existing];
        const owner = (existingAgent.registeredBy || existingAgent.agentWallet || '').toLowerCase();
        if (authWallet && owner && authWallet !== owner) {
          return res.status(403).json({ ok: false, error: 'forbidden', reason: `Wallet ${authWallet} is not the owner of agent ${agentId}` });
        }
      }

      const agentEntry = {
        agentId,
        agentWallet: agentWallet.toLowerCase(),
        identityRegistry: identityRegistry || '0x901A2b1c67daB5AC09A4e02bE9c1c8D52Cce650B',
        name: name || `Agent ${agentId}`,
        description: description || '',
        sessionAuth: validateSessionAuth(req.body.sessionAuth),
        endpoints: endpoints || {},
        capabilities: Array.isArray(capabilities) ? capabilities.map(c => String(c)) : [],
        active: true,
        registeredAt: existing >= 0 ? registry[existing].registeredAt : new Date().toISOString(),
        registeredBy: (authWallet || agentWallet).toLowerCase(),
        updatedAt: new Date().toISOString()
      };

      if (existing >= 0) {
        registry[existing] = { ...registry[existing], ...agentEntry };
      } else {
        registry.push(agentEntry);
      }

      saveAgentRegistry(registry);
      res.json({ ok: true, agent: sanitizeAgentPublic(agentEntry) });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'agent_register_failed', reason: err?.message || 'internal error' });
    }
  });

  // POST /api/a2a/agents/:agentId/session — update session auth (auth + ownership required)
  app.post('/api/a2a/agents/:agentId/session', requireRole('agent'), (req, res) => {
    try {
      const registry = loadAgentRegistry();
      const idx = registry.findIndex(a => a.agentId === req.params.agentId);
      if (idx < 0) {
        return res.status(404).json({ ok: false, error: 'agent_not_found' });
      }

      // Ownership check
      const authWallet = getAuthWallet(req);
      const owner = (registry[idx].registeredBy || registry[idx].agentWallet || '').toLowerCase();
      if (authWallet && owner && authWallet !== owner) {
        return res.status(403).json({ ok: false, error: 'forbidden', reason: `Wallet ${authWallet} is not the owner of agent ${req.params.agentId}` });
      }

      const { sessionAddress, sessionId, expiresAt } = req.body;
      if (sessionAddress && !isValidAddress(sessionAddress)) {
        return res.status(400).json({ ok: false, error: 'invalid_field', reason: 'sessionAddress must be a valid 0x-prefixed 20-byte address' });
      }

      registry[idx].sessionAuth = validateSessionAuth({ sessionAddress, sessionId, expiresAt });
      registry[idx].updatedAt = new Date().toISOString();
      saveAgentRegistry(registry);

      res.json({ ok: true, sessionAuth: { sessionAddress: registry[idx].sessionAuth.sessionAddress, expiresAt: registry[idx].sessionAuth.expiresAt } });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'session_update_failed', reason: err?.message || 'internal error' });
    }
  });

  // DELETE /api/a2a/agents/:agentId — deregister (auth + ownership required)
  app.delete('/api/a2a/agents/:agentId', requireRole('agent'), (req, res) => {
    try {
      const registry = loadAgentRegistry();
      const idx = registry.findIndex(a => a.agentId === req.params.agentId);
      if (idx < 0) {
        return res.status(404).json({ ok: false, error: 'agent_not_found' });
      }

      // Ownership check
      const authWallet = getAuthWallet(req);
      const owner = (registry[idx].registeredBy || registry[idx].agentWallet || '').toLowerCase();
      if (authWallet && owner && authWallet !== owner) {
        return res.status(403).json({ ok: false, error: 'forbidden', reason: `Wallet ${authWallet} is not the owner of agent ${req.params.agentId}` });
      }

      registry[idx].active = false;
      registry[idx].sessionAuth = null;
      registry[idx].updatedAt = new Date().toISOString();
      saveAgentRegistry(registry);

      res.json({ ok: true, agentId: req.params.agentId, active: false });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'agent_deregister_failed', reason: err?.message || 'internal error' });
    }
  });
}