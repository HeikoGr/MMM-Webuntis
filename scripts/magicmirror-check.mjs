#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Extract and replace markdown links with numbered references
 * @param {string} text - Text containing markdown links
 * @param {Map} urlMap - Map to store URLs with their reference numbers
 * @returns {string} Text with [1], [2], etc. instead of markdown links
 */
function extractLinks(text, urlMap) {
  let currentIndex = urlMap.size + 1;

  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    // Check if URL already exists
    let refNum = null;
    for (const [num, storedUrl] of urlMap.entries()) {
      if (storedUrl === url) {
        refNum = num;
        break;
      }
    }

    // Add new URL if not found
    if (refNum === null) {
      refNum = currentIndex++;
      urlMap.set(refNum, url);
    }

    return `${linkText} [${refNum}]`;
  });
}

/**
 * Smart text wrapping that keeps sentences and parenthetical expressions together
 * @param {string} text - Text to wrap
 * @param {number} maxWidth - Maximum line width (default: terminal width or 80)
 * @param {string} indent - Base indentation
 * @param {string} hangingIndent - Additional indent for continuation lines
 * @returns {string} Wrapped text
 */
function smartWrap(text, maxWidth = null, indent = '', hangingIndent = '') {
  const width = maxWidth || process.stdout.columns || 80;

  // Don't wrap if already short enough
  if (indent.length + text.length <= width) {
    return indent + text;
  }

  const lines = [];
  const fullHangingIndent = indent + hangingIndent;

  // Split into semantic chunks: sentences and parenthetical expressions
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (remaining.length === 0) break;

    // Try to match a parenthetical expression including any trailing punctuation/reference
    const parenMatch = remaining.match(/^\([^)]+\)(?:\s*\[\d+\])?[.,;]?/);
    if (parenMatch) {
      chunks.push(parenMatch[0]);
      remaining = remaining.slice(parenMatch[0].length);
      continue;
    }

    // Try to match a sentence (words until period, or to end if no period)
    const sentenceMatch = remaining.match(/^[^.()]+\./);
    if (sentenceMatch) {
      chunks.push(sentenceMatch[0]);
      remaining = remaining.slice(sentenceMatch[0].length);
      continue;
    }

    // Match individual words with any trailing reference/punctuation
    const wordMatch = remaining.match(/^\S+(?:\s*\[\d+\])?[.,;]?/);
    if (wordMatch) {
      chunks.push(wordMatch[0]);
      remaining = remaining.slice(wordMatch[0].length);
      continue;
    }

    // Fallback: take one character
    chunks.push(remaining[0]);
    remaining = remaining.slice(1);
  }

  // Build lines from chunks
  let currentLine = '';
  let isFirstLine = true;

  for (const chunk of chunks) {
    const trimmedChunk = chunk.trim();
    if (!trimmedChunk) continue;

    const lineIndent = isFirstLine ? indent : fullHangingIndent;
    const testLine = currentLine ? currentLine + ' ' + trimmedChunk : trimmedChunk;

    if (lineIndent.length + testLine.length <= width) {
      // Fits on current line
      currentLine = testLine;
    } else {
      // Doesn't fit - push current line and start new one
      if (currentLine) {
        lines.push(lineIndent + currentLine);
        isFirstLine = false;
      }
      currentLine = trimmedChunk;
    }
  }

  // Add remaining line
  if (currentLine) {
    const lineIndent = isFirstLine ? indent : fullHangingIndent;
    lines.push(lineIndent + currentLine);
  }

  return lines.join('\n');
}

// Find MagicMirror modules directory automatically
function findModulesDirectory() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));

  // Check if we're in a MagicMirror modules directory structure
  let checkPath = currentDir;
  for (let i = 0; i < 5; i++) {
    const modulesPath = path.join(checkPath, 'modules');
    if (existsSync(modulesPath) && existsSync(path.join(checkPath, 'package.json'))) {
      // Check if this is a MagicMirror installation
      try {
        const pkg = JSON.parse(readFileSync(path.join(checkPath, 'package.json'), 'utf8'));
        if (pkg.name === 'magicmirror') {
          return modulesPath;
        }
      } catch {
        // Not a valid package.json, continue searching
      }
    }
    checkPath = path.dirname(checkPath);
  }

  // Default fallback to standard MagicMirror location
  const defaultPath = '/opt/magic_mirror/modules';
  if (existsSync(defaultPath)) {
    return defaultPath;
  }

  throw new Error('Could not find MagicMirror modules directory. Please run this script from within a MagicMirror installation.');
}

const MODULES_ROOT = findModulesDirectory();
// Use /tmp for checker to avoid fs.cp self-copy restrictions
const CHECKER_REPO = path.join('/tmp', 'mm-module-checker-all');
const UPSTREAM_REPO = 'https://github.com/MagicMirrorOrg/MagicMirror-3rd-Party-Modules.git';

