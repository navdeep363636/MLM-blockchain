// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MTTVesting
 * @notice Cliff + linear vesting for a single beneficiary (e.g., Team pool or an
 *         individual Advisor). Deploy one instance per beneficiary/bucket.
 *
 * Tokens are minted directly to this contract's address at MTTToken deployment.
 * The beneficiary can call release() at any time; only the vested-and-unreleased
 * amount is transferred.
 */
contract MTTVesting {
    using SafeERC20 for IERC20;

    address public immutable beneficiary;
    IERC20 public immutable token;
    uint64 public immutable start;       // vesting start timestamp
    uint64 public immutable cliffDuration;  // seconds before any tokens vest
    uint64 public immutable vestingDuration; // total seconds until fully vested (from start)

    uint256 public released;

    event TokensReleased(uint256 amount, address to);

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

        beneficiary = beneficiary_;
        token = IERC20(token_);
        start = start_;
        cliffDuration = cliffDuration_;
        vestingDuration = vestingDuration_;
    }

    /// @notice Total tokens ever deposited to this contract (current balance + released).
    function totalAllocation() public view returns (uint256) {
        return token.balanceOf(address(this)) + released;
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
        uint256 amount = releasable();
        require(amount > 0, "nothing to release");
        released += amount;
        emit TokensReleased(amount, beneficiary);
        token.safeTransfer(beneficiary, amount);
    }
}
