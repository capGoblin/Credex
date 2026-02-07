#!/usr/bin/env node
/**
 * Credex LP Agent Server
 *
 * HTTP server for the Credex LP Agent.
 * Run with: npm start
 */

import { createServer } from "http";
// Use require for adk-typescript to handle paths
let Runner: any,
  InMemorySessionService: any,
  InMemoryArtifactService: any,
  InMemoryMemoryService: any;

try {
  // Try clean package import first
  const adk = require("adk-typescript");
  Runner = adk.runners
    ? adk.runners.Runner
    : require("adk-typescript/runners").Runner;
  InMemorySessionService = adk.sessions
    ? adk.sessions.InMemorySessionService
    : require("adk-typescript/sessions").InMemorySessionService;
  InMemoryArtifactService = adk.artifacts
    ? adk.artifacts.InMemoryArtifactService
    : require("adk-typescript/artifacts").InMemoryArtifactService;
  InMemoryMemoryService = adk.memory
    ? adk.memory.InMemoryMemoryService
    : require("adk-typescript/memory").InMemoryMemoryService;
} catch (e) {
  console.log(
    "⚠️ Failed to load adk-typescript from package root, trying dist paths directly...",
  );
  const path = require("path");
  // Try to find dist folder
  const dist = path.resolve("node_modules/adk-typescript/dist");
  try {
    Runner = require(path.join(dist, "runners")).Runner;
    InMemorySessionService = require(
      path.join(dist, "sessions"),
    ).InMemorySessionService;
    InMemoryArtifactService = require(
      path.join(dist, "artifacts"),
    ).InMemoryArtifactService;
    InMemoryMemoryService = require(
      path.join(dist, "memory"),
    ).InMemoryMemoryService;
  } catch (e2) {
    console.error(
      "❌ Failed to load Runner from adk-typescript. Check installation.",
    );
    process.exit(1);
  }
}

import { lpAgent } from "./agent";
import "dotenv/config";

const PORT = parseInt(process.env.PORT || "10005");

// --- ADK Services ---

const sessionService = new InMemorySessionService();
const artifactService = new InMemoryArtifactService();
const memoryService = new InMemoryMemoryService();

const runner = new Runner({
  appName: "test_lp",
  agent: lpAgent,
  sessionService,
  artifactService,
  memoryService,
});

console.log("🚀 Starting Credex LP Agent Server...");

// --- HTTP Server ---

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "credex-lp-agent" }));
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));

  req.on("end", async () => {
    try {
      const request = JSON.parse(body);
      console.log("\n=== Request ===");
      console.log("URL:", req.url);

      // Support ADK /run endpoint
      if (req.url === "/run" && request.newMessage) {
        const events: any[] = [];

        for await (const event of runner.runAsync({
          userId: request.userId || "user",
          sessionId: request.sessionId || `session-${Date.now()}`,
          newMessage: request.newMessage,
        })) {
          events.push(event);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(events));
        return;
      }

      // Legacy format (simple text in body)
      const message = request.message || {
        role: "user",
        parts: [{ text: request.text || request.input || "" }],
      };

      const events: any[] = [];

      for await (const event of runner.runAsync({
        userId: "user",
        sessionId: request.sessionId || `session-${Date.now()}`,
        newMessage: message,
      })) {
        events.push(event);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, events }));
    } catch (error) {
      console.error("Request error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Internal error",
        }),
      );
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Credex LP Agent running at http://localhost:${PORT}`);
  console.log(
    `\nTest with: curl -X POST http://localhost:${PORT} -H "Content-Type: application/json" -d '{"text": "check my pool status"}'`,
  );
});

process.on("SIGINT", () => {
  console.log("\n👋 Shutting down...");
  server.close(() => process.exit(0));
});
