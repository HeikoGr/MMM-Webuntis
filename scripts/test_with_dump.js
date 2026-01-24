/**
 * Test Grid Rendering with Debug Dump Data
 *
 * Usage: node scripts/test_with_dump.js debug_dumps/debug_api.json
 *
 * This script loads a debug dump and injects it into the frontend for visual testing.
 * Opens a local HTTP server that serves the MagicMirror module with the dump data.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const dumpPath = process.argv[2] || 'debug_dumps/debug_api.json';
const port = 8888;

if (!fs.existsSync(dumpPath)) {
  throw new Error(`Dump file not found: ${dumpPath}`);
}

const dumpData = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MMM-Webuntis Grid Test</title>
  <link rel="stylesheet" href="/MMM-Webuntis.css">
  <style>
    body {
      background: #000;
      color: #fff;
      font-family: "Roboto", sans-serif;
      padding: 20px;
    }
    .test-header {
      background: #222;
      padding: 10px;
      margin-bottom: 20px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="test-header">
    <h2>Grid Rendering Test: ${dumpData.title || 'Unknown Student'}</h2>
    <p>Data from: <code>${dumpPath}</code></p>
    <p>Fetched: ${dumpData.meta?.fetchedAt || 'Unknown'}</p>
  </div>
  <div class="MMM-Webuntis" id="module-container"></div>

  <script>
    // Inject dump data
    window.TEST_DUMP_DATA = ${JSON.stringify(dumpData)};

    // Mock Date to use the first lesson's date from dump data
    // This ensures the grid shows the correct date range
    (function() {
      const lessonDate = window.TEST_DUMP_DATA.timetableRange?.[0]?.date;
      if (lessonDate) {
        const dateStr = String(lessonDate); // e.g., "20260123"
        const year = parseInt(dateStr.substring(0, 4), 10);
        const month = parseInt(dateStr.substring(4, 6), 10) - 1; // 0-indexed
        const day = parseInt(dateStr.substring(6, 8), 10);

        const mockDate = new Date(year, month, day, 10, 0, 0); // 10:00 AM on lesson date
        const RealDate = Date;

        window.Date = class extends RealDate {
          constructor(...args) {
            if (args.length === 0) {
              super(mockDate.getTime());
            } else {
              super(...args);
            }
          }

          static now() {
            return mockDate.getTime();
          }
        };

        console.log(\`📅 Date mocked to: \${mockDate.toISOString().split('T')[0]}\`);
      }
    })();
  </script>
  <script src="/widgets/util.js"></script>
  <script src="/widgets/grid.js"></script>
  <script>
    // Initialize and render
    const container = document.getElementById('module-container');

    // Mock context
    const ctx = {
      identifier: 'MMM-Webuntis-test',
      name: 'MMM-Webuntis',
      config: window.TEST_DUMP_DATA.config,
      translate: (key) => {
        const de = {
          'break_supervision': 'Pausenaufsicht'
        };
        return de[key] || key;
      },
      _toMinutes: window.MMMWebuntisWidgets.util.toMinutes,
      _hasWidget: (name) => name === 'grid',
      _getWidgetApi: () => window.MMMWebuntisWidgets,
    };

    // Render grid widget
    if (window.MMMWebuntisWidgets?.grid?.renderGridForStudent) {
      const title = window.TEST_DUMP_DATA.title;
      const config = ctx.config;
      const timetable = window.TEST_DUMP_DATA.timetableRange || [];
      const homeworks = window.TEST_DUMP_DATA.homeworks || [];
      const exams = window.TEST_DUMP_DATA.exams || [];
      const absences = window.TEST_DUMP_DATA.absences || [];

      // Transform timeUnits: add startMin/endMin fields (required by grid.js)
      const rawTimeUnits = window.TEST_DUMP_DATA.timeUnits || [];
      const timeUnits = rawTimeUnits.map(tu => ({
        ...tu,
        startMin: window.MMMWebuntisWidgets.util.toMinutes(tu.startTime),
        endMin: window.MMMWebuntisWidgets.util.toMinutes(tu.endTime)
      }));

      const gridElement = window.MMMWebuntisWidgets.grid.renderGridForStudent(
        ctx,
        title,
        config,
        timetable,
        homeworks,
        timeUnits,
        exams,
        absences
      );

      // Clear container and append DOM element
      container.innerHTML = '';
      if (gridElement instanceof HTMLElement) {
        container.appendChild(gridElement);
      } else {
        container.innerHTML = gridElement;
      }

      // Start now line updater
      if (window.MMMWebuntisWidgets?.grid?.startNowLineUpdater) {
        window.MMMWebuntisWidgets.grid.startNowLineUpdater(ctx);
      }

      console.log('Grid rendered successfully');
      console.log('Title:', title);
      console.log('Lessons:', timetable.length);
      console.log('Break supervisions:', timetable.filter(l => l.activityType === 'BREAK_SUPERVISION').length);
    } else {
      container.innerHTML = '<p style="color: red;">Error: Grid widget not loaded</p>';
      console.error('Available methods:', Object.keys(window.MMMWebuntisWidgets?.grid || {}));
    }
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const filePath = req.url === '/' ? null : path.join(__dirname, '..', req.url);

  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } else if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentTypes = {
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
    };
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(port, () => {
  console.log(`\n✓ Test server running at http://localhost:${port}`);
  console.log(`  Data source: ${dumpPath}`);
  console.log(`  Student: ${dumpData.title || 'Unknown'}`);
  console.log(`  Lessons: ${dumpData.timetableRange?.length || 0}`);
  console.log(`\nOpen http://localhost:${port} in your browser to test grid rendering.\n`);
});
