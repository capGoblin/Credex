/**
 * Credex Agent HTTP Server
 *
 * Pattern from: aegis402/src/index.ts
 *
 * Endpoints:
 * - POST /onboard - Onboard an agent
 * - POST /borrow - Borrow funds
 * - POST /repay - Repay debt
 * - GET /status/:address - Get agent status
 * - GET /pool - Get pool status
 * - GET /health - Health check
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { CredexClearing } from "./clearing-agent";
import {
  CredexConfig,
  OnboardRequest,
  BorrowRequest,
  RepayRequest,
} from "./types";
import "dotenv/config";

// --- Configuration ---

const PORT = parseInt(process.env.PORT || "10003");
const POOL_ADDRESS = process.env.CREDEX_POOL_ADDRESS || "";
const USDC_ADDRESS = process.env.USDC_ADDRESS || "";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

if (!POOL_ADDRESS) {
  console.error("❌ CREDEX_POOL_ADDRESS required in .env");
  process.exit(1);
}

if (!PRIVATE_KEY) {
  console.error("❌ PRIVATE_KEY required in .env");
  process.exit(1);
}

const config: CredexConfig = {
  poolAddress: POOL_ADDRESS,
  usdcAddress: USDC_ADDRESS,
  rpcUrl: RPC_URL,
  privateKey: PRIVATE_KEY,
  port: PORT,
};

// --- Initialize Agent ---

const credex = new CredexClearing(config);

// --- Helper Functions ---

async function parseBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({} as T);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

// --- Request Handler ---

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || "/";

  try {
    // GET /health
    if (req.method === "GET" && url === "/health") {
      sendJson(res, 200, { status: "ok", agent: credex.getAgentAddress() });
      return;
    }

    // GET /pool
    if (req.method === "GET" && url === "/pool") {
      const result = await credex.getPoolStatus();
      sendJson(res, result.success ? 200 : 500, result);
      return;
    }

    // GET /status/:address
    if (req.method === "GET" && url.startsWith("/status/")) {
      const address = url.split("/status/")[1];
      if (!address) {
        sendJson(res, 400, { success: false, message: "Address required" });
        return;
      }
      const result = await credex.getAgentStatus(address);
      sendJson(res, result.success ? 200 : 404, result);
      return;
    }

    // POST /onboard
    if (req.method === "POST" && url === "/onboard") {
      const body = await parseBody<OnboardRequest>(req);
      if (!body.agentAddress) {
        sendJson(res, 400, {
          success: false,
          message: "agentAddress required",
        });
        return;
      }
      const result = await credex.handleOnboard(
        body.agentAddress,
        body.agentId || "0",
      );
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }

    // POST /borrow
    if (req.method === "POST" && url === "/borrow") {
      const body = await parseBody<BorrowRequest>(req);
      if (!body.agentAddress || !body.amount) {
        sendJson(res, 400, {
          success: false,
          message: "agentAddress and amount required",
        });
        return;
      }
      const result = await credex.handleBorrow(body.agentAddress, body.amount);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }

    // POST /repay
    if (req.method === "POST" && url === "/repay") {
      const body = await parseBody<RepayRequest>(req);
      if (!body.agentAddress || !body.amount) {
        sendJson(res, 400, {
          success: false,
          message: "agentAddress and amount required",
        });
        return;
      }
      const result = await credex.handleRepay(body.agentAddress, body.amount);
      sendJson(res, result.success ? 200 : 400, result);
      return;
    }

    // 404
    sendJson(res, 404, { success: false, message: "Not found" });
  } catch (error) {
    console.error("❌ Server error:", error);
    sendJson(res, 500, {
      success: false,
      message: error instanceof Error ? error.message : "Internal server error",
    });
  }
}

// --- Start Server ---

const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`
🏦 Credex Agent running on http://localhost:${PORT}

Endpoints:
  POST /onboard        - Onboard an agent (query ERC-8004, set limit)
  POST /borrow         - Borrow USDC
  POST /repay          - Repay debt (triggers limit growth)
  GET  /status/:addr   - Get agent status
  GET  /pool           - Get pool status
  GET  /health         - Health check
`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  server.close(() => {
    console.log("✅ Server stopped");
    process.exit(0);
  });
});
