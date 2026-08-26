// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MTTPayout
 * @notice The settlement rail for member withdrawals (FRD Section 6.5).
 *
 * WHY THIS CONTRACT EXISTS
 * ------------------------
 * The backend has to be able to send MTT to a member who has completed KYC and
 * requested a withdrawal. Before this contract, the only way to do that was for
 * the relayer to call `transfer` on the token directly — which means the relayer
 * key must BE the wallet holding the tokens. That wallet is the Play-to-Earn
 * Rewards Pool: 40% of total supply, 400,000,000 MTT.
 *
 * So the design was: one hot key, held by an always-online backend process, with
 * unilateral authority over 40% of the supply and no on-chain limit on what it
 * could move in a day. Every other privileged action on this platform is capped,
 * dual-controlled or both. This one was not, and it was the largest.
 *
 * What this contract changes:
 *
 *   1. THE HOT KEY HOLDS NOTHING. Treasury funds a working float here. The
 *      relayer can only move what has been deliberately placed in front of it,
 *      and the rewards pool stays in multisig custody.
 *
 *   2. A DAILY CEILING. `dailyLimit` bounds what the payer role can move per
 *      window, so a compromised relayer key is a bounded loss with time for a
 *      human to notice and pause, rather than an unbounded one.
 *
 *   3. EVERY PAYOUT CARRIES ITS WITHDRAWAL REFERENCE. `withdrawalRef` is the
 *      off-chain withdrawal id, hashed. It is stored, so a replayed payout is
 *      refused by the contract rather than by the backend remembering correctly,
 *      and it is emitted, so any payout on the explorer can be traced back to the
 *      request that authorised it. Reconciling "did we pay this member twice"
 *      stops being a database question.
 *
 *   4. IT CAN BE STOPPED. `pause()` halts payouts without touching custody of
 *      the float, which is what an incident response actually needs.
 *
 * Note what is deliberately absent: there is no function that lets the payer
 * choose an arbitrary destination for the whole balance, and no admin function
 * that can pay a member. Funding, paying and recovery are three separate roles.
 */
