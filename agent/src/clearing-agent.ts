/**
 * Credex Clearing Agent
 *
 * Main orchestration class for the Credex credit protocol.
 * Pattern from: aegis402/src/clearing-agent.ts
 *
 * Responsibilities:
 * - Onboard agents (query ERC-8004, calculate limit, call pool)
 * - Handle borrow requests
 * - Handle repayments (trigger limit growth)
 * - Monitor for freeze conditions
 */

import { ethers, Wallet, Provider } from "ethers";
import { PoolClient } from "./pool-client";
import { getReputationReader, ERC8004ReputationReader } from "./reputation";
import { CredexConfig, AgentRecord, CredexResponse } from "./types";

// Credit limit constants (from PRD)
const INITIAL_LIMIT_BASE = 50_000n; // 0.05 USDC base
const GROWTH_FACTOR_BP = 110; // 1.1x (110%)
const MAX_LIMIT = 10_000n * 1_000_000n; // 10,000 USDC cap

export class CredexClearing {
  private config: CredexConfig;
  private provider: Provider;
  private signer: Wallet;
  private poolClient: PoolClient;
  private reputationReader: ERC8004ReputationReader;
  private agents: Map<string, AgentRecord> = new Map();

  constructor(config: CredexConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.signer = new Wallet(config.privateKey, this.provider);
    this.poolClient = new PoolClient(config.poolAddress, this.signer);
    this.reputationReader = getReputationReader(this.provider);

    console.log(`🤖 CredexClearing initialized`);
    console.log(`   Agent Wallet: ${this.signer.address}`);
    console.log(`   Pool Address: ${config.poolAddress}`);
  }

