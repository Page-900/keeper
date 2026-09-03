import { checkDeployed } from '../dist/demo/check.js';

const print = (text) => process.stdout.write(`${text}\n`);
const url = process.argv[2];

print('');
if (url === undefined) {
  print('  Usage: npm run demo:check <url>');
  print('  Example: npm run demo:check https://keeper-demo.fly.dev/');
  print('');
  process.exitCode = 1;
} else {
  print('  Asking the deployed page one question, the way a visitor would.');
  print('  It spends one model call on that page and it sends no transaction.');
  print('');
  print(`  ${url}`);
  print('');

  try {
    const checked = await checkDeployed(url);
    for (const row of checked.rows)
      print(`  ${row.passed ? 'PASS' : 'FAIL'}  ${row.name.padEnd(20)}  ${row.detail}`);
    print('');
    print(checked.passed ? '  ANSWERING' : '  NOT ANSWERING');
    if (!checked.passed) process.exitCode = 1;
  } catch (cause) {
    print(`  FAIL  it could not be reached: ${cause instanceof Error ? cause.message : cause}`);
    print('');
    print('  NOT ANSWERING');
    process.exitCode = 1;
  }
  print('');
}
