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
        uint256 creditLimit;
        uint256 lastAccrued;
        uint256 lastRepayment;
        bool frozen;
        bool active;
    }

    // Agent accounts
    mapping(address => AgentAccount) public agents;
    
    // Liquidity tracking
    mapping(address => uint256) public lpBalances; // LP -> deposited amount
    uint256 public totalLiquidity;

    // Interest rate: 0.1% per 6 hours = 10 basis points
    uint256 public constant INTEREST_RATE_BP = 10;
    uint256 public constant ACCRUAL_INTERVAL = 6 hours;

    // Events
    event LiquidityDeposited(address indexed provider, uint256 amount);
    event LiquidityWithdrawn(address indexed provider, uint256 amount);
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

    function deposit(uint256 amount) external {
        require(amount > 0, "Zero amount");
        USDC.transferFrom(msg.sender, address(this), amount);
        lpBalances[msg.sender] += amount;
        totalLiquidity += amount;
        emit LiquidityDeposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        require(lpBalances[msg.sender] >= amount, "Insufficient balance");
        require(totalLiquidity >= amount, "Insufficient liquidity");
        lpBalances[msg.sender] -= amount;
        totalLiquidity -= amount;
        USDC.transfer(msg.sender, amount);
        emit LiquidityWithdrawn(msg.sender, amount);
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
        
        require(acc.debt + amount <= acc.creditLimit, "Exceeds limit");
        require(totalLiquidity >= amount, "Insufficient liquidity");
        
        acc.debt += amount;
        totalLiquidity -= amount;
        
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
        acc.debt -= amount;
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

    function getAgentState(address agent) external view returns (
        uint256 debt,
        uint256 creditLimit,
        uint256 lastAccrued,
        uint256 lastRepayment,
        bool frozen,
        bool active
    ) {
        AgentAccount storage acc = agents[agent];
        return (acc.debt, acc.creditLimit, acc.lastAccrued, acc.lastRepayment, acc.frozen, acc.active);
    }

    function availableCredit(address agent) external view returns (uint256) {
        AgentAccount storage acc = agents[agent];
        if (!acc.active || acc.frozen) return 0;
        if (acc.creditLimit <= acc.debt) return 0;
        return acc.creditLimit - acc.debt;
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
            acc.lastAccrued += intervals * ACCRUAL_INTERVAL;
            emit InterestAccrued(agent, interest);
        }
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN
    //////////////////////////////////////////////////////////////*/

    function setAgent(address newAgent) external onlyOwner {
        credexAgent = newAgent;
    }
}
