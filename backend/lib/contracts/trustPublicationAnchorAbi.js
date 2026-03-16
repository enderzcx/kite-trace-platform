export const trustPublicationAnchorAbi = [
  'function owner() view returns (address)',
  'function publishTrustPublication(string publicationType, string sourceId, string agentId, string referenceId, string traceId, bytes32 payloadHash, string detailsURI) returns (uint256)',
  'function getPublication(uint256 anchorId) view returns (string publicationType, string sourceId, string agentId, string referenceId, string traceId, bytes32 payloadHash, string detailsURI, address publisher, uint64 createdAt)',
  'event TrustPublicationAnchored(uint256 indexed anchorId, bytes32 indexed publicationTypeHash, bytes32 indexed sourceIdHash, string publicationType, string sourceId, string agentId, string referenceId, string traceId, bytes32 payloadHash, string detailsURI, address publisher)'
];
