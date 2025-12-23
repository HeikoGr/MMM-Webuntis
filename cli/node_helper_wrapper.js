#!/usr/bin/env node

/**
 * Node Helper CLI Wrapper - Tests the real node_helper.js
 *
 * Provides a CLI interface to test the actual node_helper functions
 * directly without a MagicMirror instance.
 */

const fs = require('fs');
const path = require('path');
const process = require('process');

// ============================================================================
// Mock MagicMirror dependencies
// ============================================================================

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

const stripModuleTag = (str) => {
  if (typeof str === 'string') {
    return str.replace(/^\[MMM-Webuntis\]\s*/, '');
  }
  return str;
};

const Log = {
  debug: (...args) => console.log(` > ${ANSI.dim}${ANSI.cyan}[DEBUG]${ANSI.reset}`, ...args.map(stripModuleTag)),
  info: (...args) => console.log(` > ${ANSI.green}[INFO] ${ANSI.reset}`, ...args.map(stripModuleTag)),
  warn: (...args) => console.log(` > ${ANSI.yellow}[WARN] ${ANSI.reset}`, ...args.map(stripModuleTag)),
  error: (...args) => console.error(` > ${ANSI.red}[ERROR]${ANSI.reset}`, ...args.map(stripModuleTag)),
  wrapper_info: (...args) => console.log(`${ANSI.reset}[INFO] `, ...args),
};

let logLevel = 'info';

function setLogLevel(level) {
  logLevel = level;
}

const NodeHelper = {
  create: (moduleImpl) => moduleImpl,
};

function loadNodeHelper() {
  const Module = require('module');
  const originalRequire = Module.prototype.require;

  Module.prototype.require = function (moduleName) {
    if (moduleName === 'node_helper') return NodeHelper;
    if (moduleName === 'logger') return Log;
    return originalRequire.apply(this, arguments);
  };

  try {
    const nodeHelperPath = path.join(__dirname, '..', 'node_helper.js');
    delete require.cache[require.resolve(nodeHelperPath)];
    const helperModule = require(nodeHelperPath);
    Module.prototype.require = originalRequire;
    return helperModule;
  } catch (err) {
    Module.prototype.require = originalRequire;
    throw err;
  }
}

let nodeHelper;
try {
  nodeHelper = loadNodeHelper();
  if (nodeHelper.start) {
    nodeHelper.start();
  }
  // Mock sendSocketNotification for wrapper mode
  if (!nodeHelper.sendSocketNotification) {
    nodeHelper.sendSocketNotification = () => { };
  }
} catch (err) {
  console.error('Failed to load node_helper.js:', err.message);
  if (process.argv.includes('--verbose')) {
    console.error(err.stack);
  }
  process.exit(1);
}

