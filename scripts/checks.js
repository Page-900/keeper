export const PASSED = 'passed';
export const FAILED = 'failed';
export const DID_NOT_RUN = 'did not run';

export const CHECKS = [
  {
    id: 'layout',
    title: 'Layout',
    proves: 'Every file is written in the one layout this project uses.',
    script: 'format:check',
  },
  {
    id: 'rules',
    title: 'Code rules',
    proves: 'No rule this project sets for its own code is broken.',
    script: 'lint',
  },
  {
    id: 'types',
    title: 'Types',
    proves: 'Every value is the kind of value the code around it expects.',
    script: 'typecheck',
  },
  {
    id: 'tests',
    title: 'Tests',
    proves: 'Every test written for this project passes.',
    script: 'test',
  },
  {
    id: 'contracts',
    title: 'Contract tests',
    proves: 'Every test written against the smart contract passes.',
    script: 'test:contracts',
  },
  {
    id: 'rehearsal',
    title: 'Rehearsal',
    proves:
      'The whole flow runs end to end against the registry as it is really deployed, on a private copy of the test network that nothing outside this machine can see.',
    script: 'test:fork',
  },
  {
    id: 'build',
    title: 'Build',
    proves: 'The project compiles into something that can be run.',
    script: 'build',
  },
  {
    id: 'scan',
    title: 'Code scan',
    proves: 'The code quality scanner reports no error.',
    script: 'scan',
  },
  {
    id: 'wallets',
    title: 'Wallet addresses',
    proves:
      'Every wallet address this project publishes is one it can really sign with, and not a number typed into a file.',
    whenFailed:
      'An address in the code is not the wallet the matching key in .env signs with, or .env is missing. Nothing was sent anywhere.',
  },
  {
    id: 'asset',
    title: 'The token',
    proves:
      'The token this project acts on is really on the test network, under the symbol and the decimals its limits are written in.',
    whenFailed: 'The token address in the code is not answering as the token this project expects.',
  },
  {
    id: 'record',
    title: "Brickken's record",
    proves:
      'Brickken hold this token under our own account, with the same name, supply, and decimals the code uses.',
    whenFailed: 'Brickken describe this token differently from the way this project describes it.',
  },
  {
    id: 'holding',
    title: 'The investor holding',
    proves:
      'The investor wallet holds what it started with, less exactly what the agent has spent, and the test network says so.',
    whenFailed:
      'The balance on the test network is not the starting holding less what the registry says the agent spent.',
  },
  {
    id: 'allowed',
    title: 'Allowed to hold it',
    proves:
      'Brickken record the investor wallet as cleared to hold this token, which is the check their own contract makes before any transfer.',
    whenFailed:
      'The investor wallet is not cleared to hold the token, so no transfer of it can settle.',
  },
  {
    id: 'allowance',
    title: 'The spending permission',
    proves:
      'The executor is still allowed to move more of the token than the mandate has left to give, so a refused transfer is always the mandate refusing it and never the permission running out.',
    whenFailed:
      'The executor is not allowed to move the token, so every agent action would fail for a reason that has nothing to do with the mandate.',
  },
  {
    id: 'eligibility',
    title: 'Cleared to be represented',
    proves:
      "Brickken's own compliance contract answers that the investor wallet is eligible under the exact reference they issued, which is the check their registry makes before it will accept a mandate at all.",
    whenFailed:
      'The compliance contract does not answer eligible for this wallet and this reference. A mandate granted now would be refused, and no agent action could follow.',
  },
  {
    id: 'recorder',
    title: 'Allowed to record',
    proves:
      'The registry lets our executor contract record what the agent spends, which is what keeps the running total honest.',
    whenFailed:
      'The executor cannot record, so an allowed action would still fail, after the mandate had already permitted it. That reads as a broken mandate and is not one.',
  },
  {
    id: 'mandate',
    title: 'The granted authority',
    proves:
      'The permission that is really on the test network is the one the investor approved: that agent, that token, that one action, those two limits, and not revoked.',
    whenFailed:
      'The mandate on the chain is not the one this project describes. Nothing here is safe to demonstrate until the two agree.',
  },
  {
    id: 'moved',
    title: 'What the agent moved',
    proves:
      "The tokens the agent moved really left the investor and arrived at the counterparty, and the registry's own running total agrees with the amount.",
    whenFailed:
      'The balances on the test network and the running total in the registry do not tell the same story. One of them is not being read correctly.',
  },
  {
    id: 'refusal',
    title: 'The limit still refuses',
    proves:
      'The registry still says no to one unit more than the agent is allowed to move at once, and still says yes at the limit itself, so the refusal shown in the demonstration is the one happening right now.',
    whenFailed:
      'The limit is no longer refusing the amount just above it, or is refusing the amount at it. Either the mandate was changed on the chain, or something other than the limit is now blocking the agent.',
  },
  {
    id: 'window',
    title: 'The mandate window',
    proves:
      'The permission the investor gives would still be live on the date this demonstration has to survive to, so nobody opens a dead demo and reads it as a broken one.',
    whenFailed:
      'A mandate granted now would expire before that date, or the mandate already granted expires before it. Lengthen the window before granting, never after.',
  },
  {
    id: 'chain',
    title: 'Live chain read',
    proves:
      'This project reaches the Sepolia test network, confirms the endpoint really serves it, and reads its latest block.',
    whenFailed:
      'The test network could not be read, or the endpoint in .env serves a different network. Check the internet connection first, then the endpoint named in .env. Nothing else in this table depends on it.',
  },
];

const MARK = { [PASSED]: 'PASS', [FAILED]: 'FAIL', [DID_NOT_RUN]: 'NOT RUN' };

const widest = (values) => Math.max(...values.map((value) => value.length));

export function report(results) {
  const rows = CHECKS.map((check) => ({
    check,
    status: DID_NOT_RUN,
    detail: '',
    output: '',
    ...results.get(check.id),
  }));
  const passed = rows.filter((row) => row.status === PASSED).length;
  return { rows, passed, verified: passed === rows.length };
}

const line = (row, markWidth, titleWidth) => {
  const detail = row.status === PASSED && row.detail !== '' ? `  ${row.detail}` : '';
  const mark = MARK[row.status].padEnd(markWidth);
  return `  ${mark}  ${row.check.title.padEnd(titleWidth)}  ${row.check.proves}${detail}`;
};

export function render(summary) {
  const markWidth = widest(Object.values(MARK));
  const titleWidth = widest(CHECKS.map((check) => check.title));
  return [
    '',
    'Keeper verification',
    '',
    ...summary.rows.map((row) => line(row, markWidth, titleWidth)),
    '',
    `  ${summary.passed} of ${summary.rows.length} checks passed.`,
    `  ${summary.verified ? 'VERIFIED' : 'NOT VERIFIED'}`,
    '',
  ].join('\n');
}
