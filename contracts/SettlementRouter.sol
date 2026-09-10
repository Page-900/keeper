// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IAgentExecutor} from "./interfaces/IAgentExecutor.sol";

/// @notice The reads every IAgentExecutor exposes, which an integrator uses to describe a call.
interface IExecutorReads {
    function actions(bytes4 selector) external view returns (bool supported, bool hasAmount, uint8 amountIndex);
    function rams() external view returns (address);
    function principal() external view returns (address);
}

/// @title SettlementRouter
/// @notice Stands in front of an IAgentExecutor as the agent a mandate names, and refuses any call
///         whose address argument the principal has not listed. A mandate bounds quantity and time
///         and never destination, so the destination is bounded here instead.
contract SettlementRouter is IAgentExecutor, Ownable {
    /// @param supported Whether this selector may be forwarded.
    /// @param recipientIndex Index of the address argument this selector delivers to.
    struct Route {
        bool supported;
        uint8 recipientIndex;
    }

    IAgentExecutor public immutable executor;

    address public agentWallet;

    mapping(bytes4 selector => Route) public routes;

    mapping(address recipient => bool) public allowed;

    event AgentWalletSet(address indexed wallet);
    event RouteSet(bytes4 indexed selector, bool supported, uint8 recipientIndex);
    event RecipientAllowed(address indexed recipient, bool allowed);

    error NotTheAgentWallet(address caller);
    error ActionNotRouted(bytes4 selector);
    error CalldataUnreadable();
    error RecipientNotAllowed(address recipient);

    constructor(IAgentExecutor _executor, address _agentWallet, address owner_) Ownable(owner_) {
        executor = _executor;
        agentWallet = _agentWallet;
        emit AgentWalletSet(_agentWallet);
    }

    function setAgentWallet(address wallet) external onlyOwner {
        agentWallet = wallet;
        emit AgentWalletSet(wallet);
    }

    /// @notice A wrong recipientIndex reads the wrong argument, so treat this like the executor's own table.
    function setRoute(bytes4 selector, bool supported, uint8 recipientIndex) external onlyOwner {
        routes[selector] = Route({supported: supported, recipientIndex: recipientIndex});
        emit RouteSet(selector, supported, recipientIndex);
    }

    /// @notice Answered by the executor behind this one, so an integrator reads one amount table, not two.
    function actions(bytes4 selector) external view returns (bool, bool, uint8) {
        return IExecutorReads(address(executor)).actions(selector);
    }

    function rams() external view returns (address) {
        return IExecutorReads(address(executor)).rams();
    }

    function principal() external view returns (address) {
        return IExecutorReads(address(executor)).principal();
    }

    function setAllowed(address recipient, bool value) external onlyOwner {
        allowed[recipient] = value;
        emit RecipientAllowed(recipient, value);
    }

    /// @inheritdoc IAgentExecutor
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        if (msg.sender != agentWallet) revert NotTheAgentWallet(msg.sender);
        if (data.length < 4) revert CalldataUnreadable();

        bytes4 selector = bytes4(data[:4]);
        Route memory route = routes[selector];
        if (!route.supported) revert ActionNotRouted(selector);

        address recipient = _addressArg(data, route.recipientIndex);
        if (!allowed[recipient]) revert RecipientNotAllowed(recipient);

        return executor.execute(target, data);
    }

    /// @dev A word with dirty high bytes would cast to an address the target decodes differently.
    function _addressArg(bytes calldata data, uint8 index) internal pure returns (address) {
        uint256 offset = 4 + uint256(index) * 32;
        if (data.length < offset + 32) revert CalldataUnreadable();
        uint256 word = uint256(bytes32(data[offset:offset + 32]));
        if (word > type(uint160).max) revert CalldataUnreadable();
        return address(uint160(word));
    }
}
