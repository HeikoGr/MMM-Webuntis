/**
 * Dependency Check Script
 * Checks if npm install is needed by comparing package.json with installed modules
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const packageLockPath = path.join(rootDir, 'package-lock.json');
const nodeModulesPath = path.join(rootDir, 'node_modules');

let exitCode = 0;
let needsInstall = false;
const issues = [];

// Check 1: Does node_modules exist?
if (!fs.existsSync(nodeModulesPath)) {
  issues.push('❌ node_modules directory does not exist');
  needsInstall = true;
}

// Check 2: Does package-lock.json exist?
if (!fs.existsSync(packageLockPath)) {
  issues.push('⚠️  package-lock.json does not exist');
  needsInstall = true;
}

// Check 3: Compare modification times
if (fs.existsSync(packageJsonPath) && fs.existsSync(packageLockPath)) {
  const packageJsonTime = fs.statSync(packageJsonPath).mtime;
  const packageLockTime = fs.statSync(packageLockPath).mtime;

  if (packageJsonTime > packageLockTime) {
    issues.push('⚠️  package.json is newer than package-lock.json');
    needsInstall = true;
  }
}

// Check 4: Verify all dependencies are installed
if (fs.existsSync(nodeModulesPath)) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    const missingDeps = [];
    for (const dep of Object.keys(allDeps)) {
      const depPath = path.join(nodeModulesPath, dep);
      if (!fs.existsSync(depPath)) {
        missingDeps.push(dep);
      }
    }

    if (missingDeps.length > 0) {
      issues.push(`❌ Missing dependencies: ${missingDeps.join(', ')}`);
      needsInstall = true;
    }
  } catch (err) {
    issues.push(`⚠️  Could not check dependencies: ${err.message}`);
  }
}

// Check 5: Run npm list to detect version mismatches
if (fs.existsSync(nodeModulesPath)) {
  try {
    execSync('npm list --depth=0 --json', {
      cwd: rootDir,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (err) {
    // npm list exits with 1 if there are issues
    const output = err.stdout || '';
    if (output.includes('missing') || output.includes('invalid')) {
      issues.push('⚠️  npm list detected dependency issues');
      needsInstall = true;
    }
  }
}

// Output results
console.log('\n📦 Dependency Check Results:\n');

if (issues.length === 0) {
  console.log('✅ All dependencies are properly installed');
  console.log('✅ No npm install needed\n');
} else {
  console.log('Issues found:');
  issues.forEach((issue) => console.log(`  ${issue}`));
  console.log('');

  if (needsInstall) {
    console.log('🔧 Action required: Run \x1b[1mnpm install\x1b[0m\n');
    exitCode = 1;
  }
}

// Exit with appropriate code
// Using process.exit is necessary here as this is a CLI script
// eslint-disable-next-line n/no-process-exit
process.exit(exitCode);
