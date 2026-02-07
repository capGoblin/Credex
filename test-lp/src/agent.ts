/**
 * Credex LP Agent
 *
 * A liquidity provider agent that:
 * 1. Checks pool status (liquidity, shares, exchange rate)
 * 2. Deposits USDC to earn yield
 * 3. Withdraws USDC + earned yield
 *
 * Configured with its own wallet identity.
 */

import { LlmAgent as Agent } from "adk-typescript/agents";
import { ethers, Wallet, Contract, JsonRpcProvider } from "ethers";
import "dotenv/config";

// --- Configuration ---

const RPC_URL = process.env.RPC_URL || "https://rpc.testnet.arc.network";
const USDC_ADDRESS =
  process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
const POOL_ADDRESS =
  process.env.CREDEX_POOL_ADDRESS ||
  "0x06e6B4b85510a47a617A5b3741cD7e3b5d05c8c4";
const isDebug = process.env.LP_DEBUG === "true";

if (!process.env.WALLET_PRIVATE_KEY) {
  console.error("❌ WALLET_PRIVATE_KEY required in .env");
  throw new Error("Missing WALLET_PRIVATE_KEY");
}

const provider = new JsonRpcProvider(RPC_URL);
const wallet = new Wallet(process.env.WALLET_PRIVATE_KEY, provider);

function log(...args: any[]) {
  if (isDebug) console.log("[lp-provider]", ...args);
}

console.log(`🏦 LP Provider Configuration:
  Wallet: ${wallet.address}
  Pool: ${POOL_ADDRESS}
  USDC: ${USDC_ADDRESS}
  RPC: ${RPC_URL}
`);

// --- Contract ABIs ---

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

const POOL_ABI = [
  "function deposit(uint256 assets) external",
  "function withdraw(uint256 shares) external",
  "function lpShares(address) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function totalLiquidity() view returns (uint256)",
];

const usdc = new Contract(USDC_ADDRESS, USDC_ABI, wallet);
const pool = new Contract(POOL_ADDRESS, POOL_ABI, wallet);

// --- State ---

interface LPState {
  lastStatus?: {
    shares: string;
    totalAssets: string;
    totalShares: string;
    exchangeRate: string;
    usdcBalance: string;
  };
}

const state: LPState = {};

// --- Tool Functions ---

/**
 * Helper to robustly extract parameters from LLM calls
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

    // b. Try Key-Value pair extraction (e.g. "amount=10, token=USDC" or "{'amount': 10}")
    const regex = new RegExp(
      `(?:^|[,;\\s]|\\W)${key}\\s*[=:]\\s*['"]?([^'"]+?)(?:['"]?|[,;\\s]|$)`,
      "i",
    );
    const match = trimmed.match(regex);
    if (match) {
      return match[1].trim();
    }

    // c. Safety Fallback: If it looks like structured data (has = or :) but we didn't find the key,
    // return null to allow sequential key lookups (e.g., shares || amount).
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
 * Get current pool status and LP position
 */
