// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/CredexPool.sol";

contract DeployBaseSepoliaScript is Script {
    function run() external {
        // Base Sepolia USDC Address
        address usdcAddress = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
        
        // Deployment
        vm.startBroadcast();

        // Get deployer address
        address deployer = msg.sender;
        
        // Deploy CredexPool
        CredexPool pool = new CredexPool(usdcAddress, deployer);
        
        console.log("Deployed to Base Sepolia:");
        console.log("CredexPool:", address(pool));
        console.log("USDC:", usdcAddress);
        console.log("Admin/Agent:", deployer);

        vm.stopBroadcast();
    }
}
