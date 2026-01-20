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
      // Return filename only for brevity (e.g., "node_helper.js:123")
      const fileName = filePath.split('/').pop();
      return `${fileName}:${lineNum}`;
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

// ============================================================================
// Load real node_helper with mocked dependencies
// ============================================================================

const NodeHelper = {
  create: (moduleImpl) => ({
    ...moduleImpl,
    sendSocketNotification: (name, payload) => {
      // Stub: in CLI we don't have a frontend; just log
      Log.debug(`[sendSocketNotification] ${name} for ${payload?.id || 'unknown'}`);
    },
  }),
};

function loadNodeHelper() {
  const Module = require('module');
  const originalRequire = Module.prototype.require;

  Module.prototype.require = function (moduleName) {
    if (moduleName === 'node_helper') return NodeHelper;
    if (moduleName === 'logger') return Log;
    return originalRequire.apply(this, arguments);
  };

  const nodeHelper = require('../node_helper.js');

  // Restore original require
  Module.prototype.require = originalRequire;
  // Initialize node helper lifecycle
  if (typeof nodeHelper.start === 'function') {
    nodeHelper.start();
  }
  return nodeHelper;
}

const nodeHelper = loadNodeHelper();

// ============================================================================
// Arg parsing & config loading helpers
// ============================================================================

