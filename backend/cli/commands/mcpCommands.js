import process from 'node:process';
import { readFile } from 'node:fs/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod/v4';

export function createMcpCommandHandlers({
  parseMcpBridgeArgs,
  sendLocalSessionPayment,
  createCliError
}) {
  function normalizeText(value = '') {
    return String(value ?? '').trim();
  }

  function normalizeJsonSchemaProperties(inputSchema = {}) {
    const properties =
      inputSchema && typeof inputSchema === 'object' && !Array.isArray(inputSchema)
        ? inputSchema.properties
        : null;
    return properties && typeof properties === 'object' && !Array.isArray(properties) ? properties : {};
  }

  function buildToolShape(inputSchema = {}) {
    const shape = {};
    for (const [key, property] of Object.entries(normalizeJsonSchemaProperties(inputSchema))) {
      const description =
        property && typeof property === 'object' && !Array.isArray(property)
          ? normalizeText(property.description || '')
          : '';
      shape[key] = description ? z.any().describe(description).optional() : z.any().optional();
    }
    return z.object(shape).passthrough();
  }

  function buildBridgeErrorResult(message = '', extra = {}) {
    const reason = normalizeText(message || 'Local MCP bridge call failed.');
    const structured = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: reason
        }
      ],
      structuredContent: {
        error: normalizeText(structured.error || 'bridge_payment_failed') || 'bridge_payment_failed',
        reason,
        ...structured
      }
    };
  }

  async function loadSessionRuntimeFromFile(pathname = '') {
    const normalizedPath = normalizeText(pathname);
    if (!normalizedPath) return null;
    const raw = await readFile(normalizedPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw createCliError('Session runtime file must contain a JSON object.', {
        code: 'mcp_bridge_session_runtime_invalid'
      });
    }
    if (parsed.runtime && typeof parsed.runtime === 'object' && !Array.isArray(parsed.runtime)) {
      return parsed.runtime;
    }
    return parsed;
  }

  function buildBridgeRuntime(runtime = {}, importedRuntime = null) {
    const localSessionRuntime =
      importedRuntime && typeof importedRuntime === 'object' && !Array.isArray(importedRuntime)
        ? importedRuntime
        : runtime?.localSessionRuntime || null;
    return {
      ...runtime,
      localSessionRuntime
    };
  }

  function buildBackendTransport(runtime = {}) {
    const headers = {};
    const apiKey = normalizeText(runtime.apiKey || '');
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['x-ktrace-mcp-payment-mode'] = 'agent';
    return new StreamableHTTPClientTransport(new URL(`${runtime.baseUrl.replace(/\/+$/, '')}/mcp`), {
      requestInit: {
        headers
      }
    });
  }

  async function settleBridgePayment(runtime = {}, preview = {}, tool = {}) {
    const fakeMode = /^(1|true|yes|on)$/i.test(normalizeText(process.env.KTRACE_MCP_BRIDGE_FAKE_PAYMENT || ''));
    if (fakeMode) {
      return {
        status: 'paid',
        payment: {
          requestId: preview.requestId,
          tokenAddress: preview.tokenAddress,
          recipient: preview.recipient,
          amount: preview.amount,
          amountWei: preview.amount,
          aaWallet: normalizeText(runtime?.localSessionRuntime?.aaWallet || runtime?.aaWallet || ''),
          sessionAddress: normalizeText(runtime?.localSessionRuntime?.sessionAddress || ''),
          sessionId: normalizeText(runtime?.localSessionRuntime?.sessionId || ''),
          txHash: '0xfakepaymenttxhash',
          userOpHash: '0xfakepaymentuserophash',
          aaVersion: 'fake-test'
        },
        paymentProof: {
          requestId: preview.requestId,
          txHash: '0xfakepaymenttxhash',
          payer: normalizeText(runtime?.localSessionRuntime?.aaWallet || runtime?.aaWallet || ''),
          tokenAddress: preview.tokenAddress,
          recipient: preview.recipient,
          amount: preview.amount
        }
      };
    }

    return sendLocalSessionPayment(runtime, {
      tokenAddress: preview.tokenAddress,
      recipient: preview.recipient,
      amount: preview.amount,
      requestId: preview.requestId,
      action: preview.action || preview.serviceId || tool.name,
      query: tool.title || tool.name
    });
  }

  function extractPaymentPreview(result = {}, tool = {}) {
    const structured =
      result?.structuredContent && typeof result.structuredContent === 'object'
        ? result.structuredContent
        : {};
    const requestId = normalizeText(structured.requestId || '');
    const tokenAddress = normalizeText(structured.tokenAddress || '');
    const recipient = normalizeText(structured.recipient || '');
    const amount = normalizeText(structured.amount || '');
    const paymentStatus = normalizeText(structured.paymentStatus || '');
    if (
      paymentStatus !== 'payment_required_preview' ||
      !requestId ||
      !tokenAddress ||
      !recipient ||
      !amount
    ) {
      return null;
    }
    return {
      requestId,
      traceId: normalizeText(structured.traceId || ''),
      tokenAddress,
      recipient,
      amount,
      serviceId: normalizeText(structured.serviceId || tool.serviceId || ''),
      action: normalizeText(tool.action || structured.serviceId || tool.name || '')
    };
  }

  function mergeReplayArguments(args = {}, requestId = '', paymentProof = null) {
    const baseArgs = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
    if (requestId) baseArgs.requestId = requestId;
    if (paymentProof && typeof paymentProof === 'object') baseArgs.paymentProof = paymentProof;
    return baseArgs;
  }

  async function callBackendTool(client, toolName, args = {}) {
    return client.request(
      {
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        }
      },
      CallToolResultSchema
    );
  }

  async function handleMcpBridge(runtimeBundle, commandArgs = []) {
    const runtime = runtimeBundle.config;
    const options = parseMcpBridgeArgs(commandArgs);
    const importedRuntime = await loadSessionRuntimeFromFile(options.sessionRuntime);
    const bridgeRuntime = buildBridgeRuntime(runtime, importedRuntime);
    const backendTransport = buildBackendTransport(bridgeRuntime);
    const backendClient = new Client(
      { name: 'ktrace-local-bridge', version: '1.0.0' },
      { capabilities: {} }
    );
    await backendClient.connect(backendTransport);

    const toolsResult = await backendClient.listTools();
    const backendTools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
    const toolIndex = new Map(
      backendTools.map((tool) => [
        normalizeText(tool?.name || ''),
        {
          name: normalizeText(tool?.name || ''),
          title: normalizeText(tool?.title || ''),
          description: normalizeText(tool?.description || ''),
          inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {},
          serviceId: normalizeText(tool?._meta?.capabilityId || ''),
          action: normalizeText(tool?._meta?.capabilityId || '')
        }
      ])
    );

    const bridgeServer = new McpServer({
      name: 'ktrace-local-bridge',
      version: '1.0.0'
    });

    for (const tool of toolIndex.values()) {
      bridgeServer.registerTool(
        tool.name,
        {
          title: tool.title || tool.name,
          description:
            tool.description ||
            `Proxy tool ${tool.name} through the local KTrace self-custodial MCP bridge.`,
          inputSchema: buildToolShape(tool.inputSchema)
        },
        async (args = {}) => {
          const initial = await callBackendTool(backendClient, tool.name, args);
          const preview = extractPaymentPreview(initial, tool);
          if (!preview) {
            return initial;
          }

          let payment = null;
          try {
            payment = await settleBridgePayment(bridgeRuntime, preview, tool);
          } catch (error) {
            return buildBridgeErrorResult(
              normalizeText(error?.message || 'Local session payment failed.') || 'Local session payment failed.',
              {
                error: 'bridge_payment_failed',
                requestId: preview.requestId,
                traceId: preview.traceId,
                serviceId: preview.serviceId,
                paymentStatus: 'payment_failed'
              }
            );
          }

          const replay = await callBackendTool(
            backendClient,
            tool.name,
            mergeReplayArguments(args, preview.requestId, payment?.paymentProof || null)
          );
          const replayPreview = extractPaymentPreview(replay, tool);
          if (replayPreview) {
            return buildBridgeErrorResult(
              'Local payment was sent, but the replayed MCP tool still returned payment_required.',
              {
                error: 'payment_replay_failed',
                requestId: replayPreview.requestId || preview.requestId,
                traceId: replayPreview.traceId || preview.traceId,
                serviceId: replayPreview.serviceId || preview.serviceId,
                paymentStatus: 'payment_replay_failed'
              }
            );
          }
          if (replay?.isError === true) {
            return buildBridgeErrorResult(
              normalizeText(replay?.content?.[0]?.text || replay?.structuredContent?.reason || 'Bridge replay failed.') ||
                'Bridge replay failed.',
              {
                error: normalizeText(replay?.structuredContent?.error || 'payment_replay_failed') || 'payment_replay_failed',
                requestId: normalizeText(replay?.structuredContent?.requestId || preview.requestId || ''),
                traceId: normalizeText(replay?.structuredContent?.traceId || preview.traceId || ''),
                serviceId: normalizeText(replay?.structuredContent?.serviceId || preview.serviceId || ''),
                paymentStatus: 'payment_replay_failed'
              }
            );
          }
          return replay;
        }
      );
    }

    const stdioTransport = new StdioServerTransport();
    await bridgeServer.connect(stdioTransport);

    await new Promise((resolve) => {
      const finish = () => {
        process.off('SIGINT', finish);
        process.off('SIGTERM', finish);
        resolve(null);
      };
      process.on('SIGINT', finish);
      process.on('SIGTERM', finish);
    });

    await Promise.allSettled([bridgeServer.close(), backendTransport.close()]);
    return {
      ok: true,
      exitCode: 0,
      suppressOutput: true
    };
  }

  return {
    handleMcpBridge
  };
}
