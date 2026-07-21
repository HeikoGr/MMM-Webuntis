const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const submodulePath = 'lib/mmm-shared';

function runGit(args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

if (!fs.existsSync(path.join(repoRoot, '.git')) || !fs.existsSync(path.join(repoRoot, '.gitmodules'))) {
  process.exit(0);
}

const syncResult = runGit(['submodule', 'sync', '--', submodulePath]);
if (syncResult.error || syncResult.status !== 0) {
  console.warn('Skipping mmm-shared submodule sync.');
  process.exit(0);
}

const updateResult = runGit(['submodule', 'update', '--init', '--recursive', '--checkout', submodulePath]);
if (updateResult.error || updateResult.status !== 0) {
  console.warn('Skipping mmm-shared submodule update.');
}
