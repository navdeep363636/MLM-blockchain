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
    event CommissionClawedBack(address indexed recipient, uint256 amount, bytes32 indexed sourceEventId);
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

        bytes32 dedupeKey = keccak256(abi.encodePacked(recipient, level, sourceEventId));
        require(!processedCommissions[dedupeKey], "already recorded");
        require(totalRecorded + amount <= totalDeposited, "insufficient funded pool balance");

        processedCommissions[dedupeKey] = true;
        totalRecorded += amount;
        commissionBalance[recipient] += amount;

        emit CommissionRecorded(recipient, level, amount, sourceEventId, dedupeKey);
    }

    /**
     * @notice Reverses a previously recorded, unclaimed commission — e.g. if
     *         the underlying transaction was refunded or found fraudulent
     *         (FRD Section 11.5, clawback provisions). Cannot claw back
     *         amounts already claimed by the user.
     */
    function clawback(address recipient, uint256 amount, bytes32 sourceEventId) external onlyRole(COMPLIANCE_ROLE) {
        require(commissionBalance[recipient] >= amount, "exceeds balance");
        commissionBalance[recipient] -= amount;
        totalRecorded -= amount;
        emit CommissionClawedBack(recipient, amount, sourceEventId);
    }

    /// @notice Compliance-gated KYC flag. Commission is claimable only once approved.
    function setKycApproved(address user, bool approved) external onlyRole(COMPLIANCE_ROLE) {
        kycApproved[user] = approved;
        emit KycStatusUpdated(user, approved);
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
}
