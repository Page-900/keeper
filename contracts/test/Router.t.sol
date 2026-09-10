// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {AgentExecutor} from "../AgentExecutor.sol";
import {SettlementRouter} from "../SettlementRouter.sol";
import {IAgentExecutor} from "../interfaces/IAgentExecutor.sol";
import {IAgentMandate} from "../interfaces/IAgentMandate.sol";
import {LabTest} from "./Lab.t.sol";

contract CallerStub {
    IAgentExecutor internal immutable executor;

    constructor(IAgentExecutor value) {
        executor = value;
    }

    function forward(address target, bytes calldata data) external returns (bytes memory) {
        return executor.execute(target, data);
    }
}

contract RouterTest is LabTest {
    bytes4 internal constant APPROVE = ERC20.approve.selector;
    uint8 internal constant RECIPIENT_INDEX = 1;
    uint8 internal constant SPENDER_INDEX = 0;

    CallerStub internal stub;
    SettlementRouter internal router;
    address internal stranger = makeAddr("stranger");

    function setUp() public override {
        super.setUp();
        stub = new CallerStub(IAgentExecutor(address(executor)));
        router = new SettlementRouter(IAgentExecutor(address(executor)), agent, principal);

        vm.startPrank(principal);
        router.setRoute(TRANSFER_FROM, true, RECIPIENT_INDEX);
        router.setAllowed(recipient, true);
        vm.stopPrank();

        grantTo(address(router));
    }

    function grantTo(address who) internal {
        IAgentMandate.GrantMandateParams memory params = grantParams();
        params.agent = who;
        vm.prank(principal);
        registry.grantMandate(params, "");
    }

    function routerUsed() internal view returns (uint256) {
        return registry.getMandate(address(router), principal).cumulativeUsed;
    }

    function deliver(address to, uint256 amount) internal view returns (bytes memory) {
        return abi.encodeWithSelector(TRANSFER_FROM, principal, to, amount);
    }

    function testAContractCanBeTheAgentAMandateNames() public {
        grantTo(address(stub));

        stub.forward(address(asset), transferCall(PER_TRANSACTION_CAP));

        assertEq(asset.balanceOf(recipient), PER_TRANSACTION_CAP);
        assertEq(registry.getMandate(address(stub), principal).cumulativeUsed, PER_TRANSACTION_CAP);
    }

    function testAListedRecipientIsForwardedAndRecordedAgainstTheCap() public {
        vm.prank(agent);
        router.execute(address(asset), deliver(recipient, PER_TRANSACTION_CAP));

        assertEq(asset.balanceOf(recipient), PER_TRANSACTION_CAP);
        assertEq(routerUsed(), PER_TRANSACTION_CAP);
    }

    function testARecipientTheMandateWouldAllowIsStillRefusedHere() public {
        assertTrue(registry.canExecute(address(router), principal, address(asset), bytes32(TRANSFER_FROM), PER_TRANSACTION_CAP));

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(SettlementRouter.RecipientNotAllowed.selector, stranger));
        router.execute(address(asset), deliver(stranger, PER_TRANSACTION_CAP));

        assertEq(asset.balanceOf(stranger), 0);
        assertEq(routerUsed(), 0);
    }

    function testTheExecutorRefusesTheWalletThatTriesToGoAroundTheRouter() public {
        vm.prank(principal);
        registry.revokeMandate(agent, principal, 0, "");

        vm.prank(agent);
        vm.expectPartialRevert(AgentExecutor.CannotExecute.selector);
        executor.execute(address(asset), deliver(stranger, PER_TRANSACTION_CAP));

        assertEq(asset.balanceOf(stranger), 0);
    }

    function testACallerThatIsNotTheAgentWalletIsRefused() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SettlementRouter.NotTheAgentWallet.selector, stranger));
        router.execute(address(asset), deliver(recipient, PER_TRANSACTION_CAP));

        assertEq(routerUsed(), 0);
    }

    function testCalldataTooShortToHoldARecipientIsRefused() public {
        vm.prank(agent);
        vm.expectRevert(SettlementRouter.CalldataUnreadable.selector);
        router.execute(address(asset), abi.encodeWithSelector(TRANSFER_FROM, principal));
    }

    function testAnAddressArgumentWithDirtyHighBytesIsRefused() public {
        bytes memory dirty = abi.encodePacked(
            TRANSFER_FROM,
            bytes32(uint256(uint160(principal))),
            bytes32(uint256(uint160(recipient)) | (uint256(1) << 200)),
            bytes32(PER_TRANSACTION_CAP)
        );

        vm.prank(agent);
        vm.expectRevert(SettlementRouter.CalldataUnreadable.selector);
        router.execute(address(asset), dirty);
    }

    function testASelectorTheRouterDoesNotKnowIsRefused() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(SettlementRouter.ActionNotRouted.selector, APPROVE));
        router.execute(address(asset), abi.encodeWithSelector(APPROVE, recipient, PER_TRANSACTION_CAP));
    }

    function testASecondActionIsForwardedSoTheMandateStaysTheLayerThatRefusesIt() public {
        vm.prank(principal);
        executor.setAction(APPROVE, true, true, 1);
        vm.prank(principal);
        router.setRoute(APPROVE, true, SPENDER_INDEX);

        vm.prank(agent);
        vm.expectPartialRevert(AgentExecutor.CannotExecute.selector);
        router.execute(address(asset), abi.encodeWithSelector(APPROVE, recipient, PER_TRANSACTION_CAP));
    }

    function testTheAgentWalletCannotWidenItsOwnReach() public {
        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        router.setAllowed(stranger, true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        router.setAgentWallet(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, agent));
        router.setRoute(TRANSFER_FROM, true, 0);
        vm.stopPrank();
    }

    function testTheRouterAnswersTheActionTableWithWhateverTheExecutorSays() public view {
        (bool supported, bool hasAmount, uint8 amountIndex) = router.actions(TRANSFER_FROM);

        assertTrue(supported);
        assertTrue(hasAmount);
        assertEq(amountIndex, AMOUNT_INDEX);
    }

    function testTheRouterNamesTheSameRegistryAndPrincipalTheExecutorDoes() public view {
        assertEq(router.rams(), address(registry));
        assertEq(router.principal(), principal);
        assertEq(router.owner(), principal);
    }

    function testAnActionTheExecutorHasNotRegisteredReadsAsUnsupportedThroughTheRouter() public view {
        (bool supported,,) = router.actions(APPROVE);

        assertFalse(supported);
    }

    function testTheRouterHoldsNothingAndSpendsNoAllowanceOfItsOwn() public {
        vm.prank(agent);
        router.execute(address(asset), deliver(recipient, PER_TRANSACTION_CAP));

        assertEq(asset.balanceOf(address(router)), 0);
        assertEq(asset.allowance(principal, address(router)), 0);
    }
}