// ============================================================================
// CLI Utilities
// ============================================================================

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { command: null, flags: {} };

  let startIdx = 0;

  // Check if first arg is a command (doesn't start with -)
  if (args.length > 0 && !args[0].startsWith('-')) {
    result.command = args[0];
    startIdx = 1;
  }

  // Parse flags starting from startIdx
  for (let i = startIdx; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--') && !nextArg.startsWith('-')) {
        result.flags[key] = nextArg;
        i++;
      } else {
        result.flags[key] = true;
      }
    } else if (arg.startsWith('-') && arg !== '-') {
      // Handle short flags like -v, -d, -s, -c, -a, -h
      const shortFlags = arg.slice(1);
      for (let j = 0; j < shortFlags.length; j++) {
        const char = shortFlags[j];
        if (char === 'c' || char === 's' || char === 'a') {
          // These flags take values
          const nextArg = args[i + 1];
          if (nextArg && !nextArg.startsWith('-')) {
            result.flags[char] = nextArg;
            i++;
          }
        } else if (char === 'h') {
          // Help flag
          result.command = 'help';
        } else {
          // Boolean flags: v, d
          result.flags[char] = true;
        }
      }
    }
  }

  return result;
}

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`);
  return d;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Load configuration from config.js
 */
function loadConfig(configPath) {
  if (!configPath) {
    // Try common locations
    const candidates = ['./config/config.js', '../config/config.js', '../../config/config.js'];
    for (const candidate of candidates) {
      const abs = path.resolve(candidate);
      if (fs.existsSync(abs)) {
        configPath = abs;
        break;
      }
    }
  }

  if (!configPath) {
    throw new Error('Config file not found. Use --config <path> or place config.js in standard location');
  }

  const abs = path.isAbsolute(configPath) ? configPath : path.resolve(configPath);

  if (!fs.existsSync(abs)) {
    throw new Error(`Config file not found: ${abs}`);
  }

  delete require.cache[require.resolve(abs)];

  const config = require(abs);
  if (!config || typeof config !== 'object') {
    throw new Error(`Config did not export an object: ${abs}`);
  }

  return { config, filePath: abs };
}

/**
 * Get MMM-Webuntis module config
 */
function getModuleConfig(config) {
  const moduleConfig = config.modules?.find((m) => m.module === 'MMM-Webuntis')?.config;
  if (!moduleConfig) {
    throw new Error('MMM-Webuntis module configuration not found in config file');
  }
  return moduleConfig;
}

/**
 * Get student credentials from config
 * Supports both direct credentials and parent account mode
 */
function getStudentCredentials(config, studentIndex) {
  const moduleConfig = getModuleConfig(config);
  const students = moduleConfig.students || [];

  if (!students.length) {
    throw new Error('No students configured in config file');
  }

  if (studentIndex < 0 || studentIndex >= students.length) {
    throw new Error(`Student index ${studentIndex} out of range (0-${students.length - 1})`);
  }

  const student = students[studentIndex];

  const qrcode = student.qrcode;

  // Try direct credentials first, then fall back to parent account
  let username = student.username || moduleConfig.username;
  let password = student.password || moduleConfig.password;

  // Parent account fallback
  if (!username) {
    username = student.username || moduleConfig.username;
  }
  if (!password) {
    password = student.password || moduleConfig.password;
  }

  let school = student.school || moduleConfig.school;
  let server = student.server || moduleConfig.server;

  // Derive school/server from QR code if present
  if ((!school || !server) && qrcode && qrcode.startsWith('untis://')) {
    try {
      const qrUrl = new URL(qrcode);
      school = school || qrUrl.searchParams.get('school');
      server = server || qrUrl.searchParams.get('url');
      if (server && server.startsWith('http')) {
        server = new URL(server).hostname;
      }
    } catch (err) {
      throw new Error(`QR code parsing failed for student ${studentIndex}: ${err.message}`);
    }
  }

  if (!qrcode) {
    if (!school || !username || !password || !server) {
      throw new Error(
        `Missing credentials for student ${studentIndex}. ` +
        `Found: school=${school ? 'yes' : 'no'}, ` +
        `username=${username ? 'yes' : 'no'}, ` +
        `password=${password ? 'yes' : 'no'}, ` +
        `server=${server ? 'yes' : 'no'}`
      );
    }
  } else {
    if (!school || !server) {
      throw new Error(`Missing school/server for QR student ${studentIndex}`);
    }
  }

  return {
    qrcode,
    school,
    username,
    password,
    server,
    studentId: student.studentId,
    daysToShow: student.daysToShow || moduleConfig.daysToShow || 1,
    examsDaysAhead: student.examsDaysAhead || moduleConfig.examsDaysAhead || 30,
  };
}

async function cmdFetch(flags) {
  const configPath = flags.config || flags.c;
  const studentIndex = parseInt(flags.student || flags.s || '0', 10);
  const action = flags.action || flags.a || 'all';
  const verbose = flags.verbose || flags.v;
  const shouldDump = flags.dump || flags.d;

  if (verbose) setLogLevel('debug');

  try {
    Log.wrapper_info('Loading configuration...');
    const { config, filePath } = loadConfig(configPath);
    Log.wrapper_info(`✓ Loaded config from ${filePath}`);

    const moduleConfig = getModuleConfig(config);
    await nodeHelper._ensureStudentsFromAppData(moduleConfig);
    // Emulate MagicMirror socket payload: set id, config and per-student fallbacks
    moduleConfig.id = moduleConfig.id || 'wrapper-cli';
    nodeHelper.config = moduleConfig;
    const defaultProps = [
      'daysToShow',
      'pastDaysToShow',
      'showStartTime',
      'useClassTimetable',
      'showTeacherMode',
      'useShortSubject',
      'showSubstitutionText',
      'examsDaysAhead',
      'showExamSubject',
      'showExamTeacher',
      'logLevel',
    ];
    moduleConfig.students.forEach((stu) => {
      defaultProps.forEach((prop) => {
        if (stu[prop] === undefined) stu[prop] = moduleConfig[prop];
      });
      if (stu.daysToShow < 0 || stu.daysToShow > 10 || isNaN(stu.daysToShow)) {
        stu.daysToShow = 1;
      }
      if (stu.pastDaysToShow === undefined || isNaN(stu.pastDaysToShow)) {
        stu.pastDaysToShow = moduleConfig.pastDaysToShow || 0;
      }
      if (stu.displayMode == 'list') {
        stu.displayMode = 'lessons,exams';
      }
    });
    const student = moduleConfig.students[studentIndex];
    const credentials = getStudentCredentials(config, studentIndex);
    const { school, username, password, server, daysToShow, examsDaysAhead, qrcode } = credentials;

    Log.wrapper_info(`✓ Using student ${studentIndex}`);
    Log.wrapper_info(`  School: ${school}`);
    Log.wrapper_info(`  Mode: ${qrcode ? 'qrcode' : 'username/password'}`);

    // Determine date ranges
    const today = new Date();
    const timetableEnd = new Date(today.getTime() + daysToShow * 24 * 60 * 60 * 1000);
    const examsEnd = new Date(today.getTime() + examsDaysAhead * 24 * 60 * 60 * 1000);


    Log.wrapper_info('\n--- QR student: using node_helper.fetchData() ---');
    try {
      const untis = nodeHelper._createUntisClient(student, moduleConfig);
      await untis.login();

      const credKey = nodeHelper._getCredentialKey(student, moduleConfig);
      Log.wrapper_info(`Using credential key`);

      // Enable dumping if requested
      if (shouldDump) {
        moduleConfig.dumpBackendPayloads = true;
      }

      const payload = await nodeHelper.fetchData(untis, { ...student }, 'wrapper-fetch', credKey);

      Log.wrapper_info('✓ Fetch via fetchData finished');
      if (action === 'auth') {
        Log.wrapper_info('Auth: login ok');
      }
      if (action === 'all' || action === 'timetable') {
        Log.wrapper_info(`Timetable entries: ${payload?.timetableRange?.length || 0}`);
      }
      if (action === 'all' || action === 'exams') {
        Log.wrapper_info(`Exams: ${payload?.exams?.length || 0}`);
      }
      if (action === 'all' || action === 'homework') {
        Log.wrapper_info(`Homework: ${payload?.homeworks?.length || 0}`);
      }
      if (action === 'all' || action === 'absences') {
        Log.wrapper_info(`Absences: ${payload?.absences?.length || 0}`);
      }

      if (shouldDump) {
        try {
          const dumpsDir = path.join(__dirname, '..', 'debug_dumps');
          const files = fs.readdirSync(dumpsDir).sort().reverse();
          const recentDumps = files.filter((f) => f.includes(student.title) || f.includes(String(Date.now()).slice(0, 7))).slice(0, 1);
          if (recentDumps.length > 0) {
            console.log(`\n📄 Dump file: debug_dumps/${recentDumps[0]}`);
          }
        } catch (e) {
          // ignore if can't find dumps dir
        }
      }
    } catch (err) {
      Log.error(`✗ QR fetch failed: ${err.message}`);
      if (verbose) console.error(err.stack);
      process.exit(1);
    }
    return;
  } catch (err) {
    Log.error(`✗ Command failed: ${err.message}`);
    if (verbose) console.error(err.stack);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
MMM-Webuntis Node Helper Wrapper
================================

Fetches and tests data from WebUntis API using config.js credentials.
All student data is loaded automatically from your MagicMirror configuration.

USAGE:
  npm run debug -- [options]

OPTIONS:
  --config  | -c   <path>    Path to config.js (auto-detected if omitted)
  --student | -s   <index>   Student index to test (default: 0)
  --action  | -a   <action>  Which data to fetch (default: all):
                             all, auth, timetable, exams, homework, absences
  --dump    | -d             Also write debug dump JSON to debug_dumps/
  --verbose | -v             Show detailed output
  --help    | -h             Show this help

EXAMPLES:

  # Fetch all data for first student
  npm run debug

  # Fetch for specific student with verbose output
  npm run debug -- --student 1 --verbose

  # Fetch only timetable and homework
  npm run debug -- --action timetable

  # Fetch and create debug dump
  npm run debug -- --dump --verbose

  # Use custom config file
  npm run debug -- --config ./custom-config.js --student 0

  # Test authentication only
  npm run debug -- --action auth --verbose
`);
}

// ============================================================================
// CLI Commands
// ============================================================================

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { command, flags } = parseArgs(process.argv);

  try {
    // Handle help requests
    if (command === 'help' || command === '--help' || command === '-h' || flags.help) {
      showHelp();
      process.exit(0);
    }

    // If command provided but looks like a path, treat as config
    if (command && !command.startsWith('-')) {
      if (!flags.config && !flags.c) {
        flags.config = command;
      }
    }

    // Run unified fetch command
    await cmdFetch(flags);
    process.exit(0);
  } catch (err) {
    Log.error(`Command failed: ${err.message}`);
    if (flags && (flags.verbose || flags.v)) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
