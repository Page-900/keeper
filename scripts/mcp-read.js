import { createBrickkenClient } from '../dist/brickken/client.js';
import { createMcpClient } from '../dist/brickken/mcp.js';
import { SUNL_SYMBOL } from '../dist/shared/config.js';

const print = (text) => process.stdout.write(`${text}\n`);

print('');
print('Asking Brickken twice about the same token, once over MCP and once over REST.');
print('It reads and never writes. Two surfaces disagreeing is the thing worth finding.');
print('');

try {
  const mcp = createMcpClient();
  const tools = await mcp.listTools();
  print(`  tools offered   ${tools.length}`);
  print(`  reads among them ${tools.filter((name) => name.startsWith('get_')).join(', ')}`);
  print('');

  const answer = JSON.parse(await mcp.call('get_token_info', { tokenSymbol: SUNL_SYMBOL }));
  const rest = await createBrickkenClient().getTokenInfo(SUNL_SYMBOL);

  print(`  MCP  symbol ${answer.tokenSymbol}, ${answer.allowedTokenDecimals} decimals`);
  print(`  REST symbol ${rest.tokenSymbol}, ${rest.decimals} decimals`);
  print('');

  const agrees =
    answer.tokenSymbol === rest.tokenSymbol && answer.allowedTokenDecimals === rest.decimals;
  print(agrees ? '  The two surfaces agree.' : '  THEY DISAGREE. Nothing is assumed. Record it.');
  if (!agrees) process.exitCode = 1;
} catch (cause) {
  print(`  not read: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
