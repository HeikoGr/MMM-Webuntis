/**
 * Node Helper CLI Wrapper - Tests the real node_helper.js
 *
 * Provides a CLI interface to test the actual node_helper functions
 * directly without a MagicMirror instance.
 */

const fs = require('fs');
const path = require('path');
const process = require('process');

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
  for (let i = 3; i < stack.length; i++) {
    const line = stack[i];
    if (line.includes('node_helper_wrapper.js')) continue;

    const match = line.match(/\(([^)]+?):(\d+):(\d+)\)/);
    if (match) {
      const filePath = match[1];
      const lineNum = match[2];
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
  void 0;
}

const capturedPayloads = new Map();

const NodeHelper = {
  create: (moduleImpl) => ({
    ...moduleImpl,
    sendSocketNotification: (name, payload) => {
      if (name === 'GOT_DATA' && payload?.id) {
        capturedPayloads.set(payload.id, payload);
      }
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

  Module.prototype.require = originalRequire;
  if (typeof nodeHelper.start === 'function') {
    nodeHelper.start();
  }
  return nodeHelper;
}

const nodeHelper = loadNodeHelper();

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
  const verbose = flags.verbose || flags.v;
  const debugApi = flags['debug-api'] || flags.x;
  const allStudents = flags.all || flags.a_all;

  if (verbose) setLogLevel('debug');

  try {
    if (nodeHelper.cacheManager) {
      nodeHelper.cacheManager.clearAll();
      Log.wrapper_info('🔄 Cleared all caches for fresh data');
    }

    Log.wrapper_info('Loading configuration...');
    const { config, filePath } = loadConfig(configPath);
    Log.wrapper_info(`✓ Loaded config from ${filePath}`);

    const webuntisModules = getAllWebuntisModules(config);
    Log.wrapper_info(`\n📋 Found ${webuntisModules.length} MMM-Webuntis module(s) in config`);

    let successCount = 0;
    let failureCount = 0;
    let disabledCount = 0;

    for (let moduleIdx = 0; moduleIdx < webuntisModules.length; moduleIdx++) {
      const moduleEntry = webuntisModules[moduleIdx];
      const header = moduleEntry.header || `Module ${moduleIdx}`;

      if (moduleEntry.disabled === true) {
        Log.wrapper_info(`\n⊘ [${header}] - DISABLED (skipped)`);
        disabledCount++;
        continue;
      }

      Log.wrapper_info(`\n📍 [${header}] Processing...`);

      try {
        const cliIdentifier = `cli-wrapper-${moduleIdx}`;
        const cliSessionId = `cli-session-${moduleIdx}`;
        const initPayload = {
          ...moduleEntry.config,
          id: cliIdentifier,
          sessionId: cliSessionId,
          debugApi: debugApi,
        };

        await nodeHelper._handleInitModule(initPayload);

        if (!nodeHelper._configsByIdentifier.has(cliIdentifier)) {
          throw new Error('Config initialization failed - no config stored after _handleInitModule');
        }

        const moduleConfig = nodeHelper._configsByIdentifier.get(cliIdentifier);

        const widgetNamespaces = ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'];
        if (Array.isArray(moduleConfig.students)) {
          moduleConfig.students.forEach((stu) => {
            widgetNamespaces.forEach((widget) => {
              if (!stu[widget] && moduleConfig[widget]) {
                stu[widget] = { ...moduleConfig[widget] };
              }
            });
          });
        }

        let studentIndices = [];
        if (studentIndexFlag !== undefined && studentIndexFlag !== null && studentIndexFlag !== '') {
          const idx = parseInt(studentIndexFlag, 10);
          studentIndices = [idx];
        } else if (allStudents) {
          studentIndices = Array.from({ length: moduleConfig.students.length }, (_, i) => i);
        } else {
          studentIndices = Array.from({ length: moduleConfig.students.length }, (_, i) => i);
        }

        Log.wrapper_info(`  📋 Configuration loaded with ${moduleConfig.students.length} student(s)`);
        Log.wrapper_info(`  Testing student(s): [${studentIndices.join(', ')}]`);

        const fetchPayload = {
          ...moduleConfig,
          id: cliIdentifier,
          sessionId: cliSessionId,
        };
        await nodeHelper._handleFetchData(fetchPayload);

        for (const idx of studentIndices) {
          try {
            const stu = moduleConfig.students[idx] || {};
            const title = stu.title || `Student ${idx}`;

            const payload = capturedPayloads.get(cliIdentifier);
            if (!payload) {
              Log.warn(`  ⚠️ No payload captured for ${title}.`);
              failureCount++;
              continue;
            }

            let studentData = payload;

            if (Array.isArray(payload.students)) {
              studentData = payload.students.find((s) => s.title === title || s.studentId === stu.studentId);
            } else if (payload.title !== title && moduleConfig.students.length > 1) {
              continue;
            }

            if (!studentData) {
              Log.warn(`  ⚠️ No data for student ${title}.`);
              failureCount++;
              continue;
            }

            const dataObj = studentData.data || studentData;

            const results = {
              timetable: Array.isArray(dataObj.lessons)
                ? dataObj.lessons.length
                : Array.isArray(dataObj.timetableRange)
                  ? dataObj.timetableRange.length
                  : 0,
              exams: Array.isArray(dataObj.exams) ? dataObj.exams.length : 0,
              homework: Array.isArray(dataObj.homework)
                ? dataObj.homework.length
                : Array.isArray(dataObj.homeworks)
                  ? dataObj.homeworks.length
                  : 0,
              absences: Array.isArray(dataObj.absences) ? dataObj.absences.length : 0,
              messagesofday: Array.isArray(dataObj.messages)
                ? dataObj.messages.length
                : Array.isArray(dataObj.messagesOfDay)
                  ? dataObj.messagesOfDay.length
                  : 0,
            };

            Log.wrapper_info(`\n  📊 Final Payload for "${title}":`);
            Log.wrapper_info(`     Lessons (Timetable): ${results.timetable}`);
            Log.wrapper_info(`     Exams: ${results.exams}`);
            Log.wrapper_info(`     Homework: ${results.homework}`);
            Log.wrapper_info(`     Absences: ${results.absences}`);
            Log.wrapper_info(`     Messages of Day: ${results.messagesofday}`);
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

async function main() {
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
    if (command === 'help' || command === '--help' || command === '-h' || flags.help) {
      showHelp();
      process.exit(0);
    }

    if (command && !command.startsWith('-')) {
      if (!flags.config && !flags.c) {
        flags.config = command;
      }
    }

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
