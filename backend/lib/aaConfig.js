import { ethers } from 'ethers';

export const DEFAULT_KITE_AA_FACTORY_ADDRESS = '0xF720b28181D4729C66D691e41ADfa3ee027CB22B';
export const DEFAULT_KITE_AA_ACCOUNT_IMPLEMENTATION =
  '0x1E62047B0e1FFB8c801440ab7bdF682C5d9E9226';
export const DEFAULT_KITE_AA_V2_IMPLEMENTATION =
  '0x1E62047B0e1FFB8c801440ab7bdF682C5d9E9226';
export const DEFAULT_KITE_AA_REQUIRED_VERSION = 'GokiteAccountV3-session-execute';
export const DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION = 'GokiteAccountV3-session-execute';
export const DEFAULT_KITE_AA_KNOWN_BAD_FACTORIES = Object.freeze([
  '0x7112E8A6D6fC03fCab33E4FE3f8207F1eA9Be243'
]);

function normalizeAddressInput(value = '') {
  const text = String(value || '').trim();
  if (!text || !ethers.isAddress(text)) return '';
  return ethers.getAddress(text);
}

function normalizeVersionInput(value = '') {
  return String(value || '').trim();
}

function normalizeCapabilityFlag(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function inferCapabilitiesFromVersion(accountVersionTag = '') {
  const normalizedVersion = normalizeVersionInput(accountVersionTag).toLowerCase();
  if (!normalizedVersion) {
    return {
      sessionPayment: false,
      sessionGenericExecute: false
    };
  }
  if (
    normalizedVersion === DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION.toLowerCase() ||
    normalizedVersion.includes('session-execute')
  ) {
    return {
      sessionPayment: true,
      sessionGenericExecute: true
    };
  }
  if (
    normalizedVersion === DEFAULT_KITE_AA_REQUIRED_VERSION.toLowerCase() ||
    normalizedVersion.includes('session-userop')
  ) {
    return {
      sessionPayment: true,
      sessionGenericExecute: false
    };
  }
  return {
    sessionPayment: false,
    sessionGenericExecute: false
  };
}

export function resolveAaJobLaneRequiredVersion(value = '') {
  return normalizeVersionInput(
    value || process.env.KITE_AA_JOB_LANE_REQUIRED_VERSION || DEFAULT_KITE_AA_JOB_LANE_REQUIRED_VERSION
  );
}

export function deriveAaAccountCapabilities({
  accountVersion = '',
  accountVersionTag = '',
  accountCapabilities = {},
  requiredForJobLane = ''
} = {}) {
  const normalizedAccountVersion = normalizeVersionInput(accountVersion);
  const normalizedVersionTag = normalizeVersionInput(normalizedAccountVersion || accountVersionTag);
  const inferredCapabilities = inferCapabilitiesFromVersion(normalizedVersionTag);
  const explicitCapabilities =
    accountCapabilities && typeof accountCapabilities === 'object' && !Array.isArray(accountCapabilities)
      ? accountCapabilities
      : {};
  const capabilities = normalizedAccountVersion
    ? Object.freeze({
        sessionPayment: inferredCapabilities.sessionPayment,
        sessionGenericExecute: inferredCapabilities.sessionGenericExecute
      })
    : Object.freeze({
        sessionPayment: normalizeCapabilityFlag(
          explicitCapabilities.sessionPayment,
          inferredCapabilities.sessionPayment
        ),
        sessionGenericExecute: normalizeCapabilityFlag(
          explicitCapabilities.sessionGenericExecute,
          inferredCapabilities.sessionGenericExecute
        )
      });
  const normalizedRequiredForJobLane = normalizeVersionInput(requiredForJobLane)
    ? normalizeVersionInput(requiredForJobLane)
    : 'sessionGenericExecute';
  return Object.freeze({
    accountVersionTag: normalizedVersionTag,
    accountCapabilities: capabilities,
    requiredForJobLane: normalizedRequiredForJobLane
  });
}

export function resolveAaFactoryAddress(value = '') {
  return normalizeAddressInput(value || process.env.KITE_AA_FACTORY_ADDRESS || DEFAULT_KITE_AA_FACTORY_ADDRESS);
}

export function resolveAaAccountImplementation(value = '') {
  return normalizeAddressInput(
    value ||
      process.env.KITE_AA_ACCOUNT_IMPLEMENTATION ||
      process.env.KITE_AA_EXPECTED_IMPLEMENTATION ||
      DEFAULT_KITE_AA_ACCOUNT_IMPLEMENTATION
  );
}

export function resolveAaExpectedImplementation(value = '') {
  return normalizeAddressInput(
    value || process.env.KITE_AA_EXPECTED_IMPLEMENTATION || DEFAULT_KITE_AA_V2_IMPLEMENTATION
  );
}

export function resolveAaRequiredVersion(value = '') {
  return String(value || process.env.KITE_AA_REQUIRED_VERSION || DEFAULT_KITE_AA_REQUIRED_VERSION).trim();
}

export function resolveAaKnownBadFactories(value = '') {
  const raw = String(value || process.env.KITE_AA_KNOWN_BAD_FACTORIES || '').trim();
  const candidates = raw
    ? raw
        .split(',')
        .map((item) => normalizeAddressInput(item || ''))
        .filter(Boolean)
    : DEFAULT_KITE_AA_KNOWN_BAD_FACTORIES.map((item) => normalizeAddressInput(item)).filter(Boolean);
  return Object.freeze(Array.from(new Set(candidates)));
}
