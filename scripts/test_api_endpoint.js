/**
 * Flexible WebUntis API Endpoint Tester
 *
 * Tests arbitrary WebUntis REST API endpoints using existing auth infrastructure.
 * Useful for exploring new endpoints without fully integrating them.
 *
 * All API responses are automatically saved to debug_dumps/ directory with metadata.
 *
 * Usage:
 *   node scripts/test_api_endpoint.js <path> [queryParams] [options]
 *
 * Examples:
 *   # Simple path with inline query params
 *   node scripts/test_api_endpoint.js "/WebUntis/api/rest/view/v2/calendar-entry/detail?elementId=7211&elementType=5&startDateTime=2026-03-16T07:50:00&endDateTime=2026-03-16T09:35:00"
 *
 *   # Path with ID in URL
 *   node scripts/test_api_endpoint.js "/WebUntis/api/rest/view/v2/calendar-entry/733133/detail?homeworkOption=DUE"
 *
 *   # Separate query params (optional)
 *   node scripts/test_api_endpoint.js "/WebUntis/api/rest/view/v2/calendar-entry/detail" "elementId=7211&elementType=5"
 *
 *   # Output raw JSON to stdout (dump still saved to debug_dumps/)
 *   node scripts/test_api_endpoint.js "/api/rest/view/v2/calendar-entry/733133/detail" "" --raw > output.json
 *
 * Options:
 *   --debug       Enable detailed debug output
 *   --student=N   Use specific student index (0-based) from students array
 *   --raw         Output raw JSON only (no formatting)
 */

const fs = require('node:fs');
const path = require('node:path');
const AuthService = require('../lib/webuntis/authService');
const { callRestAPI } = require('../lib/webuntis/restClient');

// Parse CLI arguments
const args = process.argv.slice(2);
const options = {
  debug: args.includes('--debug'),
  raw: args.includes('--raw'),
  studentIndex: null,
};

// Extract --student=N
const studentArg = args.find((arg) => arg.startsWith('--student='));
if (studentArg) {
  options.studentIndex = parseInt(studentArg.split('=')[1], 10);
}

// Filter out option flags
const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
const apiPath = positionalArgs[0];
const queryParams = positionalArgs[1] || '';

if (!apiPath) {
  console.error('Usage: node scripts/test_api_endpoint.js <path> [queryParams] [options]');
  console.error('');
  console.error('Examples:');
  console.error('  node scripts/test_api_endpoint.js "/WebUntis/api/rest/view/v2/calendar-entry/733133/detail?homeworkOption=DUE"');
  console.error('  node scripts/test_api_endpoint.js "/api/rest/view/v2/calendar-entry/detail" "elementId=7211&elementType=5" --debug');
  console.error('');
  console.error('Options:');
  console.error('  --debug       Enable detailed debug output');
  console.error('  --student=N   Use specific student index (0-based)');
  console.error('  --raw         Output raw JSON only');
  throw new Error('Missing required argument: <path>');
}

// Logger function
function log(level, message) {
  if (!options.raw) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }
}

function debugLog(message) {
  if (options.debug) {
    log('debug', message);
  }
}

// Load config
const configPath = path.join(__dirname, '../config/config.js');
if (!fs.existsSync(configPath)) {
  throw new Error(`Config file not found: ${configPath}. Please create config/config.js from config/config.template.js`);
}

debugLog(`Loading config from ${configPath}`);

// Load the config file which exports a MagicMirror config object
const configExport = require(configPath);
const mmConfig = configExport.config || configExport;

// Find MMM-Webuntis module config
const webuntisModule = mmConfig.modules?.find((m) => m.module === 'MMM-Webuntis');
if (!webuntisModule) {
  throw new Error('MMM-Webuntis module not found in config.js');
}

const config = webuntisModule.config;
debugLog('Config loaded successfully');

