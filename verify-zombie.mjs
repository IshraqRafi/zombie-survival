import { chromium } from 'playwright-core';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const shot = (n) => path.join(dir, 'screens', `zombie-${n}.png`);
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && window.__game.state.ready, { timeout: 10000 });
const S = () => page.evaluate(() => window.__game.state);
const L = () => page.evaluate(() => window.__game.log);
const checks = {};
const idle = () => page.waitForFunction(() => window.__game.state.anim !== 'melee_swing', { timeout: 3000 });
const rows = await page.evaluate(() => window.__game.rows());
checks.noOverheadRows = !rows.player.some((r) => r.includes('overhead'));
checks.swingRows = ['down','left','right','up'].every((d) => rows.player.includes('melee_swing_' + d));

await page.waitForTimeout(400);
await page.screenshot({ path: shot('01-start') });

// weapons swap
const weapons = await page.evaluate(() => window.__game.weapons());
const seen = [];
for (let i = 1; i <= weapons.length; i++) { await page.keyboard.press('Digit' + i); seen.push((await S()).weapon); }
await page.keyboard.press('KeyE'); const afterE = (await S()).weapon;
await page.keyboard.press('KeyQ'); const afterQ = (await S()).weapon;
checks.weaponsSwap = JSON.stringify(seen) === JSON.stringify(weapons) && afterE === weapons[0] && afterQ === weapons[weapons.length - 1];

// swing screenshots per weapon mid-swing (frame 4 = hit)
await page.evaluate(() => window.__game.godMode(true));
for (let i = 0; i < weapons.length; i++) {
  await page.keyboard.press('Digit' + (i + 1));
  await page.evaluate((d) => window.__game.setPlayer(512, 448, d), ['right','left','down','up'][i]);
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => window.__game.state.anim === 'melee_swing' && window.__game.state.frame === 4, { timeout: 3000 });
  await page.screenshot({ path: shot(`02-swing-${weapons[i]}`) });
  await page.waitForFunction(() => window.__game.state.anim !== 'melee_swing', { timeout: 3000 });
}

// attack frames hit a zombie: place one right of the player, swing right
await page.keyboard.press('Digit1');
let st = await S();
const target = st.zombies[0].id;
await page.evaluate((id) => { window.__game.setPlayer(512, 448, 'right'); window.__game.placeZombie(id, 18, 0, 'left'); window.__game.setZombieState(id, 'hurt', 'hurt'); }, target);
const hpBefore = (await S()).zombies.find((z) => z.id === target).hp;
await page.keyboard.press('KeyJ');
await page.waitForTimeout(700);
let log = await L();
const ph = log.filter((e) => e.ev === 'playerHit' && e.zombie === target);
checks.attackFrameHits = ph.length === 1 && ph[0].frame === 4;
checks.zombieDamaged = (await S()).zombies.find((z) => z.id === target)?.hp < hpBefore;
checks.hurtState = log.some((e) => e.ev === 'zstate' && e.zombie === target && e.to === 'hurt');

// debug boxes screenshot during a swing near zombies
await idle();
await page.keyboard.press('KeyB');
await page.evaluate((id) => { window.__game.setPlayer(512, 448, 'right'); window.__game.placeZombie(id, 20, 0, 'left'); }, target);
await page.keyboard.press('KeyJ');
await page.waitForFunction(() => window.__game.state.frame === 4 && window.__game.state.anim === 'melee_swing', { timeout: 3000 });
await page.screenshot({ path: shot('03-debug-boxes') });
await page.waitForTimeout(500);

// kill it -> death -> decay -> fade
for (let k = 0; k < 6; k++) {
  const z = (await S()).zombies.find((q) => q.id === target);
  if (!z || ['death','decay','fade'].includes(z.state)) break;
  await page.evaluate((id) => { window.__game.setPlayer(512, 448, 'right'); window.__game.placeZombie(id, 18, 0, 'left'); }, target);
  await idle();
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(750);
}
await page.waitForTimeout(500);
await page.screenshot({ path: shot('04-death') });
await page.waitForFunction((id) => { const z = window.__game.state.zombies.find((q) => q.id === id); return z && z.anim === 'decay' && z.frame >= 3; }, target, { timeout: 8000 });
await page.screenshot({ path: shot('05-decay') });
await page.waitForFunction((id) => !window.__game.state.zombies.some((q) => q.id === id), target, { timeout: 12000 });
log = await L();
const tz = log.filter((e) => e.ev === 'zstate' && e.zombie === target).map((e) => e.to);
checks.deathDecayFade = ['death','decay','fade'].every((s) => tz.includes(s));
checks.respawnKeepsCount = (await S()).zombies.length === 6;
await page.keyboard.press('KeyB');

