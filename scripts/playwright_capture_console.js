// eslint-disable-next-line n/no-unpublished-require
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const outDir = path.resolve(process.cwd(), 'debug_dumps');
  try {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    /* ignore */
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];

  page.on('console', (msg) => {
    try {
      const entry = { type: msg.type(), text: msg.text() };
      logs.push(entry);
      console.log(`[PAGE ${entry.type}] ${entry.text}`);
      // eslint-disable-next-line no-unused-vars
    } catch (e) {
      console.log('[PAGE console] (error reading message)');
    }
  });

  page.on('pageerror', (err) => {
    const text = err && err.toString();
    console.log('[PAGE ERROR]', text);
    logs.push({ type: 'pageerror', text });
  });

  try {
    console.log('[SCRIPT] Navigating to http://localhost:8080');
    await page.goto('http://localhost:8080', { waitUntil: 'networkidle', timeout: 20000 });
    // wait a bit for dynamic widgets to render and emit console messages
    await page.waitForTimeout(3000);

    const screenshotPath = path.join(outDir, 'magicmirror_playwright.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('[SCRIPT] Screenshot saved to', screenshotPath);
  } catch (err) {
    console.error('[SCRIPT] Error during page interaction:', err && err.message);
    logs.push({ type: 'script-error', text: err && err.stack });
  } finally {
    await browser.close();
    const logPath = path.join(outDir, 'magicmirror_console_logs.json');
    try {
      fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
      console.log('[SCRIPT] Console logs saved to', logPath);
    } catch (e) {
      console.error('[SCRIPT] Failed to write logs:', e && e.message);
    }
  }
})();