contract MTTPayout is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// Held by the backend relayer. Can pay members, and nothing else.
    bytes32 public constant PAYER_ROLE = keccak256("PAYER_ROLE");
    /// Held by the Treasury multisig. Funds the float and recovers it.
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    /// Held by a multisig. Can pause and adjust the ceiling.
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    IERC20 public immutable mtt;

    /// Ceiling on what PAYER_ROLE may move per window.
    uint256 public dailyLimit;

    /// Cumulative counters, for reconciliation against the off-chain ledger.
    uint256 public totalFunded;
    uint256 public totalPaid;
    uint256 public payoutCount;

    /// Rolling-window accounting. See `_consumeAllowance`.
    uint64 public windowStart;
    uint256 public spentInWindow;

    /// withdrawalRef => paid. The on-chain replay guard.
    mapping(bytes32 => bool) public paid;
    /// withdrawalRef => amount, so a settled payout is queryable, not just a flag.
    mapping(bytes32 => uint256) public paidAmount;

    uint64 public constant WINDOW = 1 days;

    event Funded(address indexed funder, uint256 amount, uint256 newFloat);
    event PayoutSent(
        address indexed to,
        uint256 amount,
        bytes32 indexed withdrawalRef,
        uint256 newTotalPaid
    );
    event Swept(address indexed to, uint256 amount, string reason);
    event DailyLimitUpdated(uint256 previous, uint256 next);
    event WindowReset(uint64 newWindowStart, uint256 previousSpend);

    /**
     * @param mttToken   The MTT token.
     * @param admin      DEFAULT_ADMIN_ROLE + TREASURY_ROLE + GUARDIAN_ROLE. MUST be a multisig.
     * @param payer      The backend relayer address. Gets PAYER_ROLE only.
     * @param dailyLimit_ Initial ceiling on payer spend per window, in wei.
     */
    constructor(address mttToken, address admin, address payer, uint256 dailyLimit_) {
        require(mttToken != address(0), "token=0");
        require(admin != address(0), "admin=0");
        require(payer != address(0), "payer=0");
        require(dailyLimit_ > 0, "dailyLimit=0");

        mtt = IERC20(mttToken);
        dailyLimit = dailyLimit_;
        windowStart = uint64(block.timestamp);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TREASURY_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);

        /* The payer is granted ONLY the payer role, and deliberately not by the
         * same address that holds it. An admin that is also the payer defeats
         * the separation this contract exists to create. */
        _grantRole(PAYER_ROLE, payer);
    }

    // ---------- Funding ----------

    /**
     * @notice Moves MTT from the Treasury into the payout float.
     *
     * Pull, not push: the treasury approves and this contract transfers, so the
     * amount credited to `totalFunded` is exactly the amount that arrived. A
     * plain token transfer to this address would increase the balance without
     * touching the counter, and the two would drift apart silently.
     */
    function fund(uint256 amount) external onlyRole(TREASURY_ROLE) nonReentrant {
        require(amount > 0, "amount=0");
        totalFunded += amount;
        mtt.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount, mtt.balanceOf(address(this)));
    }

    /**
     * @notice Returns float to the Treasury. Cannot send anywhere else.
     *
     * The destination is `msg.sender` and the caller must hold TREASURY_ROLE, so
     * there is no parameter an attacker could point at their own address. Sweeping
     * is how the float is wound down or an over-funding is corrected.
     */
    function sweep(uint256 amount, string calldata reason) external onlyRole(TREASURY_ROLE) nonReentrant {
        require(amount > 0, "amount=0");
        require(bytes(reason).length > 0, "reason required");
        mtt.safeTransfer(msg.sender, amount);
        emit Swept(msg.sender, amount, reason);
    }

    // ---------- Payouts ----------

    /**
     * @notice Settles one member withdrawal.
     *
     * @param to           The member's own wallet, as verified off-chain.
     * @param amount       Net amount to send, after any fee the backend applied.
     * @param withdrawalRef The off-chain withdrawal id. Must be unique, and is the
     *                      contract's replay guard — a retried submission of the
     *                      same withdrawal reverts rather than paying twice.
     */
    function payout(address to, uint256 amount, bytes32 withdrawalRef)
        external
        onlyRole(PAYER_ROLE)
        whenNotPaused
        nonReentrant
    {
        _payout(to, amount, withdrawalRef);
    }

    /**
     * @notice Settles many withdrawals in one transaction.
     *
     * All-or-nothing. A batch that would breach the daily ceiling on its last
     * entry reverts whole, rather than paying the first eight members and leaving
     * the backend to work out which. Bounded at 50 to stay well inside a block.
     */
    function payoutBatch(
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes32[] calldata withdrawalRefs
    ) external onlyRole(PAYER_ROLE) whenNotPaused nonReentrant {
        uint256 n = recipients.length;
        require(n > 0 && n <= 50, "bad batch size");
        require(amounts.length == n && withdrawalRefs.length == n, "length mismatch");

        for (uint256 i = 0; i < n; i++) {
            _payout(recipients[i], amounts[i], withdrawalRefs[i]);
        }
    }

    function _payout(address to, uint256 amount, bytes32 withdrawalRef) private {
        require(to != address(0), "to=0");
        require(amount > 0, "amount=0");
        require(withdrawalRef != bytes32(0), "ref=0");
        require(!paid[withdrawalRef], "already paid");

        _consumeAllowance(amount);

        paid[withdrawalRef] = true;
        paidAmount[withdrawalRef] = amount;
        totalPaid += amount;
        payoutCount += 1;

        mtt.safeTransfer(to, amount);
        emit PayoutSent(to, amount, withdrawalRef, totalPaid);
    }

    /**
     * @dev The daily ceiling.
     *
     * A true rolling window would need a queue of timestamped spends and an
     * unbounded loop to expire them — gas that grows with volume, on the hot
     * path. This is a resetting window instead: the first payout after the
     * window elapses starts a fresh one.
     *
     * The honest trade-off: spend is bounded by `dailyLimit` per window, but two
     * windows can sit back to back, so up to 2× the limit can move across a
     * boundary. That is a real property, not a bug to be surprised by later —
     * set `dailyLimit` to half of what a genuine incident could tolerate.
     */
    function _consumeAllowance(uint256 amount) private {
        if (block.timestamp >= windowStart + WINDOW) {
            emit WindowReset(uint64(block.timestamp), spentInWindow);
            windowStart = uint64(block.timestamp);
            spentInWindow = 0;
        }
        require(spentInWindow + amount <= dailyLimit, "daily limit exceeded");
        spentInWindow += amount;
    }

    // ---------- Guardian ----------

    /// @notice Halts payouts. Funding, sweeping and all views keep working.
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    /**
     * @notice Adjusts the ceiling.
     *
     * Deliberately does NOT reset the current window's spend. Raising the limit
     * to release a legitimately blocked payout is a reasonable operation;
     * raising it to reset the counter after an incident has already drained the
     * allowance is not, and the two should not be the same call.
     */
    function setDailyLimit(uint256 next) external onlyRole(GUARDIAN_ROLE) {
        require(next > 0, "dailyLimit=0");
        emit DailyLimitUpdated(dailyLimit, next);
        dailyLimit = next;
    }

    // ---------- Views ----------

    /// @notice MTT available to pay withdrawals.
    function float() external view returns (uint256) {
        return mtt.balanceOf(address(this));
    }

    /// @notice What PAYER_ROLE may still move in the current window.
    function remainingAllowance() external view returns (uint256) {
        if (block.timestamp >= windowStart + WINDOW) return dailyLimit;
        return spentInWindow >= dailyLimit ? 0 : dailyLimit - spentInWindow;
    }

    /// @notice When the current window resets.
    function windowResetsAt() external view returns (uint64) {
        return windowStart + WINDOW;
    }

    /**
     * @notice Whether a withdrawal has been settled, and for how much.
     *
     * The backend checks this before submitting. `amount` is returned alongside
     * the flag so a reconciler can prove the on-chain settlement matches the
     * ledger, not merely that something was sent.
     */
    function settlement(bytes32 withdrawalRef) external view returns (bool isSettled, uint256 amount) {
        return (paid[withdrawalRef], paidAmount[withdrawalRef]);
    }

    /// @notice Batched replay check, for a queue about to be submitted.
    function settled(bytes32[] calldata withdrawalRefs) external view returns (bool[] memory flags) {
        flags = new bool[](withdrawalRefs.length);
        for (uint256 i = 0; i < withdrawalRefs.length; i++) {
            flags[i] = paid[withdrawalRefs[i]];
        }
    }

    /// @notice Whether the float can cover a given amount right now.
    function canPay(uint256 amount) external view returns (bool) {
        if (paused() || amount == 0) return false;
        uint256 allowance = block.timestamp >= windowStart + WINDOW
            ? dailyLimit
            : (spentInWindow >= dailyLimit ? 0 : dailyLimit - spentInWindow);
        return amount <= allowance && mtt.balanceOf(address(this)) >= amount;
    }
}
