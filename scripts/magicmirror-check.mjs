#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(currentDir, '..');
// Use /tmp for checker to avoid fs.cp self-copy restrictions
const CHECKER_REPO = path.join('/tmp', `mm-module-checker-${path.basename(PROJECT_ROOT)}`);
const UPSTREAM_REPO = 'https://github.com/MagicMirrorOrg/MagicMirror-3rd-Party-Modules.git';

console.log('🔍 Setting up MagicMirror checker...');
try {
  // Clone only the CHECKER repository (test tools), not the module to check
  if (!existsSync(CHECKER_REPO)) {
    console.log('Fetching checker repository (git-free) via `degit` (first time only)...');
    try {
      // Use degit to copy repository without .git metadata
      await execAsync(`npx degit MagicMirrorOrg/MagicMirror-3rd-Party-Modules#main "${CHECKER_REPO}"`);
    } catch (err) {
      const errMsg = err && err.message ? err.message : err;
      console.log('`degit` failed or not available, falling back to git clone and stripping .git:', errMsg);
      await execAsync(`git clone --depth 1 ${UPSTREAM_REPO} "${CHECKER_REPO}"`);
      // Remove any .git metadata to ensure the checker copy is detached from git
      try {
        await fs.rm(path.join(CHECKER_REPO, '.git'), { recursive: true, force: true });
      } catch (e) {
        // Non-fatal: log and continue
        console.log('Warning: failed to remove .git from checker clone:', e?.message || e);
      }
    }
  }

  if (!existsSync(path.join(CHECKER_REPO, 'node_modules'))) {
    console.log('📦 Installing dependencies...');
    await execAsync('npm install', { cwd: CHECKER_REPO });
  }

  // Read package.json for metadata
  const pkg = JSON.parse(readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

  // Auto-detect module name and maintainer (prefer directory name over package.json name for case sensitivity)
  const moduleName = path.basename(PROJECT_ROOT);
  const repoUrl = pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') || '';
  const maintainer = repoUrl.match(/github\.com\/([^/]+)\//)?.[1] || 'unknown';
  const moduleId = `${maintainer}/${moduleName}`;

  const modulesDir = path.join(CHECKER_REPO, 'modules');
  await fs.mkdir(modulesDir, { recursive: true });

  // Copy project files to /tmp (without node_modules) - checks local changes
  const moduleCopyPath = path.join(modulesDir, `${moduleName}-----${maintainer}`);

  // ALWAYS delete old copy for fresh data
  if (existsSync(moduleCopyPath)) {
    await fs.rm(moduleCopyPath, { recursive: true });
  }

  // ALWAYS delete old checker results for fresh checks
  const websiteDataDir = path.join(CHECKER_REPO, 'website', 'data');
  const websiteDir = path.join(CHECKER_REPO, 'website');

  const filesToClean = [
    path.join(websiteDataDir, 'modules.stage.4.json'), // Input
    path.join(websiteDataDir, 'modules.json'), // Output (cached results!)
    path.join(websiteDataDir, 'moduleCache.json'), // Cache (CRITICAL: contains cached ncu results!)
    path.join(websiteDir, 'result.md'), // Output (cached results!)
  ];

  for (const file of filesToClean) {
    if (existsSync(file)) {
      await fs.rm(file, { force: true });
    }
  }

  console.log('✓ Copying local files (excluding node_modules)...');
  await fs.cp(PROJECT_ROOT, moduleCopyPath, {
    recursive: true,
    filter: (src) => {
      const relativePath = path.relative(PROJECT_ROOT, src);
      // Exclude node_modules, .git (but NOT .github), build artifacts, and generated files
      return (
        !relativePath.startsWith('node_modules') &&
        relativePath !== '.git' &&
        !relativePath.startsWith('.git/') &&
        !relativePath.startsWith('.mm-module-checker') &&
        relativePath !== 'magicmirror-check-results.md' &&
        !relativePath.includes('magicmirror-check.mjs')
      );
    },
  });
  console.log(`✓ Checking ${moduleName} (including uncommitted changes)`);

  // Create module metadata for the checker
  const moduleData = {
    modules: [
      {
        id: moduleId,
        name: moduleName,
        category: pkg.keywords?.[0] || 'Other',
        maintainer: maintainer,
        maintainerURL: `https://github.com/${maintainer}`,
        url: repoUrl || `https://github.com/${moduleId}`,
        description: pkg.description || `MagicMirror module: ${moduleName}`,
        license: pkg.license || 'none',
        keywords: pkg.keywords || [],
        issues: [], // Required by schema (even if empty)
        // The checker needs packageJson explicitly for dependency checks!
        packageJson: {
          status: 'parsed',
          summary: {
            name: pkg.name,
            version: pkg.version,
            description: pkg.description,
            license: pkg.license,
            keywords: pkg.keywords || [],
            dependencies: pkg.dependencies || {},
            devDependencies: pkg.devDependencies || {},
            scripts: pkg.scripts || {},
          },
        },
      },
    ],
  };

  await fs.mkdir(websiteDataDir, { recursive: true });
  await fs.writeFile(path.join(websiteDataDir, 'modules.stage.4.json'), JSON.stringify(moduleData, null, 2));

  console.log('🔎 Running full module checks...');
  await execAsync('npx tsx scripts/check-modules/index.ts', {
    cwd: CHECKER_REPO,
    env: {
      ...process.env,
      CHECK_MODULES_PROJECT_ROOT: CHECKER_REPO,
      CHECK_MODULES_MODULES_DIR: modulesDir,
      CHECK_MODULES_STAGE4_PATH: path.join(websiteDataDir, 'modules.stage.4.json'),
      NODE_OPTIONS: '--no-warnings',
    },
    maxBuffer: 10 * 1024 * 1024,
  });

  // Additional ESLint check for package.json (often skipped if too many issues)
  console.log('🔍 Running ESLint check on package.json...');
  const eslintResult = await execAsync(`npx eslint --format json --config eslint.testconfig.js "${moduleCopyPath}/package.json"`, {
    cwd: CHECKER_REPO,
    maxBuffer: 1024 * 1024,
  }).catch((err) => err); // ESLint returns non-zero on errors

  // Parse ESLint results
  const additionalEslintIssues = [];
  if (eslintResult && eslintResult.stdout) {
    try {
      const eslintParsed = JSON.parse(eslintResult.stdout);
      for (const entry of eslintParsed) {
        for (const message of entry.messages || []) {
          if (message && message.message) {
            const location = `package.json: Line ${message.line}, Column ${message.column}`;
            additionalEslintIssues.push(`${location}: ${message.message} (rule: ${message.ruleId})`);
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Read issues from result.md (modules.json contains only boolean)
  const resultMd = await fs.readFile(path.join(CHECKER_REPO, 'website', 'result.md'), 'utf8');
  const moduleSection = resultMd.split(`### [${moduleName} by`)[1]?.split('### [')[0] || '';

  // Parse issues - can be multi-line (e.g. dependency updates with sub-items)
  const issueMatches = [];
  const lines = moduleSection.split('\n');
  let currentIssue = '';

  for (const line of lines) {
    if (line.match(/^\d+\./)) {
      // New issue starts
      if (currentIssue) issueMatches.push(currentIssue);
      currentIssue = line.replace(/^\d+\.\s*/, '').trim();
    } else if (line.trim().startsWith('-') && currentIssue) {
      // Sub-item of current issue (e.g. dependency list)
      currentIssue += '\n' + line.trim();
    }
  }
  if (currentIssue) issueMatches.push(currentIssue);

  // Add additional ESLint issues
  if (additionalEslintIssues.length > 0) {
    issueMatches.push('ESLint issues:\n' + additionalEslintIssues.map((i) => `   - ${i}`).join('\n'));
  }

  console.log('\n' + '='.repeat(80));
  console.log(`${moduleName} - MagicMirror Module Check Results`);
  console.log('='.repeat(80));

  if (issueMatches.length > 0) {
    console.log('\n📋 Issues found (' + issueMatches.length + '):');
    issueMatches.forEach((issue, i) => console.log(`  ${i + 1}. ${issue}`));
  } else {
    console.log('\n✅ No issues found - module passes all checks!');
  }

  // Write results to main directory
  const resultsPath = path.join(PROJECT_ROOT, 'magicmirror-check-results.md');
  let resultsContent = `# ${moduleName} - MagicMirror Module Check Results\n\n`;
  resultsContent += `**Check Date:** ${new Date().toLocaleString('en-US')}\n\n`;
  resultsContent += `**Module:** ${moduleName} (${maintainer})\n\n`;

  if (issueMatches.length > 0) {
    resultsContent += `## Issues Found (${issueMatches.length})\n\n`;
    issueMatches.forEach((issue, i) => {
      resultsContent += `${i + 1}. ${issue}\n`;
    });
  } else {
    resultsContent += `## ✅ No Issues Found\n\n`;
    resultsContent += `This module passes all MagicMirror quality checks!\n`;
  }

  resultsContent += `\n---\n`;
  resultsContent += `Compare with results: https://modules.magicmirror.builders/result.html\n`;

  await fs.writeFile(resultsPath, resultsContent);

  console.log('\n' + '='.repeat(80));
  console.log(`📄 Results saved to: magicmirror-check-results.md`);
  console.log('Compare with: https://modules.magicmirror.builders/result.html');
  console.log('='.repeat(80) + '\n');

  // Optional: Cleanup
  if (process.argv.includes('--cleanup')) {
    console.log('🧹 Cleaning up checker files...');
    await fs.rm(CHECKER_REPO, { recursive: true, force: true });
    console.log('✅ Cleanup complete\n');
  } else {
    console.log('💡 Tip: Use --cleanup to remove checker files after check\n');
  }
} catch (error) {
  console.error('❌ Error:', error.message);
  if (error.stderr) console.error(error.stderr);
  process.exit(1);
}
