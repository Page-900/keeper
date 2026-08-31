// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IAgentMandate} from "./IAgentMandate.sol";

/// The grant and revoke paths revert these, and IAgentMandate declares none of them.
interface IMandateErrors is IAgentMandate {
    error SignatureExpired();
    error InvalidSignature();
    error MandateAlreadyActive();
}
