// Top-down zombie test. All sprite rows, timings, weapon attachments and combat boxes
// are looked up by name from Sara's JSON at load time (no hardcoded row indices).
(() => {
  "use strict";
  const DIRS = ["down", "left", "right", "up"];
  const ATTACK = "melee_swing";
  const WORLD_W = 1024, WORLD_H = 768, TILE = 16;
  const WALK_SPEED = 72, RUN_SPEED = 140;
  const PLAYER_HP = 100, ZOMBIE_HP = 100, ZOMBIE_COUNT = 6;
  const MAX_STAMINA = 100, STAMINA_DRAIN = 35, STAMINA_REGEN = 18;
  const SPRINT_CUTOFF = 8, SPRINT_RECOVER = 25; // hysteresis so it doesn't flicker
  const SENSE_RADIUS = 150, LOSE_TIME = 3;
  const Z_WALK = 16, Z_RUN = 50;
  const WAVE_INTERVAL = 25; // seconds between wave increases
  const KILLS_PER_WAVE = 8;
  // Gameplay tuning per weapon (art/boxes come from JSON; unknown weapons get the default).
  const WEAPON_STATS = {
    bat: { dmg: 34, kb: 150, type: "melee" },
    bat_nails: { dmg: 50, kb: 140, type: "melee" },
    pipe: { dmg: 40, kb: 170, type: "melee" },
    machete: { dmg: 60, kb: 110, type: "melee" },
    pistol: { dmg: 28, kb: 60, type: "ranged", cooldown: 0.28, speed: 680, range: 320 },
    _default: { dmg: 40, kb: 140, type: "melee" },
  };
  const PICKUP_HEAL = 35;
  const VARIANT_STATS = {
    zombie_1: { hp: 100, speed: 1.0, dropChance: 0.25 },  // normal
    zombie_2: { hp: 70, speed: 1.35, dropChance: 0.15 },   // fast runner
    _default: { hp: 100, speed: 1.0, dropChance: 0.2 },
  };
  const MAX_AMMO = 24;
  const AMMO_REGEN_RATE = 0.25; // ammo per second when not firing
  // Obstacles (minimal; they exist so line of sight means something).
  const WALLS = [
    [300, 220, 96, 24], [600, 160, 24, 120], [420, 470, 140, 24],
    [180, 520, 24, 110], [760, 470, 110, 24], [700, 600, 24, 90],
  ];

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const hpFill = document.getElementById("hpfill");
  const stamFill = document.getElementById("stamfill");
  const weaponLabel = document.getElementById("weapon");
  const statsLabel = document.getElementById("stats");
  const banner = document.getElementById("banner");
  const bannerStats = document.getElementById("banner-stats");

  const keys = new Set();
  let A = null; // loaded assets + parsed data
  let scale = 4, viewW = 320, viewH = 180, camX = 0, camY = 0, last = 0;
  let ready = false, debug = false, ground = null, time = 0;
  let mouse = { x: 0, y: 0 };
  const player = {};
  let zombies = [];
  let projectiles = [];
  let damagePops = [];
  let pickups = [];
  let nextZombieId = 1;
  let nextProjectileId = 1;
  const stats = { playerHits: 0, zombieHits: 0, kills: 0, startTime: 0, wave: 1 };
  const log = [];
  let rainDrops = [];
  let bloodParticles = [];
  function initRain() {
    rainDrops = [];
    for (let i = 0; i < 120; i++) {
      rainDrops.push({
        x: Math.random() * WORLD_W,
        y: Math.random() * WORLD_H,
        vy: 180 + Math.random() * 80,
        len: 6 + Math.random() * 6
      });
    }
  }
  function updateRain(dt) {
    for (const d of rainDrops) {
      d.y += d.vy * dt;
      d.x -= 15 * dt; // slight wind
      if (d.y > WORLD_H) { d.y = -10; d.x = Math.random() * WORLD_W; }
      if (d.x < 0) d.x += WORLD_W;
    }
  }
  function updateBlood(dt) {
    for (let i = bloodParticles.length - 1; i >= 0; i--) {
      const b = bloodParticles[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.life -= dt; b.vy += 40 * dt;
      if (b.life <= 0) bloodParticles.splice(i, 1);
    }
  }
  function spawnBlood(x, y, count = 5) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 50;
      bloodParticles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
        life: 0.4 + Math.random() * 0.4, size: 1 + Math.random() * 1.5
      });
    }
  }
  initRain();

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  function rectsOverlap(a, b) {
    return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
  }
  function dirFromVec(dx, dy, fallback) {
    if (dx === 0 && dy === 0) return fallback;
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
    return dy > 0 ? "down" : "up";
  }
  function segIntersectsRect(x1, y1, x2, y2, r) {
    // Liang-Barsky clip
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - r[0], r[0] + r[2] - x1, y1 - r[1], r[1] + r[3] - y1];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return false; continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  }
  function lineOfSight(x1, y1, x2, y2) {
    // eye height: test from roughly chest level on the ground plane
    for (const w of WALLS) if (segIntersectsRect(x1, y1 - 2, x2, y2 - 2, w)) return false;
    return true;
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("Failed to load " + src));
      img.src = src;
    });
  }
  const loadJSON = (src) => fetch(src, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("Failed to load " + src);
    return r.json();
  });

  // ---------- asset parsing ----------
  function buildRows(layout) {
    const rows = {};
    layout.rows.forEach((r, i) => { rows[r.name] = { index: i, frames: r.frames, anim: r.anim, dir: r.dir }; });
    return rows;
  }
  // Per-frame durations (ms) for an anim, from durations_ms or fps.
  function playerDurations(layout, anim, frames) {
    const d = layout.durations_ms && layout.durations_ms[anim];
    if (d && d.length >= frames) return d.slice(0, frames);
    const fps = (layout.fps && layout.fps[anim]) || 10;
    return new Array(frames).fill(1000 / fps);
  }
  function zombieAnimInfo(zl, anim) {
    const a = zl.animations[anim];
    const durs = a.durations_ms && a.durations_ms.length >= a.frames ? a.durations_ms : new Array(a.frames).fill(1000 / a.fps);
    return { frames: a.frames, durs, loop: a.loop, next: a.next, hit: a.hit_frames || [] };
  }
  function ellipseRect(hb) {
    // ground-plane footprint relative to feet pivot, from collision_recommended
    const piv = hb.pivot || [32, 56];
    const e = hb.collision_recommended.ellipse;
    return { cx: e.cx - piv[0], cy: e.cy - piv[1], rx: e.rx, ry: e.ry,
      rect: [e.cx - piv[0] - e.rx, e.cy - piv[1] - e.ry, e.rx * 2, e.ry * 2] };
  }

  async function loadAssets() {
    const P = "assets/player/", Z = "assets/zombie/";
    const [pl, pw, ph, zl, zh] = await Promise.all([
      loadJSON(P + "layout.json"), loadJSON(P + "weapons.json"), loadJSON(P + "hitboxes.json"),
      loadJSON(Z + "layout.json"), loadJSON(Z + "hitboxes.json"),
    ]);
    const weaponNames = Object.keys(pw.weapons);
    const imgs = await Promise.all([
      loadImage(P + "main_character_sheet.png"), loadImage(P + "shadow.png"),
      loadImage(P + (pw.hands_overlay || "hands_overlay_sheet.png")),
      loadImage(P + (pw.fx || "fx/smear_sheet.png")),
      ...weaponNames.map((n) => loadImage(P + pw.weapons[n].rotations)),
    ]);
    const zVariants = Object.keys(zh.variants);
    const zimgs = await Promise.all([
      loadImage(Z + "sheets/fx_sheet.png"), loadImage(Z + "sheets/shadow_sheet.png"),
      ...zVariants.flatMap((v) => [loadImage(Z + `sheets/${v}_sheet_nofx.png`), loadImage(Z + `sheets/${v}_sheet.png`)]),
    ]);
    const rot = {};
    weaponNames.forEach((n, i) => { rot[n] = imgs[4 + i]; });
    const zsheets = {};
    zVariants.forEach((v, i) => { zsheets[v] = { nofx: zimgs[2 + i * 2], full: zimgs[3 + i * 2] }; });

    const pRows = buildRows(pl);
    // inject ranged weapon using pipe rotation sheet as a stand-in gun
    if (!weaponNames.includes("pistol")) weaponNames.push("pistol");
    if (rot.pipe && !rot.pistol) rot.pistol = rot.pipe;
    if (!pRows[ATTACK + "_down"]) throw new Error("player layout.json has no " + ATTACK + " rows");
    const pAnims = {};
    for (const anim of new Set(pl.rows.map((r) => r.anim))) {
      const frames = pRows[anim + "_down"].frames;
      pAnims[anim] = { frames, durs: playerDurations(pl, anim, frames) };
    }
    // attack frames: per-dir arrays of {dur, active, reach{weapon:[...]}, weapon attach}
    const attack = {};
    for (const d of DIRS) {
      const row = ATTACK + "_" + d;
      const hbFrames = (ph.attacks && ph.attacks[row]) || [];
      const wFrames = (pw.frames && pw.frames[row]) || [];
      attack[d] = wFrames.map((wf, i) => {
        const hf = hbFrames[i] || {};
        const reach = {};
        if (hf.weapons) for (const n in hf.weapons) reach[n] = hf.weapons[n].reach;
        return { dur: hf.duration_ms || wf.duration_ms || pAnims[ATTACK].durs[i], active: !!hf.active, reach, w: wf };
      });
      pAnims[ATTACK].frames = attack[d].length || pAnims[ATTACK].frames;
    }
    pAnims[ATTACK].durs = attack.down.map((f) => f.dur);

    const zRows = buildRows(zl);
    const zAnims = {};
    for (const a of Object.keys(zl.animations)) zAnims[a] = zombieAnimInfo(zl, a);
    const zAttack = {};
    for (const d of DIRS) zAttack[d] = (zh.attacks["attack_" + d] || []).map((f) => ({ active: !!f.active, reach: f.reach, kind: f.kind }));

    return {
      p: { layout: pl, weapons: pw, hit: ph, rows: pRows, anims: pAnims, attack, foot: ellipseRect(ph),
        sheet: imgs[0], shadow: imgs[1], hands: imgs[2], smear: imgs[3], rot, weaponNames,
        frame: pl.frame || 64, pivot: ph.pivot || [32, 56] },
      z: { layout: zl, hit: zh, rows: zRows, anims: zAnims, attack: zAttack, foot: ellipseRect(zh),
        fx: zimgs[0], shadow: zimgs[1], sheets: zsheets, variants: zVariants,
        frame: zl.frame || 64, pivot: zh.pivot || [32, 56], hurtActive: zh.hurtbox_active || {} },
    };
  }

  // ---------- world ----------
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function makeGround() {
    const g = document.createElement("canvas");
    g.width = WORLD_W; g.height = WORLD_H;
    const c = g.getContext("2d");
    c.fillStyle = "#8a9a62"; c.fillRect(0, 0, WORLD_W, WORLD_H);
    for (let ty = 0; ty < WORLD_H; ty += TILE) for (let tx = 0; tx < WORLD_W; tx += TILE) {
      const n = hash(tx, ty);
      c.fillStyle = n % 7 === 0 ? "#7e9158" : n % 5 === 0 ? "#93a36b" : "#86985e";
      c.fillRect(tx, ty, TILE, TILE);
      if (n % 4 === 0) {
        c.fillStyle = n % 8 === 0 ? "#6e844c" : "#9aaa70";
        const fx = tx + (n % TILE), fy = ty + ((n >> 3) % TILE);
        c.fillRect(fx, fy, 1, 1);
        if (n % 6 === 0) c.fillRect(fx + 2, fy + 1, 1, 1);
      }
    }
    c.strokeStyle = "rgba(40,48,28,0.18)"; c.beginPath();
    for (let x = 0; x <= WORLD_W; x += 32) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, WORLD_H); }
    for (let y = 0; y <= WORLD_H; y += 32) { c.moveTo(0, y + 0.5); c.lineTo(WORLD_W, y + 0.5); }
    c.stroke();
    c.strokeStyle = "rgba(40,48,28,0.45)"; c.strokeRect(0.5, 0.5, WORLD_W - 1, WORLD_H - 1);
    ground = g;
  }
  function drawWall(w, part) {
    // top face + front face (3/4 view): blocks are 14px tall visually
    const H = 14;
    const x = Math.round(w[0] - camX), y = Math.round(w[1] - camY);
    if (part === "shadow") {
      ctx.fillStyle = "rgba(30,36,20,0.28)"; ctx.fillRect(x + 3, y + 3, w[2], w[3]); return;
    }
    ctx.fillStyle = "#5b4f43"; ctx.fillRect(x, y + w[3] - H, w[2], H);           // front
    ctx.fillStyle = "#7a6b5a"; ctx.fillRect(x, y - H, w[2], w[3]);                // top
    ctx.fillStyle = "#8d7d69"; ctx.fillRect(x, y - H, w[2], 1);
    ctx.fillStyle = "#3a322a";
    ctx.fillRect(x, y + w[3] - 1, w[2], 1); ctx.fillRect(x, y - H, 1, w[3] + H); ctx.fillRect(x + w[2] - 1, y - H, 1, w[3] + H);
  }

  // Move an entity's footprint with axis-separated wall/world collision.
  function moveWithCollision(e, foot, dx, dy) {
    const tryAxis = (ax, d) => {
      if (!d) return;
      const nx = ax === 0 ? e.x + d : e.x, ny = ax === 1 ? e.y + d : e.y;
      const r = [nx + foot.rect[0], ny + foot.rect[1], foot.rect[2], foot.rect[3]];
      if (r[0] < 0 || r[1] < 0 || r[0] + r[2] > WORLD_W || r[1] + r[3] > WORLD_H) return;
      for (const w of WALLS) if (rectsOverlap(r, w)) return;
      e.x = nx; e.y = ny;
    };
    tryAxis(0, dx); tryAxis(1, dy);
  }
  function footRect(e, foot) { return [e.x + foot.rect[0], e.y + foot.rect[1], foot.rect[2], foot.rect[3]]; }
  // Full body hurtbox (not just the feet ellipse)
  function bodyRect(z) {
    const v = A.z.hit.variants[z.variant];
    const hf = v.hurtbox_frames && v.hurtbox_frames[z.anim + "_" + z.dir];
    const r = (hf && hf[z.frame]) || (v.hurtbox[z.dir] && v.hurtbox[z.dir].rect);
    if (!r) return footRect(z, A.z.foot);
    const piv = A.z.pivot;
    return [z.x + r[0] - piv[0], z.y + r[1] - piv[1], r[2], r[3]];
  }
  // Upper portion of the body = head (dynamic hitbox)
  function headRect(z) {
    const b = bodyRect(z);
    const headH = Math.max(7, Math.round(b[3] * 0.32));
    return [b[0], b[1], b[2], headH];
  }
  function freeSpot(foot, avoidX, avoidY, minDist) {
    for (let i = 0; i < 200; i++) {
      const x = rand(40, WORLD_W - 40), y = rand(60, WORLD_H - 30);
      if (Math.hypot(x - avoidX, y - avoidY) < minDist) continue;
      const r = [x + foot.rect[0] - 4, y + foot.rect[1] - 4, foot.rect[2] + 8, foot.rect[3] + 8];
      if (!WALLS.some((w) => rectsOverlap(r, w))) return { x, y };
    }
    return { x: 40, y: 60 };
  }

  // ---------- audio (assets/sfx) ----------
  const SFX = {};
  let footLoop = null, rainLoop = null;
  function loadSfx() {
    const map = {
      bat_swing: "assets/sfx/bat_swing.wav",
      sword_swing: "assets/sfx/sword_swing.wav",
      handgun: "assets/sfx/handgun.wav",
      hit: "assets/sfx/hit.wav",
      hit2: "assets/sfx/hit2.wav",
      hit3: "assets/sfx/hit3.wav",
      walking: "assets/sfx/walking.mp3",
      rain: "assets/sfx/rain.mp3",
      zombie_groan: "assets/sfx/zombie_groan.mp3",
      zombie_groan2: "assets/sfx/zombie_groan2.mp3",
      zombie_scream: "assets/sfx/zombie_scream.mp3",
    };
    for (const [k, src] of Object.entries(map)) {
      const a = new Audio(src);
      a.preload = "auto";
      a.volume = 0.6;
      if (k === "walking" || k === "rain") a.loop = true;
      SFX[k] = a;
    }
    rainLoop = SFX.rain;
    rainLoop.volume = 0.18;
    rainLoop.play().catch(() => {});
  }
  let actx = null;
  function ensureAudioCtx() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  }
  function play(name, vol = 1, rate = 1) {
    const a = SFX[name];
    if (!a) return;
    const c = a.cloneNode();
    c.volume = Math.min(1, (a.volume || 0.6) * vol);
    c.playbackRate = rate;
    c.play().catch(() => {});
    return c;
  }
  // Distance-based volume + left/right pan. Far = quiet, close = loud.
  function playSpatial(name, x, y, vol = 1, rate = 1) {
    const a = SFX[name];
    if (!a) return;
    const dx = x - player.x, dy = y - player.y;
    const d = Math.hypot(dx, dy);
    const maxDist = 460;
    if (d >= maxDist) return;
    const atten = Math.pow(1 - d / maxDist, 1.55); // steeper falloff
    if (atten < 0.04) return;
    const c = a.cloneNode();
    c.volume = Math.min(1, (a.volume || 0.6) * vol * atten);
    c.playbackRate = rate;
    // stereo pan based on horizontal offset (only if audio context is already running)
    try {
      const ctx = ensureAudioCtx();
      if (ctx.state === "running") {
        const src = ctx.createMediaElementSource(c);
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.max(-1, Math.min(1, dx / 200));
        src.connect(pan);
        pan.connect(ctx.destination);
      }
    } catch (e) { /* volume-only fallback */ }
    c.play().catch(() => {});
    return c;
  }
  function playHit(vol = 0.7) {
    const names = ["hit", "hit2", "hit3"];
    play(names[(Math.random() * names.length) | 0], vol, 0.9 + Math.random() * 0.2);
  }
  function setFootsteps(on, sprint) {
    if (!footLoop) footLoop = SFX.walking;
    if (on) {
      if (footLoop.paused) footLoop.play().catch(() => {});
      footLoop.volume = sprint ? 0.42 : 0.3;
      footLoop.playbackRate = sprint ? 1.3 : 1.0;
    } else {
      if (!footLoop.paused) footLoop.pause();
    }
  }
  loadSfx();

  // ---------- player ----------
  function resetPlayer() {
    Object.assign(player, {
      x: WORLD_W / 2, y: WORLD_H / 2 + 40, dir: "down", anim: "idle", frame: 0, t: 0,
      hp: PLAYER_HP, stamina: MAX_STAMINA, canSprint: true, dead: false, inv: 0, kx: 0, ky: 0, hitSet: new Set(), flash: 0,
      weapon: player.weapon || A.p.weaponNames[0], ammo: MAX_AMMO, queued: false,
    });
  }
  function setPlayerAnim(anim) {
    if (player.anim === anim) return;
    player.anim = anim; player.frame = 0; player.t = 0;
    if (anim === ATTACK) player.hitSet = new Set();
  }
  function startAttack(faceX, faceY) {
    if (player.dead) return;
    const ws = WEAPON_STATS[player.weapon] || WEAPON_STATS._default;
    if (ws.type === "ranged") {
      if (player.anim === ATTACK || (player.shootCd || 0) > 0 || (player.ammo || 0) <= 0) return;
      if (faceX !== undefined) player.dir = dirFromVec(faceX, faceY, player.dir);
      // fire from weapon tip (roughly hand position)
      const angle = Math.atan2(faceY || 0, faceX || 1);
      const tipDist = 18;
      const sx = player.x + Math.cos(angle) * tipDist;
      const sy = player.y - 10 + Math.sin(angle) * tipDist;
      const speed = ws.speed || 400;
      projectiles.push({
        id: nextProjectileId++,
        x: sx, y: sy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        dmg: ws.dmg, kb: ws.kb, range: ws.range || 250, dist: 0,
        life: 0.48,
        trail: []
      });
      player.shootCd = ws.cooldown || 0.3;
      player.ammo = Math.max(0, (player.ammo || 0) - 1);
      play("handgun", 0.8, 0.95 + Math.random() * 0.1);
      log.push({ t: time, ev: "shoot", weapon: player.weapon });
      return;
    }
    if (player.anim === ATTACK) return;
    if (faceX !== undefined) player.dir = dirFromVec(faceX, faceY, player.dir);
    setPlayerAnim(ATTACK);
    play(player.weapon === "machete" ? "sword_swing" : "bat_swing", 0.7, 0.9 + Math.random() * 0.2);
  }
  function setWeapon(name) {
    if (name !== "pistol" && !A.p.weapons.weapons[name]) return;
    player.weapon = name;
    weaponLabel.textContent = name.replace("_", " ");
    log.push({ t: time, ev: "weapon", name });
  }
  function cycleWeapon(step) {
    const names = A.p.weaponNames;
    setWeapon(names[(names.indexOf(player.weapon) + step + names.length) % names.length]);
  }

  function inputVector() {
    let ix = 0, iy = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) ix -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) ix += 1;
    if (keys.has("KeyW") || keys.has("ArrowUp")) iy -= 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) iy += 1;
    const len = Math.hypot(ix, iy);
    if (len) { ix /= len; iy /= len; }
    const wantSprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    // hysteresis: once exhausted, must recover before sprinting again
    if (player.stamina <= SPRINT_CUTOFF) player.canSprint = false;
    else if (player.stamina >= SPRINT_RECOVER) player.canSprint = true;
    return { ix, iy, moving: len > 0, sprint: wantSprint && player.canSprint };
  }

  function updatePlayer(dt) {
    const p = player, P = A.p;
    p.inv = Math.max(0, p.inv - dt); p.flash = Math.max(0, p.flash - dt);
    // stamina
    const { ix, iy, moving, sprint } = inputVector();
    if (sprint && moving) {
      p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
    } else {
      p.stamina = Math.min(MAX_STAMINA, p.stamina + STAMINA_REGEN * dt);
    }
    // ammo regen
    if ((p.ammo || 0) < MAX_AMMO && (p.shootCd || 0) <= 0) {
      p.ammo = Math.min(MAX_AMMO, (p.ammo || 0) + AMMO_REGEN_RATE * dt);
    }
    // knockback decay
    if (p.kx || p.ky) {
      moveWithCollision(p, P.foot, p.kx * dt, p.ky * dt);
      const k = Math.exp(-10 * dt); p.kx *= k; p.ky *= k;
      if (Math.hypot(p.kx, p.ky) < 2) p.kx = p.ky = 0;
    }
    if (p.dead) { setFootsteps(false); return; }
    p.shootCd = Math.max(0, (p.shootCd || 0) - dt);
    if (p.anim !== ATTACK) {
      setPlayerAnim(!moving ? "idle" : sprint ? "run" : "walk");
      if (moving) {
        p.dir = dirFromVec(ix, iy, p.dir);
        const sp = sprint ? RUN_SPEED : WALK_SPEED;
        moveWithCollision(p, P.foot, ix * sp * dt, iy * sp * dt);
        // continuous footsteps
        setFootsteps(true, sprint);
      } else {
        setFootsteps(false);
        p.stepT = 0;
      }
    } else if (moving) {
      // tiny drift while swinging keeps it responsive without sliding
      moveWithCollision(p, P.foot, ix * 18 * dt, iy * 18 * dt);
    }
    // advance animation
    const info = P.anims[p.anim];
    p.t += dt * 1000;
    while (p.t >= info.durs[p.frame]) {
      p.t -= info.durs[p.frame];
      p.frame++;
      if (p.frame >= info.frames) {
        if (p.anim === ATTACK) { setPlayerAnim("idle"); break; }
        p.frame = 0;
      }
    }
    // hit check: only on frames flagged active in hitboxes.json
    if (p.anim === ATTACK) {
      const f = P.attack[p.dir][p.frame];
      if (f && f.active) {
        const r = f.reach[p.weapon];
        if (r) {
          const box = [p.x + r[0], p.y + r[1], r[2], r[3]];
          for (const z of zombies) {
            if (!z.hittable() || p.hitSet.has(z.id)) continue;
            if (rectsOverlap(box, bodyRect(z))) {
              p.hitSet.add(z.id);
              const ws = WEAPON_STATS[p.weapon] || WEAPON_STATS._default;
              const isHead = rectsOverlap(box, headRect(z));
              z.takeHit(ws.dmg, ws.kb, p.x, p.y, isHead);
              stats.playerHits++;
              playSpatial(["hit","hit2","hit3"][(Math.random()*3)|0], z.x, z.y, 0.8, 0.9 + Math.random() * 0.2);
              spawnBlood(z.x, z.y - 10, 4);
              log.push({ t: time, ev: "playerHit", zombie: z.id, weapon: p.weapon, frame: p.frame });
            }
          }
        }
      }
    }
  }
  function updateProjectiles(dt) {
    for (const pr of projectiles) {
      // smoke trail points (quick fade)
      if (!pr.trail) pr.trail = [];
      pr.trail.push({ x: pr.x, y: pr.y, t: 0 });
      for (const p of pr.trail) p.t += dt;
      pr.trail = pr.trail.filter((p) => p.t < 0.10);
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.dist += Math.hypot(pr.vx, pr.vy) * dt;
      pr.life -= dt;
      // hit zombies using full body hurtbox
      for (const z of zombies) {
        if (!z.hittable()) continue;
        if (rectsOverlap([pr.x - 3, pr.y - 3, 6, 6], bodyRect(z))) {
          const isHead = rectsOverlap([pr.x - 2, pr.y - 2, 4, 4], headRect(z));
          z.takeHit(pr.dmg, pr.kb, pr.x, pr.y, isHead);
          stats.playerHits++;
          playSpatial(["hit","hit2","hit3"][(Math.random()*3)|0], z.x, z.y, 0.65, 1.0 + Math.random() * 0.15);
          spawnBlood(z.x, z.y - 8, 3);
          pr.life = 0;
          log.push({ t: time, ev: "bulletHit", zombie: z.id });
          break;
        }
      }
    }
    projectiles = projectiles.filter((pr) => pr.life > 0 && pr.dist < pr.range &&
      pr.x > -20 && pr.x < WORLD_W + 20 && pr.y > -20 && pr.y < WORLD_H + 20);
  }

  function spawnPickup() {
    if (pickups.length >= 3) return;
    const s = freeSpot(A.p.foot, player.x, player.y, 120);
    pickups.push({ x: s.x, y: s.y, type: "health", t: 0 });
  }

  function updatePickups(dt) {
    for (const pk of pickups) pk.t += dt;
    // collect
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pk = pickups[i];
      if (Math.hypot(pk.x - player.x, pk.y - player.y) < 16 && !player.dead) {
        if (pk.type === "health") {
          player.hp = Math.min(PLAYER_HP, player.hp + PICKUP_HEAL);
          playHit(0.45); // soft hit as pickup cue
          log.push({ t: time, ev: "pickup", type: "health" });
        }
        pickups.splice(i, 1);
      }
    }
    // occasional spawn
    if (Math.random() < 0.004 * dt * 60) spawnPickup();
  }

  function damagePlayer(dmg, fromX, fromY) {
    const p = player;
    if (p.dead || p.inv > 0) return false;
    p.hp = Math.max(0, p.hp - dmg);
    p.inv = 0.45; p.flash = 0.25;
    const dx = p.x - fromX, dy = p.y - fromY, d = Math.hypot(dx, dy) || 1;
    p.kx = (dx / d) * 160; p.ky = (dy / d) * 160;
    stats.zombieHits++;
    if (p.hp <= 0) {
      p.dead = true; setPlayerAnim("idle");
      const survived = Math.floor(time);
      bannerStats.textContent = `Kills: ${stats.kills} · Survived: ${survived}s · Wave ${stats.wave}`;
      banner.style.display = "block";
      log.push({ t: time, ev: "playerDead" });
    }
    return true;
  }

  // ---------- zombies ----------
  class Zombie {
    constructor(variant, x, y) {
      this.id = nextZombieId++;
      this.variant = variant; this.x = x; this.y = y;
      this.dir = DIRS[(Math.random() * 4) | 0];
      const vs = VARIANT_STATS[variant] || VARIANT_STATS._default;
      this.hp = vs.hp; this.maxHp = vs.hp; this.speedMult = vs.speed; this.dropChance = vs.dropChance;
      this.kx = 0; this.ky = 0;
      this.anim = "idle"; this.frame = 0; this.t = 0; this.done = false;
      this.state = "wander"; this.stateT = 0; this.alpha = 1;
      this.target = null; this.pause = rand(0.5, 2);
      this.lastSeen = null; this.lostT = 0; this.dealt = false; this.cooldown = 0; this.groanT = rand(2, 6); this.noticeMark = 0;
    }
    hittable() {
      return this.state !== "death" && this.state !== "decay" && this.state !== "fade" && A.z.hurtActive[this.anim] !== false;
    }
    setAnim(a) {
      if (this.anim === a) return;
      this.anim = a; this.frame = 0; this.t = 0; this.done = false;
    }
    setState(s) {
      if (this.state !== s) log.push({ t: time, ev: "zstate", zombie: this.id, from: this.state, to: s });
      this.state = s; this.stateT = 0;
    }
    takeHit(dmg, kb, fx, fy, isHead) {
      const mult = isHead ? 1.9 : 1;
      const final = Math.round(dmg * mult);
      this.hp -= final;
      // floating damage number above head
      const br = bodyRect(this);
      damagePops.push({
        x: this.x,
        y: br[1] - 4,
        text: (isHead ? "!" : "") + final,
        t: 0,
        life: 0.85,
        head: !!isHead
      });
      const dx = this.x - fx, dy = this.y - fy, d = Math.hypot(dx, dy) || 1;
      this.kx = (dx / d) * kb; this.ky = (dy / d) * kb;
      this.dir = dirFromVec(-dx, -dy, this.dir); // face the attacker
      this.lastSeen = { x: player.x, y: player.y };
      if (this.hp <= 0) {
        this.setState("death"); this.setAnim("death"); stats.kills++; playSpatial(["hit","hit2","hit3"][(Math.random()*3)|0], this.x, this.y, 0.55, 0.85 + Math.random() * 0.2);
        if (Math.random() < this.dropChance && pickups.length < 5) {
          pickups.push({ x: this.x, y: this.y, type: "health", t: 0 });
        }
      }
      else { this.setState("hurt"); this.setAnim("hurt"); this.anim = "hurt"; this.frame = 0; this.t = 0; this.done = false; }
    }
    advance(dt) {
      const info = A.z.anims[this.anim];
      this.t += dt * 1000;
      while (!this.done && this.t >= info.durs[this.frame]) {
        this.t -= info.durs[this.frame];
        if (this.frame + 1 >= info.frames) {
          if (info.loop) this.frame = 0; else { this.done = true; }
        } else this.frame++;
      }
    }
    canSeePlayer() {
      if (player.dead) return false;
      const d = Math.hypot(player.x - this.x, player.y - this.y);
      return d < SENSE_RADIUS && lineOfSight(this.x, this.y, player.x, player.y);
    }
    playerInReach() {
      const atk = A.z.attack[this.dir];
      const f = atk && atk.find((a) => a.active);
      if (!f) return false;
      const r = f.reach;
      return rectsOverlap([this.x + r[0], this.y + r[1], r[2], r[3]], footRect(player, A.p.foot));
    }
    steerTo(tx, ty, speed, dt) {
      let dx = tx - this.x, dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) return d;
      dx /= d; dy /= d;
      // separation from other living zombies
      let sx = 0, sy = 0;
      for (const o of zombies) {
        if (o === this || !o.solid()) continue;
        const ox = this.x - o.x, oy = (this.y - o.y) * 2.2, od = Math.hypot(ox, oy);
        if (od > 0 && od < 22) { sx += (ox / od) * (22 - od) / 22; sy += (oy / od) * (22 - od) / 22; }
      }
      let vx = dx + sx * 1.6, vy = dy + sy * 1.6;
      const vl = Math.hypot(vx, vy) || 1;
      vx /= vl; vy /= vl;
      moveWithCollision(this, A.z.foot, vx * speed * dt, vy * speed * dt);
      this.dir = dirFromVec(dx, dy, this.dir);
      return d;
    }
    solid() { return this.state !== "death" && this.state !== "decay" && this.state !== "fade"; }
    update(dt) {
      this.stateT += dt; this.cooldown = Math.max(0, this.cooldown - dt);
      // occasional soft groans only (no scream)
      if (this.solid() && this.state !== "sense") {
        this.groanT -= dt;
        if (this.groanT <= 0) {
          this.groanT = rand(5, 11);
          playSpatial(Math.random() < 0.5 ? "zombie_groan" : "zombie_groan2", this.x, this.y, 0.45, 0.8 + Math.random() * 0.4);
        }
      }
      if (this.noticeMark > 0) this.noticeMark = Math.max(0, this.noticeMark - dt);
      if (this.kx || this.ky) {
        moveWithCollision(this, A.z.foot, this.kx * dt, this.ky * dt);
        const k = Math.exp(-9 * dt); this.kx *= k; this.ky *= k;
        if (Math.hypot(this.kx, this.ky) < 2) this.kx = this.ky = 0;
      }
      this.advance(dt);
      const sees = this.solid() && this.canSeePlayer();
      if (sees) { this.lastSeen = { x: player.x, y: player.y }; this.lostT = 0; }
      switch (this.state) {
        case "wander": {
          if (sees) {
            this.setState("sense"); this.setAnim("sense");
            this.noticeMark = 1.4;
            playSpatial("zombie_scream", this.x, this.y, 0.85, 0.92 + Math.random() * 0.16);
            break;
          }
          if (this.pause > 0) {
            this.setAnim("idle"); this.pause -= dt;
            if (this.pause <= 0) {
              const a = rand(0, Math.PI * 2), r = rand(30, 90);
              this.target = { x: clamp(this.x + Math.cos(a) * r, 30, WORLD_W - 30), y: clamp(this.y + Math.sin(a) * r, 60, WORLD_H - 20) };
            }
          } else {
            this.setAnim("walk");
            const px = this.x, py = this.y;
            const d = this.steerTo(this.target.x, this.target.y, Z_WALK * this.speedMult, dt);
            const stuck = Math.hypot(this.x - px, this.y - py) < Z_WALK * dt * 0.2;
            if (d < 4 || stuck || this.stateT > 8) { this.pause = rand(1, 3); this.stateT = 0; }
          }
          break;
        }
        case "sense": // play sense once, then turn toward the player and chase
          if (this.done) {
            if (this.lastSeen) this.dir = dirFromVec(this.lastSeen.x - this.x, this.lastSeen.y - this.y, this.dir);
            this.setState("chase"); this.setAnim("run");
          }
          break;
        case "chase": {
          if (player.dead) { this.setState("wander"); this.pause = rand(1, 2); break; }
          if (!sees) {
            this.lostT += dt;
            if (this.lostT > LOSE_TIME || !this.lastSeen) { this.setState("wander"); this.pause = rand(1, 2); break; }
          }
          this.setAnim("run");
          if (this.cooldown <= 0 && this.playerInReach()) {
            this.setState("attack"); this.setAnim("attack"); this.dealt = false; break;
          }
          const tgt = sees ? player : this.lastSeen;
          const d = this.steerTo(tgt.x, tgt.y, Z_RUN * this.speedMult, dt);
          if (!sees && d < 4) { this.setState("wander"); this.pause = rand(1, 2); }
          // face player squarely when close (helps reach line up)
          if (sees && d < 26) this.dir = dirFromVec(player.x - this.x, player.y - this.y, this.dir);
          break;
        }
        case "attack": {
          const f = A.z.attack[this.dir][this.frame];
          if (f && f.active && !this.dealt) {
            const r = f.reach;
            if (rectsOverlap([this.x + r[0], this.y + r[1], r[2], r[3]], footRect(player, A.p.foot))) {
              if (damagePlayer(10, this.x, this.y)) {
                this.dealt = true; // damage once per attack
                log.push({ t: time, ev: "zombieHit", zombie: this.id, frame: this.frame, kind: f.kind });
              }
            }
          }
          if (this.done) { this.cooldown = 0.35; this.setState("chase"); this.setAnim("run"); }
          break;
        }
        case "hurt":
          if (this.done) { this.setState("chase"); this.setAnim("run"); this.lostT = 0; }
          break;
        case "death":
          if (this.done) { this.setState("decay"); this.setAnim("decay"); }
          break;
        case "decay":
          if (this.done) this.setState("fade");
          break;
        case "fade":
          this.alpha = Math.max(0, 1 - this.stateT / 2);
          if (this.alpha <= 0) this.remove = true;
          break;
      }
    }
  }

  function spawnZombie(awayFromPlayer = 220) {
    const v = A.z.variants[zombies.length % A.z.variants.length];
    const s = freeSpot(A.z.foot, player.x, player.y, awayFromPlayer);
    zombies.push(new Zombie(v, s.x, s.y));
  }
  function resetWorld() {
    resetPlayer();
    zombies = [];
    projectiles = [];
    pickups = [];
    damagePops = [];
    stats.kills = 0;
    stats.wave = 1;
    stats.startTime = performance.now() / 1000;
    time = 0;
    for (let i = 0; i < ZOMBIE_COUNT; i++) spawnZombie();
    banner.style.display = "none";
    setWeapon(player.weapon);
  }

  // Hard separation (no stacking) between living bodies, incl. player.
  function resolveOverlaps() {
    const bodies = zombies.filter((z) => z.solid());
    const all = player.dead ? bodies : bodies.concat([player]);
    const rx = A.z.foot.rx, ry = A.z.foot.ry;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const dx = b.x - a.x, dy = (b.y - a.y) * (rx / ry);
      const d = Math.hypot(dx, dy), min = rx * 2;
      if (d > 0 && d < min) {
        const push = (min - d) / 2, nx = dx / d, ny = dy / d;
        const aw = a === player ? 0.15 : 1, bw = b === player ? 0.15 : 1;
        moveWithCollision(a, a === player ? A.p.foot : A.z.foot, -nx * push * aw, -ny * push * aw * (ry / rx));
        moveWithCollision(b, b === player ? A.p.foot : A.z.foot, nx * push * bw, ny * push * bw * (ry / rx));
      }
    }
  }

  // ---------- render ----------
  function resize() {
    scale = Math.max(2, Math.min(6, Math.floor(window.innerWidth / 240), Math.floor(window.innerHeight / 160)));
    viewW = Math.ceil(window.innerWidth / scale);
    viewH = Math.ceil(window.innerHeight / scale);
    canvas.width = viewW * scale; canvas.height = viewH * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function drawPlayer() {
    const p = player, P = A.p, F = P.frame;
    const ox = Math.round(p.x - P.pivot[0] - camX), oy = Math.round(p.y - P.pivot[1] - camY);
    const row = P.rows[p.anim + "_" + p.dir];
    const sx = p.frame * F, sy = row.index * F;
    ctx.save();
    if (p.dead) ctx.globalAlpha = 0.45;
    else if (p.flash > 0 && Math.floor(p.flash * 30) % 2 === 0) ctx.globalAlpha = 0.55;
    ctx.drawImage(P.shadow, ox, oy);

    const att = p.anim === ATTACK ? P.attack[p.dir][p.frame] : null;
    const w = att ? att.w : carryPose(p);
    if (att && att.w.smear) ctx.drawImage(P.smear, sx, sy, F, F, ox, oy, F, F); // always under body
    if (w && w.order === "behind") drawWeapon(w, ox, oy);
    ctx.drawImage(P.sheet, sx, sy, F, F, ox, oy, F, F);
    if (w && w.order !== "behind") {
      drawWeapon(w, ox, oy);
      if (att) ctx.drawImage(P.hands, sx, sy, F, F, ox, oy, F, F); // fingers over handle
    }
    ctx.restore();
  }
  // Outside of the swing, carry the weapon low at the hand anchor from layout.json.
  function carryPose(p) {
    const an = A.p.layout.anchors && A.p.layout.anchors[p.anim + "_" + p.dir];
    const a = an && an[p.frame];
    if (!a) return null;
    const pick = { down: ["hand_r", 100, "front"], up: ["hand_l", 260, "behind"],
      left: ["hand_near", 115, "front"], right: ["hand_near", 65, "front"] }[p.dir];
    const hand = a[pick[0]] || a.hand_near || a.hand_r || a.hand_main;
    if (!hand) return null;
    return { grip: hand, angle: pick[1], scale: 0.75, order: pick[2], flip_v: p.dir === "left" };
  }
  function drawWeapon(w, ox, oy) {
    const W = A.p.weapons, img = A.p.rot[player.weapon];
    if (!img) return; // ranged weapons (pistol) have no rotation sheet
    const tile = W.tile || 64, piv = W.tile_pivot || [32, 32], steps = W.steps || 32;
    const col = ((Math.round(w.angle / (360 / steps)) % steps) + steps) % steps;
    let si = 0, best = 1e9;
    W.scales.forEach((s, i) => { const d = Math.abs(s - (w.scale || 1)); if (d < best) { best = d; si = i; } });
    const rowsAvail = Math.floor(img.height / tile);
    const flip = w.flip_v && rowsAvail >= W.scales.length * 2 ? 1 : 0;
    const r = si + W.scales.length * flip;
    ctx.drawImage(img, col * tile, r * tile, tile, tile,
      Math.round(ox + w.grip[0] - piv[0]), Math.round(oy + w.grip[1] - piv[1]), tile, tile);
  }

  function drawZombie(z) {
    const Z = A.z, F = Z.frame;
    const ox = Math.round(z.x - Z.pivot[0] - camX), oy = Math.round(z.y - Z.pivot[1] - camY);
    const row = Z.rows[z.anim + "_" + z.dir];
    const sx = z.frame * F, sy = row.index * F;
    ctx.save();
    ctx.globalAlpha = z.alpha;
    ctx.drawImage(Z.shadow, sx, sy, F, F, ox, oy, F, F);
    const sheets = Z.sheets[z.variant];
    if (z.anim === "death" || z.anim === "decay") {
      ctx.drawImage(sheets.full, sx, sy, F, F, ox, oy, F, F); // composite keeps the pool under the corpse
    } else {
      ctx.drawImage(sheets.nofx, sx, sy, F, F, ox, oy, F, F);
      if (z.anim === "hurt") ctx.drawImage(Z.fx, sx, sy, F, F, ox, oy, F, F); // blood spray layer
    }
    ctx.restore();
    // small red exclamation mark right above head on notice
    if (z.noticeMark > 0 && z.solid()) {
      const br = bodyRect(z);
      const mx = Math.round(z.x - camX);
      const my = Math.round(br[1] - camY) - 6;
      const pulse = 1 + Math.sin(time * 14) * 0.1;
      ctx.save();
      ctx.translate(mx, my);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = "#ff2a2a";
      ctx.strokeStyle = "#3a0000";
      ctx.lineWidth = 0.6;
      // smaller body
      ctx.fillRect(-1.2, -9, 2.4, 6.5);
      ctx.strokeRect(-1.2, -9, 2.4, 6.5);
      // smaller dot
      ctx.beginPath();
      ctx.arc(0, -0.8, 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function strokeRect(r, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1 / scale * 2;
    ctx.strokeRect(r[0] - camX + 0.5 / scale, r[1] - camY + 0.5 / scale, r[2], r[3]);
  }
  function strokeEllipse(x, y, f, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 1 / scale * 2;
    ctx.beginPath(); ctx.ellipse(x + f.cx - camX, y + f.cy - camY, f.rx, f.ry, 0, 0, Math.PI * 2); ctx.stroke();
  }
  function frameBox(x, y, piv, r) { return [x + r[0] - piv[0], y + r[1] - piv[1], r[2], r[3]]; }
  function drawDebug() {
    const P = A.p, Z = A.z, p = player;
    for (const w of WALLS) strokeRect(w, "rgba(255,255,255,0.6)");
    // player hurtbox (per-frame bounds), collision ellipse, reach
    const phf = P.hit.hurtbox_frames && P.hit.hurtbox_frames[p.anim + "_" + p.dir];
    const pr = (phf && phf[p.frame]) || (P.hit.hurtbox[p.dir] && P.hit.hurtbox[p.dir].rect);
    if (pr && !p.dead) strokeRect(frameBox(p.x, p.y, P.pivot, pr), "#4aa8ff");
    strokeEllipse(p.x, p.y, P.foot, "#4cff7a");
    if (p.anim === ATTACK) {
      const f = P.attack[p.dir][p.frame];
      // show the reach for the whole swing faintly, solid on active frames
      const any = P.attack[p.dir].find((a) => a.active);
      const r = (f && f.active ? f : any) && (f && f.active ? f : any).reach[p.weapon];
      if (r) strokeRect([p.x + r[0], p.y + r[1], r[2], r[3]], f && f.active ? "#ff3b3b" : "rgba(255,59,59,0.35)");
    }
    for (const z of zombies) {
      if (z.alpha <= 0) continue;
      const v = Z.hit.variants[z.variant];
      if (z.hittable()) {
        const hf = v.hurtbox_frames && v.hurtbox_frames[z.anim + "_" + z.dir];
        const r = (hf && hf[z.frame]) || (v.hurtbox[z.dir] && v.hurtbox[z.dir].rect);
        if (r) strokeRect(frameBox(z.x, z.y, Z.pivot, r), "#4aa8ff");
        strokeEllipse(z.x, z.y, Z.foot, "#4cff7a");
      }
      if (z.anim === "attack") {
        const f = Z.attack[z.dir][z.frame];
        if (f && f.reach) strokeRect([z.x + f.reach[0], z.y + f.reach[1], f.reach[2], f.reach[3]], f.active ? "#ff9a2e" : "rgba(255,154,46,0.35)");
      }
      if (z.solid()) {
        ctx.fillStyle = "#fff"; ctx.font = "5px monospace";
        ctx.fillText(z.state, Math.round(z.x - camX - 10), Math.round(z.y - camY - 46));
      }
    }
    if (!p.dead) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1 / scale;
      ctx.beginPath(); ctx.arc(p.x - camX, p.y - camY, SENSE_RADIUS, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function draw() {
    ctx.fillStyle = "#1a1c16"; ctx.fillRect(0, 0, viewW, viewH);
    ctx.drawImage(ground, -camX, -camY);
    for (const w of WALLS) drawWall(w, "shadow");
    // corpses on the floor first, then y-sorted living things + walls
    const corpses = zombies.filter((z) => !z.solid());
    for (const z of corpses) drawZombie(z);
    const items = zombies.filter((z) => z.solid()).map((z) => ({ y: z.y, f: () => drawZombie(z) }));
    items.push({ y: player.y, f: drawPlayer });
    for (const w of WALLS) items.push({ y: w[1] + w[3], f: () => drawWall(w, "body") });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.f();
    if (debug) drawDebug();
    // projectiles: 2px blazing hot flash + visible smoke trail
    for (const pr of projectiles) {
      // dark smoke trail that evaporates quickly
      if (pr.trail) {
        for (const p of pr.trail) {
          const a = 1 - p.t / 0.10;
          if (a <= 0) continue;
          const x = Math.round(p.x - camX), y = Math.round(p.y - camY);
          ctx.fillStyle = `rgba(40,40,42,${(a * 0.55).toFixed(3)})`;
          ctx.fillRect(x, y, 1, 1);
          if (a > 0.4) {
            ctx.fillStyle = `rgba(20,20,22,${(a * 0.35).toFixed(3)})`;
            ctx.fillRect(x + 1, y, 1, 1);
          }
        }
      }
      // small 2px hot tip (no large glow)
      const x = Math.round(pr.x - camX), y = Math.round(pr.y - camY);
      ctx.fillStyle = "#ffe8a0";
      ctx.fillRect(x, y, 2, 2);
      ctx.fillStyle = "#fffef5";
      ctx.fillRect(x, y, 1, 1);
    }
    // pickups
    for (const pk of pickups) {
      const x = Math.round(pk.x - camX), y = Math.round(pk.y - camY);
      const bob = Math.sin(pk.t * 4) * 1.5;
      ctx.fillStyle = "#5cdb6e";
      ctx.fillRect(x - 4, y - 4 + bob, 8, 8);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x - 1, y - 3 + bob, 2, 6);
      ctx.fillRect(x - 3, y - 1 + bob, 6, 2);
    }
    // rain
    ctx.strokeStyle = "rgba(180,200,220,0.35)";
    ctx.lineWidth = 1;
    for (const d of rainDrops) {
      const x = d.x - camX, y = d.y - camY;
      if (x > -10 && x < viewW + 10 && y > -10 && y < viewH + 10) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 1, y + d.len);
        ctx.stroke();
      }
    }
    // blood particles
    for (const b of bloodParticles) {
      const x = b.x - camX, y = b.y - camY;
      ctx.globalAlpha = Math.max(0, b.life * 2);
      ctx.fillStyle = "#8b1e1e";
      ctx.fillRect(x, y, b.size, b.size);
    }
    ctx.globalAlpha = 1;

    // floating damage numbers
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    for (const p of damagePops) {
      const a = 1 - p.t / p.life;
      const x = Math.round(p.x - camX);
      const y = Math.round(p.y - camY);
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.head ? "#ffee55" : "#ffffff";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 0.8;
      ctx.strokeText(p.text, x, y);
      ctx.fillText(p.text, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";

    // off-screen detection indicators (edge of screen)
    const margin = 10;
    for (const z of zombies) {
      if (!z.solid()) continue;
      const detected = z.state === "sense" || z.state === "chase" || z.state === "attack";
      if (!detected) continue;
      const sx = z.x - camX;
      const sy = z.y - camY;
      const onScreen = sx >= 2 && sx <= viewW - 2 && sy >= 2 && sy <= viewH - 2;
      if (onScreen) continue;
      // clamp to screen edge in the direction of the zombie
      const cx = viewW / 2, cy = viewH / 2;
      const dx = z.x - (camX + cx), dy = z.y - (camY + cy);
      const angle = Math.atan2(dy, dx);
      const hw = viewW / 2 - margin, hh = viewH / 2 - margin;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const tx = Math.abs(cos) < 0.001 ? 1e9 : hw / Math.abs(cos);
      const ty = Math.abs(sin) < 0.001 ? 1e9 : hh / Math.abs(sin);
      const t = Math.min(tx, ty);
      const ex = cx + cos * t;
      const ey = cy + sin * t;
      const pulse = 1 + Math.sin(time * 10) * 0.08;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = "#ff2a2a";
      ctx.strokeStyle = "#3a0000";
      ctx.lineWidth = 0.7;
      ctx.fillRect(-1.4, -10, 2.8, 7);
      ctx.strokeRect(-1.4, -10, 2.8, 7);
      ctx.beginPath();
      ctx.arc(0, -1, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // atmospheric fog / vignette
    const fog = ctx.createRadialGradient(viewW/2, viewH/2, viewW*0.25, viewW/2, viewH/2, viewW*0.75);
    fog.addColorStop(0, "rgba(80,90,100,0.0)");
    fog.addColorStop(0.6, "rgba(60,70,80,0.08)");
    fog.addColorStop(1, "rgba(40,50,60,0.22)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, viewW, viewH);
    // light rain mist overlay
    ctx.fillStyle = "rgba(140,160,180,0.06)";
    ctx.fillRect(0, 0, viewW, viewH);
  }


  function updateDamagePops(dt) {
    for (const p of damagePops) {
      p.t += dt;
      p.y -= 18 * dt; // float upward
    }
    damagePops = damagePops.filter((p) => p.t < p.life);
  }

  // ---------- loop ----------
  function step(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now; time += dt;
    updatePlayer(dt);
    updateProjectiles(dt);
    updatePickups(dt);
    updateRain(dt);
    updateBlood(dt);
    updateDamagePops(dt);
    for (const z of zombies) z.update(dt);
    resolveOverlaps();
    const before = zombies.length;
    zombies = zombies.filter((z) => !z.remove);
    // wave progression
    const targetCount = ZOMBIE_COUNT + (stats.wave - 1);
    for (let i = zombies.length; i < Math.max(before, targetCount); i++) spawnZombie(260);
    // advance wave by time or kills
    const nextWaveByTime = Math.floor(time / WAVE_INTERVAL) + 1;
    const nextWaveByKills = Math.floor(stats.kills / KILLS_PER_WAVE) + 1;
    const newWave = Math.max(nextWaveByTime, nextWaveByKills);
    if (newWave > stats.wave) {
      stats.wave = newWave;
      log.push({ t: time, ev: "wave", wave: stats.wave });
    }
    // HUD
    hpFill.style.width = (player.hp / PLAYER_HP) * 100 + "%";
    stamFill.style.width = (player.stamina / MAX_STAMINA) * 100 + "%";
    const survived = Math.floor(time);
    const ammoTxt = player.weapon === "pistol" ? ` · Ammo ${Math.floor(player.ammo || 0)}` : "";
    statsLabel.textContent = `Kills: ${stats.kills} · Time: ${survived}s · Wave ${stats.wave}${ammoTxt}`;
    camX = clamp(player.x - viewW / 2, 0, Math.max(0, WORLD_W - viewW));
    camY = clamp(player.y - 20 - viewH / 2, 0, Math.max(0, WORLD_H - viewH));
    draw();
    requestAnimationFrame(step);
  }

  // ---------- input ----------
  const PREVENT = ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F1", "Space"];
  window.addEventListener("keydown", (e) => {
    ensureAudioCtx();
    if (PREVENT.includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (!ready || e.repeat) return;
    if (e.code === "KeyJ" || e.code === "Space") startAttack();
    else if (e.code === "KeyQ") cycleWeapon(-1);
    else if (e.code === "KeyE") cycleWeapon(1);
    else if (/^Digit[1-9]$/.test(e.code)) { const n = A.p.weaponNames[+e.code.slice(5) - 1]; if (n) setWeapon(n); }
    else if (e.code === "F1" || e.code === "KeyB") debug = !debug;
    else if (e.code === "KeyR") resetWorld();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());
  window.addEventListener("resize", resize);
  canvas.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener("mousedown", (e) => {
    ensureAudioCtx();
    if (!ready || e.button !== 0) return;
    const wx = e.clientX / scale + camX, wy = e.clientY / scale + camY;
    startAttack(wx - player.x, wy - (player.y - 20));
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // test hooks for verification
  window.__game = {
    get state() {
      return { ready, debug, anim: player.anim, dir: player.dir, frame: player.frame, x: player.x, y: player.y,
        hp: player.hp, dead: player.dead, weapon: player.weapon, scale, viewW, viewH, stats: { ...stats },
        zombies: zombies.map((z) => ({ id: z.id, variant: z.variant, state: z.state, anim: z.anim, frame: z.frame, dir: z.dir, hp: z.hp, x: z.x, y: z.y, alpha: z.alpha })) };
    },
    log,
    weapons: () => A.p.weaponNames.slice(),
    rows: () => ({ player: Object.keys(A.p.rows), zombie: Object.keys(A.z.rows) }),
    // place a zombie relative to the player (testing only)
    placeZombie(id, dx, dy, dir) { const z = zombies.find((q) => q.id === id); if (z) { z.x = player.x + dx; z.y = player.y + dy; if (dir) z.dir = dir; } },
    setPlayer(x, y, dir) { player.x = x; player.y = y; if (dir) player.dir = dir; },
    setZombieState(id, s, anim) { const z = zombies.find((q) => q.id === id); if (z) { z.setState(s); z.setAnim(anim); } },
    godMode(on) { player.inv = on ? 1e9 : 0; },
  };

  loadAssets().then((assets) => {
    A = assets;
    makeGround(); resize();
    player.weapon = A.p.weaponNames[0];
    resetWorld();
    ready = true;
    last = performance.now();
    requestAnimationFrame(step);
  }).catch((err) => console.error(err));
})();
