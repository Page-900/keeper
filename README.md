# Keeper

An AI portfolio agent for tokenized real-world assets, running under an ERC-8226 mandate on Ethereum Sepolia. Built for the Build with Brickken campaign.

## What it does

An investor holds tokens in a property and wants an agent to manage that position. They do not want to hand an agent unlimited authority over their money. ERC-8226 (RAMS) lets them grant a **mandate** instead. A mandate is a set of on-chain limits saying what the agent may do, with which asset, up to what amount, and until when.

Keeper is the agent that runs inside those limits. The demo asset is Sunrise Lodge (SUNL).

## The claim

**An agent's reasoning can be fully compromised and the money still cannot move.**

Prompt injection works, and it will keep working. So Keeper assumes its own reasoning is already hijacked. Security lives in the on-chain mandate, never in the system prompt.

## How it works

A transfer must pass three independent checks:

| Layer   | Asks                                                                               | Lives in                 |
| ------- | ---------------------------------------------------------------------------------- | ------------------------ |
| Token   | Is this party allowed to hold or receive this asset?                               | The regulated token      |
| Mandate | Right asset, inside the time window, not revoked, action allowed, under both caps? | Brickken's RAMS registry |
| App     | Does this decision make sense at all?                                              | Keeper's own code        |

The app layer contains the LLM, so it is the layer that can be talked into things. The other two do not read English. A hijacked Keeper asking for 50,000 SUNL against a 1,000 cap is simply refused.

Every blocked attempt is reported with the layer that actually blocked it. The mandate caps amounts and time. It does **not** filter recipients, that is the token layer's job.

## Status

Early. The repo, CI gates, the config module, the chain client, and the transaction pipeline are done. Nothing else is built, no transaction has been sent, and no mandate has been granted. The on-chain work is blocked on Brickken sandbox onboarding.

Transaction hashes and the list of Brickken surfaces used will appear here, generated from recorded logs rather than typed by hand. Nothing is published that the chain has not confirmed.

## Running it

Needs Node 22+.

```bash
git clone https://github.com/Page-900/keeper.git
cd keeper
npm ci
npm run ci
```

`npm run ci` runs format, lint, typecheck, tests, build, and a code quality scan, failing on the first red. No API key is needed for the tests.

If you want to see the state of the build rather than debug it, run `npm run verify`. It runs the same chain plus a live read of the Sepolia chain, then prints a pass or fail table in plain English. It does not stop at the first failure, and a check that never ran is printed as a failure rather than left off the table, so the command can never report a pass for a partial run.

For chain work, copy `.env.example` to `.env` and fill in your own values. `.env` is git ignored, and a test fails the build if it ever enters the git index.

## Limitations

- Sepolia testnet only. No mainnet, no bridging, no funds of any value.
- Caps and the validity window are deliberately small, so a successful attack on the public demo stays cheap and publishable.
- A production version would need compliance event monitoring, real key management, and human approval above a threshold.

## AI disclosure

AI-assisted implementation under human architectural direction and review.

I defined the problem and the security thesis, made the architectural decisions, and handle every interaction with Brickken. AI assisted in coding only. Every commit is mine.

## License

MIT. See [LICENSE](LICENSE).
