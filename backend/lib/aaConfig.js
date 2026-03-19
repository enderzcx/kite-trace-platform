import { ethers } from 'ethers';

export const DEFAULT_KITE_AA_FACTORY_ADDRESS = '0xAba80c4c8748c114Ba8b61cda3b0112333C3b96E';
export const DEFAULT_KITE_AA_ACCOUNT_IMPLEMENTATION =
  '0xF7681F4f70a2F2d114D03e6B93189cb549B8A503';
export const DEFAULT_KITE_AA_V2_IMPLEMENTATION =
  '0xD0dA36a3B402160901dC03a0B9B9f88D6cffA7b6';
export const DEFAULT_KITE_AA_REQUIRED_VERSION = 'GokiteAccountV2-session-userop';

function normalizeAddressInput(value = '') {
  const text = String(value || '').trim();
  if (!text || !ethers.isAddress(text)) return '';
  return ethers.getAddress(text);
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
