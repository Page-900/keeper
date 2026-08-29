import { installSkill } from '../dist/brickken/skill.js';

const print = (text) => process.stdout.write(`${text}\n`);
const stated = (value) => value ?? 'not stated in the file';

print('');
print('Installing the skill Brickken publish for AI agents, with their own command line tool.');
print('Every file that arrives is recorded by name, size and hash. None of it is committed here.');
print('');

try {
  const installed = await installSkill();
  print(`  ${installed.command}`);
  print('');
  for (const file of installed.files) {
    print(`  ${file.name}  ${file.bytes} bytes`);
    print(`  sha256 ${file.sha256}`);
  }
  print('');
  print(`  it calls itself  ${stated(installed.declares['name'])}`);
  print(`  and describes itself as  ${stated(installed.declares['description'])}`);
} catch (cause) {
  print(`  not installed: ${cause instanceof Error ? cause.message : cause}`);
  process.exitCode = 1;
}

print('');
