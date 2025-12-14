const fs = require('fs');
const path = require('path');
const process = require('process');
const readline = require('readline');
const { stdin: input, stdout: output } = require('process');

const { WebUntis } = require('webuntis');
const { WebUntisQR } = require('webuntis');
const { URL } = require('url');
const Authenticator = require('otplib').authenticator;

function formatErr(err) {
  if (!err) return '(no error)';
  return err && err.message ? err.message : String(err);
}

function resolveConfigPathFromArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  const cfgIdx = args.findIndex((a) => a === '--config' || a === '-c');
  if (cfgIdx >= 0 && args[cfgIdx + 1]) return args[cfgIdx + 1];
  // allow positional
  const firstPositional = args.find((a) => !String(a).startsWith('-'));
  if (firstPositional) return firstPositional;

  // common MagicMirror locations relative to MMM-Webuntis folder
  const candidates = ['../../config/config.js', '../../config.js', '../config/config.js', '../config.js'];
  for (const rel of candidates) {
    const abs = path.resolve(__dirname, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function ask(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(String(answer ?? '')));
  });
}

function loadMagicMirrorConfig(fileName) {
  if (!fileName) throw new Error('No config file provided. Use --config <path>.');
  const filePath = path.isAbsolute(fileName) ? fileName : path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) throw new Error(`Config file not found: ${filePath}`);

  // Ensure we reload on each invocation
  try {
    delete require.cache[require.resolve(filePath)];
  } catch {
    // ignore
  }

  const cfg = require(filePath);
  if (!cfg || typeof cfg !== 'object') throw new Error(`Config did not export an object: ${filePath}`);
  if (!Array.isArray(cfg.modules)) throw new Error(`Config has no 'modules' array: ${filePath}`);
  return { cfg, filePath };
}

function mergeStudentConfig(moduleCfg, studentCfg) {
  const props = [
    'daysToShow',
    'pastDaysToShow',
    'useClassTimetable',
    'showRegularLessons',
    'showStartTime',
    'showTeacherMode',
    'useShortSubject',
    'showSubstitutionText',
    'examsDaysAhead',
    'showExamSubject',
    'showExamTeacher',
    'fetchHomeworks',
  ];
  const out = { ...studentCfg };
  props.forEach((p) => {
    if (out[p] === undefined) out[p] = moduleCfg?.[p];
  });
  return out;
}

function validateStudent(student) {
  const problems = [];
  if (!student) {
    problems.push('student is missing');
    return problems;
  }
  const hasQr = Boolean(student.qrcode);
  const hasUser = Boolean(student.username) && Boolean(student.password) && Boolean(student.school) && Boolean(student.server);
  if (!hasQr && !hasUser) {
    problems.push('missing credentials (need qrcode or username+password+school+server)');
  }
  return problems;
}

function createUntisClient(student) {
  if (student.qrcode) {
    return new WebUntisQR(student.qrcode, 'mmm-webuntis-cli', Authenticator, URL);
  }
  return new WebUntis(student.school, student.username, student.password, student.server);
}

function ymdFromDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatTime(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (s.includes(':')) return s;
  const digits = s.replace(/\D/g, '').padStart(4, '0');
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}

async function promptInt(rl, prompt, { min = 0, max = Number.POSITIVE_INFINITY, defaultValue = null } = {}) {
  while (true) {
    const ans = (await ask(rl, prompt)).trim();
    if (ans === '' && defaultValue !== null && defaultValue !== undefined) return defaultValue;
    if (ans.toLowerCase() === 'q') return null;
    const n = Number(ans);
    if (Number.isFinite(n) && n >= min && n <= max) return Math.floor(n);
    console.log(`Please enter a number between ${min} and ${max} (or 'q' to quit).`);
  }
}

async function showTimetableToday(untis, student) {
  const today = new Date();
  const rangeStart = new Date(today);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + 1);
  const todayStr = ymdFromDate(rangeStart);

  let lessons = [];
  if (student.useClassTimetable) {
    lessons = await untis.getOwnClassTimetableForRange(rangeStart, rangeEnd);
  } else {
    lessons = await untis.getOwnTimetableForRange(rangeStart, rangeEnd);
  }
  lessons = Array.isArray(lessons) ? lessons : [];
  lessons = lessons.filter((l) => String(l.date) === todayStr).sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));

  const showRegular = Boolean(student.showRegularLessons);
  if (!showRegular) {
    lessons = lessons.filter((l) => {
      const code = (l.code || '').toLowerCase();
      if (code && code !== 'regular') return true;
      if ((l.substText || '').trim() !== '') return true;
      if ((l.lstext || '').trim() !== '') return true;
      return false;
    });
  }

  if (lessons.length === 0) {
    console.log('No lessons found for today (with current filters).');
    return;
  }
  console.log(`\nTimetable for today (${todayStr}) - ${student.title || ''}`);
  lessons.forEach((l) => {
    const subj = l.su?.[0]?.name || l.su?.[0]?.longname || 'N/A';
    const teacher = l.te?.[0]?.name || l.te?.[0]?.longname || '';
    const code = l.code ? String(l.code) : '';
    const extra = [l.substText, l.lstext].filter((x) => x && String(x).trim() !== '').join(' | ');
    console.log(
      `- ${formatTime(l.startTime)}-${formatTime(l.endTime)} ${subj}${teacher ? ` (${teacher})` : ''}${code ? ` [${code}]` : ''}${
        extra ? ` :: ${extra}` : ''
      }`
    );
  });
}

