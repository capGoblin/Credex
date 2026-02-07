// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/CredexPool.sol";

contract DeployArcScript is Script {
    function run() external {
        // ARC Testnet Native USDC Address (System Contract)
        // This address provides the ERC-20 interface for the native gas token.
        address usdcAddress = 0x3600000000000000000000000000000000000000;
        
        // Deployment
        vm.startBroadcast();

        // Get deployer address
        address deployer = msg.sender;
        
        // Deploy CredexPool
        CredexPool pool = new CredexPool(usdcAddress, deployer);
        
        console.log("Deployed to ARC Testnet:");
        console.log("CredexPool:", address(pool));
        console.log("USDC (Native):", usdcAddress);
        console.log("Admin/Agent:", deployer);

        vm.stopBroadcast();
    }
}