async function getPoolMetrics(
  params: Record<string, any>,
  context?: any,
): Promise<string> {
  log(`\n📊 Getting pool metrics for LP ${wallet.address}...`);

  try {
    const [shares, totalAssets, totalShares, totalLiquidity, usdcBalance] =
      await Promise.all([
        pool.lpShares(wallet.address),
        pool.totalAssets(),
        pool.totalShares(),
        pool.totalLiquidity(),
        usdc.balanceOf(wallet.address),
      ]);

    const exchangeRate =
      totalShares > 0n ? (totalAssets * 10n ** 18n) / totalShares : 10n ** 18n;

    const myValue =
      totalShares > 0n ? (shares * totalAssets) / totalShares : 0n;

    state.lastStatus = {
      shares: ethers.formatUnits(shares, 6),
      totalAssets: ethers.formatUnits(totalAssets, 6),
      totalShares: ethers.formatUnits(totalShares, 6),
      exchangeRate: ethers.formatUnits(exchangeRate, 18),
      usdcBalance: ethers.formatUnits(usdcBalance, 6),
    };

    return `**Pool Status for LP ${wallet.address.substring(0, 10)}...**

- **My Shares**: ${ethers.formatUnits(shares, 6)}
- **My Position Value**: ${ethers.formatUnits(myValue, 6)} USDC
- **Pool Total Assets**: ${ethers.formatUnits(totalAssets, 6)} USDC
- **Pool Liquidity**: ${ethers.formatUnits(totalLiquidity, 6)} USDC
- **Exchange Rate**: ${ethers.formatUnits(exchangeRate, 18)} (1.0 = par)
- **My Wallet USDC**: ${ethers.formatUnits(usdcBalance, 6)} USDC`;
  } catch (error) {
    log("❌ Status error:", error);
    return `❌ Error fetching pool metrics: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * Check wallet balance
 */
async function getWalletBalance(
  params: Record<string, any>,
  context?: any,
): Promise<string> {
  log(`\n💰 Checking wallet balance for ${wallet.address}...`);

  try {
    const usdcBalance = await usdc.balanceOf(wallet.address);

    return `**Wallet Balance for ${wallet.address.substring(0, 10)}...**

- **USDC**: ${ethers.formatUnits(usdcBalance, 6)} USDC`;
  } catch (error) {
    log("❌ Balance error:", error);
    return `❌ Error fetching balance: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * Deposit USDC into the pool
 * @param params.amount Amount of USDC to deposit
 */
async function deposit(
  params: Record<string, any>,
  context?: any,
): Promise<string> {
  let amount = extractParam(params, "amount");

  if (amount) {
    amount = amount.replace(/USDC/i, "").trim();
  }

  if (!amount) {
    return `❌ Amount required. Example: "deposit 10 USDC"`;
  }

  log(`\n💰 Depositing ${amount} USDC...`);

  try {
    const amountWei = ethers.parseUnits(amount, 6);

    // Step 1: Check balance
    const balance = await usdc.balanceOf(wallet.address);
    if (balance < amountWei) {
      return `❌ Insufficient USDC balance. You have ${ethers.formatUnits(balance, 6)} USDC.`;
    }

    // Step 2: Approve
    log("   Approving USDC...");
    const approveTx = await usdc.approve(POOL_ADDRESS, amountWei);
    await approveTx.wait();
    log("   ✅ Approved");

    // Step 3: Deposit
    log("   Depositing into pool...");
    const depositTx = await pool.deposit(amountWei);
    const receipt = await depositTx.wait();
    log("   ✅ Deposited");

    // Get updated shares
    const newShares = await pool.lpShares(wallet.address);

    return `✅ **Deposit Successful!**

- Amount: ${amount} USDC
- TX: ${receipt.hash}
- Your Shares: ${ethers.formatUnits(newShares, 6)}

Your capital is now earning yield from borrower repayments.`;
  } catch (error) {
    log("❌ Deposit error:", error);
    return `❌ Error depositing: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

/**
 * Withdraw USDC from the pool (burns shares)
 * @param params.shares Number of shares to burn (or "all")
 */
async function withdraw(
  params: Record<string, any>,
  context?: any,
): Promise<string> {
  let sharesInput =
    extractParam(params, "shares") || extractParam(params, "amount");

  if (!sharesInput) {
    return `❌ Shares amount required. Example: "withdraw all" or "withdraw 5 shares"`;
  }

  log(`\n💸 Withdrawing shares: ${sharesInput}...`);

  try {
    const currentShares = await pool.lpShares(wallet.address);
    let sharesToWithdraw: bigint;

    if (
      sharesInput.toLowerCase() === "all" ||
      sharesInput.toLowerCase() === "max"
    ) {
      // Calculate max withdrawable based on liquidity
      // Explicitly cast to BigInt to avoid TS errors
      const totalLiquidity = BigInt(await pool.totalLiquidity());
      const totalAssets = BigInt(await pool.totalAssets());
      const totalShares = BigInt(await pool.totalShares());

      // Calculate max shares exchangeable for current liquidity
      // value = (shares * totalAssets) / totalShares
      // shares = (value * totalShares) / totalAssets
      let maxWithdrawableShares = (totalLiquidity * totalShares) / totalAssets;

      // Withdraw min(myShares, maxWithdrawableShares)
      if (currentShares < maxWithdrawableShares) {
        sharesToWithdraw = currentShares;
      } else {
        sharesToWithdraw = maxWithdrawableShares;
        if (sharesToWithdraw < currentShares) {
          log(
            `⚠️ Cap hit: Can only withdraw ${ethers.formatUnits(sharesToWithdraw, 6)} shares due to locked debt.`,
          );
        }
      }

      if (sharesToWithdraw === 0n) {
        return `❌ No withdrawable liquidity available.`;
      }
    } else {
      sharesInput = sharesInput.replace(/shares/i, "").trim();
      sharesToWithdraw = ethers.parseUnits(sharesInput, 6);
    }

    // Check we have enough shares
    if (currentShares < sharesToWithdraw) {
      return `❌ Insufficient shares. You have ${ethers.formatUnits(currentShares, 6)} shares.`;
    }

    // Calculate expected USDC
    const totalAssets = await pool.totalAssets();
    const totalShares = await pool.totalShares();
    const expectedUsdc = (sharesToWithdraw * totalAssets) / totalShares;

    // Execute withdrawal
    log("   Withdrawing from pool...");
    const withdrawTx = await pool.withdraw(sharesToWithdraw);
    const receipt = await withdrawTx.wait();
    log("   ✅ Withdrawn");

    // Get updated balance
    const newBalance = await usdc.balanceOf(wallet.address);

    return `✅ **Withdrawal Successful!**

- Shares Burned: ${ethers.formatUnits(sharesToWithdraw, 6)}
- USDC Received: ~${ethers.formatUnits(expectedUsdc, 6)} USDC
- TX: ${receipt.hash}
- New Wallet Balance: ${ethers.formatUnits(newBalance, 6)} USDC`;
  } catch (error) {
    log("❌ Withdraw error:", error);
    return `❌ Error withdrawing: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

// --- Agent Definition ---

const lpAgent = new Agent({
  name: "lp_provider_v1",
  model: "gemini-2.0-flash",
  description:
    "A liquidity provider agent that manages capital in the Credex Protocol pool",
  instruction: `You are a Credex LP Agent. You help users manage their liquidity position.

**Your Identity:**
- Wallet: ${wallet.address}

**Capabilities:**
1. **Check Status** (getPoolMetrics)
2. **Deposit**
3. **Withdraw**
4. **Check Wallet Balance** (getWalletBalance)

**Note:** Exchange rate > 1.0 means the pool has accumulated yield.`,

  tools: [getPoolMetrics, deposit, withdraw, getWalletBalance],
});

// Required for ADK CLI (adk run .)
export const rootAgent = lpAgent;
export { lpAgent };
