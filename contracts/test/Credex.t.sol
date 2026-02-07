// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/CredexPool.sol";
import "./Mocks.sol";

contract CredexPoolTest is Test {
    CredexPool pool;
    MockUSDC usdc;

    address owner = address(0x1);
    address credexAgent = address(0x2);
    address lp1 = address(0x3);
    address agent1 = address(0x4);

    function setUp() public {
        vm.startPrank(owner);
        usdc = new MockUSDC();
        pool = new CredexPool(address(usdc), credexAgent);
        vm.stopPrank();

        // Mint USDC for LP
        usdc.mint(lp1, 1000 * 1e6);
        usdc.mint(agent1, 100 * 1e6); // For repayment
    }

    function test_LPDeposit() public {
        vm.startPrank(lp1);
        usdc.approve(address(pool), 100 * 1e6);
        pool.deposit(100 * 1e6);
        vm.stopPrank();

        assertEq(pool.totalLiquidity(), 100 * 1e6);
        assertEq(pool.lpBalances(lp1), 100 * 1e6);
    }

    function test_OnboardAgent() public {
        // LP deposits first
        vm.startPrank(lp1);
        usdc.approve(address(pool), 100 * 1e6);
        pool.deposit(100 * 1e6);
        vm.stopPrank();

        // Credex agent onboards agent1 with 50 USDC limit
        vm.prank(credexAgent);
        pool.onboardAgent(agent1, 50 * 1e6);

        (uint256 debt, uint256 limit, , , , bool active) = pool.getAgentState(agent1);
        assertEq(debt, 0);
        assertEq(limit, 50 * 1e6);
        assertEq(active, true);
    }

    function test_Borrow() public {
        // Setup
        vm.startPrank(lp1);
        usdc.approve(address(pool), 100 * 1e6);
        pool.deposit(100 * 1e6);
        vm.stopPrank();

        vm.prank(credexAgent);
        pool.onboardAgent(agent1, 50 * 1e6);

        // Borrow
        vm.prank(credexAgent);
        pool.borrow(agent1, 20 * 1e6);

        (uint256 debt, , , , , ) = pool.getAgentState(agent1);
        assertEq(debt, 20 * 1e6);
        assertEq(usdc.balanceOf(agent1), 100 * 1e6 + 20 * 1e6); // Initial + borrowed
    }

    function test_Repay() public {
        // Setup
        vm.startPrank(lp1);
        usdc.approve(address(pool), 100 * 1e6);
        pool.deposit(100 * 1e6);
        vm.stopPrank();

        vm.prank(credexAgent);
        pool.onboardAgent(agent1, 50 * 1e6);

        vm.prank(credexAgent);
        pool.borrow(agent1, 20 * 1e6);

        // Agent approves pool for repayment
        vm.prank(agent1);
        usdc.approve(address(pool), 10 * 1e6);

        // Repay
        vm.prank(credexAgent);
        pool.repay(agent1, 10 * 1e6);

        (uint256 debt, , , , , ) = pool.getAgentState(agent1);
        assertEq(debt, 10 * 1e6);
    }

    function test_Freeze() public {
        vm.prank(credexAgent);
        pool.onboardAgent(agent1, 50 * 1e6);

        vm.prank(credexAgent);
        pool.freeze(agent1);

        (, , , , bool frozen, ) = pool.getAgentState(agent1);
        assertEq(frozen, true);
    }

    function test_BorrowExceedsLimit() public {
        vm.startPrank(lp1);
        usdc.approve(address(pool), 100 * 1e6);
        pool.deposit(100 * 1e6);
        vm.stopPrank();

        vm.prank(credexAgent);
        pool.onboardAgent(agent1, 50 * 1e6);

        vm.prank(credexAgent);
        vm.expectRevert("Exceeds limit");
        pool.borrow(agent1, 51 * 1e6);
    }

    function test_InterestAccrual() public {
        vm.startPrank(lp1);
        usdc.approve(address(pool), 1000 * 1e6);
        pool.deposit(1000 * 1e6);
        vm.stopPrank();

        vm.prank(credexAgent);
        pool.onboardAgent(agent1, 100 * 1e6);

        vm.prank(credexAgent);
        pool.borrow(agent1, 50 * 1e6);

        // Advance 6 hours
        vm.warp(block.timestamp + 6 hours);

        // Trigger accrual via another borrow
        vm.prank(credexAgent);
        pool.borrow(agent1, 1 * 1e6);

        (uint256 debt, , , , , ) = pool.getAgentState(agent1);
        // 50 * 0.001 = 0.05 interest + 50 + 1 = 51.05
        assertEq(debt, 51.05 * 1e6);
    }
}
