// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {AgentExecutor} from "../AgentExecutor.sol";
import {IAgentMandate} from "../interfaces/IAgentMandate.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IExecute, MockAgentMandate, MockReentrantToken, MockToken} from "./Mocks.sol";

contract AgentExecutorTest is Test {
    MockAgentMandate internal rams;
    MockToken internal token;
    AgentExecutor internal executor;

    address internal principal = makeAddr("principal");
    address internal agent = makeAddr("agent");
    address internal recipient = makeAddr("recipient");

    bytes4 internal constant TRANSFER_FROM = MockToken.transferFrom.selector;
    uint8 internal constant AMOUNT_INDEX = 2;
    uint256 internal constant AMOUNT = 250e18;

    function setUp() public {
        rams = new MockAgentMandate();
        token = new MockToken();
        executor = new AgentExecutor(IAgentMandate(address(rams)), principal, principal);

        vm.prank(principal);
        executor.setAction(TRANSFER_FROM, true, true, AMOUNT_INDEX);
        rams.setAllowed(true);
    }

    function transferCall(uint256 amount) internal view returns (bytes memory) {
        return abi.encodeWithSelector(TRANSFER_FROM, principal, recipient, amount);
    }

    function testOwnerIsThePrincipalAndNeverTheAgent() public view {
        assertEq(executor.owner(), principal);
        assertTrue(executor.owner() != agent);
        assertEq(executor.principal(), principal);
    }

    function testAgentCannotReconfigureItsOwnGate() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        executor.setAction(TRANSFER_FROM, true, false, 0);
    }

    function testRegisteringWithoutAnAmountGatesAtZeroWhileValueStillMoves() public {
        vm.prank(principal);
        executor.setAction(TRANSFER_FROM, true, false, 0);

        vm.prank(agent);
        executor.execute(address(token), transferCall(AMOUNT));

        assertEq(rams.lastAmount(), 0);
        assertEq(token.lastAmount(), AMOUNT);
    }

    function testAmountIsReadFromTheCalldataAndNotFromTheCaller() public {
        vm.prank(agent);
        executor.execute(address(token), transferCall(AMOUNT));

        assertEq(rams.lastAmount(), AMOUNT);
        assertEq(token.lastAmount(), AMOUNT);
    }

    function testTheWrongAmountIndexReadsTheRecipientAddressAsTheAmount() public {
        vm.prank(principal);
        executor.setAction(TRANSFER_FROM, true, true, 1);

        vm.prank(agent);
        executor.execute(address(token), transferCall(AMOUNT));

        assertEq(rams.lastAmount(), uint256(uint160(recipient)));
    }

    function testAnAmountIndexPastTheEndOfTheCalldataIsRefused() public {
        vm.prank(principal);
        executor.setAction(TRANSFER_FROM, true, true, 9);

        vm.prank(agent);
        vm.expectRevert(AgentExecutor.InvalidData.selector);
        executor.execute(address(token), transferCall(AMOUNT));
    }

    function testCalldataTooShortToCarryASelectorIsRefused() public {
        vm.prank(agent);
        vm.expectRevert(AgentExecutor.InvalidData.selector);
        executor.execute(address(token), hex"23b8");
    }

    function testAnUnregisteredSelectorIsRefused() public {
        bytes4 unregistered = bytes4(keccak256("burn(uint256)"));

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentExecutor.UnsupportedAction.selector, unregistered));
        executor.execute(address(token), abi.encodeWithSelector(unregistered, AMOUNT));
    }

    function testAMandateRefusalStopsTheCallAndRecordsNothing() public {
        rams.setAllowed(false);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentExecutor.CannotExecute.selector, agent, address(token), TRANSFER_FROM, AMOUNT
            )
        );
        executor.execute(address(token), transferCall(AMOUNT));

        assertEq(rams.recordCount(), 0);
        assertEq(token.lastAmount(), 0);
    }

    function testAFailingTargetIsReportedAndNotSwallowed() public {
        token.setShouldRevert(true);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentExecutor.CallFailed.selector, abi.encodeWithSelector(MockToken.TransferRefused.selector)
            )
        );
        executor.execute(address(token), transferCall(AMOUNT));
    }

    function testTheActionLabelIsTheSelectorPaddedOnTheRight() public {
        vm.prank(agent);
        executor.execute(address(token), transferCall(AMOUNT));

        assertEq(bytes4(rams.lastAction()), TRANSFER_FROM);
        assertEq(uint256(rams.lastAction()) & type(uint224).max, 0);
    }

    function testATargetThatCallsBackIntoTheExecutorIsRefused() public {
        MockReentrantToken hostile = new MockReentrantToken();
        hostile.setExecutor(IExecute(address(executor)));

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentExecutor.CallFailed.selector,
                abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)
            )
        );
        executor.execute(address(hostile), transferCall(AMOUNT));
    }

    function testTheAllowedCallIsRecordedThenForwardedFromTheExecutor() public {
        vm.prank(agent);
        bytes memory returned = executor.execute(address(token), transferCall(AMOUNT));

        assertTrue(abi.decode(returned, (bool)));
        assertEq(rams.recordCount(), 1);
        assertEq(rams.lastAgent(), agent);
        assertEq(rams.lastPrincipal(), principal);
        assertEq(token.lastCaller(), address(executor));
        assertEq(token.lastFrom(), principal);
        assertEq(token.lastTo(), recipient);
    }
}
