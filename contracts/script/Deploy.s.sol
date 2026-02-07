// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/CredexPool.sol";
import "../test/Mocks.sol";

contract DeployScript is Script {
    function run() external {
        // Use sender from --private-key flag
        vm.startBroadcast();

        // Deploy Mock USDC
        MockUSDC usdc = new MockUSDC();
        
        // Deploy CredexPool with deployer as initial agent
        address deployer = msg.sender;
        CredexPool pool = new CredexPool(address(usdc), deployer);
        
        console.log("Deployed:");
        console.log("USDC:", address(usdc));
        console.log("CredexPool:", address(pool));
        console.log("Agent (deployer):", deployer);

        // Mint USDC for LP (Deployer)
        usdc.mint(deployer, 10000 * 1e6);
        
        // Approve and Deposit Liquidity
        usdc.approve(address(pool), 5000 * 1e6);
        pool.deposit(5000 * 1e6);
        
        console.log("Deposited 5000 USDC as liquidity");
        
        vm.stopBroadcast();
    }
}
