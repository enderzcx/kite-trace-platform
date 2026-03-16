export function isTechnicalAnalysisAction(actionRaw = '') {
  const action = String(actionRaw || '').trim().toLowerCase();
  return action === 'technical-analysis-feed' || action === 'risk-score-feed';
}

export function isInfoAnalysisAction(actionRaw = '') {
  const action = String(actionRaw || '').trim().toLowerCase();
  return action === 'info-analysis-feed' || action === 'x-reader-feed';
}

export function createServiceRoutingHelpers({
  ethers,
  hyperliquidOrderRecipient,
  kiteAgent2AaAddress,
  merchantAddress,
  normalizeAddress,
  x402BtcPrice,
  x402HyperliquidOrderPrice,
  x402InfoPrice,
  x402ReactivePrice,
  x402RiskScorePrice,
  x402TechnicalPrice,
  x402XReaderPrice,
  x402Price,
  xmtpReaderAgentAaAddress,
  xmtpRiskAgentAaAddress
}) {
  function resolveTechnicalSettlementRecipient() {
    const candidate = normalizeAddress(xmtpRiskAgentAaAddress || kiteAgent2AaAddress || '');
    return ethers.isAddress(candidate) ? candidate : normalizeAddress(kiteAgent2AaAddress || '');
  }

  function resolveInfoSettlementRecipient() {
    const candidate = normalizeAddress(xmtpReaderAgentAaAddress || kiteAgent2AaAddress || '');
    return ethers.isAddress(candidate) ? candidate : normalizeAddress(kiteAgent2AaAddress || '');
  }

  function getActionConfig(actionRaw = '') {
    const action = String(actionRaw || 'kol-score').trim().toLowerCase();
    if (action === 'kol-score') {
      return {
        action: 'kol-score',
        amount: x402Price,
        recipient: merchantAddress,
        summary: 'KOL score report unlocked by x402 payment'
      };
    }
    if (action === 'reactive-stop-orders') {
      return {
        action: 'reactive-stop-orders',
        amount: x402ReactivePrice,
        recipient: kiteAgent2AaAddress,
        summary: 'Reactive contracts stop-orders signal unlocked by x402 payment'
      };
    }
    if (action === 'btc-price-feed') {
      return {
        action: 'btc-price-feed',
        amount: x402BtcPrice,
        recipient: kiteAgent2AaAddress,
        summary: 'BTC price quote unlocked by x402 payment'
      };
    }
    if (isTechnicalAnalysisAction(action)) {
      return {
        action: action === 'technical-analysis-feed' ? 'technical-analysis-feed' : 'risk-score-feed',
        amount: action === 'technical-analysis-feed' ? x402TechnicalPrice : x402RiskScorePrice,
        recipient: resolveTechnicalSettlementRecipient(),
        summary:
          action === 'technical-analysis-feed'
            ? 'Technical analysis unlocked by x402 payment'
            : 'BTC risk score unlocked by x402 payment'
      };
    }
    if (isInfoAnalysisAction(action)) {
      return {
        action: 'info-analysis-feed',
        amount: x402InfoPrice || x402XReaderPrice,
        recipient: resolveInfoSettlementRecipient(),
        summary: 'Info analysis unlocked by x402 payment'
      };
    }
    if (action === 'hyperliquid-order-testnet') {
      return {
        action: 'hyperliquid-order-testnet',
        amount: x402HyperliquidOrderPrice,
        recipient: hyperliquidOrderRecipient || merchantAddress,
        summary: 'Hyperliquid testnet order unlocked by x402 payment'
      };
    }
    return null;
  }

  return {
    resolveTechnicalSettlementRecipient,
    resolveInfoSettlementRecipient,
    getActionConfig
  };
}
