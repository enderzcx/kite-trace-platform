export const identityRegistryProbeAbi = [
  'function registerFee() view returns (uint256)',
  'function metadataUpdateFee() view returns (uint256)'
];

export const identityRegistryReadAbi = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function getAgentWallet(uint256 agentId) view returns (address)',
  'function getMetadataByName(uint256 tokenId, string memory key) view returns (string memory)'
];

export const identityRegistryRegisterAbi = [
  ...identityRegistryProbeAbi,
  ...identityRegistryReadAbi,
  'function register(string tokenURI) payable returns (uint256)',
  'function setAgentWallet(uint256 agentId, address newWallet) payable',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
];
