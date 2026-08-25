// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// recordExecution is gated on AccessControl, which IAgentMandate does not declare.
interface IMandateRoles is IAccessControl {}