// Parse query params from string
function parseQueryParams(queryString) {
  if (!queryString) return {};

  const params = {};
  queryString.split('&').forEach((pair) => {
    const [key, value] = pair.split('=');
    if (key) {
      params[key] = decodeURIComponent(value || '');
    }
  });
  return params;
}

// Extract query params from path if present
function splitPathAndQuery(fullPath) {
  const [path, query] = fullPath.split('?');
  return { path, query: query || '' };
}

// Generate endpoint name for filename from path
function getEndpointName(path) {
  // Extract meaningful parts from path
  // e.g., "/WebUntis/api/rest/view/v2/calendar-entry/detail" -> "calendar-entry-detail"
  const parts = path.split('/').filter(Boolean);
  const relevantParts = parts.slice(-3); // Take last 3 parts
  return relevantParts.join('-').replace(/[^a-zA-Z0-9-]/g, '_');
}

// Save API response to debug_dumps directory (like MMM module dumps)
function saveToDumpFile(endpoint, params, response, authConfig, elapsed) {
  const dumpDir = path.join(__dirname, '../debug_dumps');

  // Create directory if it doesn't exist
  if (!fs.existsSync(dumpDir)) {
    fs.mkdirSync(dumpDir, { recursive: true });
  }

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // Remove milliseconds
  const endpointName = getEndpointName(endpoint);
  const filename = `${timestamp}_${endpointName}_api-test.json`;
  const filePath = path.join(dumpDir, filename);

  // Build dump payload similar to MMM module structure
  const dumpData = {
    metadata: {
      timestamp: new Date().toISOString(),
      endpoint,
      params,
      status: response.status,
      duration: `${elapsed}ms`,
      studentConfig: {
        school: authConfig.school,
        server: authConfig.server,
        studentId: authConfig.studentId || null,
        username: authConfig.username ? '***' : null,
      },
    },
    response: response.data,
  };

  // Write to file
  fs.writeFileSync(filePath, JSON.stringify(dumpData, null, 2), 'utf8');

  return path.relative(process.cwd(), filePath);
}

