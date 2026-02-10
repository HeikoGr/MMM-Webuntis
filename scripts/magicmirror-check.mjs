#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { exec, spawn } from 'node:child_process';
import readline from 'node:readline';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const UPSTREAM_REPO = 'https://github.com/MagicMirrorOrg/MagicMirror-3rd-Party-Modules.git';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract and replace markdown links with numbered references
 */
function extractLinks(text, urlMap) {
  let currentIndex = urlMap.size + 1;
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
    let refNum = null;
    for (const [num, storedUrl] of urlMap.entries()) {
      if (storedUrl === url) {
        refNum = num;
        break;
      }
    }
    if (refNum === null) {
      refNum = currentIndex++;
      urlMap.set(refNum, url);
    }
    return `${linkText} [${refNum}]`;
  });
}

/**
 * Smart text wrapping that keeps sentences and parenthetical expressions together
 */
function smartWrap(text, maxWidth = null, indent = '', hangingIndent = '') {
  const width = maxWidth || process.stdout.columns || 80;
  if (indent.length + text.length <= width) {
    return indent + text;
  }

  const lines = [];
  const fullHangingIndent = indent + hangingIndent;
  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (remaining.length === 0) break;

    const parenMatch = remaining.match(/^\([^)]+\)(?:\s*\[\d+\])?[.,;]?/);
    if (parenMatch) {
      chunks.push(parenMatch[0]);
      remaining = remaining.slice(parenMatch[0].length);
      continue;
    }

    const sentenceMatch = remaining.match(/^[^.()]+\./);
    if (sentenceMatch) {
      chunks.push(sentenceMatch[0]);
      remaining = remaining.slice(sentenceMatch[0].length);
      continue;
    }

    const wordMatch = remaining.match(/^\S+(?:\s*\[\d+\])?[.,;]?/);
    if (wordMatch) {
      chunks.push(wordMatch[0]);
      remaining = remaining.slice(wordMatch[0].length);
      continue;
    }

    chunks.push(remaining[0]);
    remaining = remaining.slice(1);
  }

  let currentLine = '';
  let isFirstLine = true;

  for (const chunk of chunks) {
    const trimmedChunk = chunk.trim();
    if (!trimmedChunk) continue;

    const lineIndent = isFirstLine ? indent : fullHangingIndent;
    const testLine = currentLine ? currentLine + ' ' + trimmedChunk : trimmedChunk;

    if (lineIndent.length + testLine.length <= width) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(lineIndent + currentLine);
        isFirstLine = false;
      }
      currentLine = trimmedChunk;
    }
  }

  if (currentLine) {
    const lineIndent = isFirstLine ? indent : fullHangingIndent;
    lines.push(lineIndent + currentLine);
  }

  return lines.join('\n');
}

/**
 * Find MagicMirror modules directory automatically
 */
function findModulesDirectory(overridePath = null) {
  if (overridePath && existsSync(overridePath)) {
    return overridePath;
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  let checkPath = currentDir;

  for (let i = 0; i < 5; i++) {
    const modulesPath = path.join(checkPath, 'modules');
    if (existsSync(modulesPath) && existsSync(path.join(checkPath, 'package.json'))) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(checkPath, 'package.json'), 'utf8'));
        if (pkg.name === 'magicmirror') {
          return modulesPath;
        }
      } catch {
        // Continue searching
      }
    }
    checkPath = path.dirname(checkPath);
  }

  const defaultPath = '/opt/magic_mirror/modules';
  if (existsSync(defaultPath)) {
    return defaultPath;
  }

  throw new Error('Could not find MagicMirror modules directory. Please run this script from within a MagicMirror installation.');
}

/**
 * Normalize package.json data with safe fallbacks
 */
