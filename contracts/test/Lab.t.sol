// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {AgentExecutor} from "../AgentExecutor.sol";
import {AgentMandate} from "../AgentMandate.sol";
import {ComplianceProvider} from "../ComplianceProvider.sol";
import {IAgentMandate} from "../interfaces/IAgentMandate.sol";
import {IComplianceProvider} from "../interfaces/IComplianceProvider.sol";

contract LabAsset is ERC20 {
    constructor() ERC20("Lab Asset", "LAB") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function batchTransferFrom(address from, address[] calldata to, uint256[] calldata amounts) external {
        for (uint256 i = 0; i < to.length; i++) {
            transferFrom(from, to[i], amounts[i]);
        }
    }
}

/// Every contract here is deployed by this test, so no result from it describes anyone else's.
contract LabTest is Test {
    bytes32 internal constant RECORDER_ROLE = keccak256("RECORDER_ROLE");
    bytes32 internal constant IDENTITY_REF = keccak256("lab identity, never an issued reference");

    bytes4 internal constant TRANSFER_FROM = ERC20.transferFrom.selector;
    uint8 internal constant AMOUNT_INDEX = 2;
    uint48 internal constant WINDOW_SECONDS = 60 days;
    uint256 internal constant HOLDING = 2000e18;
    uint256 internal constant PER_TRANSACTION_CAP = 250e18;
    uint256 internal constant CUMULATIVE_CAP = 1000e18;

    address internal admin = makeAddr("admin");
    address internal operator = makeAddr("complianceOperator");
    address internal principal = makeAddr("principal");
    address internal agent = makeAddr("agent");
    address internal recipient = makeAddr("recipient");

    ComplianceProvider internal compliance;
    AgentMandate internal registry;
    LabAsset internal asset;
    AgentExecutor internal executor;

    function setUp() public virtual {
        compliance = new ComplianceProvider(operator);
        registry = new AgentMandate(admin);
        asset = new LabAsset();
        asset.mint(principal, HOLDING);

        vm.prank(operator);
        compliance.grantPrincipal(principal, IDENTITY_REF, uint48(block.timestamp) + 365 days);

        executor = new AgentExecutor(IAgentMandate(address(registry)), principal, principal);

        vm.prank(admin);
        registry.grantRole(RECORDER_ROLE, address(executor));

        vm.prank(principal);
        executor.setAction(TRANSFER_FROM, true, true, AMOUNT_INDEX);

        vm.prank(principal);
        asset.approve(address(executor), HOLDING);

        vm.prank(principal);
        registry.grantMandate(grantParams(), "");
    }

    function grantParams() internal view virtual returns (IAgentMandate.GrantMandateParams memory) {
        bytes32[] memory actions = new bytes32[](1);
        actions[0] = bytes32(TRANSFER_FROM);
        return IAgentMandate.GrantMandateParams({
            agent: agent,
            validFrom: uint48(block.timestamp),
            validUntil: uint48(block.timestamp) + WINDOW_SECONDS,
            principal: principal,
            complianceProvider: address(compliance),
            identityRef: IDENTITY_REF,
            asset: address(asset),
            maxTransactionValue: PER_TRANSACTION_CAP,
            maxCumulativeValue: CUMULATIVE_CAP,
            metadata: bytes32(0),
            actions: actions,
            deadline: block.timestamp + 1 hours
        });
    }

    function transferCall(uint256 amount) internal view returns (bytes memory) {
        return abi.encodeWithSelector(TRANSFER_FROM, principal, recipient, amount);
    }

    function used() internal view returns (uint256) {
        return registry.getMandate(agent, principal).cumulativeUsed;
    }

    function testTheLabGrantsAMandateThePrincipalIsEligibleFor() public view {
        (bool eligible,,) = compliance.checkPrincipal(principal, IDENTITY_REF);

        assertTrue(eligible);
        assertEq(registry.getMandate(agent, principal).principal, principal);
        assertEq(registry.getMandate(agent, principal).maxTransactionValue, PER_TRANSACTION_CAP);
    }

    function testAPermittedAmountMovesValueAndIsRecordedAgainstTheCap() public {
        vm.prank(agent);
        executor.execute(address(asset), transferCall(PER_TRANSACTION_CAP));

        assertEq(asset.balanceOf(recipient), PER_TRANSACTION_CAP);
        assertEq(used(), PER_TRANSACTION_CAP);
    }

    function testOneUnitAboveThePerTransactionCapIsRefusedAndNothingMoves() public {
        vm.prank(agent);
        vm.expectPartialRevert(AgentExecutor.CannotExecute.selector);
        executor.execute(address(asset), transferCall(PER_TRANSACTION_CAP + 1));

        assertEq(asset.balanceOf(recipient), 0);
        assertEq(used(), 0);
    }

    function testTheCumulativeCapStopsTheActionThatWouldCrossIt() public {
        for (uint256 i = 0; i < 4; i++) {
            vm.prank(agent);
            executor.execute(address(asset), transferCall(PER_TRANSACTION_CAP));
        }
        assertEq(used(), CUMULATIVE_CAP);

        vm.prank(agent);
        vm.expectPartialRevert(AgentExecutor.CannotExecute.selector);
        executor.execute(address(asset), transferCall(1));
    }

    function testTheMandateStopsTheAgentOnceItsWindowHasPassed() public {
        vm.warp(registry.getMandate(agent, principal).validUntil + 1);

        vm.prank(agent);
        vm.expectPartialRevert(AgentExecutor.CannotExecute.selector);
        executor.execute(address(asset), transferCall(PER_TRANSACTION_CAP));
    }

    function testAnActionTheExecutorDoesNotKnowNeverReachesTheRegistry() public {
        vm.prank(agent);
        vm.expectPartialRevert(AgentExecutor.UnsupportedAction.selector);
        executor.execute(address(asset), abi.encodeWithSelector(ERC20.approve.selector, recipient, 1));
    }
}
