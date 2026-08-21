// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MTTStaking
 * @notice Multi-pool staking contract for MTT. Reward pools are funded EXCLUSIVELY
 *         by the Treasury role (see FRD Section 9.2) — never from stakers' own
 *         principal. APR is therefore a function of real Treasury inflow, not a
 *         fixed promise.
 *
 * Reward accounting follows the standard "Synthetix StakingRewards" streaming
 * model, applied per pool: a funding deposit is streamed linearly to stakers
 * over `rewardsDuration`. This makes each `fundRewardPool` call fully auditable
 * on-chain and prevents rewards from ever exceeding cumulative Treasury deposits.
 */
contract MTTStaking is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant POOL_ADMIN_ROLE = keccak256("POOL_ADMIN_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    IERC20 public immutable mtt;

    struct Pool {
        bool active;
        uint64 lockDuration;          // seconds principal is locked after staking
        uint64 rewardsDuration;       // seconds over which a funding deposit is streamed
        uint64 periodFinish;          // timestamp current reward-streaming period ends
        uint64 lastUpdateTime;
        uint256 rewardRate;           // reward tokens per second, scaled by 1e18 in accounting
        uint256 rewardPerTokenStored; // scaled by 1e18
        uint256 totalStaked;
        uint16 earlyUnstakePenaltyBps; // e.g. 3000 = 30% of PENDING rewards forfeited on early unstake
        uint256 totalRewardsFunded;    // cumulative Treasury deposits into this pool (audit trail)
        uint256 totalRewardsPaid;      // cumulative rewards actually paid out (audit trail)
    }

    struct UserInfo {
        uint256 amount;
        uint64 lockEnd;
        uint256 rewardPerTokenPaid;
        uint256 rewards; // accrued, unclaimed
    }

    uint256 public poolCount;
    mapping(uint256 => Pool) public pools;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    address public penaltyReceiver; // where forfeited rewards go (e.g., back to Treasury)

    event PoolCreated(uint256 indexed poolId, uint64 lockDuration, uint64 rewardsDuration, uint16 earlyUnstakePenaltyBps);
    event PoolFunded(uint256 indexed poolId, address indexed funder, uint256 amount, uint256 newRewardRate, uint64 newPeriodFinish);
    event Staked(uint256 indexed poolId, address indexed user, uint256 amount, uint64 lockEnd);
    event Unstaked(uint256 indexed poolId, address indexed user, uint256 amount, uint256 forfeitedRewards, bool early);
    event RewardClaimed(uint256 indexed poolId, address indexed user, uint256 amount);
    event PenaltyReceiverUpdated(address indexed newReceiver);

    constructor(address mttToken, address admin, address penaltyReceiver_) {
        require(mttToken != address(0) && admin != address(0) && penaltyReceiver_ != address(0), "zero addr");
        mtt = IERC20(mttToken);
        penaltyReceiver = penaltyReceiver_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POOL_ADMIN_ROLE, admin);
        _grantRole(TREASURY_ROLE, admin);
    }

    // ---------- Admin ----------

    function createPool(
        uint64 lockDuration,
        uint64 rewardsDuration,
        uint16 earlyUnstakePenaltyBps
    ) external onlyRole(POOL_ADMIN_ROLE) returns (uint256 poolId) {
        require(rewardsDuration > 0, "rewardsDuration=0");
        require(earlyUnstakePenaltyBps <= 10000, "penalty>100%");
        poolId = poolCount++;
        Pool storage pool = pools[poolId];
        pool.active = true;
        pool.lockDuration = lockDuration;
        pool.rewardsDuration = rewardsDuration;
        pool.earlyUnstakePenaltyBps = earlyUnstakePenaltyBps;
        emit PoolCreated(poolId, lockDuration, rewardsDuration, earlyUnstakePenaltyBps);
    }

    function setPoolActive(uint256 poolId, bool active) external onlyRole(POOL_ADMIN_ROLE) {
        pools[poolId].active = active;
    }

    function setPenaltyReceiver(address newReceiver) external onlyRole(POOL_ADMIN_ROLE) {
        require(newReceiver != address(0), "zero addr");
        penaltyReceiver = newReceiver;
        emit PenaltyReceiverUpdated(newReceiver);
    }

    /**
     * @notice The ONLY way reward balances increase. Restricted to TREASURY_ROLE,
     *         intended to be held by the multisig-controlled Revenue Treasury
     *         described in FRD Section 2.2 / 9.5. Pulls `amount` MTT from the
     *         caller and streams it to stakers over the pool's rewardsDuration.
     */
    function fundRewardPool(uint256 poolId, uint256 amount) external onlyRole(TREASURY_ROLE) nonReentrant {
        require(amount > 0, "amount=0");
        Pool storage pool = pools[poolId];
        require(pool.active, "pool inactive");

        _updatePoolRewards(poolId);

        if (block.timestamp >= pool.periodFinish) {
            pool.rewardRate = (amount * 1e18) / pool.rewardsDuration;
        } else {
            uint256 remaining = pool.periodFinish - block.timestamp;
            uint256 leftover = remaining * pool.rewardRate;
            pool.rewardRate = ((amount * 1e18) + leftover) / pool.rewardsDuration;
        }
        pool.lastUpdateTime = uint64(block.timestamp);
        pool.periodFinish = uint64(block.timestamp + pool.rewardsDuration);
        pool.totalRewardsFunded += amount;

        mtt.safeTransferFrom(msg.sender, address(this), amount);
        emit PoolFunded(poolId, msg.sender, amount, pool.rewardRate, pool.periodFinish);
    }

    // ---------- Reward accounting ----------

    function _lastTimeRewardApplicable(uint256 poolId) internal view returns (uint256) {
        Pool storage pool = pools[poolId];
        return block.timestamp < pool.periodFinish ? block.timestamp : pool.periodFinish;
    }

    function rewardPerToken(uint256 poolId) public view returns (uint256) {
        Pool storage pool = pools[poolId];
        if (pool.totalStaked == 0) return pool.rewardPerTokenStored;
        uint256 elapsed = _lastTimeRewardApplicable(poolId) - pool.lastUpdateTime;
        return pool.rewardPerTokenStored + (elapsed * pool.rewardRate) / pool.totalStaked;
    }

    function earned(uint256 poolId, address account) public view returns (uint256) {
        UserInfo storage u = userInfo[poolId][account];
        uint256 rpt = rewardPerToken(poolId);
        return u.rewards + (u.amount * (rpt - u.rewardPerTokenPaid)) / 1e18;
    }

    function _updatePoolRewards(uint256 poolId) internal {
        Pool storage pool = pools[poolId];
        pool.rewardPerTokenStored = rewardPerToken(poolId);
        pool.lastUpdateTime = uint64(_lastTimeRewardApplicable(poolId));
    }

    function _updateUserRewards(uint256 poolId, address account) internal {
        _updatePoolRewards(poolId);
        UserInfo storage u = userInfo[poolId][account];
        u.rewards = earned(poolId, account);
        u.rewardPerTokenPaid = pools[poolId].rewardPerTokenStored;
    }

    // ---------- User actions ----------

    function stake(uint256 poolId, uint256 amount) external nonReentrant {
        Pool storage pool = pools[poolId];
        require(pool.active, "pool inactive");
        require(amount > 0, "amount=0");

        _updateUserRewards(poolId, msg.sender);

        UserInfo storage u = userInfo[poolId][msg.sender];
        u.amount += amount;
        u.lockEnd = uint64(block.timestamp) + pool.lockDuration; // resets lock on top-up, by design
        pool.totalStaked += amount;

        mtt.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(poolId, msg.sender, amount, u.lockEnd);
    }

    /// @notice Claim accrued rewards without touching staked principal. Never subject to penalty.
    function claimRewards(uint256 poolId) external nonReentrant {
        _updateUserRewards(poolId, msg.sender);
        UserInfo storage u = userInfo[poolId][msg.sender];
        uint256 amount = u.rewards;
        require(amount > 0, "nothing to claim");
        u.rewards = 0;
        pools[poolId].totalRewardsPaid += amount;
        mtt.safeTransfer(msg.sender, amount);
        emit RewardClaimed(poolId, msg.sender, amount);
    }

    /**
     * @notice Withdraw staked principal. Principal is ALWAYS returned in full.
     *         If called before lock expiry, a configurable percentage of the
     *         caller's currently-accrued, unclaimed rewards is forfeited to
     *         `penaltyReceiver` as the early-exit penalty (never the principal).
     */
    function unstake(uint256 poolId, uint256 amount) external nonReentrant {
        UserInfo storage u = userInfo[poolId][msg.sender];
        require(amount > 0 && amount <= u.amount, "invalid amount");

        _updateUserRewards(poolId, msg.sender);

        bool early = block.timestamp < u.lockEnd;
        uint256 forfeited = 0;

        if (early && u.rewards > 0) {
            Pool storage pool = pools[poolId];
            forfeited = (u.rewards * pool.earlyUnstakePenaltyBps) / 10000;
            u.rewards -= forfeited;
        }

        u.amount -= amount;
        pools[poolId].totalStaked -= amount;

        if (forfeited > 0) {
            mtt.safeTransfer(penaltyReceiver, forfeited);
        }
        mtt.safeTransfer(msg.sender, amount);
        emit Unstaked(poolId, msg.sender, amount, forfeited, early);
    }
}
