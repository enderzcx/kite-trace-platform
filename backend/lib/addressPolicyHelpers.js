import { ethers } from 'ethers';

export function normalizeAddress(address = '') {
  return String(address).trim().toLowerCase();
}

export function normalizePrivateKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.startsWith('0x') ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(normalized) ? normalized : '';
}

export function deriveAddressFromPrivateKey(value = '') {
  const privateKey = normalizePrivateKey(value);
  if (!privateKey) return '';
  try {
    return normalizeAddress(new ethers.Wallet(privateKey).address || '');
  } catch {
    return '';
  }
}

export function getServiceProviderBytes32(action) {
  const normalized = String(action || '').trim().toLowerCase();
  if (normalized === 'reactive-stop-orders') {
    return ethers.encodeBytes32String('reactive-stop-orders');
  }
  if (normalized === 'btc-price-feed') {
    const alias = String(process.env.KITE_BTC_SERVICE_PROVIDER_ALIAS || 'kol-score')
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  if (normalized === 'risk-score-feed') {
    const alias = String(process.env.KITE_RISK_SERVICE_PROVIDER_ALIAS || 'kol-score')
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  if (normalized === 'technical-analysis-feed') {
    const alias = String(
      process.env.KITE_TECHNICAL_SERVICE_PROVIDER_ALIAS || process.env.KITE_RISK_SERVICE_PROVIDER_ALIAS || 'kol-score'
    )
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  if (normalized === 'x-reader-feed') {
    const alias = String(process.env.KITE_XREADER_SERVICE_PROVIDER_ALIAS || 'kol-score')
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  if (normalized === 'info-analysis-feed') {
    const alias = String(
      process.env.KITE_INFO_SERVICE_PROVIDER_ALIAS || process.env.KITE_XREADER_SERVICE_PROVIDER_ALIAS || 'kol-score'
    )
      .trim()
      .toLowerCase();
    if (alias === 'reactive-stop-orders') {
      return ethers.encodeBytes32String('reactive-stop-orders');
    }
    return ethers.encodeBytes32String('kol-score');
  }
  return ethers.encodeBytes32String('kol-score');
}

export function normalizeRecipients(input) {
  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((v) => v.trim());
  return arr
    .map((addr) => normalizeAddress(addr))
    .filter((addr, index, self) => addr && ethers.isAddress(addr) && self.indexOf(addr) === index);
}

export function normalizeAddresses(input) {
  const arr = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((v) => v.trim());
  return arr
    .map((addr) => normalizeAddress(addr))
    .filter((addr, index, self) => addr && ethers.isAddress(addr) && self.indexOf(addr) === index);
}

export function createPolicyConfigHelpers({
  fs,
  path,
  policyConfigPath,
  policyMaxPerTxDefault,
  policyDailyLimitDefault,
  policyAllowedRecipientsDefault,
  merchantAddress,
  kiteAgent2AaAddress,
  resolveTechnicalSettlementRecipient,
  resolveInfoSettlementRecipient
}) {
  function getCoreAllowedRecipients() {
    return normalizeRecipients([
      merchantAddress,
      kiteAgent2AaAddress,
      resolveTechnicalSettlementRecipient(),
      resolveInfoSettlementRecipient()
    ]);
  }

  function mergeAllowedRecipients(addresses = []) {
    const merged = normalizeRecipients(addresses);
    for (const core of getCoreAllowedRecipients()) {
      if (!merged.includes(core)) merged.push(core);
    }
    return merged;
  }

  function sanitizePolicy(input = {}) {
    const maxPerTx = Number(input.maxPerTx);
    const dailyLimit = Number(input.dailyLimit);
    const allowedRecipients = mergeAllowedRecipients(
      normalizeRecipients(input.allowedRecipients).length > 0
        ? input.allowedRecipients
        : policyAllowedRecipientsDefault
    );
    const revokedPayers = normalizeAddresses(input.revokedPayers);
    return {
      maxPerTx: Number.isFinite(maxPerTx) && maxPerTx > 0 ? maxPerTx : policyMaxPerTxDefault,
      dailyLimit: Number.isFinite(dailyLimit) && dailyLimit > 0 ? dailyLimit : policyDailyLimitDefault,
      allowedRecipients,
      revokedPayers
    };
  }

  function ensurePolicyFile() {
    if (!fs.existsSync(policyConfigPath)) {
      fs.mkdirSync(path.dirname(policyConfigPath), { recursive: true });
      const initial = sanitizePolicy({
        maxPerTx: policyMaxPerTxDefault,
        dailyLimit: policyDailyLimitDefault,
        allowedRecipients: policyAllowedRecipientsDefault
      });
      fs.writeFileSync(policyConfigPath, JSON.stringify(initial, null, 2), 'utf8');
    }
  }

  function readPolicyConfig() {
    ensurePolicyFile();
    const raw = fs.readFileSync(policyConfigPath, 'utf8');
    const cleaned = raw.replace(/^\uFEFF/, '');
    return sanitizePolicy(JSON.parse(cleaned || '{}'));
  }

  function writePolicyConfig(input) {
    const next = sanitizePolicy(input);
    fs.writeFileSync(policyConfigPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  return {
    getCoreAllowedRecipients,
    mergeAllowedRecipients,
    sanitizePolicy,
    ensurePolicyFile,
    readPolicyConfig,
    writePolicyConfig
  };
}