// sense -> chase -> attack: place a fresh wandering zombie near the player with clear LOS, player stands still
await page.evaluate(() => window.__game.godMode(false));
st = await S();
const z2 = st.zombies.find((z) => z.state === 'wander').id;
await page.evaluate((id) => { window.__game.setPlayer(512, 340, 'down'); window.__game.placeZombie(id, 0, 80, 'up'); }, z2);
await page.waitForFunction((id) => window.__game.state.zombies.find((q) => q.id === id)?.state === 'sense', z2, { timeout: 4000 }).catch(() => {});
await page.screenshot({ path: shot('06-sense') });
await page.waitForFunction((id) => window.__game.state.zombies.find((q) => q.id === id)?.state === 'chase', z2, { timeout: 4000 }).catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: shot('07-chase') });
await page.waitForFunction((id) => window.__game.state.zombies.find((q) => q.id === id)?.anim === 'attack' && window.__game.state.zombies.find((q) => q.id === id)?.frame === 4, z2, { timeout: 6000 }).catch(() => {});
await page.screenshot({ path: shot('08-zombie-attack') });
await page.waitForTimeout(800);
log = await L();
const t2 = log.filter((e) => e.ev === 'zstate' && e.zombie === z2).map((e) => e.to);
checks.senseChaseAttack = ['sense','chase','attack'].every((s) => t2.includes(s));
const zh = log.filter((e) => e.ev === 'zombieHit' && e.zombie === z2);
checks.zombieHitOnFrames34 = zh.length >= 1 && zh.every((e) => e.frame === 3 || e.frame === 4);
checks.playerDamaged = (await S()).hp < 100;

// LOS: zombie behind a wall should not sense. wall [600,160,24,120]: player at x=640, zombie at x=570
st = await S();
const z3 = st.zombies.find((z) => z.state === 'wander' && z.id !== z2)?.id;
let losOk = null;
if (z3) {
  await page.evaluate(() => window.__game.godMode(true));
  await page.evaluate((id) => { window.__game.setPlayer(650, 230, 'left'); window.__game.placeZombie(id, -70, 0, 'right'); }, z3);
  await page.waitForTimeout(150);
  const before = (await L()).length;
  await page.waitForTimeout(1200);
  const l3 = (await L()).slice(before).filter((e) => e.ev === 'zstate' && e.zombie === z3 && e.to === 'sense');
  losOk = l3.length === 0;
}
checks.wallBlocksSight = losOk !== false;

// separation: gather all zombies onto player, wait, check min pair distance
await page.evaluate(() => { window.__game.setPlayer(512, 600, 'down'); for (const z of window.__game.state.zombies) window.__game.placeZombie(z.id, (Math.random()-0.5)*4, -60 + (Math.random()-0.5)*4); });
await page.waitForTimeout(1500);
st = await S();
const alive = st.zombies.filter((z) => !['death','decay','fade'].includes(z.state));
let minD = 1e9;
for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) minD = Math.min(minD, Math.hypot(alive[i].x - alive[j].x, (alive[i].y - alive[j].y) * 7 / 3));
checks.separation = minD > 8;
await page.screenshot({ path: shot('09-horde') });

// player death + R reset
await page.evaluate(() => window.__game.godMode(false));
await page.waitForFunction(() => window.__game.state.dead, { timeout: 20000 }).catch(() => {});
const deadSt = await S();
await page.screenshot({ path: shot('10-player-dead') });
await page.keyboard.press('KeyR');
await page.waitForTimeout(200);
const resetSt = await S();
checks.playerDeath = deadSt.dead === true;
checks.resetR = resetSt.dead === false && resetSt.hp === 100 && resetSt.zombies.length === 6;

checks.noConsoleErrors = errors.length === 0;
await browser.close();
console.log(JSON.stringify({ errors, checks, minD, t2, tz }, null, 2));
const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
if (failed.length) { console.error('FAILED:', failed.join(', ')); process.exit(1); }
console.log('ALL CHECKS PASSED');