async function main() {
  try {
    // Split path and inline query params
    const { path: cleanPath, query: inlineQuery } = splitPathAndQuery(apiPath);

    // Merge inline query params with provided query params
    const allQueryParams = {
      ...parseQueryParams(inlineQuery),
      ...parseQueryParams(queryParams),
    };

    log('info', `Testing endpoint: ${cleanPath}`);
    if (Object.keys(allQueryParams).length > 0) {
      debugLog(`Query params: ${JSON.stringify(allQueryParams, null, 2)}`);
    }

    // Determine which student config to use
    let studentConfig;
    let authConfig = {};

    if (config.students && config.students.length > 0) {
      const index = options.studentIndex ?? 0;
      if (index >= config.students.length) {
        throw new Error(`Student index ${index} out of range (0-${config.students.length - 1})`);
      }
      studentConfig = config.students[index];
      log('info', `Using student config (index ${index}): ${studentConfig.title || studentConfig.name || 'unnamed'}`);

      // Merge global config with student-specific config
      authConfig = {
        username: studentConfig.username || config.username,
        password: studentConfig.password || config.password,
        school: studentConfig.school || config.school,
        server: studentConfig.server || config.server,
        qrCodeUrl: studentConfig.qrCodeUrl || studentConfig.qrcode,
        studentId: studentConfig.studentId,
      };
    } else {
      // Single student mode
      studentConfig = config;
      log('info', 'Using single-student config');
      authConfig = {
        username: config.username,
        password: config.password,
        school: config.school,
        server: config.server,
        qrCodeUrl: config.qrCodeUrl || config.qrcode,
        studentId: config.studentId,
      };
    }

    debugLog(
      `Auth config: username=${authConfig.username ? '***' : 'none'}, school=${authConfig.school}, server=${authConfig.server}, studentId=${authConfig.studentId || 'none'}`
    );

    // Initialize AuthService
    debugLog('Initializing AuthService...');
    const authService = new AuthService({
      logger: (level, msg) => {
        if (options.debug || level === 'error' || level === 'warn') {
          log(level, msg);
        }
      },
    });

    // Prepare getAuth function
    const getAuth = async () => {
      const authResult = await authService.getAuth(authConfig);

      debugLog('Authentication successful');
      debugLog(`  Token: ${authResult.token?.substring(0, 20)}...`);
      debugLog(`  Server: ${authResult.server}`);
      debugLog(`  Tenant ID: ${authResult.tenantId}`);
      debugLog(`  School Year ID: ${authResult.schoolYearId}`);
      debugLog(`  Person ID: ${authResult.personId}`);

      return authResult;
    };

    // Get auth
    log('info', 'Authenticating...');
    const auth = await getAuth();
    log('info', '✓ Authentication successful');

    // Make API call
    log('info', 'Calling API endpoint...');
    const startTime = Date.now();

    const response = await callRestAPI({
      server: auth.server || authConfig.server,
      path: cleanPath,
      method: 'GET',
      params: allQueryParams,
      token: auth.token,
      cookies: auth.cookieString,
      tenantId: auth.tenantId,
      schoolYearId: auth.schoolYearId,
      logger: options.debug ? log : null,
      debugApi: options.debug,
    });

    const elapsed = Date.now() - startTime;
    log('info', `✓ API call completed (${elapsed}ms)`);
    log('info', `  Status: ${response.status}`);

    // Save response to debug_dumps directory
    const dumpPath = saveToDumpFile(cleanPath, allQueryParams, response, authConfig, elapsed);
    log('info', `  Saved: ${dumpPath}`);

    // Output response
    if (options.raw) {
      // Raw JSON output (for piping to file)
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      // Formatted output with metadata
      console.log(`\n${'='.repeat(80)}`);
      console.log('API RESPONSE');
      console.log('='.repeat(80));
      console.log(`Endpoint: ${cleanPath}`);
      console.log(`Status:   ${response.status}`);
      console.log(`Duration: ${elapsed}ms`);
      if (Object.keys(allQueryParams).length > 0) {
        console.log(`Params:   ${JSON.stringify(allQueryParams)}`);
      }
      console.log('='.repeat(80));
      console.log('\nResponse Data:');
      console.log(JSON.stringify(response.data, null, 2));
      console.log(`\n${'='.repeat(80)}`);

      // Analysis hints
      if (response.data && typeof response.data === 'object') {
        console.log('\n📊 Response Analysis:');
        if (Array.isArray(response.data)) {
          console.log(`  - Array with ${response.data.length} items`);
        } else {
          const keys = Object.keys(response.data);
          console.log(`  - Object with ${keys.length} keys: ${keys.join(', ')}`);

          // Special analysis for calendar-entry responses
          if (response.data.calendarEntries) {
            const entries = response.data.calendarEntries;
            console.log(`  - Contains ${entries.length} calendar entries`);
            if (entries.length > 0) {
              const first = entries[0];
              console.log(`  - First entry spans: ${first.startDateTime} to ${first.endDateTime}`);
              if (first.singleEntries) {
                console.log(`  - First entry has ${first.singleEntries.length} single entries (sub-periods)`);
              }
              if (first.homeworks && first.homeworks.length > 0) {
                console.log(`  - First entry has ${first.homeworks.length} homework items`);
              }
            }
          }
        }
      }

      // Suggest next steps
      console.log('\n💡 Next Steps:');
      console.log(`  - Dump saved to: ${dumpPath}`);
      console.log('  - To test different student: node scripts/test_api_endpoint.js <path> "" --student=1');
      console.log('  - To see detailed logs: node scripts/test_api_endpoint.js <path> "" --debug');
    }
  } catch (error) {
    log('error', `Failed to test endpoint: ${error.message}`);
    if (options.debug) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    throw error;
  }
}

main().catch((error) => {
  // Final error handler for uncaught errors
  if (!options.raw) {
    console.error(`\n❌ Fatal error: ${error.message}`);
  }
  process.exit(1);
});
