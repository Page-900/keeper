# Building an investor's agent on ERC-8226

What I hit, and what I would suggest.

## How to read this

Three kinds of statement, never mixed.

- **Measured.** Run in this repository's own tests, on contracts it deploys itself. Reproducible with
  `npm run ci` on a clean clone, no key, no network.
- **Read from the reference implementation.** The contracts merged into the ERCs repository.
- **Not measured.** Said plainly, with what is missing.

Nothing adversarial was ever sent to a shared network. That half was measured only on contracts this
repository deploys itself. Where an ordinary measurement did touch a live deployment, the section
says so, and the closing section says exactly which ones did.

## 1. A cap bounds how much, never to whom

**Measured.**

I ran the same delivery four times, taking one defence away each time.

With my own application checks removed and nothing else changed, 25 tokens went to an address that
appears nowhere in the mandate. Nothing refused it. The registry counted it as ordinary use of the
limit.

That is structural, not a bug. `canExecute` gets an agent, a principal, an asset, an action and an
amount. It never gets a destination, so no mandate can say who may receive. A regulated token could
carry that rule, but the one I worked with checks the sender in its transfer hook and treats the
recipient only as a non zero check. I confirmed that on a fork of its own verified source.

With both caps set to the value the standard reads as unlimited, the whole holding moved in one call.
What bounded the loss was the ERC-20 allowance, not the mandate. Grant an unlimited allowance beside an
unlimited cap and there is no second line at all.

**What I would suggest.** Not a recipient list in the standard. That would drag compliance state into a
contract deliberately free of it. One paragraph in the Security Considerations instead: a mandate
bounds quantity and time, not destination, and the integrator has to put that check somewhere. I
assumed the opposite for two weeks. My own test corrected me.

**Then I took my own advice, and the shape of the answer is worth writing down.** I had the check, but
it lived in my application, on the same machine as the agent's key. That is fine until the machine is
not. So I put it on chain, in a hundred lines: a contract that implements the executor interface, sits in
front of the real executor, reads the recipient out of the forwarded call, and refuses any address the
principal has not listed. Only the principal can change that list.

**The part that makes it hold is not the check. It is that the mandate names the contract as its
agent.** The executor asks the registry about whoever called it, so once the mandate names my contract,
a direct call from the agent's own wallet is refused by the registry itself. The check is the only door
rather than a second one beside it.

**It cost one revocation and one grant**, both through the issuer's own tools, and no change to the
deployed executor. An integrator who wants the destination bounded does not need a new standard, a new
executor, or a role from anybody. They need one small contract and a mandate that points at it.

## 2. The amount extraction is four problems, and three are not the documented one

**Measured**, on the reference executor deployed byte for byte. The only wrong call is `setAction`. I
wrote no modified contract, so nobody can answer these by saying I changed the code.

Security Consideration 4 names this in one sentence, as an integrator mis-mapping the amount argument.
I found four outcomes. Only the first is that sentence.

- **An index pointing at an address fails closed.** The executor reads the address as a `uint256`,
  bigger than any plausible cap, so the check returns false and the call reverts. Worth saying, because
  "a mis-map is silently unbounded" is the natural reading and it is not always true.
- **Saying an action carries no amount is the cleanest failure.** The executor gates at zero. Zero
  passes the per transaction cap, and the total plus zero passes the cumulative cap. The full holding
  moved against a 25 cap, and the running total stayed at zero, so the audit trail never records that
  anything happened. This is a boolean, not an index. It sits outside the documented risk entirely.
- **A dynamic argument cannot be gated at all.** The extraction reads a fixed calldata word in place.
  For a batch transfer of the shape ERC-3643 defines, that word is an ABI offset, so 192 was gated
  while 2,000 tokens moved. For a batch of two, no index is correct, because the real total is a sum
  that exists nowhere in the encoding. No integrator mistake is needed for this one.
