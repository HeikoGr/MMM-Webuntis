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

function setLogLevel() {
  // Log level is controlled by node_helper logger, not by this wrapper
  // Keep function for API compatibility
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
    nodeHelper.sendSocketNotification = () => {};
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
 * Load defaults dynamically from MMM-Webuntis.js
 * This ensures defaults are always in sync with the module definition
 */
function loadModuleDefaults() {
  try {
    const mmmPath = path.join(__dirname, '..', 'MMM-Webuntis.js');
    // Read the file to extract defaults object
    const content = fs.readFileSync(mmmPath, 'utf8');

    // Use regex to find the defaults object
    // Match from defaults:  from "{" to the closing "}" before getStyles()
    const match = content.match(/defaults:\s*\{([\s\S]*?)\n\s*\},\s*getStyles/);
    if (!match) {
      throw new Error('Could not find defaults object in MMM-Webuntis.js');
    }

    // Build a valid JavaScript object string
    const defaultsStr = `({${match[1]}\n})`;

    // Evaluate to get the object (safe because we control the file)
    const moduleDefaults = eval(defaultsStr);

    return moduleDefaults;
  } catch (err) {
    // Fallback to hardcoded defaults if dynamic load fails
    console.warn(`Warning: Could not load defaults from MMM-Webuntis.js: ${err.message}`);
    return {
      header: 'MMM-Webuntis',
      fetchIntervalMs: 15 * 60 * 1000,
      logLevel: 'none',
      displayMode: 'list',
      mode: 'verbose',
      daysToShow: 7,
      pastDaysToShow: 0,
      showStartTime: false,
      showRegular: true,
      showTeacherMode: 'full',
      useShortSubject: false,
      showSubstitution: false,
      daysAhead: 21,
      showSubject: true,
      showTeacher: true,
      mergeGap: 15,
      maxLessons: 0,
      showNowLine: true,
      pastDays: 21,
      futureDays: 7,
      dateFormat: 'dd.MM.',
      examDateFormat: 'dd.MM.',
      homeworkDateFormat: 'dd.MM.',
      useClassTimetable: false,
      dumpBackendPayloads: false,
      students: [],
    };
  }
}

// Cache the defaults on first load
let cachedDefaults = null;

/**
 * Load defaults from MMM-Webuntis.js and merge with module config
 * Ensures all expected fields have values (either from config or defaults)
 */
function mergeWithModuleDefaults(moduleConfig) {
  // Load defaults once and cache them
  if (cachedDefaults === null) {
    cachedDefaults = loadModuleDefaults();
  }

  // Deep merge: defaults first, then override with config values
  // Widget namespaces need deep merge, not shallow merge
  const merged = { ...cachedDefaults, ...moduleConfig };

  // Deep merge widget namespaces
  const widgetNamespaces = ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'];
  widgetNamespaces.forEach((widget) => {
    if (cachedDefaults[widget] || moduleConfig[widget]) {
      merged[widget] = { ...cachedDefaults[widget], ...moduleConfig[widget] };
    }
  });

  return merged;
}

/**
 * Fetch data for a single student
 * Now accepts mergedConfig directly to avoid file-based lookup
 */
async function fetchStudentData(mergedConfig, studentIndex, action, shouldDump, verbose) {
  const students = mergedConfig.students || [];

  if (studentIndex < 0 || studentIndex >= students.length) {
    throw new Error(`Student index ${studentIndex} out of range (0-${students.length - 1})`);
  }

  const student = students[studentIndex];
  const qrcode = student.qrcode;
  const school = student.school || mergedConfig.school;
  const title = student.title || `Student ${studentIndex}`;

  Log.wrapper_info(`\n📚 Student ${studentIndex}: "${title}"`);
  Log.wrapper_info(`  School: ${school}`);
  Log.wrapper_info(`  Mode: ${qrcode ? 'qrcode' : 'username/password'}`);

  try {
    const authSession = await nodeHelper._createAuthSession(student, mergedConfig);
    const credKey = nodeHelper._getCredentialKey(student, mergedConfig);

    // Enable dumping if requested
    if (shouldDump) {
      mergedConfig.dumpBackendPayloads = true;
    }

    // Extract holidays once (matches processGroup behavior)
    const wantsGridWidget = nodeHelper._wantsWidget('grid', mergedConfig?.displayMode);
    const wantsLessonsWidget = nodeHelper._wantsWidget('lessons', mergedConfig?.displayMode);
    const shouldFetchHolidays = Boolean(wantsGridWidget || wantsLessonsWidget);
    const compactHolidays = nodeHelper._extractAndCompactHolidays(authSession, shouldFetchHolidays);

    const payload = await nodeHelper.fetchData(authSession, { ...student }, 'wrapper-fetch', credKey, compactHolidays);

    const results = {
      timetable: payload?.timetableRange?.length || 0,
      exams: payload?.exams?.length || 0,
      homework: payload?.homeworks?.length || 0,
      absences: payload?.absences?.length || 0,
      messagesofday: payload?.messagesOfDay?.length || 0,
    };

    if (action === 'auth') {
      Log.wrapper_info('  ✓ Auth: login ok');
    } else if (action === 'all') {
      Log.wrapper_info(`  ✓ Timetable entries: ${results.timetable}`);
      Log.wrapper_info(`  ✓ Exams: ${results.exams}`);
      Log.wrapper_info(`  ✓ Homework: ${results.homework}`);
      Log.wrapper_info(`  ✓ Absences: ${results.absences}`);
      Log.wrapper_info(`  ✓ Messages of Day: ${results.messagesofday}`);

      // Show messages of day content if present
      if (payload?.messagesOfDay?.length > 0) {
        Log.wrapper_info('\n  📢 Messages of Day:');
        payload.messagesOfDay.forEach((msg, idx) => {
          const subject = msg.subject ? `[${msg.subject}]` : '';
          const text = (msg.text || '').trim();

          // Text comes pre-sanitized from backend with \n from <br> tags
          const lines = text.split('\n').filter((l) => l.trim());

          if (lines.length > 0) {
            const title = subject || `Message ${idx + 1}`;
            Log.wrapper_info(`     ${title}`);
            lines.forEach((line) => {
              Log.wrapper_info(`       ${line.trim()}`);
            });
          }
        });
      }
    } else {
      Log.wrapper_info(`  ✓ ${action.charAt(0).toUpperCase() + action.slice(1)}: ${results[action] || 0}`);
    }

    if (shouldDump) {
      try {
        const dumpsDir = path.join(__dirname, '..', 'debug_dumps');
        const files = fs.readdirSync(dumpsDir).sort().reverse();
        const recentDumps = files.filter((f) => f.includes(title) || f.includes(String(Date.now()).slice(0, 7))).slice(0, 1);
        if (recentDumps.length > 0) {
          Log.wrapper_info(`  📄 Dump: debug_dumps/${recentDumps[0]}`);
        }
      } catch {
        // ignore if can't find dumps dir
      }
    }
  } catch (err) {
    Log.error(`  ✗ Student ${studentIndex} fetch failed: ${err.message}`);
    if (verbose) console.error(err.stack);
    throw err;
  }
}

async function cmdFetch(flags) {
  const configPath = flags.config || flags.c;
  const studentIndexFlag = flags.student || flags.s;
  const action = flags.action || flags.a || 'all';
  const verbose = flags.verbose || flags.v;
  const shouldDump = flags.dump || flags.d;
  const allStudents = flags.all || flags.a_all; // Special flag to iterate all students

  if (verbose) setLogLevel('debug');

  try {
    Log.wrapper_info('Loading configuration...');
    const { config, filePath } = loadConfig(configPath);
    Log.wrapper_info(`✓ Loaded config from ${filePath}`);

    let moduleConfig = getModuleConfig(config);

    // Apply legacy config normalization FIRST to detect deprecated keys and show warnings
    // This must happen before merging defaults, otherwise legacy values won't be mapped
    moduleConfig = nodeHelper._normalizeLegacyConfig(moduleConfig);

    // Then merge with module defaults to ensure all options have values
    moduleConfig = mergeWithModuleDefaults(moduleConfig);

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
      'showSubstitution',
      'daysAhead',
      'showSubject',
      'showTeacher',
      'logLevel',
    ];
    const widgetNamespaces = ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'];
    moduleConfig.students.forEach((stu) => {
      defaultProps.forEach((prop) => {
        if (stu[prop] === undefined) stu[prop] = moduleConfig[prop];
      });
      // Copy widget namespace configs from module to student if not already set
      widgetNamespaces.forEach((widget) => {
        if (!stu[widget] && moduleConfig[widget]) {
          stu[widget] = { ...moduleConfig[widget] };
        }
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

    // Decide which students to iterate
    let studentIndices = [];
    if (studentIndexFlag !== undefined && studentIndexFlag !== null && studentIndexFlag !== '') {
      // Specific student requested
      const idx = parseInt(studentIndexFlag, 10);
      studentIndices = [idx];
    } else if (allStudents) {
      // All students requested (explicit flag)
      studentIndices = Array.from({ length: moduleConfig.students.length }, (_, i) => i);
    } else {
      // Default: first student only (backward compatibility)
      studentIndices = [0];
    }

    Log.wrapper_info(`\n📋 Configuration loaded with ${moduleConfig.students.length} student(s)`);
    Log.wrapper_info(`Testing student(s): [${studentIndices.join(', ')}]`);

    // Fetch data for each selected student
    let successCount = 0;
    let failureCount = 0;

    for (const idx of studentIndices) {
      try {
        await fetchStudentData(moduleConfig, idx, action, shouldDump, verbose);
        successCount++;
      } catch {
        failureCount++;
      }
    }

    Log.wrapper_info(`\n✓ Completed: ${successCount} successful, ${failureCount} failed`);
    if (failureCount > 0) {
      throw new Error(`${failureCount} student(s) failed`);
    }
  } catch (err) {
    Log.error(`✗ Command failed: ${err.message}`);
    if (verbose) console.error(err.stack);
    throw err;
  }
}

function showHelp() {
  console.log(`
MMM-Webuntis Node Helper Wrapper
================================

Fetches and tests data from WebUntis API using config.js credentials.
All student data is loaded automatically from your MagicMirror configuration.

USAGE:
  node --run debug -- [options]

OPTIONS:
  --config  | -c   <path>    Path to config.js (auto-detected if omitted)
  --student | -s   <index>   Student index to test (default: 0, or all if no -s given)
  --action  | -a   <action>  Which data to fetch (default: all):
                             all, auth, timetable, exams, homework, absences
  --dump    | -d             Also write debug dump JSON to debug_dumps/
  --verbose | -v             Show detailed output
  --help    | -h             Show this help

EXAMPLES:

  # Fetch all data for first student only (default)
  node --run debug

  # Fetch for all configured students
  node --run debug -- --all

  # Fetch for specific student with verbose output
  node --run debug -- --student 1 --verbose

  # Fetch only exams for all students
  node --run debug -- --all --action exams

  # Fetch and create debug dump for student 0
  node --run debug -- --dump --verbose

  # Use custom config file, test student 1
  node --run debug -- --config ./custom-config.js --student 1

  # Test authentication only for all students
  node --run debug -- --all --action auth --verbose
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
