/**
 * Credex Client Agent
 *
 * A client agent that:
 * 1. Checks credit status from Credex Agent
 * 2. Onboards itself to the protocol
 * 3. Borrows funds from the pool
 * 4. Repays debt to build reputation
 *
 * Configured with its own wallet identity.
 */

import { LlmAgent as Agent } from "adk-typescript/agents";
import { Wallet, JsonRpcProvider, Contract, ethers } from "ethers";
import "dotenv/config";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { inspect } from "util";

// --- Configuration ---

const CREDEX_AGENT_URL =
  process.env.CREDEX_AGENT_URL || "http://localhost:10003";
const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.arc.network";
const USDC_ADDRESS =
  process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
const POOL_ADDRESS = process.env.CREDEX_POOL_ADDRESS || "";
const isDebug = process.env.CLIENT_DEBUG === "true";

// Base Sepolia Configuration for cross-chain balance checks
const BASE_RPC_URL = "https://sepolia.base.org";
const BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

if (!process.env.WALLET_PRIVATE_KEY) {
  console.error("❌ WALLET_PRIVATE_KEY required in .env");
  throw new Error("Missing WALLET_PRIVATE_KEY");
}

// Connect wallet to provider for signing transactions
const provider = new JsonRpcProvider(RPC_URL);
const wallet = new Wallet(process.env.WALLET_PRIVATE_KEY, provider);

// ERC20 ABI for approval and balance
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];
const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, wallet);

function log(...args: any[]) {
  if (isDebug) console.log("[credex-client]", ...args);
}

console.log(`🤖 Credex Client Configuration:
  Wallet: ${wallet.address}
  Credex Agent URL: ${CREDEX_AGENT_URL}
`);

// --- State ---

interface ClientState {
  lastStatus?: {
    debt: string;
    principal: string;
    limit: string;
    available: string;
    frozen: boolean;
    active: boolean;
  };
}

const state: ClientState = {};

// --- Tool Functions ---

/**
 * Helper to robustly extract parameters from LLM calls
 * Handles stringified JSON, Python-style dicts, nested "params" fields, and direct object properties.
 */
function extractParam(params: any, key: string): string | null {
  if (!params) return null;

  // 1. If params is an object (direct from LLM or canonical ADK)
  if (typeof params === "object" && params !== null) {
    if (params[key] !== undefined && params[key] !== null) {
      return String(params[key]);
    }
    if (params.params) {
      return extractParam(params.params, key);
    }
    return null;
  }

  // 2. If params is a string
  if (typeof params === "string") {
    const trimmed = params.trim();

    // a. Try JSON/Python dict parsing
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const jsonStr = trimmed.replace(/'/g, '"');
        const parsed = JSON.parse(jsonStr);
        if (parsed[key] !== undefined && parsed[key] !== null) {
          return String(parsed[key]);
        }
        return null; // Valid JSON but missing key
      } catch (e) {
        // Fall through to other strategies
      }
    }

    // b. Try Key-Value pair extraction (e.g. "amount=10&token=USDC" or "amount=10, token=USDC")
    // Greedy match that stops at common separators
    const regex = new RegExp(
      `(?:^|[&,;\\s]|\\W)${key}\\s*[=:]\\s*['"]?([^'\"&,;\\s]+)`,
      "i",
    );
    const match = trimmed.match(regex);
    if (match) {
      return match[1].trim();
    }

    // c. Safety Fallback: If it looks like structured data (has = or :) but we didn't find the key,
    // return null to allow sequential key lookups.
    if (
      trimmed.includes("=") ||
      (trimmed.includes(":") && !trimmed.startsWith("0x"))
    ) {
      return null;
    }

    // d. Literal Fallback (e.g. just "10")
    return trimmed;
  }

  return null;
}

/**
 * Onboard to the credit protocol
 * @param params.agentId Optional agent identity token ID
 */