- **The agent can pick its own gated amount.** With an index past the real arguments, a well formed
  call reverts, which looks safe. The agent then appends one word to its own calldata. Solidity ignores
  a trailing word when decoding a static signature, so the call succeeds, the executor gates on the
  appended value, and 2,000 tokens moved while the total recorded one. The mistake is the integrator's
  and the choice ends up with the attacker.

**What I would suggest.** Either document the extraction as usable only where the amount is a static
argument, as a hard limit rather than something the reader works out, or pass the amount alongside the
calldata and check it against the call rather than digging it out. Requiring the calldata length to
match the signature closes the fourth one on its own.

## 3. Extending a mandate buys time, never fresh allowance

**Read from the reference implementation.**

`extendMandate` writes only the validity date. The running total is never touched, so extension cannot
serve a recurring flow. Granting again is the intended path: a fresh grant is refused while a live
mandate exists, and it resets the total once the old one is revoked or expired.

That is coherent and I am not asking for it to change. The note is that a recurring arrangement needs a
fresh principal signature every cycle. That is a real constraint on exactly the automated flows the
standard aims at, and the prose alone does not teach it. One sentence in the lifecycle section would
save the next implementer an afternoon.

## 4. Cross principal isolation: half read, half untested

**Read from the reference implementation, and explicitly not tested.**

A mandate is keyed to the pair of agent and principal, and the check reads only the acting principal.
On chain, two principals cannot leak into each other by construction.

**The other half I did not test and claim nothing about.** Whether an agent serving two investors can
be talked into acting against the second is an application layer question. I cut that test for time.

## 5. The revocation to freeze window is not measured

**Not measured.**

This was going to be the most useful number here. The standard names the delay between a compliance
record being revoked and an agent being stopped, and does not size it. I planned to size it and ran out
of days. There is no number, and I am not disguising the gap.

One thing survives the cut, and it corrects how I described this myself for weeks. **It is not a race
in the ordering sense.** The permission check never reads the compliance provider, so a revocation and
an action can land in the same block and the action still passes. The window is not measured in blocks.
It is however long whoever watches for the event takes to react. That is an integration property, not a
chain property, and the standard could say so.

## 6. Straightforward, ambiguous, surprising

**Straightforward.** Granting by signature. The typed data endpoint returned exactly what I needed and
the grant went through first time. Revert behaviour is consistent and easy to build on.

**Ambiguous.** Whether the caps were meant to be the whole of the protection. I now think that is a
documentation question rather than a design one. Whether extension refreshed allowance, which reading
the code answered.

**What cost me most.** The permission check is a view returning a boolean, so a refusal arrives as my
executor's own error and never names which limit broke. I broke six of the registry's eight rules, one
at a time, and every one produced the same revert. I ended up recording the mandate state at the same
block beside each case purely to know which rule had fired. Anyone building an audit trail will hit
this. A revert that names the failed condition, or a view that returns a reason, would be worth a great
deal and cost the standard very little.

**What I did not expect.** Value sent to an address with no clearance is stranded there. The one sided
check that lets tokens in stops them leaving, because the uncleared address is not a permitted sender.
A mis-delivery is not just a loss, it is unrecoverable. That raised what I think a missing recipient
check is worth.

## What this does not say

**No finding here is a finding about anyone's operated deployment.** Every one of them is about the
standard, about its reference contracts, or about my own code. The executor is the reference contract
unchanged, and the batch function in the third bullet of the second finding belongs to a token these
tests create.

**The adversarial half never left my own copies.** The mis-mapped gate, and the delivery that no limit
refuses, were measured on contracts this repository deploys inside its own tests. Nothing from that
work was sent anywhere shared, and a check reads every record back and fails if a single one of them
names an address from a shared network.

**The ordinary half did run on a shared test network, and I would rather name that than imply
otherwise.** A live registry is the only place a real refusal can happen, so the mandates were granted
and revoked there, and the six rules I broke in the sixth section are real transactions there. Two test
files also fork that network at a fixed block, so that the two structural claims in the first section
are read off contracts as they are really deployed rather than off prose about them. Every transaction
is listed in `EVIDENCE.md` and every one of them can be opened.
