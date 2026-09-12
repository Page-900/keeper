# What was actually run, and where

Generated from the records this repository captured at the moment each call was made, never written from memory. Regenerate with `npm run evidence`. A test fails if this file and those records disagree, and a second one fails if a single recorded transaction is missing from it.

Everything below is on Ethereum Sepolia, chain 11155111. Every hash links to Etherscan.

## Issuing the asset

The token and its offering, through their issuance API rather than by hand.

| What happened | Result | Block | Transaction |
| --- | --- | --- | --- |
| The asset token was created through their issuance API | went through | 11516862 | [0xf37a3243…](https://sepolia.etherscan.io/tx/0xf37a3243e7456495d9ad2a6614504b98f34756da4d7bfb9f74fcf54922e8ba3c) |
| A throwaway token was created first, to rehearse the offering | went through | 11585556 | [0x0f7f55dd…](https://sepolia.etherscan.io/tx/0x0f7f55dd4cc968ace9c76c4778172c88d2b0990f2e3bae9d7ead38f2875b8e35) |
| The offering was rehearsed on that throwaway token | went through | 11585578 | [0x820283d6…](https://sepolia.etherscan.io/tx/0x820283d65ae3e8f59fefa236b455a1da66f1823ffb694f04c311b6ecde719609) |
| The offering was opened on the asset itself | went through | 11587300 | [0xc204d7c0…](https://sepolia.etherscan.io/tx/0xc204d7c009f903fdfd7127724b0374add4d9d1d69fbec78500642cccf4269172) |

## Setting up the mandate

What had to exist before an agent could act at all.

| What happened | Result | Block | Transaction |
| --- | --- | --- | --- |
| The executor contract was deployed | went through | 11511230 | [0x524e2d49…](https://sepolia.etherscan.io/tx/0x524e2d49a0cd7df6ef21044ef8bc27d85b9f02a84c53ee8ecb650bcd8d700ac6) |
| The one action it may forward was registered | went through | 11514214 | [0xb442a5e6…](https://sepolia.etherscan.io/tx/0xb442a5e6804a7cea1f27444066c20e9cfc1d9854e142e8d916a2c52464de95f6) |
| A second action was registered and never enabled on any mandate | went through | 11593687 | [0x6476302a…](https://sepolia.etherscan.io/tx/0x6476302afaa4ee32fb5a36f2d588cc136f1558fba11dbc20ce42d7432a2c4ed6) |
| The investor was cleared to hold the token | went through | 11517299 | [0x7e145740…](https://sepolia.etherscan.io/tx/0x7e14574056150ff1ec54a21131e5867648c05730168989fca0c2589a1961014b) |
| The investor's holding was issued | went through | 11517305 | [0x1b08fb09…](https://sepolia.etherscan.io/tx/0x1b08fb09b2fcf0656bdfd16938208061876b423cc96d8cd7cf55247d677d5540) |
| The investor allowed the executor to move that holding | went through | 11517391 | [0xada927ae…](https://sepolia.etherscan.io/tx/0xada927ae9e468df7f6192341aee7dcefc8c8b19de3529a9dbc675581bdc4f868) |
| The buyer was cleared to hold the token | went through | 11558473 | [0xe6b82e42…](https://sepolia.etherscan.io/tx/0xe6b82e423b77f195fe5efb2715a85cc8d37ff123c8238a7f96e3566f4c120d83) |
| The investor granted the mandate, signed rather than called directly | went through | 11558285 | [0x76a992af…](https://sepolia.etherscan.io/tx/0x76a992afc0964eae5bb4bd0ab181e5c27662062a9f0f0c1c9fce122c98660126) |

## The agent acting under it

The two that matter are the last two: value moving inside the limit, and the identical call one unit over it.

| What happened | Result | Block | Transaction |
| --- | --- | --- | --- |
| The agent moved value inside the mandate | went through | 11558501 | [0xc3bdffe3…](https://sepolia.etherscan.io/tx/0xc3bdffe39a969c2b4ce41ce345ef569bc6a462c6399a299d8077fc53ce7c88e8) |
| The agent reasoned its way to an amount, and that amount went through | went through | 11592921 | [0x0f5bea57…](https://sepolia.etherscan.io/tx/0x0f5bea57c713eea314e003bd3467d902eb59f4f91a7f000dff6b04789fcb916b) |
| The same agent, one unit over the limit, refused by the registry | **refused** | 11566500 | [0xc6d697f6…](https://sepolia.etherscan.io/tx/0xc6d697f63edc632e938d2266b10f11216f75d0a3e9e1b2cbe9cfcf562c377941) |
| The buyer was funded so it could send the holding back | went through | 11607077 | [0x33d99560…](https://sepolia.etherscan.io/tx/0x33d99560d881826ee4417835e3aa0515156d756fbf469211185b9c1cf9c77cb7) |
| The buyer returned it, so the demonstration can be run again | went through | 11607079 | [0x0ad0b598…](https://sepolia.etherscan.io/tx/0x0ad0b598b19ea511110ada163a5f63bee2b9e2025747c4951abdedfa731d9ec9) |

## The probe mandates

Every refusal below was run against a separate mandate with tiny limits, so the battery never spent the investor's own lifetime allowance.

| What happened | Result | Block | Transaction |
| --- | --- | --- | --- |
| Probe mandate 1, granted with tiny limits and a short window | went through | 11593717 | [0xc2a296cf…](https://sepolia.etherscan.io/tx/0xc2a296cfe488babd7da7a64c1daf1a928cc8a5efcc2c748a6233b0b54549abeb) |
| Probe mandate 2, granted with tiny limits and a short window | went through | 11598712 | [0x802c9c6b…](https://sepolia.etherscan.io/tx/0x802c9c6b210cd232dcafd57a26e57991aefaa8d4d860023aa627cb96954d7dc1) |
| Probe mandate 3, granted with tiny limits and a short window | went through | 11598971 | [0x3a9419af…](https://sepolia.etherscan.io/tx/0x3a9419afe9c9f1d7179a3e8b8733b7d8a1428e6895bd0e22e7f5496074f902a6) |
| Probe mandate 4, granted with tiny limits and a short window | went through | 11599399 | [0x5757652f…](https://sepolia.etherscan.io/tx/0x5757652f96c14904a1a9e04172f082e6c9d8947436856b410116e110864b711f) |

## Every limit refusing, one at a time

**These all revert with the same error, so the revert cannot say which limit was broken.** The registry answers one boolean and the executor turns any false into one error. What names the limit is a read of the mandate state at that same block, which is recorded beside each case and re-checked against the chain. A refusal that could not be pinned to a single limit is recorded as such rather than credited to one.

| Case | The first limit it broke | Revert | Block | Transaction |
| --- | --- | --- | --- | --- |
| T1 | the time window | CannotExecute | 11593720 | [0x73289b60…](https://sepolia.etherscan.io/tx/0x73289b60f4c0753d4f64a9460db9f3eb654b13379d0c700605313a536246ab43) |
| C1 | the most it may move at once | CannotExecute | 11593789 | [0xb2de73c6…](https://sepolia.etherscan.io/tx/0xb2de73c65a646b1814b52f23bae59f9eaf9c410fe035d13e39fc6265d57e6f7b) |
| C2 | the most it may move in total | CannotExecute | 11593793 | [0x55c3fef8…](https://sepolia.etherscan.io/tx/0x55c3fef869afc4c5c61d9599e5d1df85b7876c9a2fe9bc5c5cf64a50ee785270) |
| A1 | the action being one it allows | CannotExecute | 11593794 | [0x87ef296e…](https://sepolia.etherscan.io/tx/0x87ef296e8b837ac5588c2e8793d864417ba4ffe85d144b0b68b6d43deb3bceec) |
| S1 | the asset the mandate names | CannotExecute | 11593795 | [0x09b906d4…](https://sepolia.etherscan.io/tx/0x09b906d47be119f6016b70ea93e313939c653f3647f1662e056425c08dda4135) |
| T2 | the time window | CannotExecute | 11594005 | [0xde00f8d8…](https://sepolia.etherscan.io/tx/0xde00f8d8d50eb9f03ce8473851d40c810af7e654b0fcb53e08c7db8dbdcf091a) |
| V1 | the investor having revoked it | CannotExecute | 11598790 | [0x244fe2a1…](https://sepolia.etherscan.io/tx/0x244fe2a13353fd6c6b188fd08099568ecae75307233461567709f21485533092) |

## Signed instructions the registry refused

A signature already spent, one whose deadline had passed, and an attempt to grant a second mandate on top of a live one. These three do name their own reason, because they are refused before the single boolean is ever reached.

| Case | Revert | Block | Transaction |
| --- | --- | --- | --- |
| D1 | SignatureExpired | 11598768 | [0x697f6767…](https://sepolia.etherscan.io/tx/0x697f6767cc46976cbcba1bed6b7f049ae01337e6b750a08f829d890a53606268) |
| R1 | InvalidSignature | 11598974 | [0x2404b040…](https://sepolia.etherscan.io/tx/0x2404b040588e584b8142b992352a68768035296e26fa20d2144bb1a5a329d6ea) |
| X4 | MandateAlreadyActive | 11599417 | [0xf2ba2710…](https://sepolia.etherscan.io/tx/0xf2ba27102d55facf4008d02d4223c5900aec276a8bd2d07ab10a1e113e23b4f7) |

## Everything else that was sent

Listed so that no transaction this project ever sent is missing from this page.

| What happened | Result | Block | Transaction |
| --- | --- | --- | --- |
| A permitted amount, sent so the running total reaches the limit the next one breaks | went through | 11593790 | [0x8baa7309…](https://sepolia.etherscan.io/tx/0x8baa7309074d13720a78fcc50c30480ec7c04edc1dffe645e69fb4448c323206) |
| A permitted amount, sent so the running total reaches the limit the next one breaks | went through | 11593792 | [0x6977b2b7…](https://sepolia.etherscan.io/tx/0x6977b2b738f0fdf5e0d1060e0ec2b9180052e7bbbc56404ee5928bfb51f6f359) |
| A permitted amount, sent so the running total reaches the limit the next one breaks | went through | 11598788 | [0xf3f8767d…](https://sepolia.etherscan.io/tx/0xf3f8767d197f34d7afb5b0f4bcadf573140628409a65c7b2aa85a9c41a14d341) |
| A signed revocation, sent legitimately, so its signature could be replayed after | went through | 11598788 | [0x87747c3e…](https://sepolia.etherscan.io/tx/0x87747c3e673ba0556810a30f84f58525b671d81209cef3819009b77459bef437) |
| A settlement router that was replaced before any mandate named it | went through | 11673108 | [0x69c49e9e…](https://sepolia.etherscan.io/tx/0x69c49e9e693ca8b2ae57c208c2b65e78805b687b9e13a5cf9d56a16001bd5695) |
| A settlement router that was replaced before any mandate named it | went through | 11673138 | [0xdd055f3a…](https://sepolia.etherscan.io/tx/0xdd055f3afdb143de315fe7425872cdf917338c7cf3be5c5830f938c87929ff15) |
| A settlement router that was replaced before any mandate named it | went through | 11673173 | [0x4de63d72…](https://sepolia.etherscan.io/tx/0x4de63d72ed72e45333c94ff9e054973f326877772dc2e7c14b62f524079b23a8) |
| A settlement router that was replaced before any mandate named it | went through | 11673183 | [0xe1a224b9…](https://sepolia.etherscan.io/tx/0xe1a224b94e53e3ef21b71d42c9397aa0f9815f5cfff3ab3c643ad8e9f6faf81b) |
| The settlement router now in front of the executor was deployed | went through | 11673201 | [0x9381e9a6…](https://sepolia.etherscan.io/tx/0x9381e9a64b7e60ec0d1384510ed759ca3c274042ee64fa01e6763b404a1dc7db) |
| The router was told where the recipient sits in one kind of call | went through | 11673262 | [0xe6a38716…](https://sepolia.etherscan.io/tx/0xe6a38716077b3ca3171a49bd7acbe0a0127f3fe45f578f92e0fc950e9ed0ec3f) |
| The router was told where the recipient sits in one kind of call | went through | 11673263 | [0x95a12bfa…](https://sepolia.etherscan.io/tx/0x95a12bfaf8eb5ff11fe86a987ea06e6c14f20aeee3e4783b7e4f08799a9229aa) |
| The only address the router will deliver to was listed by the investor | went through | 11673264 | [0x9056a2d9…](https://sepolia.etherscan.io/tx/0x9056a2d9d09a8155983e0036f4cad7663f8ff39c1319782ccaa4aadb60eade59) |
| The investor approved the executor a second time, so the permission stays the thing that refuses | went through | 11674232 | [0x20cfb28d…](https://sepolia.etherscan.io/tx/0x20cfb28d0581ae9a097b2121007ec77732b6f47a0b01cbbefad3cbba7b2b5d8d) |
| The investor revoked the mandate, through the issuer own tool | went through | 11674259 | [0xfc85ee9b…](https://sepolia.etherscan.io/tx/0xfc85ee9bdeb64c319a2774d54fa088fd8e036071c36b9965bf4596cbd24b1d63) |
| The investor granted a fresh mandate, this time to the router rather than to a wallet | went through | 11674266 | [0xa84a596a…](https://sepolia.etherscan.io/tx/0xa84a596a9c4beea4a6317de40240aa6b411b48f9db6d76015781863d8c830cdc) |
| The investor revoked the mandate, through the issuer own tool | went through | 11680329 | [0x6f98e1c6…](https://sepolia.etherscan.io/tx/0x6f98e1c6245d4454a24f699f87efe0c0fd72479b67ac937a023053e418ee0f5d) |
| The investor granted a fresh mandate, replacing the one revoked before it | went through | 11680335 | [0x5c92c00a…](https://sepolia.etherscan.io/tx/0x5c92c00aeea936f71d6875f0d108471acdfa1da973244c836c31fefcdcc6c795) |
| keeper-action-2 | went through | 11680791 | [0x3a3b2d01…](https://sepolia.etherscan.io/tx/0x3a3b2d019174e59c35de52548739c8a4448afaf0a563572b98f1cd3a218dace1) |
| page-action-1 | went through | 11689303 | [0xddb20976…](https://sepolia.etherscan.io/tx/0xddb20976dbe95b9c97c05c886080bb31901a1e5edb77712c3be4c9749e7b7951) |
| page-return-2 | went through | 11689304 | [0x8ff32b40…](https://sepolia.etherscan.io/tx/0x8ff32b406451df4a5a0eb09ba19f0bb5c4bd9a9caae3821a9dee247b924ade77) |
| page-action-2 | went through | 11689436 | [0x3979777c…](https://sepolia.etherscan.io/tx/0x3979777c138c16550c0975a40f62af54c9178466bad10012ab1909f01161cc6e) |
| page-return-3 | went through | 11689437 | [0x14fa203e…](https://sepolia.etherscan.io/tx/0x14fa203eccaf92fb7b0b90b2eb3ffee89fa69a2bd11e05c323352bc483bd5113) |
| page-action-3 | went through | 11689494 | [0x467c34c6…](https://sepolia.etherscan.io/tx/0x467c34c61f342e397d0c2ff815e2cbb02492cde63757a29c31f1afa5694d77cb) |
| page-return-3 | went through | 11689496 | [0x682e98c9…](https://sepolia.etherscan.io/tx/0x682e98c9ddc74125751124e6a5c56f4d3f31e3416c042d73f52add502c63fb02) |
| page-action-4 | went through | 11689754 | [0xb2b69445…](https://sepolia.etherscan.io/tx/0xb2b694453b4d2238bded093b121e96c8cc62dbd571fa03b31cae9b0821814e5c) |
| page-return-4 | went through | 11689755 | [0x0b548066…](https://sepolia.etherscan.io/tx/0x0b548066475a0349c1bf9db79bc6f611e0adfc884eac87986a03f381b59417ec) |

## Measured off the shared network

Everything above was sent to Sepolia and can be opened. The genuinely adversarial work was not, and that was a deliberate line rather than an omission. A wrongly configured gate, and a delivery that no limit refuses, were measured on copies of the published contracts that this repository deploys inside its own tests. 3 configurations were measured and 2 of them were refused by nothing at all.

Those results carry no transaction hash, because nothing was sent. They are reproducible instead: `npm run ci` runs them on a fresh clone with no key and no network, in seconds. `LAYERS.md` holds the table and says what each row does and does not prove.

## What is not measured, said plainly

Two things this project intended to measure were not built, and the honest thing is to name them rather than let the tables imply otherwise.

**The delay between a compliance record being revoked and the agent being frozen is not measured.** The standard names this risk and does not size it, and sizing it would have been the most useful number here. What is established instead, by reading the registry, is that it is not a race in the ordering sense: the permission check never reads the compliance provider at all, so a revocation and an action can sit in the same block and the action still passes.

**Whether one agent serving two investors can be talked into acting against the second is not tested.** The on-chain half is readable from the reference implementation, which keys a mandate to the pair of agent and investor and checks only the acting investor, so the limits are separate by construction. That is a reading of code and is not written here as a test result.
