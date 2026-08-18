// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {AgentExecutor} from "../AgentExecutor.sol";
import {IAgentMandate} from "../interfaces/IAgentMandate.sol";

interface IComplianceRecords {
    function grantPrincipal(address principal, bytes32 identityRef, uint48 expiresAt) external;
    function owner() external view returns (address);
}

error ExceedsTransactionCap();
error ExceedsCumulativeCap();
error UnauthorizedRecorder();

/// Stands in for the tokenized asset, which does not exist on the sandbox yet.
contract RehearsalAsset is ERC20 {
    constructor() ERC20("Rehearsal Asset", "RHSL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ForkRehearsalTest is Test {
    address internal constant REGISTRY = 0xD68E1bb972cA4EF7F5764FBf6d685a6DfC26778e;
    address internal constant COMPLIANCE = 0xa90D2503D5D9b80ECC27856Ff76F892B8C02f278;
    uint256 internal constant SEPOLIA = 11155111;
    uint256 internal constant FORK_BLOCK = 11510438;

    bytes32 internal constant DEFAULT_ADMIN_ROLE = bytes32(0);
    bytes32 internal constant RECORDER_ROLE = keccak256("RECORDER_ROLE");
    bytes32 internal constant IDENTITY_REF = keccak256("local rehearsal, never an issued reference");
    bytes32 internal constant GRANT_MANDATE_TYPEHASH = keccak256(
        "GrantMandate(address agent,uint48 validFrom,uint48 validUntil,"
        "address principal,address complianceProvider,bytes32 identityRef,"
        "address asset,uint256 maxTransactionValue,uint256 maxCumulativeValue,"
        "bytes32 metadata,bytes32[] actions,uint256 nonce,uint256 deadline)"
    );

    bytes4 internal constant TRANSFER_FROM = ERC20.transferFrom.selector;
    uint8 internal constant AMOUNT_INDEX = 2;
    uint48 internal constant WINDOW_SECONDS = 30 days;
    uint256 internal constant HOLDING = 2000e18;
    uint256 internal constant PER_TRANSACTION_CAP = 250e18;
    uint256 internal constant CUMULATIVE_CAP = 1000e18;

    address internal agent = makeAddr("agent");
    address internal recipient = makeAddr("recipient");
    address internal relayer = makeAddr("relayer");

    address internal principal;
    uint256 internal principalKey;
    address internal complianceOperator;
    RehearsalAsset internal asset;
    AgentExecutor internal executor;

    function setUp() public {
        vm.createSelectFork("sepolia", FORK_BLOCK);
        assertEq(block.chainid, SEPOLIA);

        (principal, principalKey) = makeAddrAndKey("principal");

        complianceOperator = IComplianceRecords(COMPLIANCE).owner();
        assertTrue(IAccessControl(REGISTRY).hasRole(DEFAULT_ADMIN_ROLE, complianceOperator));

        asset = new RehearsalAsset();
        asset.mint(principal, HOLDING);

        vm.prank(complianceOperator);
        IComplianceRecords(COMPLIANCE).grantPrincipal(principal, IDENTITY_REF, uint48(block.timestamp) + 365 days);

        executor = new AgentExecutor(IAgentMandate(REGISTRY), principal, principal);

        vm.prank(complianceOperator);
        IAccessControl(REGISTRY).grantRole(RECORDER_ROLE, address(executor));

        vm.prank(principal);
        executor.setAction(TRANSFER_FROM, true, true, AMOUNT_INDEX);

        vm.prank(principal);
        asset.approve(address(executor), HOLDING);

        vm.prank(principal);
        IAgentMandate(REGISTRY).grantMandate(grantParamsFor(agent), "");
    }

    function grantParamsFor(address holder) internal view returns (IAgentMandate.GrantMandateParams memory) {
        bytes32[] memory actions = new bytes32[](1);
        actions[0] = bytes32(TRANSFER_FROM);
        return IAgentMandate.GrantMandateParams({
            agent: holder,
            validFrom: uint48(block.timestamp),
            validUntil: uint48(block.timestamp) + WINDOW_SECONDS,
            principal: principal,
            complianceProvider: COMPLIANCE,
            identityRef: IDENTITY_REF,
            asset: address(asset),
            maxTransactionValue: PER_TRANSACTION_CAP,
            maxCumulativeValue: CUMULATIVE_CAP,
            metadata: bytes32(0),
            actions: actions,
            deadline: block.timestamp + 1 hours
        });
    }

    /// Every field is static, so the halves concatenate to the same encoding the registry hashes.
    function grantStructHash(IAgentMandate.GrantMandateParams memory p) internal view returns (bytes32) {
        bytes memory head = abi.encode(
            GRANT_MANDATE_TYPEHASH, p.agent, p.validFrom, p.validUntil, p.principal, p.complianceProvider, p.identityRef
        );
        bytes memory tail = abi.encode(
            p.asset,
            p.maxTransactionValue,
            p.maxCumulativeValue,
            p.metadata,
            keccak256(abi.encodePacked(p.actions)),
            IAgentMandate(REGISTRY).nonces(p.principal),
            p.deadline
        );
        return keccak256(bytes.concat(head, tail));
    }

    function signGrant(IAgentMandate.GrantMandateParams memory params) internal view returns (bytes memory) {
        bytes32 digest =
            MessageHashUtils.toTypedDataHash(IAgentMandate(REGISTRY).DOMAIN_SEPARATOR(), grantStructHash(params));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(principalKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function transferCall(uint256 amount) internal view returns (bytes memory) {
        return abi.encodeWithSelector(TRANSFER_FROM, principal, recipient, amount);
    }

    function mandate() internal view returns (IAgentMandate.Mandate memory) {
        return IAgentMandate(REGISTRY).getMandate(agent, principal);
    }

    function execute(uint256 amount) internal {
        vm.prank(agent);
        executor.execute(address(asset), transferCall(amount));
    }

    function testTheDeployedRegistryDeclaresTheStandardInterfaceItIsReadThrough() public view {
        assertTrue(IAgentMandate(REGISTRY).supportsInterface(type(IAgentMandate).interfaceId));
    }

    function testTheDeployedRegistryHoldsTheMandateWeGranted() public view {
        IAgentMandate.Mandate memory granted = mandate();

        assertEq(granted.agent, agent);
        assertEq(granted.principal, principal);
        assertEq(granted.asset, address(asset));
        assertEq(granted.maxTransactionValue, PER_TRANSACTION_CAP);
        assertEq(granted.maxCumulativeValue, CUMULATIVE_CAP);
        assertEq(granted.cumulativeUsed, 0);
        assertEq(granted.validUntil - granted.validFrom, WINDOW_SECONDS);
        assertFalse(granted.revoked);
        assertTrue(IAgentMandate(REGISTRY).isActionEnabled(agent, principal, bytes32(TRANSFER_FROM)));
    }

    function testTheAllowedActionMovesValueAndIsRecorded() public {
        execute(PER_TRANSACTION_CAP);

        assertEq(asset.balanceOf(recipient), PER_TRANSACTION_CAP);
        assertEq(asset.balanceOf(principal), HOLDING - PER_TRANSACTION_CAP);
        assertEq(mandate().cumulativeUsed, PER_TRANSACTION_CAP);
    }

    function testAnAmountOverThePerTransactionCapIsRefusedAndNothingMoves() public {
        uint256 overCap = PER_TRANSACTION_CAP + 1;

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AgentExecutor.CannotExecute.selector, agent, address(asset), TRANSFER_FROM, overCap)
        );
        executor.execute(address(asset), transferCall(overCap));

        assertEq(asset.balanceOf(recipient), 0);
        assertEq(mandate().cumulativeUsed, 0);
    }

    function testTheRegistryRefusesTheOverCapAmountOnTheWriteAndNotOnlyOnTheRead() public {
        vm.prank(address(executor));
        vm.expectRevert(ExceedsTransactionCap.selector);
        IAgentMandate(REGISTRY).recordExecution(agent, principal, bytes32(TRANSFER_FROM), PER_TRANSACTION_CAP + 1);
    }

    function testTheCumulativeCapStopsTheActionThatWouldCrossIt() public {
        for (uint256 spent = 0; spent < CUMULATIVE_CAP; spent += PER_TRANSACTION_CAP) execute(PER_TRANSACTION_CAP);

        assertEq(mandate().cumulativeUsed, CUMULATIVE_CAP);
        assertEq(asset.balanceOf(principal), HOLDING - CUMULATIVE_CAP);

        vm.prank(address(executor));
        vm.expectRevert(ExceedsCumulativeCap.selector);
        IAgentMandate(REGISTRY).recordExecution(agent, principal, bytes32(TRANSFER_FROM), 1);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(AgentExecutor.CannotExecute.selector, agent, address(asset), TRANSFER_FROM, 1)
        );
        executor.execute(address(asset), transferCall(1));
    }

    function testAPrincipalSignatureLetsAnyoneElseSubmitTheGrant() public {
        address relayedAgent = makeAddr("relayed agent");
        IAgentMandate.GrantMandateParams memory params = grantParamsFor(relayedAgent);
        uint256 nonceBefore = IAgentMandate(REGISTRY).nonces(principal);

        vm.prank(relayer);
        IAgentMandate(REGISTRY).grantMandate(params, signGrant(params));

        IAgentMandate.Mandate memory granted = IAgentMandate(REGISTRY).getMandate(relayedAgent, principal);
        assertEq(granted.principal, principal);
        assertEq(granted.maxTransactionValue, PER_TRANSACTION_CAP);
        assertEq(IAgentMandate(REGISTRY).nonces(principal), nonceBefore + 1);
    }

    function testAnExecutorWithoutTheRecorderRoleCannotRecordAnAllowedAction() public {
        AgentExecutor unregistered = new AgentExecutor(IAgentMandate(REGISTRY), principal, principal);

        vm.prank(principal);
        unregistered.setAction(TRANSFER_FROM, true, true, AMOUNT_INDEX);
        vm.prank(principal);
        asset.approve(address(unregistered), HOLDING);

        assertTrue(
            IAgentMandate(REGISTRY).canExecute(
                agent, principal, address(asset), bytes32(TRANSFER_FROM), PER_TRANSACTION_CAP
            )
        );

        vm.prank(agent);
        vm.expectRevert(UnauthorizedRecorder.selector);
        unregistered.execute(address(asset), transferCall(PER_TRANSACTION_CAP));
    }
}
