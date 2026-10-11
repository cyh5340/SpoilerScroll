import { spawnSync } from 'node:child_process';
const checks = [
  ['test'],
  ['run', 'typecheck', '--prefix', 'extension'],
  ['test', '--prefix', 'extension'],
  ['run', 'test:browser', '--prefix', 'extension'],
];
for (const args of checks) {
  console.log(`\nRunning npm ${args.join(' ')}`);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    stdio: 'inherit', env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('\nAll automated component and extension-browser checks passed. Live sponsor access and combined backend/extension wiring are not covered.');
