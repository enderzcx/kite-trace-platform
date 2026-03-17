// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract JobEscrowV1 {
    enum JobState {
        None,
        Funded,
        Accepted,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        address requester;
        address executor;
        address validator;
        uint256 amount;
        uint256 executorStakeAmount;
        JobState state;
        bytes32 resultHash;
        uint64 deadlineAt;
        uint64 fundedAt;
        uint64 acceptedAt;
        uint64 submittedAt;
        uint64 resolvedAt;
        uint64 stakeFundedAt;
    }

    IERC20Minimal public immutable settlementToken;
    address public owner;

    mapping(string => Job) private jobs;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event JobFundsLocked(
        string indexed jobId,
        address indexed requester,
        address indexed executor,
        address validator,
        uint256 amount,
        uint64 deadlineAt,
        uint256 executorStakeAmount
    );
    event JobStakeLocked(string indexed jobId, address indexed executor, uint256 amount);
    event JobAccepted(string indexed jobId, address indexed executor, uint256 executorStakeAmount);
    event JobSubmitted(string indexed jobId, bytes32 indexed resultHash);
    event JobValidated(
        string indexed jobId,
        bool indexed approved,
        address recipient,
        uint256 escrowAmount,
        uint256 executorStakeAmount
    );
    event JobExpired(
        string indexed jobId,
        address indexed recipient,
        uint256 escrowAmount,
        uint256 executorStakeAmount
    );
    event JobSlashed(string indexed jobId, address indexed recipient, uint256 executorStakeAmount, string reason);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner_only");
        _;
    }

    constructor(address settlementToken_, address initialOwner) {
        require(settlementToken_ != address(0), "token_required");
        require(initialOwner != address(0), "owner_required");
        settlementToken = IERC20Minimal(settlementToken_);
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner_required");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function lockFunds(
        string calldata jobId,
        address requester,
        address executor,
        address validator,
        uint256 amount,
        uint64 deadlineAt,
        uint256 executorStakeAmount
    ) external {
        require(bytes(jobId).length > 0, "job_required");
        require(requester != address(0), "requester_required");
        require(executor != address(0), "executor_required");
        require(validator != address(0), "validator_required");
        require(msg.sender == requester, "requester_only");
        require(amount > 0, "amount_required");
        require(deadlineAt > block.timestamp, "deadline_required");

        Job storage job = jobs[jobId];
        require(job.state == JobState.None, "job_exists");
        require(settlementToken.transferFrom(msg.sender, address(this), amount), "transfer_from_failed");

        job.requester = requester;
        job.executor = executor;
        job.validator = validator;
        job.amount = amount;
        job.executorStakeAmount = executorStakeAmount;
        job.state = JobState.Funded;
        job.deadlineAt = deadlineAt;
        job.fundedAt = uint64(block.timestamp);

        emit JobFundsLocked(jobId, requester, executor, validator, amount, deadlineAt, executorStakeAmount);
    }

    function acceptJob(string calldata jobId) external {
        Job storage job = jobs[jobId];
        require(job.state == JobState.Funded, "job_not_funded");
        require(msg.sender == job.executor, "executor_only");
        require(!_deadlineReached(job), "job_expired");

        if (job.executorStakeAmount > 0) {
            require(
                settlementToken.transferFrom(msg.sender, address(this), job.executorStakeAmount),
                "stake_transfer_failed"
            );
            job.stakeFundedAt = uint64(block.timestamp);
            emit JobStakeLocked(jobId, msg.sender, job.executorStakeAmount);
        }

        job.state = JobState.Accepted;
        job.acceptedAt = uint64(block.timestamp);
        emit JobAccepted(jobId, job.executor, job.executorStakeAmount);
    }

    function submitResult(string calldata jobId, bytes32 resultHash) external {
        Job storage job = jobs[jobId];
        require(job.state == JobState.Accepted, "job_not_accepted");
        require(msg.sender == job.executor, "executor_only");
        require(!_deadlineReached(job), "job_expired");
        require(resultHash != bytes32(0), "result_hash_required");

        job.state = JobState.Submitted;
        job.resultHash = resultHash;
        job.submittedAt = uint64(block.timestamp);
        emit JobSubmitted(jobId, resultHash);
    }

    function validate(string calldata jobId, bool approved) external {
        Job storage job = jobs[jobId];
        require(job.state == JobState.Submitted, "job_not_submitted");
        require(msg.sender == job.validator, "validator_only");
        require(!_deadlineReached(job), "job_expired");

        address recipient = approved ? job.executor : job.requester;
        uint256 payout = job.amount + job.executorStakeAmount;

        job.state = approved ? JobState.Completed : JobState.Rejected;
        job.resolvedAt = uint64(block.timestamp);

        require(settlementToken.transfer(recipient, payout), "transfer_failed");
        if (!approved && job.executorStakeAmount > 0) {
            emit JobSlashed(jobId, recipient, job.executorStakeAmount, "validator_rejected");
        }
        emit JobValidated(jobId, approved, recipient, job.amount, job.executorStakeAmount);
    }

    function expireJob(string calldata jobId) external {
        Job storage job = jobs[jobId];
        require(
            job.state == JobState.Funded || job.state == JobState.Accepted || job.state == JobState.Submitted,
            "job_not_active"
        );
        require(_deadlineReached(job), "deadline_not_reached");

        uint256 slashedStake = job.state == JobState.Funded ? 0 : job.executorStakeAmount;
        uint256 payout = job.amount + slashedStake;

        job.state = JobState.Expired;
        job.resolvedAt = uint64(block.timestamp);

        require(settlementToken.transfer(job.requester, payout), "transfer_failed");
        if (slashedStake > 0) {
            emit JobSlashed(jobId, job.requester, slashedStake, "deadline_expired");
        }
        emit JobExpired(jobId, job.requester, job.amount, slashedStake);
    }

    function getJob(
        string calldata jobId
    )
        external
        view
        returns (
            address requester,
            address executor,
            address validator,
            uint256 amount,
            uint256 executorStakeAmount,
            uint8 state,
            bytes32 resultHash,
            uint64 deadlineAt,
            uint64 fundedAt,
            uint64 acceptedAt,
            uint64 submittedAt,
            uint64 resolvedAt,
            uint64 stakeFundedAt
        )
    {
        Job storage job = jobs[jobId];
        return (
            job.requester,
            job.executor,
            job.validator,
            job.amount,
            job.executorStakeAmount,
            uint8(job.state),
            job.resultHash,
            job.deadlineAt,
            job.fundedAt,
            job.acceptedAt,
            job.submittedAt,
            job.resolvedAt,
            job.stakeFundedAt
        );
    }

    function _deadlineReached(Job storage job) private view returns (bool) {
        return job.deadlineAt > 0 && block.timestamp > job.deadlineAt;
    }
}
