export function createPaymentPolicyHelpers(deps = {}) {
  const {
    BACKEND_RPC_URL,
    HYPERLIQUID_ORDER_RECIPIENT,
    KITE_AGENT2_AA_ADDRESS,
    KITE_AGENT2_ID,
    MERCHANT_ADDRESS,
    PROOF_RECEIPT_POLL_INTERVAL_MS,
    PROOF_RECEIPT_WAIT_MS,
    PROOF_RPC_RETRIES,
    PROOF_RPC_TIMEOUT_MS,
    SETTLEMENT_TOKEN,
    X402_BTC_PRICE,
    X402_HYPERLIQUID_ORDER_PRICE,
    X402_INFO_PRICE,
    X402_REACTIVE_PRICE,
    X402_RISK_SCORE_PRICE,
    X402_TECHNICAL_PRICE,
    crypto,
    ethers,
    getBackendSigner,
    normalizeAddress,
    readPolicyConfig,
    readPolicyFailures,
    resolveInfoSettlementRecipient,
    resolveTechnicalSettlementRecipient,
    waitMs,
    writePolicyFailures
  } = deps;

  const sessionUserOpQueue = new Map();

  function buildA2ACapabilities() {
    return {
      protocol: 'x402-a2a-v1',
      targetAgent: {
        agentId: KITE_AGENT2_ID,
        wallet: KITE_AGENT2_AA_ADDRESS,
        service: 'reactive-stop-orders'
      },
      payment: {
        standard: 'x402',
        flow: '402 -> on-chain payment -> proof verify -> 200',
        settlementToken: SETTLEMENT_TOKEN,
        network: 'kite_testnet'
      },
      lifecycle: ['discover', 'quote', 'pay', 'execute', 'prove', 'settle'],
      actions: [
        {
          id: 'btc-price-feed',
          input: {
            pair: 'string (default BTCUSDT)',
            source: 'hyperliquid (fallback: binance, okx; legacy auto/binance/coingecko accepted)'
          },
          price: X402_BTC_PRICE,
          recipient: KITE_AGENT2_AA_ADDRESS
        },
        {
          id: 'risk-score-feed',
          input: {
            symbol: 'string (BTC/ETH, e.g. BTCUSDT/ETHUSDT/BTCUSD/ETHUSD)',
            horizonMin: 'number 5-240',
            source: 'hyperliquid (fallback: binance, okx)'
          },
          price: X402_RISK_SCORE_PRICE,
          recipient: resolveTechnicalSettlementRecipient()
        },
        {
          id: 'technical-analysis-feed',
          input: {
            symbol: 'string (BTC/ETH, e.g. BTCUSDT/ETHUSDT/BTCUSD/ETHUSD)',
            horizonMin: 'number 5-240',
            source: 'hyperliquid (fallback: binance, okx)'
          },
          price: X402_TECHNICAL_PRICE,
          recipient: resolveTechnicalSettlementRecipient()
        },
        {
          id: 'info-analysis-feed',
          input: {
            topic: 'string (keyword/topic text) OR url',
            mode: 'auto/market-data',
            maxChars: 'number 200-8000'
          },
          price: X402_INFO_PRICE,
          recipient: resolveInfoSettlementRecipient()
        },
        {
          id: 'reactive-stop-orders',
          input: {
            symbol: 'string',
            takeProfit: 'number > 0',
            stopLoss: 'number > 0',
            quantity: 'number > 0 (optional)'
          },
          price: X402_REACTIVE_PRICE,
          recipient: KITE_AGENT2_AA_ADDRESS
        },
        {
          id: 'hyperliquid-order-testnet',
          input: {
            symbol: 'string (default BTCUSDT)',
            side: 'buy/sell',
            orderType: 'limit/market',
            size: 'number > 0',
            price: 'number > 0 (required for limit)',
            tif: 'Gtc/Ioc/Alo'
          },
          price: X402_HYPERLIQUID_ORDER_PRICE,
          recipient: HYPERLIQUID_ORDER_RECIPIENT || MERCHANT_ADDRESS
        }
      ]
    };
  }

  function validatePaymentProof(reqItem, paymentProof) {
    if (!paymentProof || typeof paymentProof !== 'object') return 'missing payment proof';
    if (!paymentProof.txHash) return 'missing txHash';
    if (paymentProof.requestId !== reqItem.requestId) return 'requestId mismatch';
    if (normalizeAddress(paymentProof.tokenAddress) !== normalizeAddress(reqItem.tokenAddress)) return 'token mismatch';
    if (normalizeAddress(paymentProof.recipient) !== normalizeAddress(reqItem.recipient)) return 'recipient mismatch';
    if (String(paymentProof.amount) !== String(reqItem.amount)) return 'amount mismatch';
    return '';
  }

  function toSafeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  function stableSerialize(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
    }
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`).join(',')}}`;
  }

  function sha256HexFromUtf8(input = '') {
    return crypto.createHash('sha256').update(String(input || ''), 'utf8').digest('hex');
  }

  function digestStableObject(value) {
    const canonical = stableSerialize(value);
    return {
      algorithm: 'sha256',
      canonicalization: 'stableSerialize',
      value: sha256HexFromUtf8(canonical)
    };
  }

  function buildResponseHash(requestId = '', action = '', resultPayload = {}) {
    const envelope = {
      requestId: String(requestId || '').trim(),
      action: String(action || '').trim().toLowerCase(),
      result: resultPayload && typeof resultPayload === 'object' ? resultPayload : {}
    };
    const canonical = stableSerialize(envelope);
    const responseHash = ethers.keccak256(ethers.toUtf8Bytes(canonical));
    return { envelope, canonical, responseHash };
  }

  async function signResponseHash(hash = '') {
    const normalized = String(hash || '').trim();
    const backendSigner = typeof getBackendSigner === 'function' ? getBackendSigner() : null;
    if (!/^0x[0-9a-fA-F]{64}$/.test(normalized) || !backendSigner) {
      return {
        signature: '',
        signer: backendSigner?.address || '',
        scheme: 'personal_sign',
        available: Boolean(backendSigner)
      };
    }
    try {
      const signature = await backendSigner.signMessage(ethers.getBytes(normalized));
      return {
        signature: String(signature || '').trim(),
        signer: backendSigner.address,
        scheme: 'personal_sign',
        available: true
      };
    } catch {
      return {
        signature: '',
        signer: backendSigner?.address || '',
        scheme: 'personal_sign',
        available: Boolean(backendSigner)
      };
    }
  }

  function getUtcDateKey(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate()
    ).padStart(2, '0')}`;
  }

  function buildPolicySnapshot() {
    return readPolicyConfig();
  }

  function logPolicyFailure(entry) {
    const logs = readPolicyFailures();
    logs.unshift({
      time: new Date().toISOString(),
      ...entry
    });
    writePolicyFailures(logs.slice(0, 300));
  }

  function sumPaidAmountByPayerForUtcDay(requests, payer, utcDateKey) {
    return requests
      .filter((item) => {
        if (String(item.status).toLowerCase() !== 'paid') return false;
        if (normalizeAddress(item.payer) !== normalizeAddress(payer)) return false;
        const mark = item.paidAt || item.createdAt;
        if (!mark) return false;
        return getUtcDateKey(Number(mark)) === utcDateKey;
      })
      .reduce((acc, item) => acc + (toSafeNumber(item.amount) || 0), 0);
  }

  function evaluateTransferPolicy({ payer, recipient, amount, requests }) {
    const policy = buildPolicySnapshot();
    const payerLc = normalizeAddress(payer);

    if (!payerLc || !ethers.isAddress(payerLc)) {
      return {
        ok: false,
        code: 'invalid_payer',
        message: 'Payer must be a valid address.',
        evidence: {
          actual: payer
        }
      };
    }

    if (Array.isArray(policy.revokedPayers) && policy.revokedPayers.includes(payerLc)) {
      return {
        ok: false,
        code: 'payer_revoked',
        message: 'Payer is revoked by gateway guardrail.',
        evidence: {
          payer: payerLc,
          revokedPayers: policy.revokedPayers
        }
      };
    }

    const amountNum = toSafeNumber(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return {
        ok: false,
        code: 'invalid_amount',
        message: 'Amount must be a positive number.',
        evidence: {
          actual: amount,
          expected: '> 0'
        }
      };
    }

    if (!recipient || !ethers.isAddress(recipient)) {
      return {
        ok: false,
        code: 'invalid_recipient',
        message: 'Recipient must be a valid address.',
        evidence: {
          actual: recipient,
          expected: '0x + 40 hex address'
        }
      };
    }

    const recipientLc = normalizeAddress(recipient);
    if (policy.allowedRecipients.length > 0 && !policy.allowedRecipients.includes(recipientLc)) {
      return {
        ok: false,
        code: 'scope_violation',
        message: 'Recipient is outside allowed scope.',
        evidence: {
          actualRecipient: recipientLc,
          allowedRecipients: policy.allowedRecipients
        }
      };
    }

    if (amountNum > policy.maxPerTx) {
      return {
        ok: false,
        code: 'over_limit_per_tx',
        message: 'Amount exceeds per-transaction limit.',
        evidence: {
          actualAmount: amountNum,
          maxPerTx: policy.maxPerTx
        }
      };
    }

    const utcDateKey = getUtcDateKey(Date.now());
    const spentToday = sumPaidAmountByPayerForUtcDay(requests, payer, utcDateKey);
    const projected = spentToday + amountNum;
    if (projected > policy.dailyLimit) {
      return {
        ok: false,
        code: 'over_limit_daily',
        message: 'Amount exceeds daily budget limit.',
        evidence: {
          utcDate: utcDateKey,
          spentToday,
          requestedAmount: amountNum,
          projectedTotal: projected,
          dailyLimit: policy.dailyLimit
        }
      };
    }

    return {
      ok: true,
      code: 'allowed',
      message: 'Policy checks passed.',
      evidence: {
        amount: amountNum,
        recipient: recipientLc,
        ...buildPolicySnapshot()
      }
    };
  }

  async function verifyProofOnChain(reqItem, paymentProof) {
    try {
      const txHash = String(paymentProof?.txHash || '').trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        return { ok: false, reason: 'invalid txHash format' };
      }

      const tokenAddress = normalizeAddress(reqItem?.tokenAddress || '');
      const recipient = normalizeAddress(reqItem?.recipient || '');
      const payer = normalizeAddress(reqItem?.payer || '');
      if (!tokenAddress || !recipient) {
        return { ok: false, reason: 'missing expected token/recipient in request' };
      }

      let expectedAmountRaw = null;
      try {
        expectedAmountRaw = ethers.parseUnits(String(reqItem?.amount || '0'), 18);
      } catch {
        return { ok: false, reason: 'invalid expected amount' };
      }

      const receipt = await fetchReceiptWithRetry(txHash);
      if (!receipt) {
        return { ok: false, reason: 'transaction receipt not found (pending or unknown)' };
      }
      if (parseHexNumber(receipt.status) !== 1) {
        return { ok: false, reason: 'transaction reverted on-chain' };
      }

      const transferTopic = ethers.id('Transfer(address,address,uint256)');
      const transferIface = new ethers.Interface([
        'event Transfer(address indexed from, address indexed to, uint256 value)'
      ]);

      const candidateLogs = (receipt.logs || []).filter((log) => {
        return (
          normalizeAddress(log.address) === tokenAddress &&
          Array.isArray(log.topics) &&
          String(log.topics[0] || '').toLowerCase() === String(transferTopic).toLowerCase()
        );
      });

      for (const log of candidateLogs) {
        try {
          const parsed = transferIface.parseLog({
            topics: log.topics,
            data: log.data
          });
          const from = normalizeAddress(String(parsed.args.from));
          const to = normalizeAddress(String(parsed.args.to));
          const value = ethers.getBigInt(parsed.args.value);
          const amountMatch = value === expectedAmountRaw;
          const toMatch = to === recipient;
          const fromMatch = !payer || from === payer;
          if (amountMatch && toMatch && fromMatch) {
            return {
              ok: true,
              details: {
                txHash,
                blockNumber: parseHexNumber(receipt.blockNumber),
                tokenAddress,
                from,
                to,
                valueRaw: value.toString()
              }
            };
          }
        } catch {
          // ignore unparsable transfer logs
        }
      }

      return {
        ok: false,
        reason: 'no matching ERC20 Transfer log found for token/recipient/amount/payer'
      };
    } catch (error) {
      return {
        ok: false,
        reason: `proof verification rpc error: ${error?.message || 'unknown'}`
      };
    }
  }

  function parseHexNumber(value) {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    const str = String(value).trim();
    if (!str) return 0;
    if (str.startsWith('0x') || str.startsWith('0X')) return Number(BigInt(str));
    const n = Number(str);
    return Number.isFinite(n) ? n : 0;
  }

  async function withSessionUserOpLock(lockKey = '', task = async () => null) {
    const key = String(lockKey || 'default').trim().toLowerCase() || 'default';
    const slot = sessionUserOpQueue.get(key) || { tail: Promise.resolve(), gate: null };
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const tail = slot.tail
      .catch(() => {})
      .then(() => gate);
    sessionUserOpQueue.set(key, { tail, gate });
    await slot.tail.catch(() => {});
    try {
      return await task();
    } finally {
      release();
      const current = sessionUserOpQueue.get(key);
      if (current && current.gate === gate) {
        sessionUserOpQueue.delete(key);
      }
    }
  }

  function extractUserOpHashFromReason(reason = '') {
    const text = String(reason || '').trim();
    if (!text) return '';
    const matched = text.match(/0x[a-fA-F0-9]{64}/);
    return matched ? matched[0] : '';
  }

  function shouldFallbackToEoaRelay(reason = '') {
    const text = String(reason || '').trim().toLowerCase();
    if (!text) return false;
    return (
      text.includes('eth_estimateuseroperationgas') ||
      text.includes('execution reverted') ||
      text.includes('timeout waiting for useroperation') ||
      text.includes('useroperation timed out') ||
      text.includes('receipt not found') ||
      text.includes('bundler') ||
      text.includes('aa24') ||
      text.includes('sig_validation_failed')
    );
  }

  async function sendSessionTransferViaEoaRelay({
    provider,
    aaWallet,
    sessionId,
    authPayload,
    authSignature,
    serviceProvider,
    metadata
  } = {}) {
    const backendSigner = typeof getBackendSigner === 'function' ? getBackendSigner() : null;
    if (!backendSigner) {
      return { ok: false, reason: 'backend_signer_unavailable_for_eoa_relay' };
    }
    try {
      const signer = backendSigner.provider ? backendSigner : backendSigner.connect(provider);
      const relaySender = await signer.getAddress();
      const relayGas = await provider.getBalance(relaySender);
      if (relayGas <= 0n) {
        return { ok: false, reason: `backend_signer_insufficient_kite_gas:${relaySender}` };
      }
      const writeAbi = [
        'function executeTransferWithAuthorizationAndProvider(bytes32 sessionId, tuple(address from,address to,address token,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce) auth, bytes signature, bytes32 serviceProvider, bytes metadata) external'
      ];
      const account = new ethers.Contract(aaWallet, writeAbi, signer);
      const tx = await account.executeTransferWithAuthorizationAndProvider(
        sessionId,
        authPayload,
        authSignature,
        serviceProvider,
        metadata
      );
      const receipt = await tx.wait();
      if (!receipt || Number(receipt.status || 0) !== 1) {
        return {
          ok: false,
          reason: 'eoa_relay_transaction_failed',
          txHash: tx?.hash || ''
        };
      }
      return {
        ok: true,
        txHash: tx.hash,
        blockNumber: Number(receipt.blockNumber || 0),
        relaySender
      };
    } catch (error) {
      return {
        ok: false,
        reason: String(error?.message || 'eoa_relay_failed').trim()
      };
    }
  }

  async function callRpc(method, params = []) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROOF_RPC_TIMEOUT_MS);
    try {
      const resp = await fetch(BACKEND_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params
        }),
        signal: controller.signal
      });
      if (!resp.ok) {
        throw new Error(`rpc http ${resp.status}`);
      }
      const json = await resp.json().catch(() => ({}));
      if (json?.error) {
        throw new Error(json.error?.message || 'rpc returned error');
      }
      return json?.result;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`rpc timeout after ${PROOF_RPC_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function isTransientProofRpcError(error) {
    const text = String(error?.message || error || '').trim().toLowerCase();
    if (!text) return false;
    return (
      text.includes('timeout') ||
      text.includes('aborted') ||
      text.includes('econnreset') ||
      text.includes('etimedout') ||
      text.includes('socket hang up') ||
      text.includes('und_err_socket') ||
      text.includes('und_err_connect_timeout') ||
      text.includes('rpc http 429') ||
      text.includes('rpc http 502') ||
      text.includes('rpc http 503') ||
      text.includes('rpc http 504')
    );
  }

  async function fetchReceiptWithRetry(txHash) {
    const retries = Number.isFinite(PROOF_RPC_RETRIES) && PROOF_RPC_RETRIES > 0 ? PROOF_RPC_RETRIES : 1;
    const totalWaitMs =
      Number.isFinite(PROOF_RECEIPT_WAIT_MS) && PROOF_RECEIPT_WAIT_MS > 0
        ? Math.max(5_000, Math.min(PROOF_RECEIPT_WAIT_MS, 180_000))
        : 45_000;
    const pollIntervalMs =
      Number.isFinite(PROOF_RECEIPT_POLL_INTERVAL_MS) && PROOF_RECEIPT_POLL_INTERVAL_MS > 0
        ? Math.max(500, Math.min(PROOF_RECEIPT_POLL_INTERVAL_MS, 10_000))
        : 2_500;
    const deadline = Date.now() + totalWaitMs;
    let lastError = null;

    while (Date.now() <= deadline) {
      for (let i = 0; i < retries; i += 1) {
        try {
          const receipt = await callRpc('eth_getTransactionReceipt', [txHash]);
          if (receipt) {
            return receipt;
          }
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const transient = isTransientProofRpcError(error);
          const hasMoreAttempts = i < retries - 1;
          if (!transient) {
            throw error;
          }
          if (hasMoreAttempts) {
            await waitMs(Math.min(1_500 * (i + 1), pollIntervalMs));
          }
        }
      }
      if (Date.now() + pollIntervalMs > deadline) break;
      await waitMs(pollIntervalMs);
    }

    if (lastError && !isTransientProofRpcError(lastError)) {
      throw lastError;
    }
    if (lastError && isTransientProofRpcError(lastError)) {
      throw new Error(`${lastError.message}; receipt wait window ${totalWaitMs}ms exhausted`);
    }
    return null;
  }

  return {
    buildA2ACapabilities,
    buildPolicySnapshot,
    buildResponseHash,
    digestStableObject,
    evaluateTransferPolicy,
    extractUserOpHashFromReason,
    logPolicyFailure,
    sendSessionTransferViaEoaRelay,
    shouldFallbackToEoaRelay,
    signResponseHash,
    validatePaymentProof,
    verifyProofOnChain,
    withSessionUserOpLock
  };
}
