// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/utils/Create2.sol";

interface IKTraceAccountInitializable {
    function initialize(address owner) external;
}

contract KTraceAccountFactory is Ownable {
    error AccountImplementationRequired();
    error InvalidOwner();

    address public accountImplementation;

    event AccountCreated(address indexed owner, uint256 indexed salt, address indexed account);
    event AccountImplementationUpdated(address indexed previousImplementation, address indexed nextImplementation);

    constructor(address initialOwner, address initialImplementation) Ownable(initialOwner) {
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

        bytes memory initializeCallData = abi.encodeCall(IKTraceAccountInitializable.initialize, (owner));
        account = address(new ERC1967Proxy{salt: bytes32(salt)}(accountImplementation, initializeCallData));
        emit AccountCreated(owner, salt, account);
    }

    function getAddress(address owner, uint256 salt) public view returns (address) {
        if (owner == address(0)) revert InvalidOwner();
        bytes memory initializeCallData = abi.encodeCall(IKTraceAccountInitializable.initialize, (owner));
        bytes memory creationCode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(accountImplementation, initializeCallData)
        );
        return Create2.computeAddress(bytes32(salt), keccak256(creationCode), address(this));
    }

    function _setAccountImplementation(address nextImplementation) internal {
        if (nextImplementation == address(0)) revert AccountImplementationRequired();
        address previousImplementation = accountImplementation;
        accountImplementation = nextImplementation;
        emit AccountImplementationUpdated(previousImplementation, nextImplementation);
    }
}
