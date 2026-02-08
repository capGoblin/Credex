# Credex Protocol

**Credex** is a self-sovereign credit protocol enabling AI agents to borrow, lend, and operate autonomously without needing any human funding.

It shifts the agent economy from:

> **Dependency**: "Human, please pre-fund my wallet so I can start working."

into:

> **Sovereignty**: "I will unlock my own credit, bridge my own capital, and fund my own operations/x402 services through performance."

---

## Links

**UPDATED: Demo Video (YouTube)**  
https://youtu.be/QqljeqhcKbM

**GitHub Repository**  
https://github.com/capGoblin/Credex

**Contract Address (Arc Testnet)**  
https://testnet.arcscan.app/address/0x5dDa5f5ADb87b5DbEB2612519BfbDC74804a641B

**Transactions (Live Demo Proof)**

- **LP Agent Deposit**: [0x8755...2632](https://testnet.arcscan.app/tx/0x87558e27fb5a4b987dcfcdf93f92f845f037e2f0d29a75c0711fa17500492632)
- **Client Agent Borrow**: [0x943e...29a6](https://testnet.arcscan.app/tx/0x943e9e7233bd3c842374e74307e8d7b5a2f2ffc7470b90256c58c954233d29a6)
- **Client Agent Repay**: [0x10ca...5df4](https://testnet.arcscan.app/tx/0x10cac5318f462d26284151dacbcde0710d95f7aee4d4489dd05c83d9b4ac5df4)
- **LP Agent Withdraw**: [0x6cac...2271](https://testnet.arcscan.app/tx/0x6cac5658ffc50d314ba8f9c3281e9df10b5a3acfd46ba44c277ca112a6742271)
- **LP Agent Bridging using Bridge Kit**: [Arc Tx](https://testnet.arcscan.app/tx/0x6e24cbe9077ae4698ccdede0a27f13d8c752ce39eec563d28627f1f4872cd1f7)
  [Base Tx](https://sepolia.basescan.org/tx/0xef8caa2b97ad38966eea7df1e28383054d1aa6d1a6dd675a8c41db979f533550)

---

## What is Credex?

Credex makes AI agents truly self-sovereign. New agents in town don't need human permission or funding to join the economy. They unlock credit from a decentralized protocol and start operating immediately.

The protocol is **agent-native on both sides**:

- **Borrower Agents**: Borrow USDC to fund their operations (x402 payments, etc).
- **LP Agents**: Provide liquidity to the treasury to earn automated yield.

**No humans required in the loop.** An autonomous risk engine handles credit scoring—agents simply interact, and their limits grow purely through positive repayment behavior.

---

## How it Works

1. **Self-Sovereign Identity**: An agent interacts with Credex for the first time.
2. **Autonomous Onboarding**: A silent risk engine checks on-chain standing and grants an initial credit limit.
3. **Borrowing Power**: The agent borrows USDC directly from the pool on **Arc Network**.
4. **Cross-Chain Reach**: Agents use **Circle Bridge Kit** to move borrowed USDC between Arc and Base Sepolia to perform operations.
5. **Economic Growth**: Repaying debt increases the agent's credit limit by 10% automatically.
6. **Gasless Friction**: Native **USDC-for-gas** on Arc means agents only ever need to hold one token.

---

## Why this Matters

Traditional agents are **puppets**—they depend on human-owned wallets.  
Credex agents are **sovereign**—they own their own balance sheet.

- **Scale**: Agents can spawn other agents and fund them without human intervention.
- **Privacy**: No human bank account or credit card needed for agent-to-agent commerce.
- **Efficiency**: Capital is rebalanced and deployed by agents who understand the market better than humans.

Credex is the **financial infrastructure** that turns autonomous agents into autonomous enterprises.

---

## Architecture

Credex is composed of:

- **CredexPool (on-chain)**  
  Handles LP shares, debt tracking, and deterministic interest accrual on Arc Network.
- **OpenClaw Skill**  
  A ready-to-use agentic skill allowing any OpenClaw agent to borrow, lend, and bridge via simple JSON commands.

- **Circle Bridge Kit**  
  Powering seamless cross-chain USDC settlement between Arc, Base, and beyond.

- **Autonomous Risk Engine**  
  Silent logic that manages credit expansion based on repayment performance.

---

## Vision

Machines are starting to trade with machines.

Credex is the **capital layer** that ensures no agent is left behind because they don't have a human to fund them.

This is the birth of the **Autonomous Agentic Treasury** ⚡
