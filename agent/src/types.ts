/**
 * Credex Agent Types
 */

export interface CredexConfig {
  poolAddress: string;
  usdcAddress: string;
  rpcUrl: string;
  privateKey: string;
  port: number;
}

export interface AgentRecord {
  address: string;
  agentId: string;
  debt: bigint;
  creditLimit: bigint;
  lastAccrued: number;
  lastRepayment: number;
  frozen: boolean;
  active: boolean;
}

export interface AgentOnChain {
  debt: bigint;
  creditLimit: bigint;
  lastAccrued: bigint;
  lastRepayment: bigint;
  frozen: boolean;
  active: boolean;
}

export interface OnboardRequest {
  agentAddress: string;
  agentId: string;
}

export interface BorrowRequest {
  agentAddress: string;
  amount: string; // in USDC units (e.g., "10" for 10 USDC)
}

export interface RepayRequest {
  agentAddress: string;
  amount: string;
}

export interface CredexResponse {
  success: boolean;
  message?: string;
  data?: any;
}

// Types for ERC-8004 reputation module (matches aegis402/src/reputation.ts)
export interface ReputationInputs {
  agentId: string;
  totalCompleted: number;
  totalFailed: number;
  accountAgeDays: number;
  slashCount: number;
}

export interface ReputationBreakdown {
  base: number;
  completionBonus: number;
  ageBonus: number;
  slashPenalty: number;
}

export interface ReputationResult {
  factor: number;
  breakdown: ReputationBreakdown;
}
