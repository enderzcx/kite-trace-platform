// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AgenticCommerceOfficialMinimal is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        address hook;
    }

    IERC20 public immutable paymentToken;
    address public platformTreasury;
    uint256 public platformFeeBP;
    uint256 public evaluatorFeeBP;
    uint256 public jobCounter;

    mapping(uint256 => Job) private _jobs;
    mapping(uint256 => bool) public jobHasBudget;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint256 expiredAt,
        address hook
    );
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event EvaluatorFeePaid(uint256 indexed jobId, address indexed evaluator, uint256 amount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event PlatformFeeUpdated(uint256 feeBP, address treasury);
    event EvaluatorFeeUpdated(uint256 feeBP);

    error InvalidJob();
    error WrongStatus();
    error Unauthorized();
    error ZeroAddress();
    error ExpiryTooShort();
    error ZeroBudget();
    error ProviderNotSet();
    error FeesTooHigh();
    error HookNotSupported();

    constructor(address paymentToken_, address treasury_) Ownable(msg.sender) {
        if (paymentToken_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        paymentToken = IERC20(paymentToken_);
        platformTreasury = treasury_;
    }

    function setPlatformFee(uint256 feeBP_, address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (feeBP_ + evaluatorFeeBP > 10_000) revert FeesTooHigh();
        platformFeeBP = feeBP_;
        platformTreasury = treasury_;
        emit PlatformFeeUpdated(feeBP_, treasury_);
    }

    function setEvaluatorFee(uint256 feeBP_) external onlyOwner {
        if (feeBP_ + platformFeeBP > 10_000) revert FeesTooHigh();
        evaluatorFeeBP = feeBP_;
        emit EvaluatorFeeUpdated(feeBP_);
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        Job memory job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();
        return job;
    }

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external nonReentrant returns (uint256) {
        if (evaluator == address(0)) revert ZeroAddress();
        if (expiredAt <= block.timestamp + 5 minutes) revert ExpiryTooShort();
        if (hook != address(0)) revert HookNotSupported();

        uint256 jobId = ++jobCounter;
        _jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: 0,
            expiredAt: expiredAt,
            status: JobStatus.Open,
            hook: hook
        });

        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, hook);
        return jobId;
    }

    function setProvider(uint256 jobId, address provider_) external nonReentrant {
        Job storage job = _mustGetJob(jobId);
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider != address(0)) revert WrongStatus();
        if (provider_ == address(0)) revert ZeroAddress();
        job.provider = provider_;
        emit ProviderSet(jobId, provider_);
    }

    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external nonReentrant {
        optParams;
        Job storage job = _mustGetJob(jobId);
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.provider) revert Unauthorized();
        if (amount == 0) revert ZeroBudget();
        if (block.timestamp >= job.expiredAt) revert WrongStatus();
        job.budget = amount;
        jobHasBudget[jobId] = true;
        emit BudgetSet(jobId, amount);
    }

    function fund(uint256 jobId, bytes calldata optParams) external nonReentrant {
        optParams;
        Job storage job = _mustGetJob(jobId);
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider == address(0)) revert ProviderNotSet();
        if (!jobHasBudget[jobId] || job.budget == 0) revert ZeroBudget();
        if (block.timestamp >= job.expiredAt) revert WrongStatus();

        paymentToken.safeTransferFrom(job.client, address(this), job.budget);
        job.status = JobStatus.Funded;
        emit JobFunded(jobId, job.client, job.budget);
    }

    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external nonReentrant {
        optParams;
        Job storage job = _mustGetJob(jobId);
        if (job.status != JobStatus.Funded) revert WrongStatus();
        if (msg.sender != job.provider) revert Unauthorized();
        if (block.timestamp >= job.expiredAt) revert WrongStatus();

        job.status = JobStatus.Submitted;
        emit JobSubmitted(jobId, msg.sender, deliverable);
    }

    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external nonReentrant {
        optParams;
        Job storage job = _mustGetJob(jobId);
        if (job.status != JobStatus.Submitted) revert WrongStatus();
        if (msg.sender != job.evaluator) revert Unauthorized();

        job.status = JobStatus.Completed;

        uint256 platformFee = (job.budget * platformFeeBP) / 10_000;
        uint256 evaluatorFee = (job.budget * evaluatorFeeBP) / 10_000;
        uint256 providerAmount = job.budget - platformFee - evaluatorFee;

        if (platformFee > 0) {
            paymentToken.safeTransfer(platformTreasury, platformFee);
        }
        if (evaluatorFee > 0) {
            paymentToken.safeTransfer(job.evaluator, evaluatorFee);
            emit EvaluatorFeePaid(jobId, job.evaluator, evaluatorFee);
        }
        paymentToken.safeTransfer(job.provider, providerAmount);

        emit JobCompleted(jobId, msg.sender, reason);
        emit PaymentReleased(jobId, job.provider, providerAmount);
    }

    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external nonReentrant {
        optParams;
        Job storage job = _mustGetJob(jobId);
        if (job.status != JobStatus.Submitted) revert WrongStatus();
        if (msg.sender != job.evaluator) revert Unauthorized();

        job.status = JobStatus.Rejected;
        paymentToken.safeTransfer(job.client, job.budget);

        emit JobRejected(jobId, msg.sender, reason);
        emit Refunded(jobId, job.client, job.budget);
    }

    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = _mustGetJob(jobId);
        if (block.timestamp < job.expiredAt) revert WrongStatus();
        if (
            job.status == JobStatus.Completed ||
            job.status == JobStatus.Rejected ||
            job.status == JobStatus.Expired
        ) revert WrongStatus();

        job.status = JobStatus.Expired;
        emit JobExpired(jobId);

        if (jobHasBudget[jobId] && job.budget > 0) {
            paymentToken.safeTransfer(job.client, job.budget);
            emit Refunded(jobId, job.client, job.budget);
        }
    }

    function _mustGetJob(uint256 jobId) internal view returns (Job storage job) {
        job = _jobs[jobId];
        if (job.id == 0) revert InvalidJob();
    }
}