function loadConfig(configPath) {
  if (!configPath) {
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

function getAllWebuntisModules(config) {
  const modules = config.modules?.filter((m) => m.module === 'MMM-Webuntis') || [];
  if (modules.length === 0) {
    throw new Error('MMM-Webuntis module configuration not found in config file');
  }
  return modules;
}

async function cmdFetch(flags) {
  const configPath = flags.config || flags.c;
  const studentIndexFlag = flags.student || flags.s;
  const action = flags.action || flags.a || 'all';
  const verbose = flags.verbose || flags.v;
  // CLI summarizes from debug dumps; no separate dump flag used
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

    // Get all MMM-Webuntis modules (enabled and disabled)
    const webuntisModules = getAllWebuntisModules(config);
    Log.wrapper_info(`\n📋 Found ${webuntisModules.length} MMM-Webuntis module(s) in config`);

    // Process each module (skip disabled ones)
    let successCount = 0;
    let failureCount = 0;
    let disabledCount = 0;

    for (let moduleIdx = 0; moduleIdx < webuntisModules.length; moduleIdx++) {
      const moduleEntry = webuntisModules[moduleIdx];
      const header = moduleEntry.header || `Module ${moduleIdx}`;

      // Check if module is disabled
      if (moduleEntry.disabled === true) {
        Log.wrapper_info(`\n⊘ [${header}] - DISABLED (skipped)`);
        disabledCount++;
        continue;
      }

      Log.wrapper_info(`\n📍 [${header}] Processing...`);

      try {
        // Simulate INIT_MODULE: load and validate config (same as browser init)
        const cliIdentifier = `cli-wrapper-${moduleIdx}`;
        const cliSessionId = `cli-session-${moduleIdx}`;
        const initPayload = {
          ...moduleEntry.config,
          id: cliIdentifier,
          sessionId: cliSessionId,
          debugApi: debugApi,
        };

        // Call _handleInitModule to set up config properly (like browser does)
        // This validates config, discovers students, sets up AuthService
        await nodeHelper._handleInitModule(initPayload);

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

        Log.wrapper_info(`  📋 Configuration loaded with ${moduleConfig.students.length} student(s)`);
        Log.wrapper_info(`  Testing student(s): [${studentIndices.join(', ')}]`);

        // Clean up old dumps to avoid clutter (keep only latest 3 per student)
        const dumpsDir = path.join(__dirname, '..', 'debug_dumps');
        if (fs.existsSync(dumpsDir)) {
          const allFiles = fs.readdirSync(dumpsDir).filter((f) => f.endsWith('_api.json'));
          const filesByStudent = new Map();

          // Group files by student name
          allFiles.forEach((f) => {
            const match = f.match(/^\d+_(.+)_api\.json$/);
            if (match) {
              const studentName = match[1];
              if (!filesByStudent.has(studentName)) filesByStudent.set(studentName, []);
              filesByStudent.get(studentName).push(f);
            }
          });

          // Delete old dumps (keep only latest 3 per student)
          filesByStudent.forEach((files) => {
            const sorted = files.sort().reverse();
            const toDelete = sorted.slice(3);
            toDelete.forEach((f) => {
              try {
                fs.unlinkSync(path.join(dumpsDir, f));
                Log.wrapper_info(`  🗑️  Deleted old dump: ${f}`);
              } catch {
                // ignore deletion errors
              }
            });
          });
        }

        // Summarize results for each selected student based on latest debug dump
        for (const idx of studentIndices) {
          try {
            const stu = moduleConfig.students[idx] || {};
            const title = stu.title || `Student ${idx}`;
            // Sanitize title same way as payloadBuilder.js does for dump filenames
            const safeTitle = title.replace(/[^a-zA-Z0-9._-]/g, '_');

            // Locate latest dump file for this student
            const files = fs.existsSync(dumpsDir) ? fs.readdirSync(dumpsDir).sort().reverse() : [];
            const dumpFile = files.find((f) => f.includes(safeTitle) && f.endsWith('_api.json'));

            if (!dumpFile) {
              Log.warn(`  ⚠️ No debug dump found for ${title}.`);
              failureCount++;
              continue;
            }

            const dumpPath = path.join(dumpsDir, dumpFile);
            const dumpJson = JSON.parse(fs.readFileSync(dumpPath, 'utf-8'));

            const results = {
              timetable: Array.isArray(dumpJson?.timetableRange) ? dumpJson.timetableRange.length : 0,
              exams: Array.isArray(dumpJson?.exams) ? dumpJson.exams.length : 0,
              homework: Array.isArray(dumpJson?.homeworks) ? dumpJson.homeworks.length : 0,
              absences: Array.isArray(dumpJson?.absences) ? dumpJson.absences.length : 0,
              messagesofday: Array.isArray(dumpJson?.messagesOfDay) ? dumpJson.messagesOfDay.length : 0,
            };

            if (action === 'auth') {
              Log.wrapper_info('  ✓ Auth: login ok');
            } else if (action === 'all') {
              Log.wrapper_info(`  ✓ Lessons (Timetable): ${results.timetable}`);
              Log.wrapper_info(`  ✓ Exams: ${results.exams}`);
              Log.wrapper_info(`  ✓ Homework: ${results.homework}`);
              Log.wrapper_info(`  ✓ Absences: ${results.absences}`);
              Log.wrapper_info(`  ✓ Messages of Day: ${results.messagesofday}`);
            } else {
              const widgetToResult = {
                lessons: 'timetable',
                grid: 'timetable',
                exams: 'exams',
                homework: 'homework',
                absences: 'absences',
                messagesofday: 'messagesofday',
              };
              // Support comma-separated actions like "lessons,grid"
              const actions = String(action || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              const actionsToReport = actions.length ? actions : ['all'];

              for (const act of actionsToReport) {
                if (act === 'all') {
                  Log.wrapper_info(`  ✓ Lessons (Timetable): ${results.timetable}`);
                  Log.wrapper_info(`  ✓ Exams: ${results.exams}`);
                  Log.wrapper_info(`  ✓ Homework: ${results.homework}`);
                  Log.wrapper_info(`  ✓ Absences: ${results.absences}`);
                  Log.wrapper_info(`  ✓ Messages of Day: ${results.messagesofday}`);
                } else {
                  const key = widgetToResult[act] || act;
                  const count = results[key] || 0;
                  Log.wrapper_info(`  ✓ ${act.charAt(0).toUpperCase() + act.slice(1)}: ${count}`);
                }
              }
            }

            // Show dump file
            Log.wrapper_info(`  📄 Dump: debug_dumps/${dumpFile}`);
            successCount++;
          } catch (err) {
            Log.error(`  ✗ Student ${idx} summary failed: ${err.message}`);
            if (verbose) console.error(err.stack);
            failureCount++;
          }
        }
      } catch (err) {
        Log.error(`  ✗ Module processing failed: ${err.message}`);
        if (verbose) console.error(err.stack);
        failureCount++;
      }
    }

    Log.wrapper_info(`\n✓ Summary: ${successCount} successful, ${failureCount} failed, ${disabledCount} disabled (skipped)`);
    if (failureCount > 0) {
      throw new Error(`${failureCount} module(s) or student(s) failed`);
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
  // Inline argument parsing
  const args = process.argv;
  const flags = {};
  let command = null;
  const startIdx = 2;

  for (let i = startIdx; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      command = arg;
      break;
    }
  }

  for (let i = startIdx; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--') && !nextArg.startsWith('-')) {
        flags[key] = nextArg;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (arg.startsWith('-') && arg !== '-') {
      const shortFlags = arg.slice(1);
      for (let j = 0; j < shortFlags.length; j++) {
        const char = shortFlags[j];
        if (char === 'c' || char === 's' || char === 'a') {
          const nextArg = args[i + 1];
          if (nextArg && !nextArg.startsWith('-')) {
            flags[char] = nextArg;
            i++;
          }
        } else if (char === 'h') {
          command = 'help';
        } else {
          flags[char] = true;
        }
      }
    }
  }

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
