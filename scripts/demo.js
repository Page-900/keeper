import { attackBoxOff } from '../dist/demo/limits.js';
import { demoServer } from '../dist/demo/server.js';
import { liveSources } from '../dist/demo/sources.js';

const print = (text) => process.stdout.write(`${text}\n`);
const port = Number(process.env.PORT ?? 8080);

const server = demoServer(liveSources());

server.listen(port, () => {
  print('');
  print(`  Keeper's page is at http://localhost:${server.address().port}`);
  print(`  The attack box is ${attackBoxOff() ? 'OFF' : 'on'}.`);
  print('  It reads the chain and asks the model. With Execute on, it can send a transaction.');
  print('');
});