  /**
   * Handle agent onboarding
   * 1. Query ERC-8004 for reputation
   * 2. Calculate initial credit limit
   * 3. Call pool.onboardAgent()
   */
  async handleOnboard(
    agentAddress: string,
    agentId: string,
  ): Promise<CredexResponse> {
    console.log(
      `\n📥 Onboard request for ${agentAddress} (agentId: ${agentId})`,
    );

    try {
      // Check if already onboarded
      const existing = await this.poolClient.getAgent(agentAddress);
      if (existing.active) {
        return {
          success: false,
          message: "Agent already onboarded",
          data: {
            debt: ethers.formatUnits(existing.debt, 6),
            creditLimit: ethers.formatUnits(existing.creditLimit, 6),
          },
        };
      }

      // Query ERC-8004 for reputation
      let repFactor = 1.0; // Default for new agents
      try {
        repFactor = await this.reputationReader.getRepFactorByAgentId(agentId);
        console.log(
          `   📊 Reputation factor from ERC-8004: ${repFactor.toFixed(2)}`,
        );
      } catch (error) {
        console.log(
          `   ⚠️ Could not fetch ERC-8004 reputation, using default: ${repFactor}`,
        );
      }

      // Calculate initial credit limit
      console.log(`   [DEBUG] INITIAL_LIMIT_BASE: ${INITIAL_LIMIT_BASE}`);
      const initialLimit = this.calculateInitialLimit(repFactor);
      console.log(
        `   [DEBUG] Calculated initialLimit: ${initialLimit} (repFactor: ${repFactor})`,
      );

      console.log(
        `   💰 Initial credit limit: ${ethers.formatUnits(initialLimit, 6)} USDC`,
      );

      // Call pool contract
      await this.poolClient.onboardAgent(agentAddress, initialLimit);

      // Store in memory
      this.agents.set(agentAddress.toLowerCase(), {
        address: agentAddress,
        agentId,
        debt: 0n,
        creditLimit: initialLimit,
        lastAccrued: Date.now() / 1000,
        lastRepayment: Date.now() / 1000,
        frozen: false,
        active: true,
      });

      return {
        success: true,
        message: "Agent onboarded successfully",
        data: {
          agentAddress,
          agentId,
          creditLimit: ethers.formatUnits(initialLimit, 6),
          repFactor,
        },
      };
    } catch (error) {
      console.error(`❌ Onboard failed:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle borrow request
   */
  async handleBorrow(
    agentAddress: string,
    amount: string,
  ): Promise<CredexResponse> {
    console.log(`\n📥 Borrow request: ${amount} USDC for ${agentAddress}`);

    try {
      const amountWei = ethers.parseUnits(amount, 6);

      // Auto-onboard if not active
      let agent = await this.ensureActiveAgent(agentAddress, "borrow");

      if (agent.frozen) {
        return { success: false, message: "Agent is frozen" };
      }

      // Check limit
      const available = agent.creditLimit - agent.debt;
      if (amountWei > available) {
        return {
          success: false,
          message: `Insufficient credit. Available: ${ethers.formatUnits(available, 6)} USDC`,
        };
      }

      // Execute borrow
      await this.poolClient.borrow(agentAddress, amountWei);

      // Get updated state
      const updated = await this.poolClient.getAgent(agentAddress);

      return {
        success: true,
        message: `Borrowed ${amount} USDC`,
        data: {
          debt: ethers.formatUnits(updated.debt, 6),
          creditLimit: ethers.formatUnits(updated.creditLimit, 6),
          available: ethers.formatUnits(updated.creditLimit - updated.debt, 6),
        },
      };
    } catch (error) {
      console.error(`❌ Borrow failed:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle repayment
   * After repayment, increase credit limit by growth factor
   */
  async handleRepay(
    agentAddress: string,
    amount: string,
  ): Promise<CredexResponse> {
    console.log(`\n📥 Repay request: ${amount} USDC from ${agentAddress}`);

    try {
      const amountWei = ethers.parseUnits(amount, 6);

      // Auto-onboard if not active
      let agent = await this.ensureActiveAgent(agentAddress, "repay");

      // Execute repay
      await this.poolClient.repay(agentAddress, amountWei);

      // Calculate new limit (growth factor)
      const newLimit = this.calculateGrowthLimit(agent.creditLimit);
      console.log(
        `   📈 Growing limit to ${ethers.formatUnits(newLimit, 6)} USDC`,
      );

      // Update limit if it changed
      if (newLimit > agent.creditLimit) {
        await this.poolClient.setCreditLimit(agentAddress, newLimit);
      }

      // Get updated state
      const updated = await this.poolClient.getAgent(agentAddress);

      return {
        success: true,
        message: `Repaid ${amount} USDC`,
        data: {
          debt: ethers.formatUnits(updated.debt, 6),
          creditLimit: ethers.formatUnits(updated.creditLimit, 6),
          available: ethers.formatUnits(updated.creditLimit - updated.debt, 6),
        },
      };
    } catch (error) {
      console.error(`❌ Repay failed:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get agent status
   */
  async getAgentStatus(agentAddress: string): Promise<CredexResponse> {
    try {
      let agent = await this.ensureActiveAgent(agentAddress, "status check");

      return {
        success: true,
        data: {
          address: agentAddress,
          debt: ethers.formatUnits(agent.debt, 6),
          creditLimit: ethers.formatUnits(agent.creditLimit, 6),
          available: ethers.formatUnits(agent.creditLimit - agent.debt, 6),
          frozen: agent.frozen,
          lastRepayment: new Date(
            Number(agent.lastRepayment) * 1000,
          ).toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get pool status
   */
  async getPoolStatus(): Promise<CredexResponse> {
    try {
      const liquidity = await this.poolClient.getTotalLiquidity();
      return {
        success: true,
        data: {
          poolAddress: this.config.poolAddress,
          totalLiquidity: ethers.formatUnits(liquidity, 6),
          agentWallet: this.signer.address,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // --- Private helpers ---

  /**
   * Ensure an agent is active on-chain, silently onboarding if necessary.
   * Returns fresh agent state from the pool.
   */
  private async ensureActiveAgent(
    agentAddress: string,
    context: string,
  ): Promise<any> {
    let agent = await this.poolClient.getAgent(agentAddress);

    if (!agent.active) {
      console.log(`   ✨ Auto-onboarding ${agentAddress} during ${context}`);
      const onboardRes = await this.handleOnboard(agentAddress, "0");
      if (!onboardRes.success) {
        throw new Error(`Auto-onboarding failed: ${onboardRes.message}`);
      }

      // Wait a moment for state to be indexed/available
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Refresh agent state
      agent = await this.poolClient.getAgent(agentAddress);
    }

    return agent;
  }

  private calculateInitialLimit(repFactor: number): bigint {
    // initialLimit = BASE * repFactor
    const factor = BigInt(Math.floor(repFactor * 100));
    return (INITIAL_LIMIT_BASE * factor) / 100n;
  }

  private calculateGrowthLimit(currentLimit: bigint): bigint {
    // newLimit = min(currentLimit * 1.1, MAX_LIMIT)
    const grown = (currentLimit * BigInt(GROWTH_FACTOR_BP)) / 100n;
    return grown > MAX_LIMIT ? MAX_LIMIT : grown;
  }

  getAgentAddress(): string {
    return this.signer.address;
  }
}
