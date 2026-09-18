/**
 * Student auto-discovery for parent accounts (app/data `user.students[]`).
 *
 * Handles three scenarios:
 *   1. No students configured -> discover all children of the parent account
 *   2. Students with IDs but no titles -> fill in missing titles
 *   3. Students with titles but no IDs -> assign the ID when exactly one child matches
 *
 * Also merges module-level defaults into each student config for consistent behavior.
 */

const { ALL_WIDGETS } = require('./moduleConfig');
const { getParentAuthResult } = require('./authSession');

function isConfiguredStudentCandidate(student) {
  if (!student || typeof student !== 'object') return false;
  const hasStudentId = student.studentId !== undefined && student.studentId !== null && String(student.studentId).trim() !== '';
  const hasQr = Boolean(student.qrcode);
  const hasCreds = Boolean(student.username && student.password);
  const hasTitle = Boolean(student.title && String(student.title).trim() !== '');
  return hasStudentId || hasQr || hasCreds || hasTitle;
}

function candidateStudentIdsFor(configStudent, autoStudents) {
  const matches = configStudent.title
    ? autoStudents.filter((a) => (a.title || '').toLowerCase().includes(String(configStudent.title).toLowerCase()))
    : [];
  return (matches.length > 0 ? matches : autoStudents).map((s) => Number(s.studentId));
}

/**
 * Merge module-level defaults into student configurations (without copying parent credentials).
 *
 * @param {Object} moduleConfig - Module configuration
 * @param {Array} students - Student configuration array
 * @param {Object} [options]
 * @param {boolean} [options.markAutoDiscovered=false] - Mark each student as auto-discovered
 * @returns {Array} Normalized student configurations
 */
function mergeModuleDefaultsIntoStudents(moduleConfig, students, options = {}) {
  const { markAutoDiscovered = false } = options;
  const defaults = { ...(moduleConfig || {}) };
  delete defaults.students;
  // Don't copy parent credentials into student configs to avoid confusion in createAuthSession
  delete defaults.username;
  delete defaults.password;
  delete defaults.school;
  delete defaults.server;

  return (Array.isArray(students) ? students : []).map((student) => {
    const inputStudent = markAutoDiscovered ? { ...(student || {}), _autoDiscovered: true } : student || {};
    const merged = { ...defaults, ...inputStudent };
    ALL_WIDGETS.forEach((widget) => {
      merged[widget] = { ...(defaults[widget] || {}), ...(inputStudent[widget] || {}) };
    });
    if (typeof merged.displayMode === 'string') merged.displayMode = merged.displayMode.toLowerCase();
    return merged;
  });
}

function enhanceConfiguredStudent(configStudent, autoStudents, logger) {
  if (!configStudent || typeof configStudent !== 'object') return;

  if (configStudent.studentId && !configStudent.title) {
    const autoStudent = autoStudents.find((auto) => Number(auto.studentId) === Number(configStudent.studentId));
    if (autoStudent) {
      configStudent.title = autoStudent.title;
      logger('debug', configStudent, `Filled in auto-discovered name: "${autoStudent.title}" for studentId ${configStudent.studentId}`);
    }
    return;
  }

  if ((!configStudent.studentId || configStudent.studentId === '') && configStudent.title) {
    const candidateIds = candidateStudentIdsFor(configStudent, autoStudents);
    if (candidateIds.length === 1) {
      configStudent.studentId = candidateIds[0];
      configStudent._autoDiscovered = true;
      delete configStudent.username;
      delete configStudent.password;
      delete configStudent.school;
      delete configStudent.server;
      logger('debug', configStudent, `Auto-assigned studentId=${candidateIds[0]} for "${configStudent.title}" (only match found)`);
    } else {
      const msg = `Student with title "${configStudent.title}" has no studentId configured. Possible studentIds: ${candidateIds.join(', ')}.`;
      configStudent.__warnings = configStudent.__warnings || [];
      configStudent.__warnings.push(msg);
      logger('warn', configStudent, msg);
    }
  }
}

