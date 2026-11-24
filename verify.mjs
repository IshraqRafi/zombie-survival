import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screens = path.join(__dirname, 'screens');
fs.mkdirSync(screens, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console.${msg.type()}: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.state.ready, { timeout: 10000 });
await page.waitForTimeout(120);

async function state() {
  return page.evaluate(() => window.__game.state);
}

function uniquePixels(bufA, bufB) {
  // rough difference count if both are PNG buffers - we'll compare via canvas instead
}

// Idle: wait enough for at least one frame tick (4 fps = 250ms)
const idleA = await state();
await page.screenshot({ path: path.join(screens, '01-idle.png') });
await page.waitForTimeout(350);
const idleB = await state();
await page.screenshot({ path: path.join(screens, '01b-idle-later.png') });

// Walk right
await page.keyboard.down('KeyD');
await page.waitForTimeout(80);
const walkStart = await state();
await page.waitForTimeout(280);
const walkMid = await state();
await page.screenshot({ path: path.join(screens, '02-walk.png') });

// Also capture a second walk direction (down-right diagonal) after a bit more time
await page.keyboard.down('KeyS');
await page.waitForTimeout(240);
await page.screenshot({ path: path.join(screens, '02b-walk-diagonal.png') });
const walkDiag = await state();

// Sprint: keep D+S, add Shift
await page.keyboard.down('Shift');
await page.waitForTimeout(80);
const runStart = await state();
await page.waitForTimeout(280);
const runMid = await state();
await page.screenshot({ path: path.join(screens, '03-sprint.png') });

// Face left sprint
await page.keyboard.up('KeyD');
await page.keyboard.up('KeyS');
await page.keyboard.down('KeyA');
await page.waitForTimeout(260);
await page.screenshot({ path: path.join(screens, '03b-sprint-left.png') });
const runLeft = await state();

// Release to idle facing left
await page.keyboard.up('KeyA');
await page.keyboard.up('Shift');
await page.waitForTimeout(80);
const backIdle = await state();
await page.screenshot({ path: path.join(screens, '04-idle-after.png') });

await browser.close();

const report = {
  errors,
  idleA,
  idleB,
  walkStart,
  walkMid,
  walkDiag,
  runStart,
  runMid,
  runLeft,
  backIdle,
  checks: {},
};

report.checks.noConsoleErrors = errors.length === 0;
report.checks.idleReady = idleA.ready === true && idleA.anim === 'idle';
report.checks.idleFramesChanged = idleA.frame !== idleB.frame;
report.checks.walkAnim = walkStart.anim === 'walk' && walkMid.anim === 'walk';
report.checks.walkFramesChanged = walkStart.frame !== walkMid.frame;
report.checks.walkMoved = walkMid.x !== idleB.x;
report.checks.sprintAnim = runStart.anim === 'run' && runMid.anim === 'run';
report.checks.sprintFramesChanged = runStart.frame !== runMid.frame;
report.checks.facingLeft = runLeft.dir === 'left';
report.checks.backToIdle = backIdle.anim === 'idle';

const failed = Object.entries(report.checks).filter(([, v]) => !v);
console.log(JSON.stringify(report, null, 2));
if (failed.length) {
  console.error('FAILED CHECKS:', failed.map(([k]) => k).join(', '));
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
