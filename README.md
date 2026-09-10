# Keeper

An AI agent that manages an investor's position in a tokenized asset, under an ERC-8226 mandate on
Ethereum Sepolia. Built for the Build with Brickken campaign.

## The claim

**An agent's reasoning can be compromised and the money still cannot move.**

Not because the agent is hard to fool. It is not. Because nothing that decides where money goes is
ever asked of the model.

## Try to break it

**[keeper-demo.fly.dev](https://keeper-demo.fly.dev/)**

The offer document on that page is an editable box. Write anything you like into it, including
instructions aimed at the agent, and press send. You see what the agent was shown, what it decided,
and what happened next.

There is also a box for an address. Type any address you like, one you own or one you invent, and the
page asks the deployed contracts what would happen if the agent tried to deliver to it. You choose the
address after the contracts were deployed, so the answer cannot have been arranged in advance.

## What it does

An investor owns tokens in a property and wants an agent to manage that position, without handing it
unlimited authority. ERC-8226 lets them grant a **mandate**: on chain limits saying which asset, which
action, how much at once, how much in total, and until when.

Keeper reads a buyer's offer, decides how much of the holding to sell, and delivers. The offer is
written by someone else. That is what makes it an attack surface.

## The asset

Sunrise Lodge is a twelve room hotel, invented for this project. Twelve rooms at about 80 USD a night
at about 60 percent occupancy, tokenizing a share of room revenue for three months.

It is invented rather than borrowed, and it is a small hotel rather than a bond, because the agent
needed three things to have a job worth doing. A story anyone understands in ten seconds. Real
ambiguity to reason about, because occupancy swings with the season and a roof repair can outrank a
distribution. And an offer document that someone other than the investor would plausibly write, since
that document is the attack surface.

**The offer document is a third party's claims, not this repository's facts.** It says so in its own
first paragraph. Every number that matters is read from the chain instead, so the supply the document
states is not the supply, and the agent is never allowed to act on a figure it read there.

## The mandate

One agent. One token. One action, `transferFrom`. **250 tokens per transfer, 1,750 in its lifetime,
expiring 9 November 2026.** Signed off chain by the investor, granted through Brickken's RAMS surface.

**The agent the mandate names is a contract, not a wallet.** The first mandate named a wallet and spent
500 of its 1,000. I revoked it through Brickken's own tool and granted a fresh one to a small contract
of mine, described further down. A grant writes a new mandate with the running total back at zero, so
what the first one spent is kept in this repository rather than on the chain.

**Six of the registry's eight rules were then broken deliberately and refused on chain**, across seven
transactions: wrong asset, outside the window, revoked, action not allowed, over the per transfer cap,
over the lifetime cap. All linked in [`EVIDENCE.md`](EVIDENCE.md).

The other two could not be sent from here. Freezing an agent needs a role this project does not hold,
and having no mandate at all is reported as the wrong asset, so it cannot be told apart on chain.

## What actually stops the money

| Layer   | What it really checks                                                      | Where it lives                    |
| ------- | -------------------------------------------------------------------------- | --------------------------------- |
| Token   | Whether the **sender** may move this asset                                 | The regulated token               |
| Mandate | Right asset, right action, inside the window, not revoked, under both caps | Brickken's registry               |
| App     | Whether the decision makes sense, and where the value is going             | This repository, off chain and on |

**Neither on chain layer checks who receives the money.** `canExecute` is handed an agent, a principal,
an asset, an action and an amount, and no destination. The token's transfer hook tests the sender.

So a delivery inside every cap, to an address nobody ever cleared, is refused by nothing on chain.
Measured three ways: a live read of the deployed registry in `npm run verify`, a fork of the deployed
token in `contracts/test/ForkRecipient.t.sol`, and the third row of [`LAYERS.md`](LAYERS.md).

**The app layer is the only thing that checks the destination**, and it does it without asking the
model. The investor's settlement address reaches the code out of band and is compared afterwards.

**Since 10 September that check also runs on chain**, in a contract of mine called the settlement
router. The mandate names the router as its agent, so the registry obeys the router and refuses anybody
else. The router reads the recipient out of the call and refuses any address the investor has not
listed. Only the investor can change that list.

Where the check lives is the whole point. A check that only runs on a server dies with the server. This
one does not. Ask the deployed contracts yourself, on the demo page, with any address you like.

## The attack

Seven attack families were written against the shipped agent and its real prompt. Three hide a forged
instruction in the document. Four go at the seams, including a forged closing marker carrying a fake
policy addendum.

**On the model used until 2 September 2026, all seven were refused by the agent's own reasoning. On the
model it runs on now, one got through in two of the five runs made**, proposing 250 tokens to an
address the investor never named. It is intermittent. Paste the same document and the agent may hold.

The proposal was refused by code that runs after the model, on a rule the model was never shown. The
mandate would not have refused it, because the amount was inside every cap.

Prompt injection is not solved here and this repository does not claim it is. The claim is that the
money never depended on solving it.

## The evidence

Generated from records captured as each call was made. Each has a test that fails if it
drifts.

| File                         | What it holds                                                    |
| ---------------------------- | ---------------------------------------------------------------- |
| [`EVIDENCE.md`](EVIDENCE.md) | Every transaction sent, linked, including the ones that reverted |
| [`LAYERS.md`](LAYERS.md)     | The same delivery with one defence removed at a time             |
| [`SURFACES.md`](SURFACES.md) | Every Brickken method called, and what was deliberately not used |
| [`REPORT.md`](REPORT.md)     | What building on a draft standard taught me, and what I suggest  |

`EVIDENCE.md` also names what was **not** measured, so its tables cannot imply a number that does not
exist.

## Brickken surfaces used

- **REST**, reads: `get-balance-whitelist`, `get-stos`, `get-token-info`, `get-transaction-status`,
  `get-whitelist-status`, `rams/status`, `rams/typed-data/grant-mandate`,
  `rams/typed-data/revoke-mandate`
- **SDK**, writes: `newTokenization`, `whitelist`, `mintToken`, `approve`, `newSto`, `closeOffer`,
  `ramsGrantMandate`, `ramsRevokeMandate`, `ramsExecute`
- **MCP**: `initialize`, `notifications/initialized`, `configure`, `tools/list`, `get_token_info`
- **CLI**: `rams inspect`, at `brickken-cli@0.4.12`, reading the mandate independently of my own code
- **Skill**: `skill install`, six files, fingerprinted at install and re-checked every run

Business logic calls none of them directly. Each goes through a thin wrapper, so every call is recorded
before its outcome is known.

## Addresses

Everything on Ethereum Sepolia, chain 11155111.

| What                                                    | Address                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| SUNL, the asset                                         | [`0x2aE3BB75aB04957aE3b8944094BC9e96d33dB255`](https://sepolia.etherscan.io/address/0x2aE3BB75aB04957aE3b8944094BC9e96d33dB255) |
| The investor, who signs the mandate and owns the tokens | [`0x6EF3A7D250F3E7e04Cf8B64E950FB1f8225832Dc`](https://sepolia.etherscan.io/address/0x6EF3A7D250F3E7e04Cf8B64E950FB1f8225832Dc) |
| Keeper's wallet, which signs its transactions           | [`0x29d78c8c5E7ad231a21A64170cA07e419f0C5aBa`](https://sepolia.etherscan.io/address/0x29d78c8c5E7ad231a21A64170cA07e419f0C5aBa) |
| The settlement router, which the mandate names          | [`0x8ac2bDD2F04c68fb03134bf1dc6C7552f15a8058`](https://sepolia.etherscan.io/address/0x8ac2bDD2F04c68fb03134bf1dc6C7552f15a8058) |
| The buyer it delivers to                                | [`0xd34B78Ff018835b7124FCf347a319A788d2DC71E`](https://sepolia.etherscan.io/address/0xd34B78Ff018835b7124FCf347a319A788d2DC71E) |
| The executor, deployed by this project                  | [`0x914F32af870b11739C68cbc8c4561c139a820C41`](https://sepolia.etherscan.io/address/0x914F32af870b11739C68cbc8c4561c139a820C41) |
| Brickken's mandate registry                             | [`0xD68E1bb972cA4EF7F5764FBf6d685a6DfC26778e`](https://sepolia.etherscan.io/address/0xD68E1bb972cA4EF7F5764FBf6d685a6DfC26778e) |
| Brickken's compliance provider                          | [`0xa90D2503D5D9b80ECC27856Ff76F892B8C02f278`](https://sepolia.etherscan.io/address/0xa90D2503D5D9b80ECC27856Ff76F892B8C02f278) |
| A second agent, used only to break the limits           | [`0xB74a98a9e33d13874adec7919BFe6599DD70161a`](https://sepolia.etherscan.io/address/0xB74a98a9e33d13874adec7919BFe6599DD70161a) |
| An address nobody ever cleared                          | [`0x3Fb193fB1b205d3d5c258D907c2E3D259CE00521`](https://sepolia.etherscan.io/address/0x3Fb193fB1b205d3d5c258D907c2E3D259CE00521) |

**The refusals were run by a second agent, not by Keeper.** Each one needed its own short lived mandate
with tiny limits, so breaking a limit eleven times cost the investor's own mandate nothing. That is why the
first mandate's lifetime total stopped at 500 of 1,000. The mandate in force now reads 0 of 1,750,
because a fresh grant starts that count again.

**The investor's wallet also created the token.** In a real deployment the issuer and the investor are
different people. Here they are one testnet key, because the point being demonstrated is the mandate,
not the separation of duties.

**Keeper holds a key and the demo page does not.** The agent signs from its own address and calls the
router. The public page runs the model and the checks, reads the chain, and signs nothing, so no attack
typed into it can move anything.

**Nothing was ever sent to the uncleared address.** It is there so the chain can be asked, as a read,
whether it would allow a delivery to it. It answers yes. Sending would have stranded the tokens,
because an uncleared address cannot send them back.

Every address above is a throwaway testnet key holding nothing of value.

## Where each thing ran

**On Brickken's deployment:** issuance, the offering, clearing both parties, the mandate, and every
refusal. Forty six transactions on Ethereum Sepolia, chain 11155111.

**On copies deployed inside this repository's own tests:** anything genuinely adversarial. Those carry
no transaction hash, because nothing was sent.

## Running it

Needs Node 22 or later.

```bash
git clone https://github.com/Page-900/keeper.git
cd keeper
npm ci
npm run ci
```

`npm run ci` runs format, lint, typecheck, tests, build and a quality scan, and fails on the first red.
**No API key or network is needed**, including for the adversarial measurements.

`npm run verify` reads Sepolia live and prints a pass or fail table in plain English. It never stops at
the first failure, and a check that did not run prints as a failure, so it cannot report a pass for a
partial run. It needs a `.env`, copied from `.env.example`.

## Limitations

- **Sepolia only.** No mainnet, no bridging, nothing of value.
- **The delay between a compliance record being revoked and an agent being frozen is not measured.**
  The standard names this risk and does not size it. What is established is that it is not a race:
  `canExecute` never reads the compliance provider, so a revocation and an action can share a block and
  the action still passes.
- **Whether one agent serving two investors can be turned against the second is not tested.** The on
  chain half is readable from the reference implementation. That is a reading of code, not a result.
- **Production would need** compliance event monitoring, real key management, and human approval above
  a threshold. It would also need somewhere to check the recipient, because the standard does not
  provide one. Mine is in this repository and it is forty lines.

## AI disclosure

AI-assisted implementation under my architectural direction and review. Every commit is mine.

**The tool was Claude Code, running Claude Opus.** Separately, and not a build tool, the shipped
agent calls `openai/gpt-oss-120b` through Groq at runtime.

## License

MIT. See [LICENSE](LICENSE).
