// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MTTToken (Members Trail Token)
 * @notice BEP-20 utility token for the Members Trail platform on BNB Smart Chain.
 *
 * Design principles (see FRD Section 9.1):
 *  - FIXED SUPPLY minted once at deployment to named allocation wallets. There is
 *    NO ongoing mint function in production. All future rewards/conversions are
 *    paid out of the pre-allocated Rewards Pool wallet, never freshly minted.
 *  - Pausable transfers restricted to a PAUSER_ROLE, intended to be held by a
 *    timelocked multisig, for emergency incident response only.
 *  - Burnable by holders (self-burn) and via an admin-triggered buyback-and-burn
 *    function restricted to BURNER_ROLE (intended: Treasury multisig).
 *  - No single-EOA admin: all privileged roles are intended to be granted to a
 *    multisig (e.g., Gnosis Safe) address, never an individual private key.
 */
contract MTTToken is ERC20, ERC20Burnable, ERC20Pausable, AccessControl {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 10 ** 18; // 1,000,000,000 MTT

    // Allocation percentages (basis points, 10000 = 100%) — see FRD Section 8.2
    uint256 public constant ALLOC_REWARDS_POOL_BPS = 4000; // 40%
    uint256 public constant ALLOC_TREASURY_RESERVE_BPS = 1500; // 15%
    uint256 public constant ALLOC_TEAM_BPS = 1500; // 15%
    uint256 public constant ALLOC_LIQUIDITY_BPS = 1500; // 15%
    uint256 public constant ALLOC_MARKETING_BPS = 1000; // 10%
    uint256 public constant ALLOC_ADVISORS_BPS = 500; // 5%

    event AllocationMinted(string indexed bucket, address indexed to, uint256 amount);

    /**
     * @param admin           Address to receive DEFAULT_ADMIN_ROLE, PAUSER_ROLE, BURNER_ROLE.
     *                        MUST be a multisig in production, never an EOA.
     * @param rewardsPool     Wallet holding the Play-to-Earn Rewards Pool (40%).
     * @param treasuryReserve Wallet holding the Treasury Reserve backstop (15%).
     * @param teamVesting     Vesting contract address for Team & Founders allocation (15%).
     * @param liquidityWallet Wallet used to seed DEX liquidity (15%).
     * @param marketingWallet Wallet for marketing & partnerships spend (10%).
     * @param advisorsVesting Vesting contract address for Advisors allocation (5%).
     */
    constructor(
        address admin,
        address rewardsPool,
        address treasuryReserve,
        address teamVesting,
        address liquidityWallet,
        address marketingWallet,
        address advisorsVesting
    ) ERC20("Members Trail Token", "MTT") {
        require(admin != address(0), "admin=0");
        require(rewardsPool != address(0), "rewardsPool=0");
        require(treasuryReserve != address(0), "treasuryReserve=0");
        require(teamVesting != address(0), "teamVesting=0");
        require(liquidityWallet != address(0), "liquidityWallet=0");
        require(marketingWallet != address(0), "marketingWallet=0");
        require(advisorsVesting != address(0), "advisorsVesting=0");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(BURNER_ROLE, admin);

        uint256 rewardsAmt = (TOTAL_SUPPLY * ALLOC_REWARDS_POOL_BPS) / 10000;
        uint256 treasuryAmt = (TOTAL_SUPPLY * ALLOC_TREASURY_RESERVE_BPS) / 10000;
        uint256 teamAmt = (TOTAL_SUPPLY * ALLOC_TEAM_BPS) / 10000;
        uint256 liquidityAmt = (TOTAL_SUPPLY * ALLOC_LIQUIDITY_BPS) / 10000;
        uint256 marketingAmt = (TOTAL_SUPPLY * ALLOC_MARKETING_BPS) / 10000;
        uint256 advisorsAmt = (TOTAL_SUPPLY * ALLOC_ADVISORS_BPS) / 10000;

        // Adjust for integer rounding: any dust goes to the Treasury Reserve.
        uint256 minted = rewardsAmt + treasuryAmt + teamAmt + liquidityAmt + marketingAmt + advisorsAmt;
        uint256 dust = TOTAL_SUPPLY - minted;

        _mint(rewardsPool, rewardsAmt);
        _mint(treasuryReserve, treasuryAmt + dust);
        _mint(teamVesting, teamAmt);
        _mint(liquidityWallet, liquidityAmt);
        _mint(marketingWallet, marketingAmt);
        _mint(advisorsVesting, advisorsAmt);

        emit AllocationMinted("REWARDS_POOL", rewardsPool, rewardsAmt);
        emit AllocationMinted("TREASURY_RESERVE", treasuryReserve, treasuryAmt + dust);
        emit AllocationMinted("TEAM_VESTING", teamVesting, teamAmt);
        emit AllocationMinted("LIQUIDITY", liquidityWallet, liquidityAmt);
        emit AllocationMinted("MARKETING", marketingWallet, marketingAmt);
        emit AllocationMinted("ADVISORS_VESTING", advisorsVesting, advisorsAmt);

        require(totalSupply() == TOTAL_SUPPLY, "supply mismatch");
    }

    /// @notice Emergency pause of all token transfers. Intended for a timelocked multisig only.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Admin-triggered burn, e.g. for a buyback-and-burn program funded by Treasury surplus.
    /// @dev Caller must already hold the tokens being burned (e.g., Treasury multisig burning its own balance).
    function adminBurn(uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(msg.sender, amount);
    }

    // --- Required overrides for multiple inheritance (ERC20Pausable) ---
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}
