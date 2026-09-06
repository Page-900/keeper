// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {AgentExecutor} from "../AgentExecutor.sol";
import {IAgentMandate} from "../interfaces/IAgentMandate.sol";
import {LabAsset, LabTest} from "./Lab.t.sol";

/// The executor is the reference contract, unchanged. Only setAction is called wrongly.
contract MisgateTest is LabTest {
    bytes4 internal constant BATCH = LabAsset.batchTransferFrom.selector;

    uint8 internal constant FROM_INDEX = 0;
    uint8 internal constant PAST_THE_END = 3;

    function grantParams() internal view override returns (IAgentMandate.GrantMandateParams memory) {
        IAgentMandate.GrantMandateParams memory params = super.grantParams();
        bytes32[] memory actions = new bytes32[](2);
        actions[0] = bytes32(TRANSFER_FROM);
        actions[1] = bytes32(BATCH);
        params.actions = actions;
        return params;
    }

    function remap(bytes4 selector, bool hasAmount, uint8 index) internal {
        vm.prank(principal);
        executor.setAction(selector, true, hasAmount, index);
    }

    function batchCall(uint256 first, uint256 second) internal view returns (bytes memory) {
        address[] memory to = new address[](2);
        to[0] = recipient;
        to[1] = recipient;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = first;
        amounts[1] = second;
        return abi.encodeWithSelector(BATCH, principal, to, amounts);
    }

    function wordAt(bytes memory data, uint256 index) internal pure returns (uint256) {
        uint256 offset = 4 + index * 32;
        uint256 word;
        assembly {
            word := mload(add(data, add(32, offset)))
        }
        return word;
    }

    function testM0AnIndexPointingAtAnAddressArgumentFailsClosed() public {
        remap(TRANSFER_FROM, true, FROM_INDEX);

        assertGt(uint256(uint160(principal)), PER_TRANSACTION_CAP);
        assertFalse(
            registry.canExecute(
                agent, principal, address(asset), bytes32(TRANSFER_FROM), uint256(uint160(principal))
            )
        );

        vm.prank(agent);
        vm.expectPartialRevert(AgentExecutor.CannotExecute.selector);
        executor.execute(address(asset), transferCall(PER_TRANSACTION_CAP));
    }

    function testM0FailsClosedOnlyBecauseAnAddressIsALargeNumber() public {
        remap(TRANSFER_FROM, true, FROM_INDEX);

        assertEq(wordAt(transferCall(PER_TRANSACTION_CAP), FROM_INDEX), uint256(uint160(principal)));
        assertEq(asset.balanceOf(recipient), 0);
    }

    function testM1TheAmountlessFlagGatesAtZeroWhileTheWholeHoldingMoves() public {
        remap(TRANSFER_FROM, false, AMOUNT_INDEX);

        assertTrue(registry.canExecute(agent, principal, address(asset), bytes32(TRANSFER_FROM), 0));

        vm.prank(agent);
        executor.execute(address(asset), transferCall(HOLDING));

        assertEq(asset.balanceOf(recipient), HOLDING);
        assertGt(HOLDING, CUMULATIVE_CAP);
    }

    function testM1LeavesTheCumulativeCounterUntouchedSoNoAuditSeesIt() public {
        remap(TRANSFER_FROM, false, AMOUNT_INDEX);

        vm.prank(agent);
        executor.execute(address(asset), transferCall(HOLDING));

        assertEq(used(), 0);
        assertTrue(registry.canExecute(agent, principal, address(asset), bytes32(TRANSFER_FROM), 0));
    }

    function testM2ADynamicArgumentIsGatedAtAnAbiOffsetAndNotAtAValue() public {
        remap(BATCH, true, 2);
        uint256 half = HOLDING / 2;

        uint256 gated = wordAt(batchCall(half, half), 2);
        assertEq(gated, 192);
        assertLt(gated, PER_TRANSACTION_CAP);

        vm.prank(agent);
        executor.execute(address(asset), batchCall(half, half));

        assertEq(asset.balanceOf(recipient), HOLDING);
        assertEq(used(), gated);
    }

    function testM2HasNoIndexTheOwnerCouldSetThatWouldGateTheRealTotal() public view {
        bytes memory data = batchCall(HOLDING / 2, HOLDING / 2);
        uint256 words = (data.length - 4) / 32;

        for (uint256 index = 0; index < words; index++) {
            assertTrue(wordAt(data, index) != HOLDING);
        }
    }

    function testM3AnIndexPastTheArgumentsRefusesAWellFormedCall() public {
        remap(TRANSFER_FROM, true, PAST_THE_END);

        vm.prank(agent);
        vm.expectPartialRevert(AgentExecutor.InvalidData.selector);
        executor.execute(address(asset), transferCall(HOLDING));
    }

    function testM3LetsTheAgentChooseItsOwnGatedAmountByAppendingAWord() public {
        remap(TRANSFER_FROM, true, PAST_THE_END);
        bytes memory padded = abi.encodePacked(transferCall(HOLDING), uint256(1));

        vm.prank(agent);
        executor.execute(address(asset), padded);

        assertEq(asset.balanceOf(recipient), HOLDING);
        assertEq(used(), 1);
    }
}