async function onboard(
  params: Record<string, any>,
  context?: any,
): Promise<string> {
  log(`[DEBUG] onboard called with params: ${JSON.stringify(params)}`);
  const agentId = extractParam(params, "agentId") || "0";

  log(`\n📥 Onboarding agent ${wallet.address} (agentId: ${agentId})...`);

  try {
    const response = await fetch(`${CREDEX_AGENT_URL}/onboard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentAddress: wallet.address,
        agentId: String(agentId),
      }),
    });

    const result = (await response.json()) as any;

    if (result.success) {
      log("✅ Onboard successful:", result);
      return `✅ **Onboard Successful!**

- Agent: ${wallet.address}
- Credit Limit: ${result.data.creditLimit} USDC
- Reputation Factor: ${result.data.repFactor || "1.0"}

You can now borrow up to your credit limit.`;
    } else {
      // Check if already onboarded
      if (result.message?.includes("already onboarded")) {
        return `ℹ️ Agent is already onboarded. Checks status to see your limit.`;
      }
      return `❌ Onboard Failed: ${result.message}`;
    }
  } catch (error) {
    log("❌ Onboard error:", error);
    return `❌ Error onboarding: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * Get current credit status from Credex Agent
 */
async function getCreditStatus(
  params: Record<string, any>,
  context?: any,
): Promise<string> {
  log(`\n📊 Getting credit status for ${wallet.address}...`);

  try {
    const response = await fetch(
      `${CREDEX_AGENT_URL}/status/${wallet.address}`,
    );

    // Check if 404
    if (response.status === 404) {
      return `❌ System error: Wallet ${wallet.address} could not be initialized. Please contact support.`;
    }

    const data = (await response.json()) as any;

    if (!data.success) {
      return `❌ Status check failed: ${data.message}`;
    }

    const { debt, principal, creditLimit, available, frozen } = data.data;
    const active = true; // If we get data, agent is active

    // Store for reference
    state.lastStatus = {
      debt,
      principal,
      limit: creditLimit,
      available,
      frozen,
      active,
    };

    const interest = (parseFloat(debt) - parseFloat(principal)).toFixed(6);

    return `**Credit Status for ${wallet.address.substring(0, 10)}...**

- **Credit Limit**: ${creditLimit} USDC
- **Principal Debt**: ${principal} USDC (Borrowed Capital)
- **Interest Accrued**: ${interest} USDC
- **Total Debt**: ${debt} USDC (Principal + Interest)
- **Available Credit**: ${available} USDC

---
**Protocol Logic (Simple Math):**
- Your **Available Credit** is exactly \`Limit - Principal\`. 
- Interest stays in your **Total Debt** but does not reduce your borrowing power until it is either paid or the account is frozen.
- Repayments pay off **Interest first**, then **Principal**. To restore borrowing power, you must pay down the principal.`;
  } catch (error) {
    log("❌ Status error:", error);
    return `❌ Error fetching status: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * Borrow funds from the pool
 * @param params.amount Amount to borrow
 */
async function borrow(
  params: Record<string, any>,
  context?: any,
): Promise<string> {
  log(`[DEBUG] borrow called with params: ${JSON.stringify(params)}`);
  let amount = extractParam(params, "amount");

  if (amount) {
    amount = amount.replace(/USDC/i, "").trim();
  }

  if (!amount) {
    return `❌ Amount required. Example: "borrow 0.5 USDC"`;
  }

  log(`\n💰 Borrowing ${amount} USDC...`);

  try {
    const response = await fetch(`${CREDEX_AGENT_URL}/borrow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentAddress: wallet.address,
        amount: String(amount),
      }),
    });

    const result = (await response.json()) as any;

    if (result.success) {
      log("✅ Borrow successful:", result);
      return `✅ **Borrow Successful!**

- Amount: ${amount} USDC
- Message: ${result.message}
${result.txHash ? `- TX: ${result.txHash}` : ""}

Use "check my status" to see updated balance.`;
    } else {
      return `❌ Borrow Failed: ${result.message}`;
    }
  } catch (error) {
    log("❌ Borrow error:", error);
    return `❌ Error borrowing: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * Repay debt to the pool
 * @param params.amount Amount to repay (USDC amount or "all" to clear debt)
 */
async function repay(
  params: Record<string, any>,
  context?: any,
): Promise<string> {
  log(`[DEBUG] repay called with params: ${JSON.stringify(params)}`);
  let amount = extractParam(params, "amount");

  if (amount) {
    amount = amount.replace(/USDC/i, "").trim();
  }

  if (!amount) {
    return `❌ Amount required. Example: "repay 0.5 USDC" or "repay all"`;
  }

  log(`\n💸 Repaying ${amount} USDC...`);

  try {
    const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, wallet);
    let amountToRepay: string;

    // Handle "all" / "full" / "max" by providing a buffer to clear interest accrual
    if (
      amount.toLowerCase().includes("all") ||
      amount.toLowerCase().includes("full") ||
      amount.toLowerCase().includes("max")
    ) {
      log("   Full repayment requested. Calculating debt with buffer...");
      const statusRes = await fetch(
        `${CREDEX_AGENT_URL}/status/${wallet.address}`,
      );
      const statusData = (await statusRes.json()) as any;

      if (!statusData.success) {
        return `❌ Could not fetch debt for full repayment: ${statusData.message}`;
      }

      // Add 1% buffer to ensure interest accrued during TX is covered.
      // The contract will cap it and only take what is owed.
      const debt = parseFloat(statusData.data.debt);
      amountToRepay = (debt * 1.01).toFixed(6);
      log(
        `   Targeting repayment of ${amountToRepay} USDC to clear ${debt} USDC debt.`,
      );
    } else {
      amountToRepay = amount;
    }

    const amountWei = ethers.parseUnits(amountToRepay, 6);

    log(`📝 Approving ${amountToRepay} USDC to pool ${POOL_ADDRESS}...`);
    const approveTx = await usdc.approve(POOL_ADDRESS, amountWei);
    await approveTx.wait();
    log(`✅ Approval confirmed: ${approveTx.hash}`);

    // Step 2: Call Credex agent to execute repayment
    const response = await fetch(`${CREDEX_AGENT_URL}/repay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentAddress: wallet.address,
        amount: String(amountToRepay),
      }),
    });

    const result = (await response.json()) as any;

    if (result.success) {
      log("✅ Repay successful:", result);
      return `✅ **Repayment Successful!**
      
- Repaid: ${amountToRepay} USDC (max cap applied)
- Message: ${result.message}
${result.txHash ? `- TX: ${result.txHash}` : ""}

Your debt has been cleared or reduced. Interest is accrued every 1 minute.
Check status to confirm current balance.`;
    } else {
      return `❌ Repay Failed: ${result.message}`;
    }
  } catch (error) {
    log("❌ Repay error:", error);
    return `❌ Error repaying: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * Bridge USDC between Arc and Base
 * @param params.amount Amount of USDC to bridge
 * @param params.fromChain Source chain: "Arc" or "Base"
 * @param params.toChain Destination chain: "Arc" or "Base"
 */
async function bridgeUSDC(
  params: Record<string, any>,
  context?: any,
): Promise<string> {
  log(`[DEBUG] bridgeUSDC called with params: ${JSON.stringify(params)}`);
  let amount = extractParam(params, "amount");
  const fromChainParam = extractParam(params, "fromChain");
  const toChainParam = extractParam(params, "toChain");

  if (amount) {
    amount = amount.replace(/USDC/i, "").trim();
  }

  if (!amount || !fromChainParam || !toChainParam) {
    return `❌ Missing required parameters. You must specify amount, fromChain, and toChain.
Example: "bridge 0.5 USDC from Arc to Base"`;
  }

  log(
    `\n🌉 Bridging ${amount} USDC from ${fromChainParam} to ${toChainParam}...`,
  );

  try {
    const kit = new BridgeKit();
    const adapter = createViemAdapterFromPrivateKey({
      privateKey: process.env.WALLET_PRIVATE_KEY as `0x${string}`,
    });

    const fromChain = fromChainParam.toLowerCase().includes("base")
      ? "Base_Sepolia"
      : "Arc_Testnet";
    const toChain = toChainParam.toLowerCase().includes("base")
      ? "Base_Sepolia"
      : "Arc_Testnet";

    if (fromChain === toChain) {
      return `❌ Source and destination chains must be different (Arc <-> Base).`;
    }

    const bridgeResult = await kit.bridge({
      from: { adapter, chain: fromChain },
      to: { adapter, chain: toChain },
      amount: amount,
    });

    log("✅ Bridge successful:", bridgeResult);

    return `✅ **Bridge Initiated!**
    
- **Amount**: ${amount} USDC
- **From**: ${fromChain}
- **To**: ${toChain}
- **Result**: ${inspect(bridgeResult, false, 1, true)}

The funds will arrive on the destination chain shortly.`;
  } catch (error) {
    log("❌ bridgeUSDC error:", error);
    return `❌ Error bridging USDC: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * Check wallet balance on both Arc and Base chains
 */
async function getWalletBalance(
  params: Record<string, any>,
  context?: any,
): Promise<string> {
  log(`\n💰 Checking cross-chain wallet balances for ${wallet.address}...`);

  try {
    // 1. Check Arc Balance (Current provider)
    const arcBalance = await usdc.balanceOf(wallet.address);

    // 2. Check Base Balance
    const baseProvider = new JsonRpcProvider(BASE_RPC_URL);
    const baseUsdc = new Contract(BASE_USDC_ADDRESS, ERC20_ABI, baseProvider);
    const baseBalance = await baseUsdc.balanceOf(wallet.address);

    return `**Wallet Balances for ${wallet.address.substring(0, 10)}...**

- **Arc Network (Native)**: ${ethers.formatUnits(arcBalance, 6)} USDC
- **Base Sepolia**: ${ethers.formatUnits(baseBalance, 6)} USDC

*Total Liquidity: ${(parseFloat(ethers.formatUnits(arcBalance, 6)) + parseFloat(ethers.formatUnits(baseBalance, 6))).toFixed(2)} USDC*`;
  } catch (error) {
    log("❌ Balance error:", error);
    return `❌ Error fetching cross-chain balances: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

// --- Agent Definition ---

export const credexClientAgent = new Agent({
  name: "credex_client",
  model: "gemini-2.0-flash",
  description:
    "A client agent that manages credit lines via the Credex Protocol",
  instruction: `You are a Credex Client Agent. You help users manage their credit line on the Credex Protocol.
  
**Your Identity:**
- Wallet: ${wallet.address}
- Role: Borrower

**Capabilities:**
1. **Check Status** - View credit limit, current debt, and available credit. (Protocol will auto-onboard you on first check).
2. **Borrow** - Request funds from the credit pool on Arc.
3. **Bridge USDC** - Move USDC between your Arc and Base wallets. **MANDATORY**: You MUST ask the user to confirm the source and destination chains before using this tool. NEVER assume.
4. **Repay** - Pay back your debt to build reputation and increase your limit. **NOTE**: You can accept "all" or "full" as an amount to repay the entire debt.
5. **Check Wallet Balance** - View your USDC balance on both Arc and Base chains.

**Strict Rules:**
- **NO ASSUMPTIONS**: Never assume which chain the user has funds on. Always ask for confirmation before bridging.
- **Explicit Confirmation**: If a user says "Bridge 1 USDC", respond with: "Certainly, from which chain (Arc or Base) would you like to move those funds, and where to?"

**Flows:**
- **Borrow to Base**: Use 'borrow' on Arc, then ask the user "Would you like to bridge this borrow to Base?", then use 'bridgeUSDC' (from Arc, to Base).
- **Repay from Base**: Ask user if they have funds on Base, if confirmed use 'bridgeUSDC' (from Base, to Arc), then call 'repay'.

**Note:** Onboarding happens automatically. You do NOT need to ask the user to onboard.`,

  tools: [
    getCreditStatus,
    borrow,
    bridgeUSDC,
    repay,
    onboard,
    getWalletBalance,
  ],
});

// Required for ADK CLI (adk run .)
export const rootAgent = credexClientAgent;
