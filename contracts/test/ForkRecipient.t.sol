// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";

import {AgentExecutor} from "../AgentExecutor.sol";
import {IAgentMandate} from "../interfaces/IAgentMandate.sol";

interface IHoldings {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// What constrains who the agent may pay, asked of the deployment rather than of a document.
contract ForkRecipientTest is Test {
    address internal constant REGISTRY = 0xD68E1bb972cA4EF7F5764FBf6d685a6DfC26778e;
    address internal constant EXECUTOR = 0x914F32af870b11739C68cbc8c4561c139a820C41;
    address internal constant ASSET = 0x2aE3BB75aB04957aE3b8944094BC9e96d33dB255;
    address internal constant PRINCIPAL = 0x6EF3A7D250F3E7e04Cf8B64E950FB1f8225832Dc;
    address internal constant AGENT = 0x29d78c8c5E7ad231a21A64170cA07e419f0C5aBa;
    address internal constant UNCLEARED = 0x3Fb193fB1b205d3d5c258D907c2E3D259CE00521;

    uint256 internal constant SEPOLIA = 11155111;
    uint256 internal constant FORK_BLOCK = 11598000;
    uint256 internal constant PER_TRANSACTION_CAP = 250e18;

    bytes4 internal constant TRANSFER_FROM = IHoldings.transferFrom.selector;

    function setUp() public {
        vm.createSelectFork("sepolia", FORK_BLOCK);
        assertEq(block.chainid, SEPOLIA);
    }

    /// ERC-8226: no recipient whitelisting, the agent may transfer to any address within caps.
    function testTheMandateAllowsATransferToAnAddressNobodyHasCleared() public view {
        assertTrue(
            IAgentMandate(REGISTRY).canExecute(
                AGENT, PRINCIPAL, ASSET, bytes32(TRANSFER_FROM), PER_TRANSACTION_CAP
            )
        );
    }

    /// The destination is an app layer control here, because no layer beneath it is checking one.
    function testNothingOnChainRefusesTheTransferToThatAddress() public {
        assertEq(IHoldings(ASSET).balanceOf(UNCLEARED), 0);

        vm.prank(AGENT);
        AgentExecutor(EXECUTOR).execute(
            ASSET, abi.encodeWithSelector(TRANSFER_FROM, PRINCIPAL, UNCLEARED, PER_TRANSACTION_CAP)
        );

        assertEq(IHoldings(ASSET).balanceOf(UNCLEARED), PER_TRANSACTION_CAP);
    }
}
