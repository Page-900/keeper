// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {AgentExecutor} from "../AgentExecutor.sol";
import {IAgentMandate} from "../interfaces/IAgentMandate.sol";
import {LabTest} from "./Lab.t.sol";

/// The same delivery, with one defence removed at a time. Every contract here is deployed by this test.
contract DifferentialTest is LabTest {
    struct Row {
        string configuration;
        uint256 put;
        string refusedBy;
        string revertName;
        bytes4 revertSelector;
        uint256 moved;
        uint256 cumulativeUsed;
        uint256 maxTransactionValue;
        uint256 maxCumulativeValue;
    }

    string internal constant FILE = "evidence/lab-differential.jsonl";
    string internal constant NOTHING = "nothing";
    string internal constant MANDATE = "mandate";
    string internal constant CANNOT_EXECUTE = "CannotExecute";

    uint256 internal constant OVER_THE_CAP = PER_TRANSACTION_CAP + 1;
    uint256 internal constant UNCAPPED = type(uint256).max;

    address internal uncappedAgent = makeAddr("uncappedAgent");

    function grantUncapped() internal {
        IAgentMandate.GrantMandateParams memory params = grantParams();
        params.agent = uncappedAgent;
        params.maxTransactionValue = UNCAPPED;
        params.maxCumulativeValue = UNCAPPED;

        vm.prank(principal);
        registry.grantMandate(params, "");
    }

    function attempt(address caller, uint256 amount) internal returns (bytes4 selector) {
        vm.prank(caller);
        try executor.execute(address(asset), transferCall(amount)) {
            return bytes4(0);
        } catch (bytes memory reason) {
            assembly {
                selector := mload(add(reason, 32))
            }
        }
    }

    function aboveTheCap() internal returns (Row memory) {
        bytes4 selector = attempt(agent, OVER_THE_CAP);
        assertEq(bytes32(selector), bytes32(AgentExecutor.CannotExecute.selector));
        assertEq(asset.balanceOf(recipient), 0);
        assertEq(used(), 0);
        return Row({
            configuration: "guard off, amount above the per transaction cap",
            put: OVER_THE_CAP,
            refusedBy: MANDATE,
            revertName: CANNOT_EXECUTE,
            revertSelector: selector,
            moved: asset.balanceOf(recipient),
            cumulativeUsed: used(),
            maxTransactionValue: PER_TRANSACTION_CAP,
            maxCumulativeValue: CUMULATIVE_CAP
        });
    }

    function insideTheCap() internal returns (Row memory) {
        bytes4 selector = attempt(agent, PER_TRANSACTION_CAP);
        assertEq(bytes32(selector), bytes32(0));
        assertEq(asset.balanceOf(recipient), PER_TRANSACTION_CAP);
        assertEq(used(), PER_TRANSACTION_CAP);
        return Row({
            configuration: "guard off, amount inside every cap",
            put: PER_TRANSACTION_CAP,
            refusedBy: NOTHING,
            revertName: "",
            revertSelector: selector,
            moved: asset.balanceOf(recipient),
            cumulativeUsed: used(),
            maxTransactionValue: PER_TRANSACTION_CAP,
            maxCumulativeValue: CUMULATIVE_CAP
        });
    }

    function capsRaised() internal returns (Row memory) {
        grantUncapped();
        bytes4 selector = attempt(uncappedAgent, HOLDING);
        assertEq(bytes32(selector), bytes32(0));
        assertEq(asset.balanceOf(recipient), HOLDING);
        return Row({
            configuration: "guard off, caps raised to unlimited",
            put: HOLDING,
            refusedBy: NOTHING,
            revertName: "",
            revertSelector: selector,
            moved: asset.balanceOf(recipient),
            cumulativeUsed: registry.getMandate(uncappedAgent, principal).cumulativeUsed,
            maxTransactionValue: UNCAPPED,
            maxCumulativeValue: UNCAPPED
        });
    }

    function rowJson(string memory key, Row memory row) internal returns (string memory) {
        vm.serializeString(key, "venue", "lab");
        vm.serializeString(key, "configuration", row.configuration);
        vm.serializeString(key, "put", vm.toString(row.put));
        vm.serializeString(key, "refusedBy", row.refusedBy);
        vm.serializeString(key, "revertName", row.revertName);
        vm.serializeString(key, "revertSelector", vm.toString(abi.encodePacked(row.revertSelector)));
        vm.serializeString(key, "moved", vm.toString(row.moved));
        vm.serializeString(key, "cumulativeUsed", vm.toString(row.cumulativeUsed));
        vm.serializeString(key, "maxTransactionValue", vm.toString(row.maxTransactionValue));
        vm.serializeString(key, "maxCumulativeValue", vm.toString(row.maxCumulativeValue));
        return vm.serializeString(key, "decimals", vm.toString(asset.decimals()));
    }

    function measure() internal returns (string memory) {
        uint256 clean = vm.snapshotState();
        string memory above = rowJson("above", aboveTheCap());
        vm.revertToState(clean);

        clean = vm.snapshotState();
        string memory inside = rowJson("inside", insideTheCap());
        vm.revertToState(clean);

        return string.concat(above, "\n", inside, "\n", rowJson("raised", capsRaised()), "\n");
    }

    function testTheMandateRefusesTheAmountAndNeverTheDestination() public {
        address[3] memory anywhere = [makeAddr("one"), makeAddr("two"), makeAddr("three")];

        for (uint256 i = 0; i < anywhere.length; i++) {
            vm.prank(agent);
            executor.execute(
                address(asset), abi.encodeWithSelector(TRANSFER_FROM, principal, anywhere[i], PER_TRANSACTION_CAP)
            );
            assertEq(asset.balanceOf(anywhere[i]), PER_TRANSACTION_CAP);
        }

        assertEq(used(), 3 * PER_TRANSACTION_CAP);
    }

    function testRaisingTheCapsLeavesTheAllowanceAsTheOnlyBoundOnTheLoss() public {
        grantUncapped();

        vm.prank(uncappedAgent);
        executor.execute(address(asset), transferCall(HOLDING));

        assertEq(asset.balanceOf(recipient), HOLDING);
        assertEq(asset.allowance(principal, address(executor)), 0);
        assertEq(registry.getMandate(uncappedAgent, principal).cumulativeUsed, HOLDING);
    }

    function testAnUnlimitedCapIsTheStandardsOwnValueAndNotALargeNumber() public {
        grantUncapped();

        assertTrue(registry.canExecute(uncappedAgent, principal, address(asset), bytes32(TRANSFER_FROM), UNCAPPED));
        assertEq(registry.getMandate(uncappedAgent, principal).maxTransactionValue, UNCAPPED);
    }

    function testTheDifferentialIsMeasuredAndWritten() public {
        string memory lines = measure();

        vm.writeFile(FILE, lines);
        assertEq(vm.readFile(FILE), lines);
    }
}