function validateConfiguredStudentIds(configuredStudents, autoStudents, logger) {
  if (!autoStudents || autoStudents.length === 0) return;
  configuredStudents.forEach((configStudent) => {
    if (!configStudent?.studentId) return;
    const match = autoStudents.find((a) => Number(a.studentId) === Number(configStudent.studentId));
    if (match) return;
    const candidateIds = candidateStudentIdsFor(configStudent, autoStudents);
    const msg = `Configured studentId ${configStudent.studentId} for title "${configStudent.title || ''}" was not found in auto-discovered students. Possible studentIds: ${candidateIds.join(', ')}.`;
    configStudent.__warnings = configStudent.__warnings || [];
    configStudent.__warnings.push(msg);
    logger('warn', configStudent, msg);
  });
}

/**
 * Auto-discover students from the parent account and merge module defaults into every student.
 * Modifies `moduleConfig.students` in place; never throws (discovery is best effort).
 *
 * @param {Object} moduleConfig - Module configuration
 * @param {Object} deps
 * @param {import('./webuntis/authService')} deps.authService - Shared auth service
 * @param {Function} deps.logger - (level, student, message) logger
 * @param {Function} deps.formatError - Error formatter
 * @returns {Promise<void>}
 */
async function ensureStudentsFromAppData(moduleConfig, { authService, logger, formatError }) {
  try {
    if (!moduleConfig || typeof moduleConfig !== 'object') return;
    if (moduleConfig._moduleDefaultsMerged) return;

    const configuredStudents = (Array.isArray(moduleConfig.students) ? moduleConfig.students : []).filter(isConfiguredStudentCandidate);
    const hasParentCreds = Boolean((moduleConfig.username && moduleConfig.password && moduleConfig.school) || moduleConfig.qrcode);
    const server = moduleConfig.server || 'webuntis.com';

    if (configuredStudents.length > 0) {
      if (hasParentCreds) {
        try {
          const authResult = await getParentAuthResult(authService, moduleConfig, server);
          const autoStudents = authService.deriveStudentsFromAppData(authResult.appData);
          if (autoStudents.length > 0) {
            configuredStudents.forEach((configStudent) => {
              enhanceConfiguredStudent(configStudent, autoStudents, logger);
            });
          }
          validateConfiguredStudentIds(configuredStudents, autoStudents, logger);
        } catch (err) {
          logger(
            'warn',
            null,
            `Could not fetch auto-discovered names for title fallback (server=${server}). Is the WebUntis server reachable? ${formatError(err)}`
          );
        }
      }

      moduleConfig.students = mergeModuleDefaultsIntoStudents(moduleConfig, moduleConfig.students);
      moduleConfig._moduleDefaultsMerged = true;
      logger('debug', null, `✓ Module defaults merged into ${moduleConfig.students.length} configured student(s)`);
      return;
    }

    if (!hasParentCreds) return;

    const authResult = await getParentAuthResult(authService, moduleConfig, server);
    const autoStudents = authService.deriveStudentsFromAppData(authResult.appData);
    if (!autoStudents || autoStudents.length === 0) {
      logger('warn', null, 'No students discovered via app/data; please configure students[] manually');
      return;
    }

    moduleConfig.students = mergeModuleDefaultsIntoStudents(moduleConfig, autoStudents, { markAutoDiscovered: true });
    moduleConfig._autoStudentsAssigned = true;
    moduleConfig._moduleDefaultsMerged = true;
    const studentList = moduleConfig.students.map((s) => `• ${s.title} (ID: ${s.studentId})`).join('\n  ');
    logger('debug', null, `✓ Auto-discovered ${moduleConfig.students.length} student(s):\n  ${studentList}`);
  } catch (err) {
    logger('warn', null, `Auto student discovery failed: ${formatError(err)}`);
  }
}

module.exports = {
  ensureStudentsFromAppData,
  mergeModuleDefaultsIntoStudents,
};