function normalizePackage(pkg, moduleName) {
  const out = {};
  out.name = pkg && typeof pkg.name === 'string' ? pkg.name : moduleName;
  out.version = pkg && typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  out.description = pkg && typeof pkg.description === 'string' ? pkg.description : `MagicMirror module: ${moduleName}`;
  out.license = pkg && typeof pkg.license === 'string' ? pkg.license : 'none';
  out.keywords = Array.isArray(pkg && pkg.keywords) ? pkg.keywords.filter((k) => typeof k === 'string' && k.length > 0) : [];
  if (out.keywords.length === 0) out.keywords = ['Other'];

  let repo = '';
  try {
    repo = (pkg && pkg.repository && pkg.repository.url) || pkg.repository || '';
    if (typeof repo !== 'string') repo = '';
    repo = repo.replace(/^git\+/, '').replace(/\.git$/, '');
  } catch {
    // repo already initialized to ''
  }
  out.repositoryUrl = repo;
  out.dependencies = pkg && typeof pkg.dependencies === 'object' && pkg.dependencies ? pkg.dependencies : {};
  out.devDependencies = pkg && typeof pkg.devDependencies === 'object' && pkg.devDependencies ? pkg.devDependencies : {};
  out.scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? pkg.scripts : {};
  return out;
}

// ============================================================================
// CLI Functions
// ============================================================================

function printHelp() {
  console.log('\nUsage: node magicmirror-check.mjs [options]');
  console.log('\nOptions:');
  console.log('  --current                 Check the current module (auto-detected)');
  console.log('  --module=NAME             Check a specific module by name');
  console.log('  --modules=NAME1,NAME2     Check multiple specific modules');
  console.log('  --modules-root=PATH       Override modules root directory');
  console.log('  --checker-repo=PATH       Override temporary checker repo location');
  console.log('  --output-dir=PATH         Write magicmirror-check-results.md to this directory (use "." for CWD)');
  console.log('  --cleanup                 Remove temporary checker files after run');
  console.log('  --help                    Show this help message');
  console.log('\nExamples:');
  console.log('  node magicmirror-check.mjs --current --output-dir=.');
  console.log('  node magicmirror-check.mjs --modules-root=/opt/magic_mirror/modules');
  console.log('');
}

