// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

contract MockAgentMandate {
    bool public allowed;

    address public lastAgent;
    address public lastPrincipal;
    bytes32 public lastAction;
    uint256 public lastAmount;
    uint256 public recordCount;

    function setAllowed(bool value) external {
        allowed = value;
    }

    function canExecute(address, address, address, bytes32, uint256) external view returns (bool) {
        return allowed;
    }

    function recordExecution(address agent, address principal, bytes32 action, uint256 amount) external {
        lastAgent = agent;
        lastPrincipal = principal;
        lastAction = action;
        lastAmount = amount;
        recordCount += 1;
    }
}

interface IExecute {
    function execute(address target, bytes calldata data) external returns (bytes memory);
}

contract MockReentrantToken {
    IExecute public executor;

    function setExecutor(IExecute value) external {
        executor = value;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        executor.execute(address(this), abi.encodeWithSelector(this.transferFrom.selector, from, to, amount));
        return true;
    }
}

contract MockToken {
    bool public shouldRevert;

    address public lastCaller;
    address public lastFrom;
    address public lastTo;
    uint256 public lastAmount;

    error TransferRefused();

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (shouldRevert) revert TransferRefused();
        lastCaller = msg.sender;
        lastFrom = from;
        lastTo = to;
        lastAmount = amount;
        return true;
    }
}
