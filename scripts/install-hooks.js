const { execSync } = require('node:child_process');

try {
  // Check whether simple-git-hooks is installed
  require.resolve('simple-git-hooks');

  // If available: run CLI (avoids dependency on internal API)
  try {
    execSync('npx simple-git-hooks install', { stdio: 'inherit' });
    console.log('Git hooks installed successfully');
  } catch (e) {
    // If CLI invocation fails, log it but do not fail installation
    console.error('simple-git-hooks found but CLI install failed:', e.message);
    console.log('Continuing without failing the install.');
  }
} catch (err) {
  if (err && err.code === 'MODULE_NOT_FOUND') {
    // In production / with --omit=dev this is expected behavior
    console.log('Skipping git hooks installation: simple-git-hooks is not installed.');
  } else {
    console.error('Unexpected error while checking simple-git-hooks:', err.message || err);
    console.log('Continuing without failing the install.');
  }
}