// Parse command line arguments
const args = process.argv.slice(2);
let filterMode = 'all'; // 'all', 'current', or 'specific'
let specificModules = [];

for (const arg of args) {
  if (arg === '--current') {
    filterMode = 'current';
  } else if (arg.startsWith('--module=')) {
    filterMode = 'specific';
    const moduleName = arg.substring(9);
    specificModules.push(moduleName);
  } else if (arg.startsWith('--modules=')) {
    filterMode = 'specific';
    const moduleNames = arg.substring(10).split(',');
    specificModules.push(...moduleNames);
  } else if (arg !== '--cleanup') {
    console.log(`Unknown argument: ${arg}`);
    console.log('\nUsage:');
    console.log('  node magicmirror-check.mjs              # Check all modules');
    console.log('  node magicmirror-check.mjs --current    # Check current module only');
    console.log('  node magicmirror-check.mjs --module=MMM-Webuntis');
    console.log('  node magicmirror-check.mjs --modules=MMM-Webuntis,MMM-OtherModule');
    console.log('  node magicmirror-check.mjs --cleanup    # Clean up after check');
    process.exit(1);
  }
}

// Determine current module if --current is used
let currentModuleName = null;
if (filterMode === 'current') {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const checkPath = scriptDir;

  // Walk up to find the module directory
  for (let i = 0; i < 5; i++) {
    const testPath = path.resolve(checkPath, '../'.repeat(i));
    const parentPath = path.dirname(testPath);

    if (parentPath === MODULES_ROOT && existsSync(path.join(testPath, 'package.json'))) {
      currentModuleName = path.basename(testPath);
      break;
    }
  }

  if (!currentModuleName) {
    console.error('❌ Error: Could not determine current module. Please use --module=NAME instead.');
    process.exit(1);
  }

  specificModules = [currentModuleName];
  filterMode = 'specific'; // Set to specific mode for consistent filtering
  console.log(`🔍 Checking current module: ${currentModuleName}`);
} else if (filterMode === 'specific') {
  console.log(`🔍 Checking specific module(s): ${specificModules.join(', ')}`);
} else {
  console.log(`🔍 Setting up MagicMirror checker for all modules in: ${MODULES_ROOT}`);
}
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

  // Scan all modules in the modules directory
  const moduleDirs = await fs.readdir(MODULES_ROOT, { withFileTypes: true });
  const validModules = [];

  for (const dirent of moduleDirs) {
    if (!dirent.isDirectory()) continue;

    const moduleName = dirent.name;
    const modulePath = path.join(MODULES_ROOT, moduleName);
    const packageJsonPath = path.join(modulePath, 'package.json');

    // Skip default modules and non-module directories
    if (moduleName === 'default' || !existsSync(packageJsonPath)) {
      continue;
    }

    // Apply filter based on mode
    if ((filterMode === 'specific' || filterMode === 'current') && specificModules.length > 0 && !specificModules.includes(moduleName)) {
      continue;
    }

    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      const repoUrl = pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') || '';
      const maintainer = repoUrl.match(/github\.com\/([^/]+)\//)?.[1] || 'unknown';

      validModules.push({
        name: moduleName,
        path: modulePath,
        pkg: pkg,
        maintainer: maintainer,
        repoUrl: repoUrl,
      });
    } catch {
      console.log(`⚠️  Skipping ${moduleName}: Invalid package.json`);
    }
  }

  if (validModules.length === 0) {
    console.error('❌ Error: No valid modules found to check.');
    if (filterMode === 'specific') {
      console.error(`   Requested module(s): ${specificModules.join(', ')}`);
      console.error(`   Available modules in ${MODULES_ROOT}:`);
      const allDirs = await fs.readdir(MODULES_ROOT, { withFileTypes: true });
      for (const dirent of allDirs) {
        if (dirent.isDirectory() && dirent.name !== 'default' && existsSync(path.join(MODULES_ROOT, dirent.name, 'package.json'))) {
          console.error(`     - ${dirent.name}`);
        }
      }
    }
    process.exit(1);
  }

  console.log(`\n📦 Found ${validModules.length} module${validModules.length > 1 ? 's' : ''} to check:\n`);
  validModules.forEach((mod, idx) => {
    console.log(`  ${idx + 1}. ${mod.name} (${mod.maintainer})`);
  });

  const checkerModulesDir = path.join(CHECKER_REPO, 'modules');
  await fs.mkdir(checkerModulesDir, { recursive: true });

  // ALWAYS delete old checker results for fresh checks
  const websiteDataDir = path.join(CHECKER_REPO, 'website', 'data');
  const websiteDir = path.join(CHECKER_REPO, 'website');

  const filesToClean = [
    path.join(websiteDataDir, 'modules.stage.4.json'),
    path.join(websiteDataDir, 'modules.json'),
    path.join(websiteDataDir, 'moduleCache.json'),
    path.join(websiteDir, 'result.md'),
  ];

  for (const file of filesToClean) {
    if (existsSync(file)) {
      await fs.rm(file, { force: true });
    }
  }

  // Copy all modules and prepare metadata
  const moduleDataArray = [];

  if (validModules.length === 1) {
    console.log('\n📋 Preparing module for analysis...');
  } else {
    console.log('\n📋 Copying modules...');
  }

  for (const mod of validModules) {
    const moduleCopyPath = path.join(checkerModulesDir, `${mod.name}-----${mod.maintainer}`);

    // Delete old copy for fresh data
    if (existsSync(moduleCopyPath)) {
      await fs.rm(moduleCopyPath, { recursive: true });
    }

    if (validModules.length > 1) {
      console.log(`  ✓ ${mod.name}`);
    }
    await fs.cp(mod.path, moduleCopyPath, {
      recursive: true,
      filter: (src) => {
        const relativePath = path.relative(mod.path, src);
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

    // Add module metadata
    const moduleId = `${mod.maintainer}/${mod.name}`;
    moduleDataArray.push({
      id: moduleId,
      name: mod.name,
      category: mod.pkg.keywords?.[0] || 'Other',
      maintainer: mod.maintainer,
      maintainerURL: `https://github.com/${mod.maintainer}`,
      url: mod.repoUrl || `https://github.com/${moduleId}`,
      description: mod.pkg.description || `MagicMirror module: ${mod.name}`,
      license: mod.pkg.license || 'none',
      keywords: mod.pkg.keywords || [],
      issues: [],
      packageJson: {
        status: 'parsed',
        summary: {
          name: mod.pkg.name,
          version: mod.pkg.version,
          description: mod.pkg.description,
          license: mod.pkg.license,
          keywords: mod.pkg.keywords || [],
          dependencies: mod.pkg.dependencies || {},
          devDependencies: mod.pkg.devDependencies || {},
          scripts: mod.pkg.scripts || {},
        },
      },
    });
  }

  await fs.mkdir(websiteDataDir, { recursive: true });
  await fs.writeFile(path.join(websiteDataDir, 'modules.stage.4.json'), JSON.stringify({ modules: moduleDataArray }, null, 2));

  const checkText = validModules.length === 1 ? 'Running module check...' : `Running checks for ${validModules.length} modules...`;
  console.log(`\n🔎 ${checkText}`);
  await execAsync('npx tsx scripts/check-modules/index.ts', {
    cwd: CHECKER_REPO,
    env: {
      ...process.env,
      CHECK_MODULES_PROJECT_ROOT: CHECKER_REPO,
      CHECK_MODULES_MODULES_DIR: checkerModulesDir,
      CHECK_MODULES_STAGE4_PATH: path.join(websiteDataDir, 'modules.stage.4.json'),
      NODE_OPTIONS: '--no-warnings',
    },
    maxBuffer: 10 * 1024 * 1024,
  });

  // Read results from modules.json (contains all modules with issue status)
  const modulesJsonPath = path.join(websiteDataDir, 'modules.json');
  const modulesData = JSON.parse(await fs.readFile(modulesJsonPath, 'utf8'));

  // Also read result.md for detailed issue descriptions
  const resultMd = await fs.readFile(path.join(CHECKER_REPO, 'website', 'result.md'), 'utf8');

  // Parse module sections from result.md for detailed issues
  const moduleSections = resultMd.split(/### \[/).slice(1);
  const issuesByModule = {};

  for (const section of moduleSections) {
    const moduleNameMatch = section.match(/^([^\]]+)/);
    if (!moduleNameMatch) continue;

    const fullName = moduleNameMatch[1];
    const moduleName = fullName.split(' by ')[0];

    // Parse issues and re-join wrapped lines
    const issueMatches = [];
    const lines = section.split('\n');
    let currentIssue = '';

    for (const line of lines) {
      if (line.match(/^\d+\./)) {
        // New issue starts
        if (currentIssue) issueMatches.push(currentIssue);
        currentIssue = line.replace(/^\d+\.\s*/, '').trim();
      } else if (line.trim().startsWith('-') && currentIssue) {
        // Sub-item of current issue (e.g. dependency list)
        currentIssue += '\n' + line.trim();
      } else if (line.trim() && currentIssue) {
        // Continuation line - join with space
        currentIssue += ' ' + line.trim();
      }
    }
    if (currentIssue) issueMatches.push(currentIssue);

    issuesByModule[moduleName] = issueMatches;
  }

  // Build results from modules.json (includes all checked modules)
  const allResults = modulesData.modules
    .filter((mod) => validModules.some((vm) => vm.name === mod.name))
    .map((mod) => ({
      name: mod.name,
      issues: issuesByModule[mod.name] || [],
    }));

  const resultTitle =
    allResults.length === 1 ? `Module Check Result: ${allResults[0].name}` : `Module Check Results: ${allResults.length} modules checked`;

  console.log('\n' + '='.repeat(80));
  console.log(resultTitle);
  console.log('='.repeat(80));

  let totalIssues = 0;
  const cleanModules = [];
  const modulesWithIssues = [];

  for (const result of allResults) {
    if (result.issues.length > 0) {
      totalIssues += result.issues.length;
      modulesWithIssues.push(result);
    } else {
      cleanModules.push(result);
    }
  }

  if (cleanModules.length > 0) {
    const passText = cleanModules.length === 1 ? '✅ Module passed all checks' : `✅ ${cleanModules.length} modules passed all checks`;
    console.log(`\n${passText}`);
    if (cleanModules.length > 1) {
      cleanModules.forEach((mod) => console.log(`  ✓ ${mod.name}`));
    }
  }

  if (modulesWithIssues.length > 0) {
    const issueText =
      allResults.length === 1
        ? `⚠️  ${totalIssues} issue${totalIssues > 1 ? 's' : ''} found`
        : `⚠️  ${modulesWithIssues.length} module${modulesWithIssues.length > 1 ? 's' : ''} with issues (${totalIssues} total)`;
    console.log(`\n${issueText}:\n`);

    // Collect all URLs for reference list at the end
    const urlMap = new Map();

    modulesWithIssues.forEach((mod) => {
      if (allResults.length > 1) {
        console.log(`  📦 ${mod.name} (${mod.issues.length} issue${mod.issues.length > 1 ? 's' : ''})`);
      }
      mod.issues.forEach((issue, i) => {
        const issueLines = issue.split('\n');
        const baseIndent = allResults.length > 1 ? '     ' : '  ';
        const subIndent = baseIndent + '   ';

        // Extract links and replace with numbered references
        const processedText = extractLinks(issueLines[0], urlMap);

        // Wrap with smart wrapping
        const wrapped = smartWrap(
          `${i + 1}. ${processedText}`,
          null,
          baseIndent,
          '   ' // Hanging indent for continuation lines
        );
        console.log(wrapped);

        for (let j = 1; j < issueLines.length; j++) {
          const processedSubItem = extractLinks(issueLines[j], urlMap);
          const wrappedSubItem = smartWrap(
            processedSubItem,
            null,
            subIndent,
            '  ' // Hanging indent for sub-items
          );
          console.log(wrappedSubItem);
        }
      });
      if (allResults.length > 1) {
        console.log('');
      }
    });

    // Print URL reference list if there are any links
    if (urlMap.size > 0) {
      console.log('\n' + '─'.repeat(80));
      console.log('📎 Links:');
      console.log('─'.repeat(80));
      for (const [num, url] of urlMap.entries()) {
        console.log(`[${num}] ${url}`);
      }
    }
  }

  // Write comprehensive results to modules directory
  const resultsPath = path.join(MODULES_ROOT, 'magicmirror-check-results.md');
  let resultsContent = `# MagicMirror Module Check Results\n\n`;
  resultsContent += `**Check Date:** ${new Date().toLocaleString('en-US')}\n`;
  resultsContent += `**Modules Directory:** ${MODULES_ROOT}\n`;
  resultsContent += `**Modules Checked:** ${allResults.length}\n\n`;

  resultsContent += `## Summary\n\n`;
  resultsContent += `- ✅ **${cleanModules.length}** modules passed all checks\n`;
  resultsContent += `- ⚠️  **${modulesWithIssues.length}** modules with issues\n`;
  resultsContent += `- 📊 **${totalIssues}** total issues found\n\n`;

  if (cleanModules.length > 0) {
    resultsContent += `## ✅ Modules Passed (${cleanModules.length})\n\n`;
    cleanModules.forEach((mod) => {
      resultsContent += `- ${mod.name}\n`;
    });
    resultsContent += `\n`;
  }

  if (modulesWithIssues.length > 0) {
    resultsContent += `## ⚠️ Modules with Issues (${modulesWithIssues.length})\n\n`;
    modulesWithIssues.forEach((mod) => {
      resultsContent += `### ${mod.name}\n\n`;
      resultsContent += `**Issues:** ${mod.issues.length}\n\n`;
      mod.issues.forEach((issue, i) => {
        resultsContent += `${i + 1}. ${issue}\n`;
      });
      resultsContent += `\n`;
    });
  }

  resultsContent += `---\n\n`;
  resultsContent += `Compare with results: https://modules.magicmirror.builders/result.html\n`;

  await fs.writeFile(resultsPath, resultsContent);

  console.log('\n' + '='.repeat(80));
  console.log(`📄 Results saved to: ${MODULES_ROOT}/magicmirror-check-results.md`);
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