function parseCliArguments() {
  const args = process.argv.slice(2);
  const config = {
    filterMode: 'all',
    specificModules: [],
    cliModulesRoot: null,
    cliCheckerRepo: null,
    cliOutputDir: null,
  };

  for (const arg of args) {
    if (arg === '--current') {
      config.filterMode = 'current';
    } else if (arg.startsWith('--module=')) {
      config.filterMode = 'specific';
      config.specificModules.push(arg.substring(9));
    } else if (arg.startsWith('--modules=')) {
      config.filterMode = 'specific';
      config.specificModules.push(...arg.substring(10).split(','));
    } else if (arg.startsWith('--modules-root=')) {
      config.cliModulesRoot = arg.substring('--modules-root='.length);
    } else if (arg.startsWith('--checker-repo=')) {
      config.cliCheckerRepo = arg.substring('--checker-repo='.length);
    } else if (arg.startsWith('--output-dir=')) {
      config.cliOutputDir = arg.substring('--output-dir='.length);
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (arg !== '--cleanup') {
      console.log(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return config;
}

// ============================================================================
// Checker Setup Functions
// ============================================================================

async function ensureCheckerRepository(checkerRepo) {
  if (!existsSync(checkerRepo)) {
    console.log('Fetching checker repository (git-free) via `degit` (first time only)...');
    try {
      await execAsync(`npx degit MagicMirrorOrg/MagicMirror-3rd-Party-Modules#main "${checkerRepo}"`);
    } catch (err) {
      console.log('`degit` failed or not available, falling back to git clone and stripping .git:', err?.message || err);
      await execAsync(`git clone --depth 1 ${UPSTREAM_REPO} "${checkerRepo}"`);
      try {
        await fs.rm(path.join(checkerRepo, '.git'), { recursive: true, force: true });
      } catch {
        // Non-fatal
      }
    }
  }

  if (!existsSync(path.join(checkerRepo, 'node_modules'))) {
    console.log('📦 Installing dependencies...');
    await execAsync('npm install', { cwd: checkerRepo });
  }
}

async function scanModules(modulesRoot, filterMode, specificModules) {
  const moduleDirs = await fs.readdir(modulesRoot, { withFileTypes: true });
  const validModules = [];

  for (const dirent of moduleDirs) {
    if (!dirent.isDirectory()) continue;

    const moduleName = dirent.name;
    const modulePath = path.join(modulesRoot, moduleName);
    const packageJsonPath = path.join(modulePath, 'package.json');

    if (moduleName === 'default' || !existsSync(packageJsonPath)) {
      continue;
    }

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

  return validModules;
}

async function prepareCheckerFiles(checkerRepo, validModules) {
  const checkerModulesDir = path.join(checkerRepo, 'modules');
  await fs.mkdir(checkerModulesDir, { recursive: true });

  const websiteDataDir = path.join(checkerRepo, 'website', 'data');
  const websiteDir = path.join(checkerRepo, 'website');

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

  if (validModules.length === 1) {
    console.log('\n📋 Preparing module for analysis...');
  } else {
    console.log('\n📋 Copying modules...');
  }

  const moduleDataArray = [];

  for (const mod of validModules) {
    const moduleCopyPath = path.join(checkerModulesDir, `${mod.name}-----${mod.maintainer}`);

    if (existsSync(moduleCopyPath)) {
      await fs.rm(moduleCopyPath, { recursive: true });
    }

    if (validModules.length > 1) {
      console.log(`  ✓  ${mod.name}`);
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

    const npkg = normalizePackage(mod.pkg, mod.name);
    const moduleId = `${mod.maintainer}/${mod.name}`;
    moduleDataArray.push({
      id: moduleId,
      name: mod.name,
      category: npkg.keywords[0] || 'Other',
      maintainer: mod.maintainer,
      maintainerURL: `https://github.com/${mod.maintainer}`,
      url: mod.repoUrl || npkg.repositoryUrl || `https://github.com/${moduleId}`,
      description: npkg.description,
      license: npkg.license,
      keywords: npkg.keywords,
      issues: [],
      packageJson: {
        status: 'parsed',
        summary: {
          name: npkg.name,
          version: npkg.version,
          description: npkg.description,
          license: npkg.license,
          keywords: npkg.keywords,
          dependencies: npkg.dependencies,
          devDependencies: npkg.devDependencies,
          scripts: npkg.scripts,
        },
      },
    });
  }

  await fs.mkdir(websiteDataDir, { recursive: true });
  await fs.writeFile(path.join(websiteDataDir, 'modules.stage.4.json'), JSON.stringify({ modules: moduleDataArray }, null, 2));

  return { checkerModulesDir, websiteDataDir };
}

// ============================================================================
// Checker Execution Functions
// ============================================================================

async function runChecker(checkerRepo, checkerModulesDir, websiteDataDir, validModules) {
  const checkText = validModules.length === 1 ? 'Running module check...' : `Running checks for ${validModules.length} modules...`;
  console.log(`\n🔎 ${checkText}`);

  await new Promise((resolve, reject) => {
    const childEnv = {
      ...process.env,
      CHECK_MODULES_PROJECT_ROOT: checkerRepo,
      CHECK_MODULES_MODULES_DIR: checkerModulesDir,
      CHECK_MODULES_STAGE4_PATH: path.join(websiteDataDir, 'modules.stage.4.json'),
      NODE_OPTIONS: '--no-warnings',
    };

    const cp = spawn('npx', ['tsx', 'scripts/check-modules/index.ts'], {
      cwd: checkerRepo,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    let elapsed = 0;
    const tick = 200;

    let stderr = '';
    let progressSeen = false;
    let progressCurrent = 0;
    let progressTotal = 0;
    let detectedModule = '';

    const spinnerInterval = setInterval(() => {
      const frame = spinnerFrames[frameIndex++ % spinnerFrames.length];
      let text = `Checking... ${frame} ${Math.floor(elapsed / 1000)}s`;
      if (detectedModule) {
        text += `  ${detectedModule} (${progressCurrent}/${progressTotal || validModules.length})`;
      } else if (progressSeen) {
        text += `  Progress ${progressCurrent}/${progressTotal}`;
      }
      try {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(text);
      } catch {
        // Ignore
      }
      elapsed += tick;
    }, tick);

    const flushSpinner = () => {
      try {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
      } catch {
        // Ignore
      }
    };

    cp.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const m = text.match(/Progress:\s*(\d+)\/(\d+)/);
      if (m) {
        progressSeen = true;
        progressCurrent = parseInt(m[1], 10);
        progressTotal = parseInt(m[2], 10);
      }
      for (const vm of validModules) {
        if (text.includes(vm.name)) {
          detectedModule = vm.name;
          if (!progressTotal) progressTotal = validModules.length;
          progressCurrent = validModules.findIndex((v) => v.name === vm.name) + 1;
          break;
        }
      }
    });

    cp.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const vm of validModules) {
        if (text.includes(vm.name)) {
          detectedModule = vm.name;
          if (!progressTotal) progressTotal = validModules.length;
          progressCurrent = validModules.findIndex((v) => v.name === vm.name) + 1;
          break;
        }
      }
    });

    cp.on('close', (code) => {
      clearInterval(spinnerInterval);
      flushSpinner();
      if (code === 0) {
        if (progressSeen) {
          console.log(`Checking complete. Progress: ${progressCurrent}/${progressTotal}`);
        } else {
          console.log('Checking complete.');
        }
        resolve();
      } else {
        const err = new Error(`Command failed with exit code ${code}`);
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

// ============================================================================
// Results Processing Functions
// ============================================================================

async function parseCheckerResults(checkerRepo, validModules) {
  const websiteDataDir = path.join(checkerRepo, 'website', 'data');
  const modulesJsonPath = path.join(websiteDataDir, 'modules.json');
  const modulesData = JSON.parse(await fs.readFile(modulesJsonPath, 'utf8'));
  const resultMd = await fs.readFile(path.join(checkerRepo, 'website', 'result.md'), 'utf8');

  const moduleSections = resultMd.split(/### \[/).slice(1);
  const issuesByModule = {};

  for (const section of moduleSections) {
    const moduleNameMatch = section.match(/^([^\]]+)/);
    if (!moduleNameMatch) continue;

    const fullName = moduleNameMatch[1];
    const moduleName = fullName.split(' by ')[0];
    const issueMatches = [];
    const lines = section.split('\n');
    let currentIssue = '';

    for (const line of lines) {
      if (line.match(/^\d+\./)) {
        if (currentIssue) issueMatches.push(currentIssue);
        currentIssue = line.replace(/^\d+\.\s*/, '').trim();
      } else if (line.trim().startsWith('-') && currentIssue) {
        currentIssue += '\n' + line.trim();
      } else if (line.trim() && currentIssue) {
        currentIssue += ' ' + line.trim();
      }
    }
    if (currentIssue) issueMatches.push(currentIssue);
    issuesByModule[moduleName] = issueMatches;
  }

  const allResults = modulesData.modules
    .filter((mod) => validModules.some((vm) => vm.name === mod.name))
    .map((mod) => ({
      name: mod.name,
      issues: issuesByModule[mod.name] || [],
    }));

  return allResults;
}

function displayResults(allResults) {
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

    modulesWithIssues.forEach((mod) => {
      const urlMap = new Map();
      if (allResults.length > 1) {
        console.log(`  📦 ${mod.name} (${mod.issues.length} issue${mod.issues.length > 1 ? 's' : ''})`);
      }
      mod.issues.forEach((issue, i) => {
        const issueLines = issue.split('\n');
        const baseIndent = allResults.length > 1 ? '     ' : '  ';
        const subIndent = baseIndent + '   ';

        const processedText = extractLinks(issueLines[0], urlMap);
        const wrapped = smartWrap(`${i + 1}. ${processedText}`, null, baseIndent, '   ');
        console.log(wrapped);

        for (let j = 1; j < issueLines.length; j++) {
          const processedSubItem = extractLinks(issueLines[j], urlMap);
          const wrappedSubItem = smartWrap(processedSubItem, null, subIndent, '  ');
          console.log(wrappedSubItem);
        }
      });

      if (urlMap.size > 0) {
        console.log(`\n    📎 Links for ${mod.name}:`);
        for (const [num, url] of urlMap.entries()) {
          console.log(`     [${num}] ${url}`);
        }
      }

      console.log('');
    });
  }

  return { cleanModules, modulesWithIssues, totalIssues };
}

function determineResultsDirectory(modulesRoot, cliOutputDir, filterMode, currentModuleName, specificModules, validModules) {
  let resultsDir = modulesRoot;

  if (cliOutputDir && cliOutputDir.length > 0) {
    if (cliOutputDir === '.' || cliOutputDir.toLowerCase() === 'cwd') {
      resultsDir = process.cwd();
    } else {
      resultsDir = path.isAbsolute(cliOutputDir) ? cliOutputDir : path.join(process.cwd(), cliOutputDir);
    }
  } else if (filterMode === 'current' && currentModuleName) {
    resultsDir = path.join(modulesRoot, currentModuleName);
  } else if (filterMode === 'specific' && specificModules.length === 1) {
    const vm = validModules.find((v) => v.name === specificModules[0]);
    if (vm && vm.path) resultsDir = vm.path;
  }

  return resultsDir;
}

async function writeResultsFile(resultsDir, modulesRoot, allResults, cleanModules, modulesWithIssues, totalIssues) {
  const resultsPath = path.join(resultsDir, 'magicmirror-check-results.md');
  let resultsContent = `# MagicMirror Module Check Results\n\n`;
  resultsContent += `**Check Date:** ${new Date().toLocaleString('en-US')}\n`;
  resultsContent += `**Modules Directory:** ${modulesRoot}\n`;
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
      const urlMap = new Map();
      resultsContent += `### ${mod.name}\n`;
      resultsContent += `**Issues:** ${mod.issues.length}\n`;
      mod.issues.forEach((issue, i) => {
        const lines = issue.split('\n');
        const first = extractLinks(lines[0], urlMap);
        let outIssue = `${i + 1}. ${first}`;
        for (let j = 1; j < lines.length; j++) {
          outIssue += '\n' + extractLinks(lines[j], urlMap);
        }
        resultsContent += `${outIssue}\n`;
      });

      if (urlMap.size > 0) {
        resultsContent += `\n**Links:**\n`;
        for (const [num, url] of urlMap.entries()) {
          resultsContent += `- [${num}] ${url}\n`;
        }
      }

      resultsContent += `\n`;
    });
  }

  resultsContent += `---\n\n`;
  resultsContent += `Compare with results: https://modules.magicmirror.builders/result.html\n`;

  await fs.writeFile(resultsPath, resultsContent);
  return resultsPath;
}

// ============================================================================
// Main Execution Flow
// ============================================================================

async function main() {
  try {
    const cliConfig = parseCliArguments();

    let modulesRoot = null;
    let checkerRepo = path.join('/tmp', 'mm-module-checker-all');

    try {
      modulesRoot = findModulesDirectory(cliConfig.cliModulesRoot);
    } catch {
      console.warn('Warning: could not auto-detect modules directory, falling back to CLI or default.');
      if (cliConfig.cliModulesRoot && existsSync(cliConfig.cliModulesRoot)) {
        modulesRoot = cliConfig.cliModulesRoot;
      } else {
        modulesRoot = findModulesDirectory();
      }
    }

    if (cliConfig.cliCheckerRepo && cliConfig.cliCheckerRepo.length > 0) {
      checkerRepo = cliConfig.cliCheckerRepo;
    }

    let currentModuleName = null;
    if (cliConfig.filterMode === 'current') {
      const scriptDir = path.dirname(fileURLToPath(import.meta.url));
      let checkPath = scriptDir;

      for (let i = 0; i < 5; i++) {
        const testPath = path.resolve(checkPath, '../'.repeat(i));
        const parentPath = path.dirname(testPath);

        if (parentPath === modulesRoot && existsSync(path.join(testPath, 'package.json'))) {
          currentModuleName = path.basename(testPath);
          break;
        }
      }

      if (!currentModuleName) {
        console.error('❌ Error: Could not determine current module. Please use --module=NAME instead.');
        process.exit(1);
      }

      cliConfig.specificModules = [currentModuleName];
      cliConfig.filterMode = 'specific';
      console.log(`🔍 Checking current module: ${currentModuleName}`);
    } else if (cliConfig.filterMode === 'specific') {
      console.log(`🔍 Checking specific module(s): ${cliConfig.specificModules.join(', ')}`);
    } else {
      const displayRoot = cliConfig.cliModulesRoot || '/opt/magic_mirror/modules';
      console.log(`🔍 Setting up MagicMirror checker for all modules in: ${displayRoot}`);
    }

    await ensureCheckerRepository(checkerRepo);

    const validModules = await scanModules(modulesRoot, cliConfig.filterMode, cliConfig.specificModules);

    if (validModules.length === 0) {
      console.error('❌ Error: No valid modules found to check.');
      if (cliConfig.filterMode === 'specific') {
        console.error(`   Requested module(s): ${cliConfig.specificModules.join(', ')}`);
        console.error(`   Available modules in ${modulesRoot}:`);
        const allDirs = await fs.readdir(modulesRoot, { withFileTypes: true });
        for (const dirent of allDirs) {
          if (dirent.isDirectory() && dirent.name !== 'default' && existsSync(path.join(modulesRoot, dirent.name, 'package.json'))) {
            console.error(`     - ${dirent.name}`);
          }
        }
      }
      process.exit(1);
    }

    console.log(`\n📦 Found ${validModules.length} module${validModules.length > 1 ? 's' : ''} to check:`);
    validModules.forEach((mod, idx) => {
      console.log(`  ${idx + 1}. ${mod.name} (${mod.maintainer})`);
    });

    const { checkerModulesDir, websiteDataDir } = await prepareCheckerFiles(checkerRepo, validModules);

    await runChecker(checkerRepo, checkerModulesDir, websiteDataDir, validModules);

    const allResults = await parseCheckerResults(checkerRepo, validModules);
    const { cleanModules, modulesWithIssues, totalIssues } = displayResults(allResults);

    const resultsDir = determineResultsDirectory(
      modulesRoot,
      cliConfig.cliOutputDir,
      cliConfig.filterMode,
      currentModuleName,
      cliConfig.specificModules,
      validModules
    );

    const resultsPath = await writeResultsFile(resultsDir, modulesRoot, allResults, cleanModules, modulesWithIssues, totalIssues);

    console.log('='.repeat(80));
    console.log(`📄 Results saved to: ${resultsPath}`);
    console.log('Compare with: https://modules.magicmirror.builders/result.html');
    console.log('='.repeat(80) + '\n');

    if (process.argv.includes('--cleanup')) {
      console.log('🧹 Cleaning up checker files...');
      await fs.rm(checkerRepo, { recursive: true, force: true });
      console.log('✅ Cleanup complete\n');
    } else {
      console.log('💡 Tip: Use --cleanup to remove checker files after check\n');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stderr) console.error(error.stderr);
    process.exit(1);
  }
}

// Start execution
main();
