// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/interfaces/IERC20.sol";

/**
 * @title CredexPool
 * @notice Sovereign credit pool for AI agents - Simple storage, no oracle calls
 * @dev Follows CreditManager.sol pattern. Agent queries ERC-8004 off-chain and sets limits.
 */
contract CredexPool {
    IERC20 public immutable USDC;
    address public credexAgent;
    address public owner;

    constructor(address _usdc, address _credexAgent) {
        USDC = IERC20(_usdc);
        credexAgent = _credexAgent;
        owner = msg.sender;
    }

    modifier onlyAgent() {
        require(msg.sender == credexAgent, "Not Credex agent");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    struct AgentAccount {
        uint256 debt;
        uint256 principal;
        uint256 creditLimit;
        uint256 lastAccrued;
        uint256 lastRepayment;
        bool frozen;
        bool active;
    }

    // Agent accounts
    mapping(address => AgentAccount) public agents;
    
    // Liquidity tracking (Shares)
    mapping(address => uint256) public lpShares; 
    uint256 public totalShares;
    uint256 public totalLiquidity; // Cash currently in the contract

    // Interest rate: 0.1% per 6 hours = 10 basis points
    uint256 public constant INTEREST_RATE_BP = 10;
    uint256 public constant ACCRUAL_INTERVAL = 1 minutes; // Changed from 6 hours for testing

    // Events
    event LiquidityDeposited(address indexed provider, uint256 assets, uint256 shares);
    event LiquidityWithdrawn(address indexed provider, uint256 assets, uint256 shares);
    event AgentOnboarded(address indexed agent, uint256 creditLimit);
    event CreditLimitUpdated(address indexed agent, uint256 newLimit);
    event Borrowed(address indexed agent, uint256 amount);
    event Repaid(address indexed agent, uint256 amount);
    event InterestAccrued(address indexed agent, uint256 interest);
    event Frozen(address indexed agent);
    event Unfrozen(address indexed agent);

    /*//////////////////////////////////////////////////////////////
                            LP FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Deposit USDC and mint shares
     * Shares = (assets * totalShares) / totalAssets
     */
    function deposit(uint256 assets) external {
        require(assets > 0, "Zero amount");
        
        uint256 shares;
        uint256 _totalAssets = totalAssets();
        uint256 _totalShares = totalShares;

        if (_totalShares == 0) {
            shares = assets;
        } else {
            shares = (assets * _totalShares) / _totalAssets;
        }

        USDC.transferFrom(msg.sender, address(this), assets);
        
        lpShares[msg.sender] += shares;
        totalShares += shares;
        totalLiquidity += assets;

        emit LiquidityDeposited(msg.sender, assets, shares);
    }

    /**
     * @notice Withdraw USDC by burning shares
     * Assets = (shares * totalAssets) / totalShares
     */
    function withdraw(uint256 shares) external {
        require(shares > 0, "Zero shares");
        require(lpShares[msg.sender] >= shares, "Insufficient shares");
        
        uint256 _totalAssets = totalAssets();
        uint256 _totalShares = totalShares;

        uint256 assets = (shares * _totalAssets) / _totalShares;
        require(totalLiquidity >= assets, "Insufficient pool liquidity");

        lpShares[msg.sender] -= shares;
        totalShares -= shares;
        totalLiquidity -= assets;

        USDC.transfer(msg.sender, assets);
        
        emit LiquidityWithdrawn(msg.sender, assets, shares);
    }

    /*//////////////////////////////////////////////////////////////
                        AGENT FUNCTIONS (onlyAgent)
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Onboard a new agent with initial credit limit
     * @dev Agent queries ERC-8004 off-chain, calculates limit, then calls this
     */
    function onboardAgent(address agent, uint256 creditLimit) external onlyAgent {
        require(!agents[agent].active, "Already onboarded");
        
        agents[agent] = AgentAccount({
            debt: 0,
            principal: 0,
            creditLimit: creditLimit,
            lastAccrued: block.timestamp,
            lastRepayment: block.timestamp,
            frozen: false,
            active: true
        });
        
        emit AgentOnboarded(agent, creditLimit);
    }

    /**
     * @notice Update credit limit for an agent
     * @dev Called after repayment to increase limit based on growth factor
     */
    function setCreditLimit(address agent, uint256 newLimit) external onlyAgent {
        require(agents[agent].active, "Not active");
        agents[agent].creditLimit = newLimit;
        emit CreditLimitUpdated(agent, newLimit);
    }

    /**
     * @notice Process a borrow request for an agent
     */
    function borrow(address agent, uint256 amount) external onlyAgent {
        AgentAccount storage acc = agents[agent];
        require(acc.active, "Not active");
        require(!acc.frozen, "Account frozen");
        
        // Accrue interest first
        _accrueInterest(agent);
        
        require(acc.principal + amount <= acc.creditLimit, "Exceeds limit");
        require(totalLiquidity >= amount, "Insufficient liquidity");
        
        acc.principal += amount;
        acc.debt += amount;
        totalLiquidity -= amount;
        globalTotalDebt += amount; // Update tracker
        
        USDC.transfer(agent, amount);
        emit Borrowed(agent, amount);
    }

    /**
     * @notice Process a repayment from an agent
     */
    function repay(address agent, uint256 amount) external onlyAgent {
        AgentAccount storage acc = agents[agent];
        require(acc.active, "Not active");
        
        // Accrue interest first
        _accrueInterest(agent);
        
        // Cap at outstanding debt
        if (amount > acc.debt) {
            amount = acc.debt;
        }
        
        USDC.transferFrom(agent, address(this), amount);
        
        // Logic: interest is paid first, then principal.
        uint256 interestOwed = acc.debt - acc.principal;
        if (amount <= interestOwed) {
            // Repayment only covers some or all interest
            acc.debt -= amount;
        } else {
            // Repayment covers all interest and some principal
            uint256 principalRepaid = amount - interestOwed;
            acc.debt -= amount;
            acc.principal -= principalRepaid;
        }

        globalTotalDebt -= amount; // Update tracker
        acc.lastRepayment = block.timestamp;
        totalLiquidity += amount;
        
        emit Repaid(agent, amount);
    }

    /**
     * @notice Freeze an agent account
     */
    function freeze(address agent) external onlyAgent {
        require(agents[agent].active, "Not active");
        agents[agent].frozen = true;
        emit Frozen(agent);
    }

    /**
     * @notice Unfreeze an agent account
     */
    function unfreeze(address agent) external onlyAgent {
        require(agents[agent].active, "Not active");
        agents[agent].frozen = false;
        emit Unfrozen(agent);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Total assets managed by the pool (Cash + Active Debt)
     * This is used to determine the exchange rate.
     */
    function totalAssets() public view returns (uint256) {
        // In a real protocol, we would sum all active debts.
        // For this MVP, we can derive it from: totalLiquidity + Sum(all debts)
        // However, a more gas-efficient way is to track totalDebt globally.
        return totalLiquidity + totalDebt();
    }

    /**
     * @notice Sum of all outstanding debts (principal + accrued interest)
     * Note: In a production environment, this would be a global variable.
     * For this MVP, we will add a global totalDebt tracker.
     */
    uint256 public globalTotalDebt;
    function totalDebt() public view returns (uint256) {
        return globalTotalDebt;
    }

    function getAgentState(address agent) external view returns (
        uint256 debt,
        uint256 principal,
        uint256 creditLimit,
        uint256 lastAccrued,
        uint256 lastRepayment,
        bool frozen,
        bool active
    ) {
        AgentAccount storage acc = agents[agent];
        
        // Calculate pending interest for display
        uint256 pendingInterest = 0;
        if (acc.lastAccrued > 0 && acc.debt > 0) {
            uint256 elapsed = block.timestamp - acc.lastAccrued;
            uint256 intervals = elapsed / ACCRUAL_INTERVAL;
            if (intervals > 0) {
                pendingInterest = (acc.debt * INTEREST_RATE_BP * intervals) / 10000;
            }
        }
        
        return (acc.debt + pendingInterest, acc.principal, acc.creditLimit, acc.lastAccrued, acc.lastRepayment, acc.frozen, acc.active);
    }

    function availableCredit(address agent) external view returns (uint256) {
        AgentAccount storage acc = agents[agent];
        if (!acc.active || acc.frozen) return 0;
        if (acc.creditLimit <= acc.principal) return 0;
        return acc.creditLimit - acc.principal;
    }

    /*//////////////////////////////////////////////////////////////
                            INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _accrueInterest(address agent) internal {
        AgentAccount storage acc = agents[agent];
        if (acc.lastAccrued == 0 || acc.debt == 0) return;

        uint256 elapsed = block.timestamp - acc.lastAccrued;
        uint256 intervals = elapsed / ACCRUAL_INTERVAL;

        if (intervals > 0) {
            // Simple interest: debt * rate * intervals
            uint256 interest = (acc.debt * INTEREST_RATE_BP * intervals) / 10000;
            acc.debt += interest;
            globalTotalDebt += interest; // Update global tracker
            acc.lastAccrued += intervals * ACCRUAL_INTERVAL;
            emit InterestAccrued(agent, interest);
        }
    }

    // Need to update globalTotalDebt in borrow and repay too
    function _updateBorrowDebt(uint256 amount) internal {
        globalTotalDebt += amount;
    }

    function _updateRepayDebt(uint256 amount) internal {
        globalTotalDebt -= amount;
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN
    //////////////////////////////////////////////////////////////*/

    function setAgent(address newAgent) external onlyOwner {
        credexAgent = newAgent;
    }
}
