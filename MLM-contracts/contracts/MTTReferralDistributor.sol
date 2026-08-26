// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MTTReferralDistributor
 * @notice On-chain settlement layer for the platform's capped, revenue-funded
 *         referral/affiliate program (see FRD Sections 2.4, 7, 9.3).
 *
 * HARD INVARIANT (the core anti-pyramid safeguard of this contract):
 *   cumulative amounts passed to recordCommission() can NEVER exceed cumulative
 *   amounts passed to depositCommissionPool(). Since depositCommissionPool is
 *   restricted to TREASURY_ROLE and is intended to be called only with funds
 *   reconciled against real, independently-verifiable platform revenue (IAPs,
 *   tournament fees, subscriptions — never new members' deposits), this
 *   contract makes it structurally impossible to pay a referral commission
 *   that isn't backed by real revenue already received.
 *
 * The actual commission calculation (levels, percentages, per-user monthly
 * caps) happens off-chain in the backend Commission Engine, which validates a
 * qualifying transaction and then calls recordCommission via an authorized
 * Oracle/Relayer role. This keeps gas costs low while preserving on-chain
 * auditability of every commission ever recorded and its funding source.
 */
contract MTTReferralDistributor is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    IERC20 public immutable mtt;

    uint256 public totalDeposited; // cumulative real-revenue-backed deposits from Treasury
    uint256 public totalRecorded;  // cumulative commission ever recorded (must stay <= totalDeposited)
    uint256 public totalClaimed;   // cumulative commission ever claimed by users

    mapping(address => uint256) public commissionBalance; // claimable, KYC-gated
    mapping(address => bool) public kycApproved;
    mapping(bytes32 => bool) public processedCommissions; // dedupe key -> processed

    event CommissionPoolFunded(address indexed funder, uint256 amount, uint256 newTotalDeposited);
    event CommissionRecorded(
        address indexed recipient,
        uint8 level,
        uint256 amount,
        bytes32 indexed sourceEventId,
        bytes32 dedupeKey
    );
    event CommissionClaimed(address indexed recipient, uint256 amount);
    /**
     * @dev `reason` is emitted, not stored. A clawback is a rare compliance act
     *      that a human will have to justify later, so the justification belongs
     *      in the permanent record next to the amount — but storing a string in
     *      contract state would cost gas on every clawback forever to hold data
     *      nothing on-chain ever reads.
     */
    event CommissionClawedBack(
        address indexed recipient,
        uint256 amount,
        bytes32 indexed sourceEventId,
        string reason
    );
    event KycStatusUpdated(address indexed user, bool approved);

    constructor(address mttToken, address admin) {
        require(mttToken != address(0) && admin != address(0), "zero addr");
        mtt = IERC20(mttToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TREASURY_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
    }

    /**
     * @notice The exclusive funding mechanism for the commission pool. Restricted
     *         to TREASURY_ROLE (multisig), and intended to be called only with
     *         amounts reconciled against real platform revenue for the period.
     */
    function depositCommissionPool(uint256 amount) external onlyRole(TREASURY_ROLE) nonReentrant {
        require(amount > 0, "amount=0");
        totalDeposited += amount;
        mtt.safeTransferFrom(msg.sender, address(this), amount);
        emit CommissionPoolFunded(msg.sender, amount, totalDeposited);
    }

    /**
     * @notice Records a commission owed to `recipient` for a given referral
     *         `level`, attributable to `sourceEventId` (the off-chain revenue
     *         event / transaction ID that triggered it). Restricted to the
     *         backend Oracle/Relayer role, which is expected to have already
     *         validated the transaction and all caps per FRD Section 7.
     * @dev Reverts if the invariant (totalRecorded <= totalDeposited) would be
     *      violated — i.e., if the commission pool has insufficient funded
     *      balance. The backend should queue and retry once more Treasury
     *      funding arrives, per FRD Section 6.5.
     */
    function recordCommission(
        address recipient,
        uint8 level,
        uint256 amount,
        bytes32 sourceEventId
    ) external onlyRole(ORACLE_ROLE) {
        require(recipient != address(0), "recipient=0");
        require(amount > 0, "amount=0");

        bytes32 dedupeKey = dedupeKeyFor(recipient, level, sourceEventId);
        require(!processedCommissions[dedupeKey], "already recorded");
        require(totalRecorded + amount <= totalDeposited, "insufficient funded pool balance");

        processedCommissions[dedupeKey] = true;
        totalRecorded += amount;
        commissionBalance[recipient] += amount;

        emit CommissionRecorded(recipient, level, amount, sourceEventId, dedupeKey);
    }

    /// One line of a batched commission settlement.
    struct CommissionEntry {
        address recipient;
        uint8 level;
        uint256 amount;
    }

    /**
     * @notice Records every commission owed for ONE revenue event, atomically.
     *
     * This is how the backend is meant to settle. A single qualifying purchase
     * generates up to three commissions — level 1, 2 and 3 up the referral
     * chain — and recording them one transaction at a time has two failure
     * modes that matter:
     *
     *   · PARTIAL SETTLEMENT. Level 1 lands, level 2 reverts on the pool
     *     invariant, and the ledger now says one member was paid for a purchase
     *     and their upline was not. Nothing on-chain marks that as incomplete.
     *     Here the invariant is checked once against the TOTAL, so either the
     *     whole chain is recorded or none of it is.
     *
     *   · COST. Three transactions carry three base fees and three signatures
     *     for one economic event, on a platform whose whole promise is that
     *     commission is a capped percentage of real revenue.
     *
     * Per-entry dedupe is preserved exactly as in the single-entry path, so a
     * replayed batch is refused on the first already-recorded line rather than
     * partially applied.
     */
    function recordCommissionBatch(CommissionEntry[] calldata entries, bytes32 sourceEventId)
        external
        onlyRole(ORACLE_ROLE)
    {
        uint256 n = entries.length;
        require(n > 0, "empty batch");
        require(n <= 16, "batch too large");

        uint256 total = 0;
        for (uint256 i = 0; i < n; i++) {
            require(entries[i].recipient != address(0), "recipient=0");
            require(entries[i].amount > 0, "amount=0");
            total += entries[i].amount;
        }

        /* One invariant check, against the sum. This is the anti-pyramid
         * safeguard: the batch is refused whole if real revenue has not already
         * funded all of it. */
        require(totalRecorded + total <= totalDeposited, "insufficient funded pool balance");

        for (uint256 i = 0; i < n; i++) {
            CommissionEntry calldata e = entries[i];
            bytes32 dedupeKey = dedupeKeyFor(e.recipient, e.level, sourceEventId);
            require(!processedCommissions[dedupeKey], "already recorded");

            processedCommissions[dedupeKey] = true;
            commissionBalance[e.recipient] += e.amount;

            emit CommissionRecorded(e.recipient, e.level, e.amount, sourceEventId, dedupeKey);
        }

        totalRecorded += total;
    }

    /**
     * @notice Reverses a previously recorded, unclaimed commission — e.g. if
     *         the underlying transaction was refunded or found fraudulent
     *         (FRD Section 11.5, clawback provisions). Cannot claw back
     *         amounts already claimed by the user.
     */
    function clawback(
        address recipient,
        uint256 amount,
        bytes32 sourceEventId,
        string calldata reason
    ) external onlyRole(COMPLIANCE_ROLE) {
        require(amount > 0, "amount=0");
        require(commissionBalance[recipient] >= amount, "exceeds balance");
        require(bytes(reason).length > 0, "reason required");

        commissionBalance[recipient] -= amount;
        totalRecorded -= amount;

        /* `totalRecorded` falls, which frees the same capacity back to the pool.
         * That is correct: the revenue that funded this commission is still
         * deposited, and it can now fund a legitimate one. */
        emit CommissionClawedBack(recipient, amount, sourceEventId, reason);
    }

    /// @notice Compliance-gated KYC flag. Commission is claimable only once approved.
    function setKycApproved(address user, bool approved) external onlyRole(COMPLIANCE_ROLE) {
        kycApproved[user] = approved;
        emit KycStatusUpdated(user, approved);
    }

    /**
     * @notice Batched KYC flag updates.
     *
     * KYC decisions arrive from a review queue, so they arrive in groups. One
     * transaction per approval means a reviewer clearing forty submissions pays
     * forty base fees and the backend tracks forty independent confirmations,
     * any of which can be the one that silently fails.
     */
    function setKycApprovedBatch(address[] calldata users, bool approved)
        external
        onlyRole(COMPLIANCE_ROLE)
    {
        uint256 n = users.length;
        require(n > 0 && n <= 100, "bad batch size");
        for (uint256 i = 0; i < n; i++) {
            require(users[i] != address(0), "user=0");
            kycApproved[users[i]] = approved;
            emit KycStatusUpdated(users[i], approved);
        }
    }

    /// @notice Claim all currently recorded, unclaimed commission. Requires Tier-1 KYC approval.
    function claimCommission() external nonReentrant {
        require(kycApproved[msg.sender], "KYC not approved");
        uint256 amount = commissionBalance[msg.sender];
        require(amount > 0, "nothing to claim");

        commissionBalance[msg.sender] = 0;
        totalClaimed += amount;

        mtt.safeTransfer(msg.sender, amount);
        emit CommissionClaimed(msg.sender, amount);
    }

    /// @notice View helper: funded-but-not-yet-recorded balance available for new commissions.
    function availablePoolBalance() external view returns (uint256) {
        return totalDeposited - totalRecorded;
    }

    /**
     * @notice The dedupe key for a commission, computed on-chain.
     *
     * The backend has to know whether a commission was already recorded before
     * it spends gas finding out by reverting. It could hash the tuple itself, but
     * then two implementations of `abi.encodePacked` — one in Solidity, one in
     * viem — have to agree forever about the packing of a `uint8`. They are one
     * refactor away from not agreeing, and the failure is silent: a key that
     * matches nothing reads as "not yet recorded" and invites a double payment.
     */
    function dedupeKeyFor(address recipient, uint8 level, bytes32 sourceEventId)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(recipient, level, sourceEventId));
    }

    /// @notice Whether this exact commission has already been recorded.
    function isRecorded(address recipient, uint8 level, bytes32 sourceEventId)
        external
        view
        returns (bool)
    {
        return processedCommissions[dedupeKeyFor(recipient, level, sourceEventId)];
    }

    /// @notice One member's claim state, in a single call.
    function getAccount(address user)
        external
        view
        returns (uint256 claimable, bool kyc, bool claimNow)
    {
        claimable = commissionBalance[user];
        kyc = kycApproved[user];
        claimNow = kyc && claimable > 0;
    }

    /// @notice Claimable balances for many members. For treasury reconciliation.
    function commissionBalances(address[] calldata users)
        external
        view
        returns (uint256[] memory balances)
    {
        balances = new uint256[](users.length);
        for (uint256 i = 0; i < users.length; i++) {
            balances[i] = commissionBalance[users[i]];
        }
    }

    /**
     * @notice Whether every recorded-but-unclaimed commission is actually held here.
     *
     * `totalRecorded - totalClaimed` is what the contract owes. Anyone can check
     * it against the balance without trusting the platform's own dashboard.
     */
    function isSolvent() external view returns (bool) {
        return mtt.balanceOf(address(this)) >= (totalRecorded - totalClaimed);
    }
}
