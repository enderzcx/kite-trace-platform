// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/interfaces/draft-IERC4337.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract KTraceAccountV3SessionExecute is Initializable, UUPSUpgradeable, IAccount {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    struct SessionRule {
        uint256 timeWindow;
        uint160 budget;
        uint96 initialWindowStartTime;
        bytes32[] targetProviders;
    }

    struct SessionConfig {
        address agent;
        bool active;
        uint64 ruleCount;
        uint256 expiresAt; // Finding 20 fix: session expiration timestamp (0 = no expiry)
    }

    struct WindowSpend {
        uint256 windowStart;
        uint256 spent;
    }

    struct SelectorPermission {
        bool enabled;
        uint256 maxAmount;
    }

    struct SelectorPermissionUpdate {
        bytes32 sessionId;
        address target;
        bytes4 selector;
        bool enabled;
        uint256 maxAmount;
    }

    struct TransferAuthorization {
        address from;
        address to;
        address token;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    struct OfficialJobView {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        uint8 status;
        address hook;
    }

    bytes4 private constant SELECTOR_APPROVE = bytes4(keccak256("approve(address,uint256)"));
    bytes4 private constant SELECTOR_CREATE_JOB =
        bytes4(keccak256("createJob(address,address,uint256,string,address)"));
    bytes4 private constant SELECTOR_SET_PROVIDER = bytes4(keccak256("setProvider(uint256,address)"));
    bytes4 private constant SELECTOR_SET_BUDGET = bytes4(keccak256("setBudget(uint256,uint256,bytes)"));
    bytes4 private constant SELECTOR_FUND = bytes4(keccak256("fund(uint256,bytes)"));
    bytes4 private constant SELECTOR_SUBMIT = bytes4(keccak256("submit(uint256,bytes32,bytes)"));
    bytes4 private constant SELECTOR_COMPLETE = bytes4(keccak256("complete(uint256,bytes32,bytes)"));
    bytes4 private constant SELECTOR_REJECT = bytes4(keccak256("reject(uint256,bytes32,bytes)"));
    bytes4 private constant SELECTOR_CLAIM_REFUND = bytes4(keccak256("claimRefund(uint256)"));
    bytes4 private constant SELECTOR_EXECUTE = bytes4(keccak256("execute(address,uint256,bytes)"));
    bytes4 private constant SELECTOR_EXECUTE_WITH_SESSION =
        bytes4(keccak256("executeWithSession(bytes32,address,uint256,bytes,bytes32,bytes)"));
    bytes4 private constant SELECTOR_SESSION_PAYMENT =
        bytes4(
            keccak256(
                "executeTransferWithAuthorizationAndProvider(bytes32,(address,address,address,uint256,uint256,uint256,bytes32),bytes,bytes32,bytes)"
            )
        );

    bytes32 private constant TRANSFER_AUTHORIZATION_TYPEHASH =
        keccak256(
            "TransferWithAuthorization(address from,address to,address token,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant SIG_VALIDATION_FAILED = 1;

    address private constant ENTRY_POINT = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;

    address private _owner;
    uint256 private _reentrancyLock;

    mapping(address => bool) private _supportedTokens;
    mapping(bytes32 => SessionConfig) private _sessions;
    mapping(bytes32 => mapping(uint256 => SessionRule)) private _sessionRules;
    mapping(bytes32 => mapping(uint256 => WindowSpend)) private _sessionWindowSpends;
    mapping(bytes32 => mapping(bytes32 => bool)) private _usedTransferNonces;
    mapping(bytes32 => mapping(address => mapping(bytes4 => SelectorPermission))) private _selectorPermissions;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event SupportedTokenUpdated(address indexed token, bool supported);
    event SessionCreated(bytes32 indexed sessionId, address indexed agent, uint256 ruleCount);
    event SessionRevoked(bytes32 indexed sessionId, address indexed agent);
    event SessionSelectorPermissionUpdated(
        bytes32 indexed sessionId,
        address indexed target,
        bytes4 indexed selector,
        bool enabled,
        uint256 maxAmount
    );
    event SessionPaymentExecuted(
        bytes32 indexed sessionId,
        address indexed token,
        address indexed recipient,
        uint256 amount,
        bytes32 serviceProvider,
        bytes32 authorizationNonce
    );
    event SessionGenericExecuted(
        bytes32 indexed sessionId,
        address indexed target,
        bytes4 indexed selector,
        bytes32 actionId
    );

    error OnlyOwner();
    error OnlyEntryPoint();
    error ZeroAddress();
    error InvalidSession();
    error InvalidSessionAgent();
    error InvalidSessionSignature();
    error InvalidAuthorization();
    error InvalidTarget();
    error InvalidSelector();
    error InvalidValue();
    error InvalidAuthz();
    error UnsupportedToken();
    error ReplayDetected();
    error PermissionDenied();
    error AmountLimitExceeded();
    error SpendingRuleFailed();
    error CallExecutionFailed(bytes returndata);

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        if (owner_ == address(0)) revert ZeroAddress();
        _owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function owner() public view returns (address) {
        return _owner;
    }

    function entryPoint() public pure returns (address) {
        return ENTRY_POINT;
    }

    function version() external pure returns (string memory) {
        return "GokiteAccountV3-session-execute";
    }

    function DOMAIN_NAME() external pure returns (string memory) {
        return "KTraceAccount";
    }

    function DOMAIN_VERSION() external pure returns (string memory) {
        return "3";
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addSupportedToken(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        _supportedTokens[token] = true;
        emit SupportedTokenUpdated(token, true);
    }

    function createSession(
        bytes32 sessionId,
        address agent,
        SessionRule[] calldata rules
    ) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        if (sessionId == bytes32(0)) revert InvalidSession();

        SessionConfig storage session = _sessions[sessionId];
        if (session.active) revert InvalidSession();

        session.agent = agent;
        session.active = true;
        session.ruleCount = uint64(rules.length);

        for (uint256 i = 0; i < rules.length; i++) {
            SessionRule storage storedRule = _sessionRules[sessionId][i];
            storedRule.timeWindow = rules[i].timeWindow;
            storedRule.budget = rules[i].budget;
            storedRule.initialWindowStartTime = rules[i].initialWindowStartTime;
            for (uint256 j = 0; j < rules[i].targetProviders.length; j++) {
                storedRule.targetProviders.push(rules[i].targetProviders[j]);
            }
        }

        emit SessionCreated(sessionId, agent, rules.length);
    }

    // Finding 18 fix: allow owner to revoke a session
    function revokeSession(bytes32 sessionId) external onlyOwner {
        SessionConfig storage session = _sessions[sessionId];
        if (!session.active) revert InvalidSession();
        session.active = false;
        emit SessionRevoked(sessionId, session.agent);
    }

    // Finding 20 fix: allow owner to set session expiry
    function setSessionExpiry(bytes32 sessionId, uint256 expiresAt) external onlyOwner {
        SessionConfig storage session = _sessions[sessionId];
        if (!session.active) revert InvalidSession();
        session.expiresAt = expiresAt;
    }

    function sessionExists(bytes32 sessionId) external view returns (bool) {
        SessionConfig storage session = _sessions[sessionId];
        if (!session.active) return false;
        if (session.expiresAt > 0 && block.timestamp >= session.expiresAt) return false;
        return true;
    }

    function getSessionAgent(bytes32 sessionId) external view returns (address) {
        return _sessions[sessionId].agent;
    }

    function getNonce() external view returns (uint256) {
        return IEntryPoint(entryPoint()).getNonce(address(this), 0);
    }

    function getSessionSelectorPermission(
        bytes32 sessionId,
        address target,
        bytes4 selector
    ) external view returns (bool enabled, uint256 maxAmount) {
        SelectorPermission storage permission = _selectorPermissions[sessionId][target][selector];
        return (permission.enabled, permission.maxAmount);
    }

    function setSessionSelectorPermission(
        bytes32 sessionId,
        address target,
        bytes4 selector,
        bool enabled,
        uint256 maxAmount
    ) external onlyOwner {
        _setSelectorPermission(sessionId, target, selector, enabled, maxAmount);
    }

    function setSessionSelectorPermissions(
        SelectorPermissionUpdate[] calldata updates
    ) external onlyOwner {
        for (uint256 i = 0; i < updates.length; i++) {
            _setSelectorPermission(
                updates[i].sessionId,
                updates[i].target,
                updates[i].selector,
                updates[i].enabled,
                updates[i].maxAmount
            );
        }
    }

    /// @notice Check if a payment amount is within session spending rules.
    /// @dev When timeWindow == 0, the rule acts as a per-transaction cap (not cumulative budget).
    ///      Each individual transaction is checked against rule.budget independently.
    ///      To enforce a total lifetime budget, use a non-zero timeWindow instead.
    function checkSpendingRules(
        bytes32 sessionId,
        uint256 normalizedAmount,
        bytes32 serviceProvider
    ) public view returns (bool) {
        SessionConfig storage session = _sessions[sessionId];
        if (!session.active || session.agent == address(0)) return false;
        if (session.expiresAt > 0 && block.timestamp >= session.expiresAt) return false;
        if (session.ruleCount == 0) return false;

        bool matchedRule = false;
        for (uint256 i = 0; i < session.ruleCount; i++) {
            SessionRule storage rule = _sessionRules[sessionId][i];
            if (!_matchesServiceProvider(rule, serviceProvider)) {
                continue;
            }
            matchedRule = true;
            if (rule.timeWindow == 0) {
                if (normalizedAmount > uint256(rule.budget)) {
                    return false;
                }
                continue;
            }
            uint256 activeWindowStart = _resolveWindowStart(rule);
            if (activeWindowStart == 0 && rule.initialWindowStartTime > block.timestamp) {
                return false;
            }
            WindowSpend storage spend = _sessionWindowSpends[sessionId][i];
            uint256 currentSpent =
                spend.windowStart == activeWindowStart ? spend.spent : 0;
            if (currentSpent + normalizedAmount > uint256(rule.budget)) {
                return false;
            }
        }
        return matchedRule;
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override returns (uint256 validationData) {
        if (msg.sender != entryPoint()) revert OnlyEntryPoint();

        bytes4 selector = _selectorOfCalldata(userOp.callData);
        bool valid;

        if (_recoverPersonalSigner(userOpHash, userOp.signature) == _owner) {
            valid = true;
        } else if (selector == SELECTOR_SESSION_PAYMENT) {
            valid = _validateSessionPaymentUserOp(userOp, userOpHash);
        } else if (selector == SELECTOR_EXECUTE_WITH_SESSION) {
            valid = _validateSessionGenericUserOp(userOp, userOpHash);
        } else {
            valid = false;
        }

        if (missingAccountFunds > 0) {
            (bool success, ) = payable(msg.sender).call{value: missingAccountFunds}("");
            success;
        }
        return valid ? 0 : SIG_VALIDATION_FAILED;
    }

    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external payable nonReentrant {
        _requireFromEntryPointOrOwner();
        _call(dest, value, func);
    }

    function executeBatch(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external payable nonReentrant {
        _requireFromEntryPointOrOwner();
        if (dest.length != func.length || (value.length != 0 && value.length != dest.length)) {
            revert InvalidAuthorization();
        }
        for (uint256 i = 0; i < dest.length; i++) {
            uint256 itemValue = value.length == 0 ? 0 : value[i];
            _call(dest[i], itemValue, func[i]);
        }
    }

    function executeWithSession(
        bytes32 sessionId,
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 actionId,
        bytes calldata authz
    ) external nonReentrant {
        if (msg.sender != entryPoint()) revert OnlyEntryPoint();
        if (authz.length != 0) revert InvalidAuthz();
        if (value != 0) revert InvalidValue();
        _assertSessionGenericAllowed(sessionId, target, data);
        emit SessionGenericExecuted(sessionId, target, _selectorOfCalldata(data), actionId);
        _call(target, value, data);
    }

    function executeTransferWithAuthorizationAndProvider(
        bytes32 sessionId,
        TransferAuthorization calldata auth,
        bytes calldata signature,
        bytes32 serviceProvider,
        bytes calldata metadata
    ) external nonReentrant {
        metadata;
        SessionConfig storage session = _sessions[sessionId];
        if (!session.active || session.agent == address(0)) revert InvalidSession();
        // Finding 20 fix: check session expiry
        if (session.expiresAt > 0 && block.timestamp >= session.expiresAt) revert InvalidSession();
        if (!_supportedTokens[auth.token]) revert UnsupportedToken();
        if (auth.from != address(this)) revert InvalidAuthorization();
        if (block.timestamp < auth.validAfter || block.timestamp > auth.validBefore) {
            revert InvalidAuthorization();
        }
        if (_usedTransferNonces[sessionId][auth.nonce]) revert ReplayDetected();
        if (_recoverTransferAuthorizationSigner(auth, signature) != session.agent) {
            revert InvalidSessionSignature();
        }
        if (!checkSpendingRules(sessionId, auth.value, serviceProvider)) {
            revert SpendingRuleFailed();
        }

        _consumeSpendingRules(sessionId, auth.value, serviceProvider);
        _usedTransferNonces[sessionId][auth.nonce] = true;
        IERC20(auth.token).safeTransfer(auth.to, auth.value);

        emit SessionPaymentExecuted(
            sessionId,
            auth.token,
            auth.to,
            auth.value,
            serviceProvider,
            auth.nonce
        );
    }

    receive() external payable {}

    modifier onlyOwner() {
        if (msg.sender != _owner) revert OnlyOwner();
        _;
    }

    modifier nonReentrant() {
        if (_reentrancyLock != 0) revert InvalidAuthorization();
        _reentrancyLock = 1;
        _;
        _reentrancyLock = 0;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function _setSelectorPermission(
        bytes32 sessionId,
        address target,
        bytes4 selector,
        bool enabled,
        uint256 maxAmount
    ) internal {
        if (!_sessions[sessionId].active) revert InvalidSession();
        if (target == address(0)) revert ZeroAddress();
        if (selector == bytes4(0)) revert InvalidSelector();
        _selectorPermissions[sessionId][target][selector] = SelectorPermission({
            enabled: enabled,
            maxAmount: maxAmount
        });
        emit SessionSelectorPermissionUpdated(sessionId, target, selector, enabled, maxAmount);
    }

    function _validateSessionPaymentUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view returns (bool) {
        (
            bytes32 sessionId,
            TransferAuthorization memory auth,
            bytes memory authSignature,
            bytes32 serviceProvider,
            bytes memory metadata
        ) = abi.decode(
                userOp.callData[4:],
                (bytes32, TransferAuthorization, bytes, bytes32, bytes)
            );
        metadata;
        SessionConfig storage session = _sessions[sessionId];
        if (!session.active || session.agent == address(0)) return false;
        if (session.expiresAt > 0 && block.timestamp >= session.expiresAt) return false;
        if (_recoverPersonalSigner(userOpHash, userOp.signature) != session.agent) return false;
        if (auth.from != address(this)) return false;
        if (!_supportedTokens[auth.token]) return false;
        if (block.timestamp < auth.validAfter || block.timestamp > auth.validBefore) return false;
        if (_usedTransferNonces[sessionId][auth.nonce]) return false;
        if (_recoverTransferAuthorizationSigner(auth, authSignature) != session.agent) return false;
        return checkSpendingRules(sessionId, auth.value, serviceProvider);
    }

    function _validateSessionGenericUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view returns (bool) {
        (
            bytes32 sessionId,
            address target,
            uint256 value,
            bytes memory data,
            bytes32 actionId,
            bytes memory authz
        ) = abi.decode(
                userOp.callData[4:],
                (bytes32, address, uint256, bytes, bytes32, bytes)
            );
        actionId;
        SessionConfig storage session = _sessions[sessionId];
        if (!session.active || session.agent == address(0)) return false;
        if (session.expiresAt > 0 && block.timestamp >= session.expiresAt) return false;
        if (_recoverPersonalSigner(userOpHash, userOp.signature) != session.agent) return false;
        if (value != 0 || authz.length != 0) return false;
        return _isSessionGenericAllowed(sessionId, target, data);
    }

    function _assertSessionGenericAllowed(
        bytes32 sessionId,
        address target,
        bytes calldata data
    ) internal view {
        if (!_isSessionGenericAllowed(sessionId, target, data)) {
            revert PermissionDenied();
        }
    }

    function _isSessionGenericAllowed(
        bytes32 sessionId,
        address target,
        bytes memory data
    ) internal view returns (bool) {
        SessionConfig storage session = _sessions[sessionId];
        if (!session.active) return false;
        if (session.expiresAt > 0 && block.timestamp >= session.expiresAt) return false;
        if (target == address(0) || data.length < 4) return false;
        bytes4 innerSelector = _selectorOf(data);
        SelectorPermission storage permission = _selectorPermissions[sessionId][target][innerSelector];
        if (!permission.enabled) return false;
        if (permission.maxAmount == 0) return true;
        uint256 amountToCheck = _extractAmountForSelector(target, innerSelector, data);
        if (amountToCheck == type(uint256).max) return false;
        return amountToCheck <= permission.maxAmount;
    }

    function _extractAmountForSelector(
        address target,
        bytes4 selector,
        bytes memory data
    ) internal view returns (uint256) {
        bytes memory payload = _payloadAfterSelector(data);
        if (selector == SELECTOR_APPROVE) {
            (, uint256 amount) = abi.decode(payload, (address, uint256));
            return amount;
        }
        if (selector == SELECTOR_SET_BUDGET) {
            (, uint256 amount, ) = abi.decode(payload, (uint256, uint256, bytes));
            return amount;
        }
        if (selector == SELECTOR_FUND) {
            (uint256 jobId, ) = abi.decode(payload, (uint256, bytes));
            return _readOfficialJobBudget(target, jobId);
        }
        return 0;
    }

    function _readOfficialJobBudget(address target, uint256 jobId) internal view returns (uint256) {
        try IOfficialJobBudgetReader(target).getJob(jobId) returns (OfficialJobView memory job) {
            return job.budget;
        } catch {
            return type(uint256).max;
        }
    }

    function _consumeSpendingRules(
        bytes32 sessionId,
        uint256 normalizedAmount,
        bytes32 serviceProvider
    ) internal {
        SessionConfig storage session = _sessions[sessionId];
        if (!session.active || session.ruleCount == 0) revert SpendingRuleFailed();

        bool matchedRule = false;
        for (uint256 i = 0; i < session.ruleCount; i++) {
            SessionRule storage rule = _sessionRules[sessionId][i];
            if (!_matchesServiceProvider(rule, serviceProvider)) {
                continue;
            }
            matchedRule = true;
            if (rule.timeWindow == 0) {
                if (normalizedAmount > uint256(rule.budget)) revert SpendingRuleFailed();
                continue;
            }
            uint256 activeWindowStart = _resolveWindowStart(rule);
            if (activeWindowStart == 0 && rule.initialWindowStartTime > block.timestamp) {
                revert SpendingRuleFailed();
            }
            WindowSpend storage spend = _sessionWindowSpends[sessionId][i];
            if (spend.windowStart != activeWindowStart) {
                spend.windowStart = activeWindowStart;
                spend.spent = 0;
            }
            if (spend.spent + normalizedAmount > uint256(rule.budget)) revert SpendingRuleFailed();
            spend.spent += normalizedAmount;
        }
        if (!matchedRule) revert SpendingRuleFailed();
    }

    function _matchesServiceProvider(
        SessionRule storage rule,
        bytes32 serviceProvider
    ) internal view returns (bool) {
        if (rule.targetProviders.length == 0) return true;
        for (uint256 i = 0; i < rule.targetProviders.length; i++) {
            if (rule.targetProviders[i] == serviceProvider) {
                return true;
            }
        }
        return false;
    }

    function _resolveWindowStart(SessionRule storage rule) internal view returns (uint256) {
        if (rule.timeWindow == 0) return 0;
        uint256 initial = uint256(rule.initialWindowStartTime);
        if (initial == 0) {
            return block.timestamp - (block.timestamp % rule.timeWindow);
        }
        if (block.timestamp < initial) {
            return 0;
        }
        uint256 elapsed = block.timestamp - initial;
        uint256 windowOffset = elapsed / rule.timeWindow;
        return initial + (windowOffset * rule.timeWindow);
    }

    function _recoverPersonalSigner(
        bytes32 userOpHash,
        bytes calldata signature
    ) internal pure returns (address) {
        return MessageHashUtils.toEthSignedMessageHash(userOpHash).recover(signature);
    }

    function _recoverTransferAuthorizationSigner(
        TransferAuthorization memory auth,
        bytes memory signature
    ) internal view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_AUTHORIZATION_TYPEHASH,
                auth.from,
                auth.to,
                auth.token,
                auth.value,
                auth.validAfter,
                auth.validBefore,
                auth.nonce
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("KTraceAccount")),
                keccak256(bytes("3")),
                block.chainid,
                address(this)
            )
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(domainSeparator, structHash);
        return digest.recover(signature);
    }

    function _requireFromEntryPointOrOwner() internal view {
        if (msg.sender != entryPoint() && msg.sender != _owner) {
            revert InvalidAuthorization();
        }
    }

    function _call(address target, uint256 value, bytes memory data) internal {
        if (target == address(0)) revert InvalidTarget();
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        if (!success) revert CallExecutionFailed(returndata);
    }

    function _selectorOf(bytes memory data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        assembly {
            selector := mload(add(data, 32))
        }
    }

    function _payloadAfterSelector(bytes memory data) internal pure returns (bytes memory payload) {
        if (data.length <= 4) {
            return bytes("");
        }
        payload = new bytes(data.length - 4);
        for (uint256 i = 4; i < data.length; i++) {
            payload[i - 4] = data[i];
        }
    }

    function _selectorOfCalldata(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length < 4) return bytes4(0);
        assembly {
            selector := calldataload(data.offset)
        }
    }
}

interface IOfficialJobBudgetReader {
    function getJob(uint256 jobId) external view returns (KTraceAccountV3SessionExecute.OfficialJobView memory);
}
