// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TrustPublicationAnchorV1 {
    address public owner;
    uint256 private _nextAnchorId = 1;

    struct Publication {
        uint256 anchorId;
        string publicationType;
        string sourceId;
        string agentId;
        string referenceId;
        string traceId;
        bytes32 payloadHash;
        string detailsURI;
        address publisher;
        uint64 createdAt;
    }

    mapping(uint256 => Publication) private _publicationOf;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TrustPublicationAnchored(
        uint256 indexed anchorId,
        bytes32 indexed publicationTypeHash,
        bytes32 indexed sourceIdHash,
        string publicationType,
        string sourceId,
        string agentId,
        string referenceId,
        string traceId,
        bytes32 payloadHash,
        string detailsURI,
        address publisher
    );

    error NotOwner();
    error InvalidOwner();

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidOwner();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidOwner();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function publishTrustPublication(
        string calldata publicationType,
        string calldata sourceId,
        string calldata agentId,
        string calldata referenceId,
        string calldata traceId,
        bytes32 payloadHash,
        string calldata detailsURI
    ) external onlyOwner returns (uint256 anchorId) {
        anchorId = _nextAnchorId;
        _nextAnchorId += 1;

        _publicationOf[anchorId] = Publication({
            anchorId: anchorId,
            publicationType: publicationType,
            sourceId: sourceId,
            agentId: agentId,
            referenceId: referenceId,
            traceId: traceId,
            payloadHash: payloadHash,
            detailsURI: detailsURI,
            publisher: msg.sender,
            createdAt: uint64(block.timestamp)
        });

        emit TrustPublicationAnchored(
            anchorId,
            keccak256(bytes(publicationType)),
            keccak256(bytes(sourceId)),
            publicationType,
            sourceId,
            agentId,
            referenceId,
            traceId,
            payloadHash,
            detailsURI,
            msg.sender
        );
    }

    function getPublication(uint256 anchorId)
        external
        view
        returns (
            string memory publicationType,
            string memory sourceId,
            string memory agentId,
            string memory referenceId,
            string memory traceId,
            bytes32 payloadHash,
            string memory detailsURI,
            address publisher,
            uint64 createdAt
        )
    {
        Publication storage publication = _publicationOf[anchorId];
        return (
            publication.publicationType,
            publication.sourceId,
            publication.agentId,
            publication.referenceId,
            publication.traceId,
            publication.payloadHash,
            publication.detailsURI,
            publication.publisher,
            publication.createdAt
        );
    }
}
