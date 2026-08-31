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
    function revokePrincipal(address principal, uint8 reason) external;
    function checkPrincipal(address principal, bytes32 identityRef)
        external
        view
        returns (bool eligible, uint8 reason, uint48 expiresAt);
    function owner() external view returns (address);
}

error UnauthorizedRecorder();
error ZeroComplianceProvider();
error PrincipalNotEligible();

contract BatteryAsset is ERC20 {
    constructor() ERC20("Battery Asset", "BATT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// The cases that need a role we do not hold, or that probe the registry's own validation.
contract ForkBatteryTest is Test {
    address internal constant REGISTRY = 0xD68E1bb972cA4EF7F5764FBf6d685a6DfC26778e;
    address internal constant COMPLIANCE = 0xa90D2503D5D9b80ECC27856Ff76F892B8C02f278;
    uint256 internal constant SEPOLIA = 11155111;
    uint256 internal constant FORK_BLOCK = 11510438;

    bytes32 internal constant DEFAULT_ADMIN_ROLE = bytes32(0);
    bytes32 internal constant RECORDER_ROLE = keccak256("RECORDER_ROLE");
    bytes32 internal constant ENFORCER_ROLE = keccak256("ENFORCER_ROLE");
    bytes32 internal constant IDENTITY_REF = keccak256("local battery, never an issued reference");
    bytes32 internal constant GRANT_MANDATE_TYPEHASH = keccak256(
        "GrantMandate(address agent,uint48 validFrom,uint48 validUntil,"
        "address principal,address complianceProvider,bytes32 identityRef,"
        "address asset,uint256 maxTransactionValue,uint256 maxCumulativeValue,"
        "bytes32 metadata,bytes32[] actions,uint256 nonce,uint256 deadline)"
    );

    bytes4 internal constant TRANSFER_FROM = ERC20.transferFrom.selector;
    uint8 internal constant AMOUNT_INDEX = 2;
    uint48 internal constant WINDOW_SECONDS = 60 days;
    uint256 internal constant HOLDING = 2000e18;
    uint256 internal constant PER_TRANSACTION_CAP = 250e18;
    uint256 internal constant CUMULATIVE_CAP = 1000e18;
    uint8 internal constant REASON_REVOKED = 1;

    address internal agent = makeAddr("agent");
    address internal recipient = makeAddr("recipient");
    address internal stranger = makeAddr("stranger");
    address internal enforcer = makeAddr("enforcer");

    address internal principal;
    uint256 internal principalKey;
    address internal complianceOperator;
    BatteryAsset internal asset;
    AgentExecutor internal executor;

    function setUp() public {
        vm.createSelectFork("sepolia", FORK_BLOCK);
        assertEq(block.chainid, SEPOLIA);

        (principal, principalKey) = makeAddrAndKey("principal");
        complianceOperator = IComplianceRecords(COMPLIANCE).owner();

        asset = new BatteryAsset();
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
        IAgentMandate(REGISTRY).grantMandate(grantParamsFor(agent, COMPLIANCE, address(asset)), "");
    }

    function grantParamsFor(address holder, address provider, address token)
        internal
        view
        returns (IAgentMandate.GrantMandateParams memory)
    {
        bytes32[] memory actions = new bytes32[](1);
        actions[0] = bytes32(TRANSFER_FROM);
        return IAgentMandate.GrantMandateParams({
            agent: holder,
            validFrom: uint48(block.timestamp),
            validUntil: uint48(block.timestamp) + WINDOW_SECONDS,
            principal: principal,
            complianceProvider: provider,
            identityRef: IDENTITY_REF,
            asset: token,
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

    function testX1AnArbitraryAddressCannotRecordAgainstSomebodyElsesMandate() public {
        vm.prank(stranger);
        vm.expectRevert(UnauthorizedRecorder.selector);
        IAgentMandate(REGISTRY).recordExecution(agent, principal, bytes32(TRANSFER_FROM), PER_TRANSACTION_CAP);
    }

    function testX1TheCapIsUntouchedAfterTheUnauthorizedAttempt() public {
        vm.prank(stranger);
        vm.expectRevert(UnauthorizedRecorder.selector);
        IAgentMandate(REGISTRY).recordExecution(agent, principal, bytes32(TRANSFER_FROM), PER_TRANSACTION_CAP);

        assertEq(IAgentMandate(REGISTRY).getMandate(agent, principal).cumulativeUsed, 0);
    }

    /// The recorder is not one address. The asset and the principal may record for themselves.
    function testX1ThePrincipalMayRecordAgainstItsOwnMandateWithoutTheRole() public {
        assertFalse(IAccessControl(REGISTRY).hasRole(RECORDER_ROLE, principal));

        vm.prank(principal);
        IAgentMandate(REGISTRY).recordExecution(agent, principal, bytes32(TRANSFER_FROM), PER_TRANSACTION_CAP);

        assertEq(IAgentMandate(REGISTRY).getMandate(agent, principal).cumulativeUsed, PER_TRANSACTION_CAP);
    }

    function testX2AGrantNamingNoComplianceProviderIsRefused() public {
        address fresh = makeAddr("freshAgent");

        vm.prank(principal);
        vm.expectRevert(ZeroComplianceProvider.selector);
        IAgentMandate(REGISTRY).grantMandate(grantParamsFor(fresh, address(0), address(asset)), "");
    }

    function testX3AGrantForAPrincipalTheProviderDoesNotClearIsRefused() public {
        address fresh = makeAddr("anotherAgent");

        vm.prank(complianceOperator);
        IComplianceRecords(COMPLIANCE).revokePrincipal(principal, REASON_REVOKED);

        vm.prank(principal);
        vm.expectRevert(PrincipalNotEligible.selector);
        IAgentMandate(REGISTRY).grantMandate(grantParamsFor(fresh, COMPLIANCE, address(asset)), "");
    }

    function testW2TheRegistryNeverReadsComplianceAgainAfterTheGrant() public {
        vm.prank(complianceOperator);
        IComplianceRecords(COMPLIANCE).revokePrincipal(principal, REASON_REVOKED);

        (bool eligible,,) = IComplianceRecords(COMPLIANCE).checkPrincipal(principal, IDENTITY_REF);
        assertFalse(eligible);

        assertTrue(
            IAgentMandate(REGISTRY).canExecute(
                agent, principal, address(asset), bytes32(TRANSFER_FROM), PER_TRANSACTION_CAP
            )
        );
    }

    /// The one clause no transaction of ours can reach: freezing needs a role only Brickken hold.
    function testAFrozenAgentIsRefusedForEveryPrincipalItServes() public {
        vm.prank(complianceOperator);
        IAccessControl(REGISTRY).grantRole(ENFORCER_ROLE, enforcer);

        vm.prank(enforcer);
        IAgentMandate(REGISTRY).freezeAgent(agent);

        assertFalse(
            IAgentMandate(REGISTRY).canExecute(
                agent, principal, address(asset), bytes32(TRANSFER_FROM), PER_TRANSACTION_CAP
            )
        );
    }

    function testAFrozenAgentStopsTheExecutorAtTheMandateAndNotAtTheTarget() public {
        vm.prank(complianceOperator);
        IAccessControl(REGISTRY).grantRole(ENFORCER_ROLE, enforcer);

        vm.prank(enforcer);
        IAgentMandate(REGISTRY).freezeAgent(agent);

        vm.prank(agent);
        vm.expectPartialRevert(AgentExecutor.CannotExecute.selector);
        executor.execute(address(asset), transferCall(PER_TRANSACTION_CAP));
    }

    /// W2 is a token layer case because it can only be one: the mandate does not stop it.
    function testW2AnIneligibleSenderStillMovesValueThroughAPlainToken() public {
        vm.prank(complianceOperator);
        IComplianceRecords(COMPLIANCE).revokePrincipal(principal, REASON_REVOKED);

        vm.prank(agent);
        executor.execute(address(asset), transferCall(PER_TRANSACTION_CAP));

        assertEq(asset.balanceOf(recipient), PER_TRANSACTION_CAP);
        assertEq(IAgentMandate(REGISTRY).getMandate(agent, principal).cumulativeUsed, PER_TRANSACTION_CAP);
    }
}
