#!/usr/bin/env node
/**
 * Regenerate the README/wiki screenshots from the demo fixtures - see docs/SCREENSHOTS.md.
 *
 * Starts a throwaway MagicMirror server (serveronly) with demo/screenshots/config.js on its
 * own port, so the regular config.js and a running mirror stay untouched, then drives it
 * with Playwright.
 *
 *   node scripts/take-screenshots.mjs
 *
 * Environment:
 *   MM_ROOT      MagicMirror installation (default: two levels above this module)
 *   MM_PORT      port for the throwaway server (default: 8081)
 *   SHOT_TIME    frozen browser clock (default: 2026-09-30T10:50:00+02:00, matches the fixture)
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mmRoot = process.env.MM_ROOT || path.resolve(moduleRoot, "..", "..");
const port = Number(process.env.MM_PORT || 8081);
const shotTime = process.env.SHOT_TIME || "2026-09-30T10:50:00+02:00";
const baseUrl = `http://localhost:${port}/`;

// Playwright is not a module dependency; use a local install or the global one (devcontainer).
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require("playwright");
  } catch {
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    return require(path.join(globalRoot, "playwright"));
  }
}

// Module instance (demo/screenshots/config.js) -> width in px.
const WIDTHS = { main: 1000, grid: 1150, lessons: 700, ehA: 700, mod: 700, notices: 700, compact: 700 };

const SHOTS = [
  { id: "main", file: "screenshot-all.png", margin: 40 },
  { id: "grid", file: "img/grid.png" },
  { id: "lessons", file: "img/lessons.png" },
  { id: "ehA", file: "img/exams-homework-absences.png" },
  { id: "mod", file: "img/messagesofday.png" },
  { id: "notices", file: "img/features/day-notices.png" },
  { id: "compact", file: "img/features/compact-mode.png" },
];

// "dd.MM." of the frozen day and the day after - the two grid columns of the close-up.
function closeUpDays() {
  const [year, month, day] = shotTime.slice(0, 10).split("-").map(Number);
  return [0, 1].map((offset) => {
    const date = new Date(Date.UTC(year, month - 1, day + offset));
    return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.`;
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`MagicMirror did not come up on ${url} within ${timeoutMs / 1000}s`);
}

async function openMirror(browser, deviceScaleFactor) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(shotTime));
  // The installation's own custom.css would leak into the screenshots.
  await page.route(/\/css\/custom\.css$/, (route) => route.fulfill({ contentType: "text/css", body: "" }));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator(".shot-main .wu-plugin-grid .grid-lesson").first().waitFor();
  await page.waitForTimeout(1000);
  const widths = Object.entries(WIDTHS)
    .map(([id, px]) => `.shot-${id} { width: ${px}px; }`)
    .join("\n");
  await page.addStyleTag({
    content: `${widths}
      body.shotmode .module.shot:not(.active) { display: none !important; }`,
  });
  await page.evaluate(() => document.body.classList.add("shotmode"));
  return page;
}

async function showOnly(page, id) {
  await page.evaluate((active) => {
    for (const el of document.querySelectorAll(".module.shot")) {
      el.classList.toggle("active", el.classList.contains(`shot-${active}`));
    }
  }, id);
  await page.waitForTimeout(300);
}

async function shoot(page, file, box, margin) {
  const out = path.join(moduleRoot, file);
  mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({
    path: out,
    clip: { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin },
  });
  console.log(`  ${file}`);
}

function union(boxes) {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

async function takeWidgetShots(browser) {
  const page = await openMirror(browser, 1);
  for (const { id, file, margin = 16 } of SHOTS) {
    await showOnly(page, id);
    await shoot(page, file, await page.locator(`.shot-${id}`).boundingBox(), margin);
  }
  await page.context().close();
}

// Close-ups for the wiki feature overview, rendered at 2x for legibility.
async function takeFeatureShots(browser) {
  const page = await openMirror(browser, 2);
  await showOnly(page, "grid");
  const grid = page.locator(".shot-grid .wu-plugin-grid");

  // Today and tomorrow of the week view: past lessons, now line, substitution, removed room,
  // absence overlay, exam and homework markers, moved and cancelled lessons.
  const labels = grid.locator(".grid-daylabel");
  const columns = grid.locator(".day-column-inner");
  const labelTexts = await labels.allInnerTexts();
  const boxes = [];
  for (const day of closeUpDays()) {
    const index = labelTexts.findIndex((text) => text.includes(day));
    if (index === -1) throw new Error(`No grid column for ${day} - does SHOT_TIME match the fixture?`);
    boxes.push(await labels.nth(index).boundingBox(), await columns.nth(index).boundingBox());
  }
  await shoot(page, "img/features/grid-changes.png", union(boxes), 0);

  await grid.locator(".grid-lesson", { hasText: "RProxy" }).click();
  const popover = page.locator(".wu-shared-popover.is-open .wu-shared-popover__shell");
  await popover.waitFor();
  await page.waitForTimeout(1000); // let the open transition finish
  await shoot(page, "img/features/grid-popover.png", await popover.boundingBox(), 24);

  await page.context().close();
}

const server = spawn(process.execPath, ["serveronly"], {
  cwd: mmRoot,
  env: {
    ...process.env,
    MM_CONFIG_FILE: path.join(moduleRoot, "demo", "screenshots", "config.js"),
    MM_PORT: String(port),
  },
  stdio: ["ignore", "ignore", "inherit"],
});

let exitCode = 0;
try {
  await waitForServer(baseUrl);
  const { chromium } = loadPlaywright();
  const launchOptions = { args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] };
  // Without downloaded Playwright browsers (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD in the devcontainer)
  // fall back to the installed Google Chrome.
  const browser = await chromium
    .launch(launchOptions)
    .catch(() => chromium.launch({ ...launchOptions, channel: "chrome" }));
  try {
    console.log(`Screenshots (clock frozen at ${shotTime}):`);
    await takeWidgetShots(browser);
    await takeFeatureShots(browser);
  } finally {
    await browser.close();
  }
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  server.kill();
}
process.exit(exitCode);
