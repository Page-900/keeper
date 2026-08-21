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
      'The principal and agent addresses this project publishes are the two wallets it can really sign with.',
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
      'The investor wallet really holds the balance every limit in this project is measured against, and the test network says so.',
    whenFailed:
      'The balance on the test network is not the holding this project is written around.',
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
      'The investor has allowed the executor contract to move this much of the token, and it is more than the mandate ever permits, so a refused transfer is always the mandate refusing it.',
    whenFailed:
      'The executor is not allowed to move the token, so every agent action would fail for a reason that has nothing to do with the mandate.',
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
