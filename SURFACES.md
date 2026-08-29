# Brickken surfaces this project used

Generated from the evidence this repository captured as the work happened, never written from memory. Regenerate with `npm run surfaces`. A test fails if this file and the evidence disagree.

Everything below ran against Brickken's sandbox on Ethereum Sepolia, chain 11155111.

## REST, the dapp API

A row is one endpoint, and the method column holds the HTTP verb. Answered means Brickken returned an HTTP success. That is recorded before the body is read, so an answer this project could not parse still counts as answered in this section.

| Method | Path | Answered |
| --- | --- | --- |
| GET | /get-balance-whitelist | yes |
| GET | /get-stos | yes |
| GET | /get-token-info | not every time |
| GET | /get-transaction-status | yes |
| GET | /get-whitelist-status | yes |
| GET | /rams/status | yes |
| GET | /rams/typed-data/grant-mandate | yes |

## The SDK

A row is one Brickken method and the path their own SDK resolves it to. Answered means the call returned without raising.

| Method | Path | Answered |
| --- | --- | --- |
| approve | /prepare-transactions | yes |
| closeOffer | /prepare-transactions | not every time |
| mintToken | /prepare-transactions | yes |
| newSto | /prepare-transactions | not every time |
| newTokenization | /prepare-transactions | not every time |
| ramsExecute | /prepare-transactions | not every time |
| whitelist | /prepare-transactions | yes |

## MCP, the hosted server

A row is one message sent over the session, so the protocol handshake appears alongside the tools. Answered is stricter here than in the REST section: a reply this project could not read is recorded as not answered.

| Method | Path | Answered |
| --- | --- | --- |
| configure | /mcp | yes |
| get_token_info | /mcp | yes |
| initialize | /mcp | yes |
| notifications/initialized | /mcp | yes |
| tools/list | /mcp | yes |

## The command line tool

A row is one command, run as a separate program. The path column holds the pinned package that ran it.

| Method | Path | Answered |
| --- | --- | --- |
| rams inspect | brickken-cli@0.4.12 | not every time |

## The agent skill

This one is not an API. Brickken publish a skill for AI agents, and their own command line tool installs it. What is recorded is the artifact that arrived, not a list of calls.

| Artifact | Installed by | Files |
| --- | --- | --- |
| brickken | npx -y brickken-cli@0.4.12 skill install --path ./vendor --force | 6 |

Every file is fingerprinted at install and re-checked on every verification run. Brickken publish no fingerprint of their own, so that check proves the files have not changed since they arrived here, and it does not prove they are authentic.

## One call the log does not hold

The mandate grant went through the SDK before this request log existed, so no row above describes it. It is anchored on the chain instead, in block 11558285: [the grant transaction](https://sepolia.etherscan.io/tx/0x76a992afc0964eae5bb4bd0ab181e5c27662062a9f0f0c1c9fce122c98660126).

## Considered and not used

| Not used | Why |
| --- | --- |
| dividendDistribution | Issuer-side, and it needs payment tokens. The agent this project is about never distributes anything. |
| create-kyc-link | Compliance here is already whitelisting plus the registry eligibility check, and both are anchored on chain. A KYC link that no investor completes would be a call made only to be counted. |
| ERC-8004 agent registration | A different standard and a different track. Nothing this project demonstrates depends on it. |
| burnToken, transferTo, transferFrom | The agent moves tokens through the mandate, not through the issuer surface, so calling these would misrepresent where the authority comes from. |
