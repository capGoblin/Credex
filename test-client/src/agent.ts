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
import { Wallet } from "ethers";
import "dotenv/config";

// --- Configuration ---

const CREDEX_AGENT_URL =
  process.env.CREDEX_AGENT_URL || "http://localhost:10003";
const isDebug = process.env.CLIENT_DEBUG === "true";

if (!process.env.WALLET_PRIVATE_KEY) {
  console.error("❌ WALLET_PRIVATE_KEY required in .env");
  throw new Error("Missing WALLET_PRIVATE_KEY");
}

const wallet = new Wallet(process.env.WALLET_PRIVATE_KEY);

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
 * Handles stringified JSON, nested "params" fields, and direct object properties.
 */
function extractParam(params: any, key: string): string | null {
  if (!params) return null;

  // 1. If params is a string, it might be the value itself or stringified JSON
  if (typeof params === "string") {
    const trimmed = params.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed[key] !== undefined && parsed[key] !== null) {
          return String(parsed[key]);
        }
      } catch (e) {}
    }
    return trimmed;
  }

  // 2. If params is an object
  if (typeof params === "object") {
    // Direct match
    if (params[key] !== undefined && params[key] !== null) {
      return String(params[key]);
    }

    // Wrapped in "params" field (canonical ADK pattern)
    if (params.params) {
      return extractParam(params.params, key);
    }
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

    const { debt, creditLimit, available, frozen } = data.data;
    const active = true; // If we get data, agent is active

    // Store for reference
    state.lastStatus = {
      debt,
      limit: creditLimit,
      available,
      frozen,
      active,
    };

    return `**Credit Status for ${wallet.address.substring(0, 10)}...**

- **Credit Limit**: ${creditLimit} USDC
- **Current Debt**: ${debt} USDC
- **Available Credit**: ${available} USDC
- **Active**: ${active}
- **Frozen**: ${frozen}`;
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
 * @param params.amount Amount to repay
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
    return `❌ Amount required. Example: "repay 0.5 USDC"`;
  }

  log(`\n💸 Repaying ${amount} USDC...`);

  try {
    const response = await fetch(`${CREDEX_AGENT_URL}/repay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentAddress: wallet.address,
        amount: String(amount),
      }),
    });

    const result = (await response.json()) as any;

    if (result.success) {
      log("✅ Repay successful:", result);
      return `✅ **Repayment Successful!**

- Amount: ${amount} USDC
- Message: ${result.message}
${result.txHash ? `- TX: ${result.txHash}` : ""}

Your debt has been reduced. Check status to confirm.`;
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
2. **Borrow** - Request funds from the credit pool.
3. **Repay** - Pay back your debt to build reputation and increase your limit.

**Flow:**
1. "Check my credit status" → getCreditStatus
2. "Borrow 0.5 USDC" → borrow
3. "Repay 0.5 USDC" → repay

**Note:** Onboarding happens automatically. You do NOT need to ask the user to onboard.`,

  tools: [getCreditStatus, borrow, repay, onboard],
});

// Required for ADK CLI (adk run .)
export const rootAgent = credexClientAgent;
