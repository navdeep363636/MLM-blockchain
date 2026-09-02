// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MTTVesting
 * @notice Cliff + linear vesting for a single beneficiary (e.g., Team pool or an
 *         individual Advisor). Deploy one instance per beneficiary/bucket.
 *
 * Tokens are transferred to this contract's address immediately after deployment
 * (see scripts/deploy.js). The beneficiary can call release() at any time; only
 * the vested-and-unreleased amount is transferred.
 *
 * The allocation is sealed once, by `seal()`, and every figure is computed
 * against that fixed number. It used to be read live as
 * `balanceOf(this) + released`, which made the schedule a function of the
 * contract's current balance: any later transfer in — a mis-sent tranche, or a
 * deliberate donation — retroactively vested its own pro-rata share of the
 * elapsed term and became claimable in the same block, with no cliff. On a
 * 36-month schedule 24 months in, an accidental 50,000,000 MTT transfer would
 * have made 33,300,000 MTT instantly withdrawable.
 */
contract MTTVesting {
    using SafeERC20 for IERC20;

    address public immutable beneficiary;
    IERC20 public immutable token;
    uint64 public immutable start;       // vesting start timestamp
    uint64 public immutable cliffDuration;  // seconds before any tokens vest
    uint64 public immutable vestingDuration; // total seconds until fully vested (from start)

    uint256 public released;

    /**
     * @notice The allocation this schedule vests, fixed at seal time.
     *
     * Zero until `seal()` is called; nothing vests before then, so a funding
     * transfer that has not been sealed cannot be released.
     */
    uint256 public totalAllocationSealed;

    event TokensReleased(address indexed to, uint256 amount);
    event AllocationSealed(uint256 total);

    constructor(
        address beneficiary_,
        address token_,
        uint64 start_,
        uint64 cliffDuration_,
        uint64 vestingDuration_
    ) {
        require(beneficiary_ != address(0), "beneficiary=0");
        require(token_ != address(0), "token=0");
        require(vestingDuration_ > 0, "duration=0");
        require(cliffDuration_ <= vestingDuration_, "cliff>duration");
        /* A start far enough in the past that the cliff has already elapsed
         * means the schedule is partly vested the moment it is funded. A
         * backdated VESTING_START_UNIX — a typo, or a value copied from a draft
         * tokenomics doc — would have made a chunk of the team allocation
         * withdrawable on day one, on a schedule the public page advertises as
         * having a twelve-month cliff. */
        require(uint256(start_) + uint256(cliffDuration_) >= block.timestamp, "cliff already elapsed");

        beneficiary = beneficiary_;
        token = IERC20(token_);
        start = start_;
        cliffDuration = cliffDuration_;
        vestingDuration = vestingDuration_;
    }

    /**
     * @notice Fix the allocation to whatever this contract currently holds.
     *
     * Callable once, by anyone, and only before the cliff ends: the figure it
     * captures is public and verifiable, so there is nothing to gain by being
     * the caller, and requiring a privileged role would just be one more key to
     * lose. Deployment seals immediately after funding.
     */
    function seal() external {
        require(totalAllocationSealed == 0, "already sealed");
        require(block.timestamp < start + cliffDuration, "cliff passed");
        uint256 held = token.balanceOf(address(this));
        require(held > 0, "nothing to seal");
        totalAllocationSealed = held;
        emit AllocationSealed(held);
    }

    /// @notice The allocation this schedule vests. Zero until sealed.
    function totalAllocation() public view returns (uint256) {
        return totalAllocationSealed;
    }

    /// @notice Amount vested at the given timestamp, respecting the cliff.
    function vestedAmount(uint64 timestamp) public view returns (uint256) {
        uint256 total = totalAllocation();
        if (timestamp < start + cliffDuration) {
            return 0;
        }
        if (timestamp >= start + vestingDuration) {
            return total;
        }
        return (total * (timestamp - start)) / vestingDuration;
    }

    /**
     * @notice Vested-and-unreleased tokens right now.
     *
     * Added because the only way to ask this question used to be
     * `vestedAmount(timestamp) - released()`, with the caller supplying the
     * timestamp. A frontend does not know the chain's clock — it knows the
     * browser's, which is wrong by anything from milliseconds to minutes, and a
     * clock that is a few seconds ahead makes `release()` revert with "nothing
     * to release" on a number the UI just displayed as available.
     */
    function releasable() public view returns (uint256) {
        return vestedAmount(uint64(block.timestamp)) - released;
    }

    /// The whole schedule, for a UI that would otherwise make six calls.
    struct Schedule {
        address beneficiary;
        uint64 start;
        uint64 cliffEnd;
        uint64 vestingEnd;
        uint256 total;
        uint256 released;
        uint256 releasable;
    }

    /// @notice Everything a vesting screen needs, in one call.
    function schedule() external view returns (Schedule memory) {
        return Schedule({
            beneficiary: beneficiary,
            start: start,
            cliffEnd: start + cliffDuration,
            vestingEnd: start + vestingDuration,
            total: totalAllocation(),
            released: released,
            releasable: releasable()
        });
    }

    /// @notice Releases the currently vested-and-unreleased tokens to the beneficiary.
    function release() external {
        require(totalAllocationSealed > 0, "not sealed");
        uint256 amount = releasable();
        require(amount > 0, "nothing to release");
        released += amount;
        emit TokensReleased(beneficiary, amount);
        token.safeTransfer(beneficiary, amount);
    }

    /**
     * @notice MTT sitting here beyond the sealed allocation.
     *
     * Anything transferred in after `seal()` is outside the schedule and is not
     * releasable. Surfacing it means a mis-sent tranche is visible rather than
     * silently inflating a beneficiary's entitlement — recovering it needs a
     * governance decision this contract deliberately does not encode.
     */
    function unallocatedBalance() external view returns (uint256) {
        uint256 held = token.balanceOf(address(this));
        uint256 owed = totalAllocationSealed - released;
        return held > owed ? held - owed : 0;
    }
}
