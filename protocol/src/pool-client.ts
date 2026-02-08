/**
 * CredexPool Contract Client
 *
 * Interacts with the deployed CredexPool.sol contract
 * Pattern from: aegis402/src/credit-manager.ts
 */

import { ethers, Contract, Signer, TransactionReceipt } from "ethers";
import { AgentOnChain } from "./types";

// CredexPool ABI (only the functions we need)
const CREDEX_POOL_ABI = [
  // Read functions
  "function agents(address) view returns (uint256 debt, uint256 principal, uint256 creditLimit, uint256 lastAccrued, uint256 lastRepayment, bool frozen, bool active)",
  "function getAgentState(address agent) view returns (uint256 debt, uint256 principal, uint256 creditLimit, uint256 lastAccrued, uint256 lastRepayment, bool frozen, bool active)",
  "function availableCredit(address agent) view returns (uint256)",
  "function totalLiquidity() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function lpShares(address) view returns (uint256)",

  // Write functions (onlyAgent)
  "function onboardAgent(address agent, uint256 creditLimit) external",
  "function setCreditLimit(address agent, uint256 newLimit) external",
  "function borrow(address agent, uint256 amount) external",
  "function repay(address agent, uint256 amount) external",
  "function freeze(address agent) external",
  "function unfreeze(address agent) external",

  // Events
  "event AgentOnboarded(address indexed agent, uint256 creditLimit)",
  "event CreditLimitUpdated(address indexed agent, uint256 newLimit)",
  "event Borrowed(address indexed agent, uint256 amount)",
  "event Repaid(address indexed agent, uint256 amount)",
  "event Frozen(address indexed agent)",
];

export class PoolClient {
  private contract: Contract;
  private signer: Signer;
  public readonly address: string;

  constructor(contractAddress: string, signer: Signer) {
    this.address = contractAddress;
    this.signer = signer;
    this.contract = new Contract(contractAddress, CREDEX_POOL_ABI, signer);
  }

  // Read agent state
  async getAgent(agentAddress: string): Promise<AgentOnChain> {
    const result = await this.contract.getAgentState(agentAddress);
    return {
      debt: result[0],
      principal: result[1],
      creditLimit: result[2],
      lastAccrued: result[3],
      lastRepayment: result[4],
      frozen: result[5],
      active: result[6],
    };
  }

  // Get available credit for an agent
  async getAvailableCredit(agentAddress: string): Promise<bigint> {
    return await this.contract.availableCredit(agentAddress);
  }

  // Get total pool liquidity (Cash)
  async getTotalLiquidity(): Promise<bigint> {
    return await this.contract.totalLiquidity();
  }

  // Get total assets (Cash + Debt)
  async getTotalAssets(): Promise<bigint> {
    return await this.contract.totalAssets();
  }

  // Get total shares
  async getTotalShares(): Promise<bigint> {
    return await this.contract.totalShares();
  }

  // Onboard a new agent with initial credit limit
  async onboardAgent(
    agentAddress: string,
    creditLimit: bigint,
  ): Promise<TransactionReceipt> {
    console.log(
      `📝 Onboarding agent ${agentAddress} with limit ${ethers.formatUnits(creditLimit, 6)} USDC`,
    );
    const tx = await this.contract.onboardAgent(agentAddress, creditLimit);
    const receipt = await tx.wait();
    console.log(`✅ Onboard tx: ${receipt.hash}`);
    return receipt;
  }

  // Set credit limit for an agent
  async setCreditLimit(
    agentAddress: string,
    newLimit: bigint,
  ): Promise<TransactionReceipt> {
    console.log(
      `📝 Setting credit limit for ${agentAddress} to ${ethers.formatUnits(newLimit, 6)} USDC`,
    );
    const tx = await this.contract.setCreditLimit(agentAddress, newLimit);
    const receipt = await tx.wait();
    console.log(`✅ SetCreditLimit tx: ${receipt.hash}`);
    return receipt;
  }

  // Borrow funds for an agent
  async borrow(
    agentAddress: string,
    amount: bigint,
  ): Promise<TransactionReceipt> {
    console.log(
      `📝 Borrowing ${ethers.formatUnits(amount, 6)} USDC for ${agentAddress}`,
    );
    const tx = await this.contract.borrow(agentAddress, amount);
    const receipt = await tx.wait();
    console.log(`✅ Borrow tx: ${receipt.hash}`);
    return receipt;
  }

  // Repay debt for an agent
  async repay(
    agentAddress: string,
    amount: bigint,
  ): Promise<TransactionReceipt> {
    console.log(
      `📝 Repaying ${ethers.formatUnits(amount, 6)} USDC for ${agentAddress}`,
    );
    const tx = await this.contract.repay(agentAddress, amount);
    const receipt = await tx.wait();
    console.log(`✅ Repay tx: ${receipt.hash}`);
    return receipt;
  }

  // Freeze an agent
  async freeze(agentAddress: string): Promise<TransactionReceipt> {
    console.log(`🔒 Freezing agent ${agentAddress}`);
    const tx = await this.contract.freeze(agentAddress);
    const receipt = await tx.wait();
    console.log(`✅ Freeze tx: ${receipt.hash}`);
    return receipt;
  }

  // Unfreeze an agent
  async unfreeze(agentAddress: string): Promise<TransactionReceipt> {
    console.log(`🔓 Unfreezing agent ${agentAddress}`);
    const tx = await this.contract.unfreeze(agentAddress);
    const receipt = await tx.wait();
    console.log(`✅ Unfreeze tx: ${receipt.hash}`);
    return receipt;
  }
}
