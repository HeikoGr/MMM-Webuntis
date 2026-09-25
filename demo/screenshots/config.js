/**
 * MagicMirror config for the README/wiki screenshots - see docs/SCREENSHOTS.md.
 *
 * One MMM-Webuntis instance per screenshot, all rendering the demo fixtures. In demo mode the
 * widgets follow this config just like live data does, so each instance sets the options it shows.
 * scripts/take-screenshots.mjs starts a throwaway MagicMirror with this file and shoots every
 * instance with the class `shot-<id>`.
 */
const AVERY = "demo/fixtures/single-student-week.json";
const ROBIN = "demo/fixtures/sibling-week.json";

const grid = (config = {}) => ({
  enabled: true,
  config: {
    nextDays: 2,
    pastDays: 0,
    mergeGap: 10,
    maxLessons: 8,
    fields: { primary: "subject", secondary: "teacher", additional: ["room"] },
    ...config,
  },
});
const lessons = (config = {}) => ({
  enabled: true,
  config: {
    nextDays: 2,
    dateFormat: "EEE dd.MM.",
    showRegular: true,
    showRoom: true,
    showSubstitution: true,
    ...config,
  },
});
const exams = { enabled: true, config: { nextDays: 21 } };
const homework = { enabled: true, config: { nextDays: 21 } };
const absences = { enabled: true, config: { pastDays: 7, nextDays: 14, maxItems: 10 } };
const messagesofday = { enabled: true, config: {} };

const shot = (id, plugins, config = {}) => ({
  module: "MMM-Webuntis",
  position: "top_left",
  classes: `shot shot-${id}`,
  config: {
    demoDataFile: AVERY,
    debugDate: "2026-09-30",
    mode: "verbose",
    // plugins.<id>.enabled replaces displayMode; list only what the screenshot shows
    displayMode: Object.keys(plugins).join(", "),
    plugins,
    ...config,
  },
});

const config = {
  address: "localhost",
  port: 8081,
  basePath: "/",
  ipWhitelist: [],
  language: "en",
  locale: "en-US",
  timeFormat: 24,
  logLevel: ["INFO", "WARN", "ERROR"],
  modules: [
    shot("main", { messagesofday, grid: grid(), exams, homework, absences }),
    shot("grid", { grid: grid({ weekView: true }) }),
    shot("lessons", { lessons: lessons() }),
    shot("ehA", { exams, homework, absences }),
    shot("mod", { messagesofday }),
    // Saturday before the autumn break: weekend and holiday notices instead of lessons.
    shot("notices", { grid: grid() }, { debugDate: "2026-10-10" }),
    // Two children in one module; compact mode prefixes each row with the child's name.
    shot(
      "compact",
      { lessons: lessons({ showRegular: false }), exams, homework: { enabled: true, config: { nextDays: 7 } } },
      {
        demoDataFile: `${AVERY}, ${ROBIN}`,
        mode: "compact",
        students: [{ title: "Avery Finch" }, { title: "Robin Finch" }],
      },
    ),
  ],
};

if (typeof module !== "undefined") {
  module.exports = config;
}