async function showExams(untis, student, rl) {
  const now = new Date();
  const defaultDays = Number(student.examsDaysAhead) > 0 ? Number(student.examsDaysAhead) : 30;
  const days = await promptInt(rl, `Days ahead for exams? (default ${defaultDays}, 'q' cancels): `, {
    min: 1,
    max: 360,
    defaultValue: defaultDays,
  });
  if (days === null) return;

  const rangeStart = new Date(now);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + days);

  let exams = await untis.getExamsForRange(rangeStart, rangeEnd);
  exams = Array.isArray(exams) ? exams : [];
  exams.sort((a, b) => (Number(a.examDate) || 0) - (Number(b.examDate) || 0) || (Number(a.startTime) || 0) - (Number(b.startTime) || 0));

  if (exams.length === 0) {
    console.log('No exams found in range.');
    return;
  }

  console.log(`\nExams (next ${days} day(s)) - ${student.title || ''}`);
  exams.forEach((e) => {
    const dt = String(e.examDate || '');
    const dateFmt = dt.length === 8 ? `${dt.slice(6, 8)}.${dt.slice(4, 6)}.${dt.slice(0, 4)}` : dt;
    const st = formatTime(e.startTime);
    const subj = e.subject ? String(e.subject) : '';
    const name = e.name ? String(e.name) : '';
    const t = Array.isArray(e.teachers) && e.teachers.length > 0 ? String(e.teachers[0]) : '';
    const line = `${dateFmt}${st ? ` ${st}` : ''} ${subj ? subj + ': ' : ''}${name}${t ? ` (${t})` : ''}`;
    console.log(`- ${line.trim()}`);
    if (e.text) console.log(`  ${String(e.text).trim()}`);
  });
}

