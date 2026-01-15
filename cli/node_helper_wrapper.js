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
    // Remove all [MMM-Webuntis] tags (can appear multiple times)
    return str.replace(/\[MMM-Webuntis\]\s*/g, '');
  }
  return str;
};

/**
 * Extract caller info from stack trace to show actual source file and line.
 * Walks up the stack to find the first frame outside node_helper_wrapper.js
 */
function getCallerInfo() {
  const stack = new Error().stack.split('\n');
  // stack[0] = "Error"
  // stack[1] = getCallerInfo
  // stack[2] = Log.debug/info/warn/error
  // stack[3+] = actual callers
  for (let i = 3; i < stack.length; i++) {
    const line = stack[i];
    // Skip frames from wrapper itself
    if (line.includes('node_helper_wrapper.js')) continue;

    // Extract file:line:column from "at functionName (file:line:column)"
    const match = line.match(/\(([^)]+?):(\d+):(\d+)\)/);
    if (match) {
      const filePath = match[1];
      const lineNum = match[2];
      // Return shortened path (e.g., "lib/authService.js:123" instead of full path)
      const shortPath = filePath.split('/').slice(-2).join('/');
      return `${shortPath}:${lineNum}`;
    }
  }
  return null;
}

const Log = {
  debug: (...args) => {
    const source = getCallerInfo();
    const sourceStr = source ? ` ${ANSI.dim}[${source}]${ANSI.reset}` : '';
    console.log(` > ${ANSI.dim}${ANSI.cyan}[DEBUG]${ANSI.reset}${sourceStr}`, ...args.map(stripModuleTag));
  },
  info: (...args) => {
    const source = getCallerInfo();
    const sourceStr = source ? ` ${ANSI.dim}[${source}]${ANSI.reset}` : '';
    console.log(` > ${ANSI.green}[INFO]${ANSI.reset}${sourceStr} `, ...args.map(stripModuleTag));
  },
  warn: (...args) => {
    const source = getCallerInfo();
    const sourceStr = source ? ` ${ANSI.dim}[${source}]${ANSI.reset}` : '';
    console.log(` > ${ANSI.yellow}[WARN]${ANSI.reset}${sourceStr} `, ...args.map(stripModuleTag));
  },
  error: (...args) => {
    const source = getCallerInfo();
    const sourceStr = source ? ` ${ANSI.dim}[${source}]${ANSI.reset}` : '';
    console.error(` > ${ANSI.red}[ERROR]${ANSI.reset}${sourceStr}`, ...args.map(stripModuleTag));
  },
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
          // Boolean flags: v, d, x
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

    // Ensure authService is initialized for this config
    if (!mergedConfig._authService) {
      mergedConfig._authService = nodeHelper._getAuthServiceForIdentifier('cli-wrapper');
    }

    // Resolve actual studentId using buildRestTargets (matches fetchData behavior)
    const appData = authSession.appData;
    const restTargets = mergedConfig._authService.buildRestTargets(
      student,
      mergedConfig,
      authSession.school,
      authSession.server,
      authSession.personId,
      authSession.token,
      appData
    );

    // Display personId vs studentId distinction
    if (authSession.personId) {
      Log.wrapper_info(`  👤 Login PersonId: ${authSession.personId}`);
    }

    // Show resolved studentId from buildRestTargets
    const resolvedStudentId = restTargets.length > 0 ? restTargets[0].studentId : null;

    // Check if studentId was manually configured in original config or auto-discovered
    const wasAutoDiscovered = mergedConfig._autoStudentsAssigned === true;
    const configuredStudentId = student.studentId;

    if (resolvedStudentId) {
      if (resolvedStudentId === authSession.personId) {
        Log.wrapper_info(`  📊 Timetable StudentId: ${resolvedStudentId} (same as personId - direct student login)`);
      } else {
        Log.wrapper_info(`  📊 Timetable StudentId: ${resolvedStudentId} (child account - parent login)`);
      }

      // Show source of studentId
      if (configuredStudentId && wasAutoDiscovered) {
        Log.wrapper_info(`  🔍 Source: Auto-discovered from parent account (${student.title || 'unnamed'})`);
      } else if (configuredStudentId && !wasAutoDiscovered) {
        Log.wrapper_info(`  ⚙️  Source: Manual studentId in config (overrides auto-discovery)`);
      }
    } else {
      Log.wrapper_info(`  ⚠️  No valid studentId resolved (check config)`);
    }

    // Enable dumping if requested
    if (shouldDump) {
      mergedConfig.dumpBackendPayloads = true;
    }

    // Override displayMode based on action to fetch only requested data
    const originalDisplayMode = mergedConfig.displayMode;
    const originalStudentDisplayMode = student.displayMode;

    if (action && action !== 'all' && action !== 'auth') {
      // Action corresponds to widget name(s)
      const limitedDisplayMode = action;
      mergedConfig.displayMode = limitedDisplayMode;
      student.displayMode = limitedDisplayMode;

      if (verbose) {
        Log.wrapper_info(`  🎯 Limiting fetch to widget(s): ${limitedDisplayMode}`);
      }
    }

    // Extract holidays once (matches processGroup behavior)
    const wantsGridWidget = nodeHelper._wantsWidget('grid', mergedConfig?.displayMode);
    const wantsLessonsWidget = nodeHelper._wantsWidget('lessons', mergedConfig?.displayMode);
    const shouldFetchHolidays = Boolean(wantsGridWidget || wantsLessonsWidget);
    const compactHolidays = nodeHelper._extractAndCompactHolidays(authSession, shouldFetchHolidays);

    const payload = await nodeHelper.fetchData(authSession, { ...student }, 'wrapper-fetch', credKey, compactHolidays, mergedConfig);

    // Restore original displayMode
    mergedConfig.displayMode = originalDisplayMode;
    student.displayMode = originalStudentDisplayMode;

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
      Log.wrapper_info(`  ✓ Lessons (Timetable): ${results.timetable}`);
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
      // Map widget action to result key
      const widgetToResult = {
        lessons: 'timetable',
        grid: 'timetable',
        exams: 'exams',
        homework: 'homework',
        absences: 'absences',
        messagesofday: 'messagesofday',
      };
      const resultKey = widgetToResult[action] || action;
      const count = results[resultKey] || 0;
      Log.wrapper_info(`  ✓ ${action.charAt(0).toUpperCase() + action.slice(1)}: ${count}`);
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
  const debugApi = flags['debug-api'] || flags.x;
  const allStudents = flags.all || flags.a_all; // Special flag to iterate all students

  if (verbose) setLogLevel('debug');

  try {
    // Clear all caches before fetch to ensure fresh data
    if (nodeHelper.cacheManager) {
      nodeHelper.cacheManager.clearAll();
      Log.wrapper_info('🔄 Cleared all caches for fresh data');
    }

    Log.wrapper_info('Loading configuration...');
    const { config, filePath } = loadConfig(configPath);
    Log.wrapper_info(`✓ Loaded config from ${filePath}`);

    // Simulate INIT_MODULE: load and validate config (same as browser init)
    const cliIdentifier = 'cli-wrapper';
    const cliSessionId = 'cli-session';
    const initPayload = {
      ...getModuleConfig(config),
      id: cliIdentifier,
      sessionId: cliSessionId,
      debugApi: debugApi,
    };

    // Call _handleInitModule to set up config properly (like browser does)
    // This validates config, discovers students, sets up AuthService
    await nodeHelper._handleInitModule(initPayload);

    // After init, get the initialized config from storage
    const sessionKey = `${cliIdentifier}:${cliSessionId}`;
    if (!nodeHelper._configsByIdentifier.has(cliIdentifier)) {
      throw new Error('Config initialization failed - no config stored after _handleInitModule');
    }

    const moduleConfig = nodeHelper._configsByIdentifier.get(cliIdentifier);

    // Apply widget namespace defaults and per-student config merging
    // (This is needed for CLI specifically to handle older config formats)
    const widgetNamespaces = ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'];
    if (Array.isArray(moduleConfig.students)) {
      moduleConfig.students.forEach((stu) => {
        // Copy widget namespace configs from module to student if not already set
        widgetNamespaces.forEach((widget) => {
          if (!stu[widget] && moduleConfig[widget]) {
            stu[widget] = { ...moduleConfig[widget] };
          }
        });
      });
    }

    // Decide which students to iterate
    let studentIndices = [];
    if (studentIndexFlag !== undefined && studentIndexFlag !== null && studentIndexFlag !== '') {
      // Specific student requested
      const idx = parseInt(studentIndexFlag, 10);
      studentIndices = [idx];
    } else if (allStudents) {
      // All students explicitly requested
      studentIndices = Array.from({ length: moduleConfig.students.length }, (_, i) => i);
    } else {
      // Default: all students
      studentIndices = Array.from({ length: moduleConfig.students.length }, (_, i) => i);
    }

    Log.wrapper_info(`\n📋 Configuration loaded with ${moduleConfig.students.length} student(s)`);
    Log.wrapper_info(`Testing student(s): [${studentIndices.join(', ')}]`);

    // Execute fetch directly (skip coalescing timer since CLI doesn't need it)
    // This simulates what _executeFetchForSession does, but synchronously
    await nodeHelper._executeFetchForSession(sessionKey);

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
  --student | -s   <index>   Student index to test (default: all students)
  --action  | -a   <widget>  Which widget(s) to fetch (default: all):
                             all, auth, lessons, grid, exams, homework, absences, messagesofday
                             or combinations: lessons,grid  or  exams,homework
  --dump    | -d             Also write debug dump JSON to debug_dumps/
  --verbose | -v             Show detailed output
  --debug-api | -x           Show detailed API requests and truncated responses
  --help    | -h             Show this help

EXAMPLES:

  # Fetch all data for all configured students (default)
  node --run debug

  # Fetch for specific student only
  node --run debug -- --student 0

  # Fetch for specific student with verbose output
  node --run debug -- --student 1 --verbose

  # Fetch only exams widget for all students
  node --run debug -- --action exams

  # Fetch lessons and grid widgets (timetable data)
  node --run debug -- --action lessons,grid

  # Fetch only homework widget
  node --run debug -- --action homework --verbose

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
