export const jobLifecycleAnchorV2Abi = [
  'function owner() view returns (address)',
  'function publishJobLifecycleAnchor(string anchorType, string jobId, string traceId, string providerId, string capability, string status, string paymentRequestId, string paymentTxHash, string validationId, string referenceId, bytes32 payloadHash, string detailsURI) returns (uint256)',
  'function hasAnchor(string jobId) view returns (bool)',
  'function latestAnchorId(string jobId) view returns (uint256)',
  'function getJobAnchor(uint256 anchorId) view returns (string anchorType, string jobId, string traceId, string providerId, string capability, string status, string paymentRequestId, string paymentTxHash, string validationId, string referenceId, bytes32 payloadHash, string detailsURI, address publisher, uint64 createdAt)',
  'event JobLifecycleAnchored(uint256 indexed anchorId, bytes32 indexed anchorTypeHash, bytes32 indexed jobIdHash, string anchorType, string jobId, string traceId, string providerId, string capability, string status, string paymentRequestId, string paymentTxHash, string validationId, string referenceId, bytes32 payloadHash, string detailsURI, address publisher)'
];