async function showHomeworks(untis, student, rl) {
  const defaultDays = 14;
  const days = await promptInt(rl, `Days ahead for homeworks? (default ${defaultDays}, 'q' cancels): `, {
    min: 1,
    max: 120,
    defaultValue: defaultDays,
  });
  if (days === null) return;

  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + days);

  let hwResult = null;
  const candidates = [() => untis.getHomeWorkAndLessons(rangeStart, rangeEnd), () => untis.getHomeWorksFor(rangeStart, rangeEnd)];
  let lastErr = null;
  for (const fn of candidates) {
    try {
      hwResult = await fn();
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (hwResult === null) throw lastErr || new Error('Homework fetch failed');

  const homeworks = Array.isArray(hwResult)
    ? hwResult
    : Array.isArray(hwResult?.homeworks)
      ? hwResult.homeworks
      : Array.isArray(hwResult?.homework)
        ? hwResult.homework
        : [];
  if (!Array.isArray(homeworks) || homeworks.length === 0) {
    console.log('No homeworks found in range.');
    return;
  }
  homeworks.sort((a, b) => (Number(a.dueDate) || 0) - (Number(b.dueDate) || 0) || (Number(a.date) || 0) - (Number(b.date) || 0));

  console.log(`\nHomeworks (next ${days} day(s)) - ${student.title || ''}`);
  homeworks.forEach((h) => {
    const due = String(h.dueDate || '');
    const dueFmt = due.length === 8 ? `${due.slice(6, 8)}.${due.slice(4, 6)}.${due.slice(0, 4)}` : due;
    const subj = h.su?.name || h.su?.longname || h.su?.[0]?.name || h.su?.[0]?.longname || '';
    const text = (h.text || h.remark || '').toString().trim();
    console.log(`- ${dueFmt}${subj ? ` ${subj}` : ''}${h.completed ? ' [done]' : ''}`);
    if (text) console.log(`  ${text}`);
  });
}

async function showAbsences(untis, student, rl) {
  const defaultBack = 30;
  const daysBack = await promptInt(rl, `Show absences for how many days back? (default ${defaultBack}, 'q' cancels): `, {
    min: 1,
    max: 365,
    defaultValue: defaultBack,
  });
  if (daysBack === null) return;

  const rangeEnd = new Date();
  rangeEnd.setHours(23, 59, 59, 999);
  const rangeStart = new Date(rangeEnd);
  rangeStart.setDate(rangeStart.getDate() - daysBack);
  rangeStart.setHours(0, 0, 0, 0);

  if (typeof untis.getAbsentLesson !== 'function') {
    console.log('Absences API not available in this webuntis version.');
    return;
  }

  const res = await untis.getAbsentLesson(rangeStart, rangeEnd);
  const absences = Array.isArray(res?.absences) ? res.absences : [];
  if (absences.length === 0) {
    console.log('No absences found in range.');
    return;
  }

  absences.sort(
    (a, b) => (Number(a.startDate) || 0) - (Number(b.startDate) || 0) || (Number(a.startTime) || 0) - (Number(b.startTime) || 0)
  );
  console.log(`\nAbsences (last ${daysBack} day(s)) - ${student.title || ''}`);
  absences.forEach((a) => {
    const sd = String(a.startDate || '');
    const ed = String(a.endDate || '');
    const sFmt = sd.length === 8 ? `${sd.slice(6, 8)}.${sd.slice(4, 6)}.${sd.slice(0, 4)}` : sd;
    const eFmt = ed.length === 8 ? `${ed.slice(6, 8)}.${ed.slice(4, 6)}.${ed.slice(0, 4)}` : ed;
    const st = formatTime(a.startTime);
    const et = formatTime(a.endTime);
    const reason = a.reason ? String(a.reason) : '';
    const exc = a.isExcused ? 'excused' : 'unexcused';
    const line = `${sFmt}${st ? ` ${st}` : ''}${eFmt && eFmt !== sFmt ? ` - ${eFmt}` : ''}${et ? ` ${et}` : ''} ${exc}${reason ? ` :: ${reason}` : ''}`;
    console.log(`- ${line.trim()}`);
    if (a.text) console.log(`  ${String(a.text).trim()}`);
  });
}

async function main() {
  const configPath = resolveConfigPathFromArgs(process.argv);
  const { cfg, filePath } = loadMagicMirrorConfig(configPath);

  const webuntisModules = cfg.modules.filter((m) => m && m.module === 'MMM-Webuntis');
  if (webuntisModules.length === 0) {
    throw new Error(`No MMM-Webuntis modules found in config: ${filePath}`);
  }

  const entries = [];
  webuntisModules.forEach((m, moduleIndex) => {
    const moduleCfg = m.config || {};
    const students = Array.isArray(moduleCfg.students) ? moduleCfg.students : [];
    students.forEach((s, studentIndex) => {
      const merged = mergeStudentConfig(moduleCfg, s);
      const problems = validateStudent(merged);
      const credType = merged.qrcode ? 'qrcode' : merged.username ? 'userpass' : 'missing';
      entries.push({
        idx: entries.length,
        moduleIndex,
        studentIndex,
        modulePosition: m.position || '',
        moduleHeader: m.header || '',
        title: merged.title || `students[${studentIndex}]`,
        credType,
        student: merged,
        problems,
      });
    });
  });

  console.log(`Loaded config: ${filePath}`);
  console.log(`Found MMM-Webuntis module instances: ${webuntisModules.length}`);
  console.log(`Found students (duplicates allowed): ${entries.length}\n`);

  entries.forEach((e) => {
    const where = `module#${e.moduleIndex}${e.modulePosition ? ` ${e.modulePosition}` : ''}${e.moduleHeader ? ` "${e.moduleHeader}"` : ''}`;
    const prob = e.problems.length > 0 ? ` [INVALID: ${e.problems.join('; ')}]` : '';
    console.log(`${e.idx}: ${e.title} (${e.credType}) @ ${where}${prob}`);
  });

  const rl = readline.createInterface({ input, output });
  try {
    const selectedIdx = await promptInt(rl, `\nSelect student by number (0-${entries.length - 1}, 'q' quits): `, {
      min: 0,
      max: entries.length - 1,
    });
    if (selectedIdx === null) return;
    const selected = entries[selectedIdx];
    if (!selected) throw new Error('Invalid selection');
    if (selected.problems.length > 0) throw new Error(`Selected student config invalid: ${selected.problems.join('; ')}`);

    const student = selected.student;
    const untis = createUntisClient(student);
    console.log(`\nLogging in for ${student.title || ''}...`);
    await untis.login();
    console.log('Login ok.');

    while (true) {
      console.log('\nWhat do you want to display?');
      console.log('1) Current timetable (today, with changes)');
      console.log('2) Next exams');
      console.log('3) Homeworks');
      console.log('4) Absences');
      console.log('0) Exit');

      const action = await promptInt(rl, 'Choice: ', { min: 0, max: 4 });
      if (action === null || action === 0) break;

      try {
        if (action === 1) await showTimetableToday(untis, student);
        else if (action === 2) await showExams(untis, student, rl);
        else if (action === 3) await showHomeworks(untis, student, rl);
        else if (action === 4) await showAbsences(untis, student, rl);
      } catch (e) {
        console.error('Error:', formatErr(e));
      }
    }

    try {
      await untis.logout();
    } catch (e) {
      console.error('Logout error:', formatErr(e));
    }
  } finally {
    rl.close();
  }
}

main().catch((e) => {
  console.error(formatErr(e));
  process.exitCode = 1;
});
