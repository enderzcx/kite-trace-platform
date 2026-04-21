// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/utils/Create2.sol";

interface IKTraceAccountV3Initializable {
    function initialize(address owner_, address entryPoint_) external;
}

/// @notice Factory for KTraceAccountV3SessionExecute (ERC-4337 v0.7 account impl).
/// @dev V1 encoded a 1-arg initialize(owner) which did not match the impl's
///      initialize(owner, entryPoint), causing every createAccount to revert.
///      V2 stores entryPoint as immutable and encodes the correct 2-arg init.
contract KTraceAccountFactoryV2 is Ownable {
    error AccountImplementationRequired();
    error EntryPointRequired();
    error InvalidOwner();

    address public accountImplementation;
    address public immutable entryPoint;

    event AccountCreated(address indexed owner, uint256 indexed salt, address indexed account);
    event AccountImplementationUpdated(
        address indexed previousImplementation,
        address indexed nextImplementation
    );

    constructor(
        address initialOwner,
        address initialImplementation,
        address entryPoint_
    ) Ownable(initialOwner) {
        if (entryPoint_ == address(0)) revert EntryPointRequired();
        entryPoint = entryPoint_;
        _setAccountImplementation(initialImplementation);
    }

    function setAccountImplementation(address nextImplementation) external onlyOwner {
        _setAccountImplementation(nextImplementation);
    }

    function createAccount(address owner, uint256 salt) external returns (address account) {
        if (owner == address(0)) revert InvalidOwner();
        account = getAddress(owner, salt);
        if (account.code.length > 0) {
            return account;
        }
        bytes memory creationCode = _buildCreationCode(owner);
        account = Create2.deploy(0, bytes32(salt), creationCode);
        emit AccountCreated(owner, salt, account);
    }

    function getAddress(address owner, uint256 salt) public view returns (address) {
        if (owner == address(0)) revert InvalidOwner();
        bytes memory creationCode = _buildCreationCode(owner);
        return Create2.computeAddress(bytes32(salt), keccak256(creationCode), address(this));
    }

    function _setAccountImplementation(address nextImplementation) internal {
        if (nextImplementation == address(0)) revert AccountImplementationRequired();
        address previousImplementation = accountImplementation;
        accountImplementation = nextImplementation;
        emit AccountImplementationUpdated(previousImplementation, nextImplementation);
    }

    function _buildCreationCode(address owner) internal view returns (bytes memory) {
        bytes memory initializeCallData = abi.encodeCall(
            IKTraceAccountV3Initializable.initialize,
            (owner, entryPoint)
        );
        return abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(accountImplementation, initializeCallData)
        );
    }
}
