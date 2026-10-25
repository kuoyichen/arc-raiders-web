'use strict';
// 地表遠征：實體、戰鬥、AI、渲染

let UID = 0;
const TAU = Math.PI * 2;
const rand = Math.random;
const rr = (a, b) => a + rand() * (b - a);

const Raid = {
  active: false,
  paused: false,

  init(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.mm = document.getElementById('minimap');
    this.mmCtx = this.mm.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.hud = {};
    for (const id of ['hpFill', 'shFill', 'stFill', 'hpTxt', 'shTxt', 'wName', 'wAmmo', 'wAlt', 'timer', 'objective', 'feed', 'prompt', 'progress', 'progFill', 'progTxt', 'hurt', 'cntHeal', 'cntShield', 'cntGren', 'btnInteract', 'extractBar', 'banner'])
      this.hud[id] = document.getElementById(id);
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.vw = this.cv.clientWidth || window.innerWidth; this.vh = this.cv.clientHeight || window.innerHeight;
    this.cv.width = Math.floor(this.vw * dpr); this.cv.height = Math.floor(this.vh * dpr);
    // 依螢幕大小決定縮放，讓手機與電腦看到的範圍差不多
    this.scale = clamp(Math.min(this.vw, this.vh) / 640, 0.5, 1.5) * (Math.max(this.vw, this.vh) < 900 ? 0.95 : 1);
  },

  // ---------- 開局 ----------
  start(mapId) {
    this.resize();
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    World.gen(mapId, seed);
    this.mapId = mapId;
    this.map = MAPS[mapId];
    this.time = RAID_TIME;
    this.elapsed = 0;
    this.arcs = []; this.raiders = []; this.bullets = []; this.lobs = []; this.fx = []; this.texts = [];
    this.grenades = []; this.beams = []; this.marks = [];
    this.kills = { arc: 0, raider: 0, byType: {} };
    this.xpGain = 0;
    this.lootValue = 0;
    this.feedItems = [];
    this.cam = { x: World.playerSpawn.x, y: World.playerSpawn.y, shake: 0 };
    this.spawnT = 30;
    this.lateRaiders = [100, 220];
    this.warned = false;
    this.ended = false;
    this.queenSeen = false;
    this.hurtA = 0; this.hurtDir = null;
    this.openC = null;

    const L = S.loadout;
    const mk = w => w ? { k: w.k, lvl: w.lvl || 1, ammo: WEAPONS[w.k].mag } : null;
    const sh = L.shield ? SHIELDS[L.shield.k] : null;
    const maxHp = 100 + skillLv('vitality') * 10;
    this.p = {
      id: ++UID, kind: 'player', team: 'player', alive: true, name: '你',
      x: World.playerSpawn.x, y: World.playerSpawn.y, r: 14, ang: 0,
      hp: maxHp, maxHp, shieldK: L.shield ? L.shield.k : null,
      sh: sh ? sh.cap : 0, shMax: sh ? sh.cap : 0, mit: sh ? sh.mit : 0, slow: sh ? sh.slow : 1,
      weapons: [mk(L.w[0]), mk(L.w[1])], cur: L.w[0] ? 0 : 1,
      stam: 100 * (1 + skillLv('stamina') * 0.2), stamMax: 100 * (1 + skillLv('stamina') * 0.2), stamCd: 0,
      fireT: 0, reloadT: 0, burst: 0, burstT: 0, bloom: 0, using: null, search: null,
      bag: L.bag.map(e => Object.assign({}, e)), pocket: L.pocket.map(e => Object.assign({}, e)),
      extractT: 0, hitT: 0, moving: false, sprint: false,
    };
    S.loadout = { w: [null, null], shield: null, bag: [], pocket: [] };
    S.stats.raids++;
    saveGame();

    this.populate();
    this.buildMinimap();
    // 觸控裝置關閉陰影模糊以節省效能
    if (Input.touch && !this.lowFx) {
      this.lowFx = true;
      Object.defineProperty(this.ctx, 'shadowBlur', { set() {}, get() { return 0; } });
    }
    this.active = true; this.paused = false;
    Input.enabled = true;
    Input.resetTouch();
    this.say(`已空降至 ${this.map.name}。搜刮物資並在 ${Math.round(RAID_TIME / 60)} 分鐘內撤離！`, '#9fe');
    this.banner(this.map.name, '找到撤離電梯並活著回來');
    UI.showCtrlHint();
    this.last = performance.now();
  },

  populate() {
    const d = this.map.danger;
    const away = [this.p];
    const rnd = Math.random;
    const counts = { wasp: 8, tick: 6, pop: 3, hornet: 2, leaper: 1 };
    for (const k in counts) {
      const n = Math.round(counts[k] * d);
      for (let i = 0; i < n; i++) { const pt = World.randomOpen(rnd, away, 700); this.spawnArc(k, pt.x, pt.y); }
    }
    for (const z of World.hvZones) {
      for (let i = 0; i < 2; i++) {
        const pt = this.spotIn(z);
        if (pt) this.spawnArc('sentinel', pt.x, pt.y);
      }
      if (!z.boss && (this.mapId !== 'dam' || rnd() < 0.5)) {
        const pt = this.spotIn(z);
        if (pt) this.spawnArc('bastion', pt.x, pt.y);
      }
      const pt = this.spotIn(z);
      if (pt) this.spawnArc('hornet', pt.x, pt.y);
    }
    const qChance = { dam: 0, city: 0.4, port: 1 }[this.mapId];
    if (rnd() < qChance) {
      const z = World.hvZones.find(z => z.boss) || World.hvZones[0];
      const pt = { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      this.spawnArc('queen', pt.x, pt.y);
      this.say('⚠ 偵測到女王級 ARC 訊號！', '#f84');
    }
    const nr = 3 + Math.round(d * 1.5);
    for (let i = 0; i < nr; i++) this.spawnRaider();
  },

  spotIn(z) {
    for (let i = 0; i < 30; i++) {
      const x = z.x + 40 + rand() * (z.w - 80), y = z.y + 40 + rand() * (z.h - 80);
      if (!World.pointBlocked(x, y, 26)) return { x, y };
    }
    return null;
  },

  spawnArc(type, x, y) {
    const d = ARC[type];
    const e = {
      id: ++UID, kind: 'arc', type, def: d, team: 'arc', alive: true,
      x, y, r: d.r, hp: d.hp, maxHp: d.hp, ang: rand() * TAU, home: { x, y },
      state: 'idle', target: null, alert: null, thinkT: rand() * 0.3, cool: rand() * 1.5, burst: 0, fireT: 0,
      path: null, repathT: 0, wanderT: 0, goal: null, hitT: 0, phase: rand() * 10, lostT: 0, seenT: 0,
      charge: 0, arm: 0, jump: null, sweep: null, atk: 0, stuckT: 0, lx: x, ly: y,
    };
    this.arcs.push(e);
    return e;
  },

  spawnRaider(late) {
    const rnd = Math.random;
    const pt = World.randomOpen(rnd, [this.p], late ? 900 : 1000);
    const pool = Object.keys(WEAPONS).filter(k => WEAPONS[k].r <= 2 + (this.map.danger > 1.3 ? 1 : 0));
    const wk = pool[Math.floor(rnd() * pool.length)];
    const shk = rnd() < 0.3 ? null : (rnd() < 0.6 ? 'shield_light' : (rnd() < 0.7 ? 'shield_med' : 'shield_heavy'));
    const sh = shk ? SHIELDS[shk] : null;
    const used = this.raiders.map(r => r.name);
    const names = RAIDER_NAMES.filter(n => !used.includes(n));
    const bag = [];
    if (rnd() < 0.7) bag.push({ k: 'bandage', n: 1 + Math.floor(rnd() * 3) });
    if (rnd() < 0.4) bag.push({ k: 'shield_cell', n: 1 + Math.floor(rnd() * 2) });
    if (rnd() < 0.5) bag.push({ k: pickWeighted(CONTAINERS.crate.table, rnd), n: 1 });
    const r = {
      id: ++UID, kind: 'raider', team: 'raider', alive: true, name: names[Math.floor(rnd() * names.length)] || '掠手',
      x: pt.x, y: pt.y, r: 14, ang: rnd() * TAU, hp: 100, maxHp: 100,
      shieldK: shk, sh: sh ? sh.cap : 0, shMax: sh ? sh.cap : 0, mit: sh ? sh.mit : 0,
      w: { k: wk, lvl: 1 + Math.floor(rnd() * 2), ammo: WEAPONS[wk].mag }, fireT: 0, reloadT: 0, burst: 0, burstT: 0,
      hostile: rnd() < 0.6, revealed: false, waved: false, bag,
      state: 'roam', target: null, goal: null, path: null, repathT: 0, thinkT: rand() * 0.3, react: 0,
      strafe: 1, strafeT: 0, lootT: 0, looted: 0, lastSeen: null, lostT: 0, healT: 0, hitT: 0, calmT: 0,
      stuckT: 0, lx: pt.x, ly: pt.y, emote: null, emoteT: 0, leaveAt: RAID_TIME * (0.25 + rnd() * 0.45),
    };
    this.raiders.push(r);
    return r;
  },

  // ---------- 訊息 ----------
  say(txt, color = '#ddd') {
    this.feedItems.unshift({ txt, color, t: 6 });
    if (this.feedItems.length > 5) this.feedItems.length = 5;
    this.renderFeed();
  },
  renderFeed() {
    this.hud.feed.innerHTML = this.feedItems.map(f => `<div style="color:${f.color};opacity:${Math.min(1, f.t)}">${f.txt}</div>`).join('');
  },
  banner(title, sub) {
    const b = this.hud.banner;
    b.innerHTML = `<div class="bt">${title}</div><div class="bs">${sub}</div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  },
  float(x, y, txt, color, size = 14) { this.texts.push({ x, y, txt, color, size, t: 0.9, vy: -40 }); },

  // ---------- 主迴圈 ----------
  frame(now) {
    if (this.cv.clientWidth !== this.vw || this.cv.clientHeight !== this.vh) this.resize();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!this.active) return;
    if (dt > 0.1) dt = 0.1;
    if (!this.paused) this.update(dt);
    this.render();
    Input.endFrame();
  },

  update(dt) {
    this.pathBudget = 6;
    this.time -= dt;
    this.elapsed += dt;
    const p = this.p;

    if (this.time <= 60 && !this.warned) {
      this.warned = true;
      Sfx.play('alarm');
      this.say('⚠ 地表將在 60 秒後封鎖！立刻前往撤離點！', '#f66');
      this.banner('最後 60 秒', '地表即將封鎖');
    }
    if (this.time <= 0) { this.end(false, '地表封鎖，你被困在外面了'); return; }

    this.updatePlayer(dt);
    if (!this.active) return;
    if (UI.mode === 'loot' && this.openC && Math.hypot(this.openC.x - p.x, this.openC.y - p.y) > 90) UI.closePanel();
    for (const e of this.arcs) if (e.alive) this.updateArc(e, dt);
    for (const r of this.raiders) if (r.alive) this.updateRaider(r, dt);
    this.separate();
    this.updateBullets(dt);
    this.updateLobs(dt);
    this.updateGrenades(dt);
    this.updateExtracts(dt);
    this.arcs = this.arcs.filter(e => e.alive);
    this.raiders = this.raiders.filter(r => r.alive);

    // 增援
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 32 + rand() * 12;
      if (this.arcs.length < 42) {
        const pt = World.randomOpen(Math.random, [p], 850);
        const t = rand() < 0.55 ? 'wasp' : (rand() < 0.6 ? 'tick' : 'pop');
        const n = t === 'tick' ? 3 : 2;
        for (let i = 0; i < n; i++) this.spawnArc(t, pt.x + rr(-40, 40), pt.y + rr(-40, 40));
      }
    }
    if (this.lateRaiders.length && this.elapsed > this.lateRaiders[0]) {
      this.lateRaiders.shift();
      this.spawnRaider(true);
    }

    // 特效
    for (const f of this.fx) { f.t -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92; }
    this.fx = this.fx.filter(f => f.t > 0);
    if (this.fx.length > 500) this.fx.splice(0, this.fx.length - 500);
    for (const t of this.texts) { t.t -= dt; t.y += t.vy * dt; }
    this.texts = this.texts.filter(t => t.t > 0);
    for (const b of this.beams) b.t -= dt;
    this.beams = this.beams.filter(b => b.t > 0);
    let feedChanged = false;
    for (const f of this.feedItems) { const o = f.t; f.t -= dt; if (o > 1 || f.t <= 0) { if (f.t <= 1) feedChanged = true; } else feedChanged = true; }
    if (feedChanged) { this.feedItems = this.feedItems.filter(f => f.t > 0); this.renderFeed(); }
    this.hurtA = Math.max(0, this.hurtA - dt * 1.5);

    // 攝影機
    const look = Input.touch ? 60 : 90;
    const tx = p.x + Math.cos(p.ang) * look, ty = p.y + Math.sin(p.ang) * look;
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 6);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 6);
    this.cam.shake = Math.max(0, this.cam.shake - dt * 30);
  },

  // ---------- 玩家 ----------
  curW(a) { return a.weapons ? a.weapons[a.cur] : a.w; },

  wStats(w, a) {
    const d = WEAPONS[w.k];
    const lv = (w.lvl || 1) - 1;
    let rel = d.rel * (1 - 0.12 * lv), spr = d.spr * (1 - 0.15 * lv);
    if (a.kind === 'player') { rel *= 1 - 0.1 * skillLv('reload'); spr *= 1 - 0.1 * skillLv('steady'); }
    return { d, rel, spr };
  },

  updatePlayer(dt) {
    const p = this.p;
    if (!p.alive) return;
    p.hitT = Math.max(0, p.hitT - dt);

    // 輸入
    let mv = Input.touch && (Input.move.x || Input.move.y) ? Input.move : Input.keyMove();
    if (Input.touch && !(Input.move.x || Input.move.y)) { const km = Input.keyMove(); if (km.x || km.y) mv = km; }
    const mag = Math.hypot(mv.x, mv.y);
    let aiming = false, firing = false;
    if (Input.touch && (Input.aim.active || Input.fireHeld)) {
      aiming = true;
      if (Input.aim.active) p.ang = this.aimAssist(Math.atan2(Input.aim.y, Input.aim.x));
      else {
        // 只按開火鍵時，自動瞄準最近的可見敵人；沒有就朝面向方向射擊
        const t = this.nearestEnemy(650);
        if (t) p.ang += angDiff(p.ang, Math.atan2(t.y - p.y, t.x - p.x)) * Math.min(1, dt * 14);
        else if (mag > 0.1) p.ang = Math.atan2(mv.y, mv.x);
      }
      firing = Input.fireHeld || Input.aim.mag > 0.55;
    } else if (!Input.touch || Input.mouse.inside) {
      if (!Input.touch) {
        const wx = this.cam.x + (Input.mouse.x - this.vw / 2) / this.scale;
        const wy = this.cam.y + (Input.mouse.y - this.vh / 2) / this.scale;
        p.ang = Math.atan2(wy - p.y, wx - p.x);
        firing = Input.mouse.down && !UI.panelOpen();
        aiming = true;
      }
    }
    if (Input.touch && !aiming && mag > 0.1) {
      const target = Math.atan2(mv.y, mv.x);
      p.ang += angDiff(p.ang, target) * Math.min(1, dt * 10);
    }

    // 衝刺
    const wantSprint = Input.touch ? (mag > 0.92 && !aiming) : !!(Input.keys.ShiftLeft || Input.keys.ShiftRight);
    p.sprint = wantSprint && mag > 0.1 && p.stam > 1 && !p.using && !firing;
    if (p.sprint) { p.stam -= 28 * dt; p.stamCd = 1; }
    else { p.stamCd -= dt; if (p.stamCd <= 0) p.stam = Math.min(p.stamMax, p.stam + 20 * (1 + skillLv('stamina') * 0.2) * dt); }
    let spd = 165 * p.slow * (p.sprint ? 1.5 : 1);
    if (p.using) spd *= 0.5;
    if (p.search) spd *= 0.6;
    if (firing) spd *= 0.85;
    p.moving = mag > 0.1;
    p.x += mv.x * spd * dt; p.y += mv.y * spd * dt;
    World.resolveCircle(p);
    if (p.sprint) { p.noiseT = (p.noiseT || 0) - dt; if (p.noiseT <= 0) { p.noiseT = 0.5; this.noise(p.x, p.y, 260, p); } }

    // 動作
    if (Input.take('w1')) this.switchTo(0);
    if (Input.take('w2')) this.switchTo(1);
    if (Input.take('swap')) this.switchTo(1 - p.cur);
    if (Input.take('reload')) this.startReload(p);
    if (Input.take('heal')) this.quickUse('heal');
    if (Input.take('shield')) this.quickUse('shield');
    if (Input.take('grenade')) this.throwGrenade(p);
    if (Input.take('bag')) { if (UI.panelOpen()) UI.closePanel(); else UI.openBag(); }
    if (Input.take('map')) UI.toggleMap();
    if (Input.take('esc')) { if (UI.panelOpen()) UI.closePanel(); else UI.pause(true); }
    const inter = this.findInteract();
    this.interTarget = inter;
    if (Input.take('interact') && inter) this.interact(inter);

    // 物品使用
    if (p.using) {
      p.using.t -= dt;
      if (firing) { p.using = null; this.say('取消使用', '#aaa'); }
      else if (p.using.t <= 0) {
        const it = ITEMS[p.using.k];
        if (it.use.heal) { const h = it.use.heal * (S.fac.medbay >= 2 ? 1.2 : 1); p.hp = Math.min(p.maxHp, p.hp + h); this.float(p.x, p.y - 20, '+' + Math.round(h), '#6f6'); }
        if (it.use.shield) { p.sh = Math.min(p.shMax, p.sh + it.use.shield); this.float(p.x, p.y - 20, '+' + it.use.shield, '#6cf'); }
        p.using = null;
      }
    }
    // 搜刮
    if (p.search) {
      const c = p.search.c;
      if (Math.hypot(c.x - p.x, c.y - p.y) > 75 || firing) { p.search = null; }
      else {
        p.search.t -= dt;
        Sfx.play('search');
        if (p.search.t <= 0) {
          p.search = null;
          if (!c.searched) { c.searched = true; if (!c.items) c.items = this.rollLoot(c); this.giveXP(8); }
          UI.openLoot(c);
        }
      }
    }

    // 武器
    const w = this.curW(p);
    p.fireT -= dt;
    p.bloom = Math.max(0, p.bloom - dt * 8);
    if (w) {
      const st = this.wStats(w, p);
      if (p.reloadT > 0) {
        p.reloadT -= dt;
        if (p.reloadT <= 0) { w.ammo = st.d.mag; Sfx.play('reload'); }
      }
      if (p.burst > 0) {
        p.burstT -= dt;
        if (p.burstT <= 0 && w.ammo > 0) { this.shoot(p, w, st); p.burst--; p.burstT = 0.07; }
        else if (w.ammo <= 0) p.burst = 0;
      }
      if (firing && p.fireT <= 0 && p.reloadT <= 0 && p.burst <= 0 && !p.using) {
        if (w.ammo <= 0) { Sfx.play('empty'); this.startReload(p); }
        else {
          if (p.search) p.search = null;
          this.shoot(p, w, st);
          p.fireT = st.d.int * (st.d.auto ? 1 : (Input.touch ? 1.05 : 1));
          if (st.d.burst) { p.burst = st.d.burst - 1; p.burstT = 0.07; }
          if (w.ammo <= 0) this.startReload(p);
        }
      }
    }

    // 撤離
    const ex = World.extracts.find(e => e.state === 'open' && Math.hypot(e.x - p.x, e.y - p.y) < e.r);
    if (ex) {
      p.extractT += dt;
      if (p.extractT >= 3) { this.end(true, `經由${ex.name}成功撤離`); return; }
    } else p.extractT = 0;
  },

  aimAssist(a) {
    // 觸控瞄準輔助：吸附角度內最近的可見敵人
    const p = this.p;
    let best = null, bd = 0.22;
    const consider = (e, hostile) => {
      if (!e.alive || !hostile) return;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > 700) return;
      const da = Math.abs(angDiff(a, Math.atan2(e.y - p.y, e.x - p.x)));
      const score = da + d / 6000;
      if (score < bd && World.los(p.x, p.y, e.x, e.y)) { bd = score; best = e; }
    };
    for (const e of this.arcs) consider(e, true);
    for (const r of this.raiders) consider(r, r.hostile && r.revealed);
    if (!best) return a;
    return a + angDiff(a, Math.atan2(best.y - p.y, best.x - p.x)) * 0.75;
  },

  nearestEnemy(range) {
    const p = this.p;
    let best = null, bd = range;
    const consider = e => {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd && World.los(p.x, p.y, e.x, e.y)) { bd = d; best = e; }
    };
    for (const e of this.arcs) if (e.alive) consider(e);
    for (const r of this.raiders) if (r.alive && r.hostile && r.revealed) consider(r);
    return best;
  },

  switchTo(i) {
    const p = this.p;
    if (i === p.cur || !p.weapons[i]) return;
    p.cur = i; p.reloadT = 0; p.burst = 0; p.fireT = 0.25;
    Sfx.play('ui');
  },

  startReload(a) {
    const w = this.curW(a);
    if (!w || a.reloadT > 0) return;
    const st = this.wStats(w, a);
    if (w.ammo >= st.d.mag) return;
    a.reloadT = st.rel;
    a.burst = 0;
  },

  quickUse(kind) {
    const p = this.p;
    if (p.using) return;
    let opts;
    if (kind === 'heal') {
      if (p.hp >= p.maxHp) { this.say('生命值已滿', '#aaa'); return; }
      opts = p.maxHp - p.hp > 50 ? ['medkit', 'bandage'] : ['bandage', 'medkit'];
    } else {
      if (!p.shieldK) { this.say('沒有裝備護盾', '#aaa'); return; }
      if (p.sh >= p.shMax) { this.say('護盾已滿', '#aaa'); return; }
      opts = ['shield_cell'];
    }
    for (const k of opts) {
      const idx = p.bag.findIndex(e => e.k === k);
      if (idx >= 0) { this.useBagItem(idx); return; }
    }
    this.say(kind === 'heal' ? '背包裡沒有治療品' : '背包裡沒有護盾充能器', '#f99');
  },

  useBagItem(idx) {
    const p = this.p;
    const e = p.bag[idx];
    if (!e) return;
    const it = ITEMS[e.k];
    if (e.k === 'grenade') { this.throwGrenade(p); return; }
    if (!it.use || p.using) return;
    if (it.use.shield && !p.shieldK) { this.say('沒有裝備護盾', '#aaa'); return; }
    e.n--; if (e.n <= 0) p.bag.splice(idx, 1);
    const speed = 1 + skillLv('medic') * 0.25;
    p.using = { k: e.k, t: it.use.t / speed, total: it.use.t / speed };
    p.search = null;
    UI.refreshPanel();
  },

  throwGrenade(a) {
    if (a.kind === 'player') {
      const idx = a.bag.findIndex(e => e.k === 'grenade');
      if (idx < 0) { this.say('背包裡沒有手雷', '#f99'); return; }
      a.bag[idx].n--; if (a.bag[idx].n <= 0) a.bag.splice(idx, 1);
      UI.refreshPanel();
    }
    let d = 300;
    if (a.kind === 'player' && !Input.touch) {
      const wx = this.cam.x + (Input.mouse.x - this.vw / 2) / this.scale, wy = this.cam.y + (Input.mouse.y - this.vh / 2) / this.scale;
      d = clamp(Math.hypot(wx - a.x, wy - a.y), 60, 380);
    }
    const sp = d * 2.0;
    this.grenades.push({ x: a.x, y: a.y, vx: Math.cos(a.ang) * sp, vy: Math.sin(a.ang) * sp, t: 1.25, owner: a });
  },

  findInteract() {
    const p = this.p;
    let best = null, bd = 60;
    for (const c of World.containers) {
      if (c.searched && c.items && c.items.length === 0) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) { bd = d; best = { type: 'container', c }; }
    }
    for (const e of World.extracts) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < 90 && e.state === 'idle') return { type: 'extract', e };
    }
    return best;
  },

  interact(t) {
    const p = this.p;
    if (t.type === 'container') {
      const c = t.c;
      if (c.searched) { UI.openLoot(c); return; }
      if (p.search && p.search.c === c) return;
      const tm = CONTAINERS[c.type].t / (1 + skillLv('scav') * 0.2);
      p.search = { c, t: tm, total: tm };
      p.using = null;
    } else if (t.type === 'extract') {
      this.callElevator(t.e, p);
    }
  },

  callElevator(e, who) {
    if (e.state !== 'idle') return;
    e.state = 'calling'; e.t = 25;
    this.noise(e.x, e.y, 1100, who);
    if (who.kind === 'player') {
      Sfx.play('beep');
      this.say(`已呼叫${e.name}，25 秒後抵達。守住！`, '#ff6');
      // 電梯的聲響會吸引 ARC
      const n = 2 + Math.round(this.map.danger * 1.5);
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU, d = rr(650, 900);
        const x = clamp(e.x + Math.cos(a) * d, 50, World.W - 50), y = clamp(e.y + Math.sin(a) * d, 50, World.H - 50);
        if (World.pointBlocked(x, y, 20)) continue;
        const arc = this.spawnArc(rand() < 0.6 ? 'wasp' : 'tick', x, y);
        arc.state = 'investigate'; arc.alert = { x: e.x, y: e.y };
      }
    } else if (Math.hypot(e.x - this.p.x, e.y - this.p.y) < 1500) {
      this.say(`有掠手呼叫了${e.name}`, '#fc8');
    }
  },

  updateExtracts(dt) {
    for (const e of World.extracts) {
      if (e.state === 'calling') {
        e.t -= dt;
        if (e.t <= 0) {
          e.state = 'open'; e.t = 30;
          if (Math.hypot(e.x - this.p.x, e.y - this.p.y) < 1200) { Sfx.play('beep'); this.say(`${e.name}已開啟，進入電梯撤離！`, '#6f6'); }
        }
      } else if (e.state === 'open') {
        e.t -= dt;
        if (e.t <= 0) { e.state = 'cool'; e.t = 25; }
      } else if (e.state === 'cool') {
        e.t -= dt;
        if (e.t <= 0) e.state = 'idle';
      }
    }
  },

  // ---------- 戰利品 ----------
  rollLoot(c) {
    const def = CONTAINERS[c.type];
    const rnd = Math.random;
    let n = def.rolls[0] + Math.floor(rnd() * (def.rolls[1] - def.rolls[0] + 1));
    if (c.hv) n += 1;
    if (this.map.danger > 1.2 && rnd() < 0.4) n += 1;
    const items = [];
    for (let i = 0; i < n; i++) {
      let k = pickWeighted(def.table, rnd);
      if (k === 'W') k = this.randWeapon(c.hv);
      else if (k === 'S') k = rnd() < 0.55 ? 'shield_light' : (rnd() < 0.7 ? 'shield_med' : 'shield_heavy');
      const d = ITEMS[k];
      if (d.type === 'weapon') items.push({ k, n: 1, lvl: rnd() < 0.25 ? 2 : 1 });
      else if (d.st === 1) items.push({ k, n: 1 });
      else {
        const q = d.r === 0 ? 1 + Math.floor(rnd() * 4) : (d.r === 1 ? 1 + Math.floor(rnd() * 2) : 1);
        const ex = items.find(e => e.k === k && e.n + q <= d.st);
        if (ex) ex.n += q; else items.push({ k, n: q });
      }
    }
    return items;
  },

  randWeapon(hv) {
    const byR = [[], [], [], [], []];
    for (const k in WEAPONS) byR[WEAPONS[k].r].push(k);
    const w = hv ? [15, 35, 30, 15, 5] : [40, 36, 17, 6, 1];
    const r = pickWeighted(w.map((x, i) => [i, x]), Math.random);
    const list = byR[r].length ? byR[r] : byR[1];
    return list[Math.floor(Math.random() * list.length)];
  },

  giveXP(n) { this.xpGain += n; },

  // 從容器拿取
  takeItem(c, idx) {
    const p = this.p;
    const e = c.items[idx];
    if (!e) return;
    const d = ITEMS[e.k];
    if (d.type === 'weapon') {
      const slot = p.weapons[0] ? (p.weapons[1] ? -1 : 1) : 0;
      if (slot >= 0) {
        p.weapons[slot] = { k: e.k, lvl: e.lvl || 1, ammo: WEAPONS[e.k].mag };
        if (!this.curW(p)) p.cur = slot;
        c.items.splice(idx, 1);
        Sfx.play('loot'); this.say(`裝備了 ${d.name}`, RARITY[d.r].color);
        UI.refreshPanel();
        return;
      }
    }
    if (d.type === 'shield' && !p.shieldK) {
      this.equipShield(e);
      c.items.splice(idx, 1);
      UI.refreshPanel();
      return;
    }
    const left = bagAdd(p.bag, bagCap(), e);
    if (left === (e.n || 1)) { this.say('背包已滿', '#f99'); UI.toast('背包已滿'); return; }
    Sfx.play('loot');
    if (left > 0) e.n = left; else c.items.splice(idx, 1);
    UI.refreshPanel();
  },

  takeAll(c) {
    for (let i = c.items.length - 1; i >= 0; i--) {
      const before = c.items.length;
      this.takeItem(c, i);
      if (c.items.length === before && ITEMS[c.items[i].k].st > 1) { /* 放不下 */ }
    }
  },

  equipShield(e) {
    const p = this.p;
    const s = SHIELDS[e.k];
    if (p.shieldK) p.bag.push({ k: p.shieldK, n: 1, ch: p.sh });
    p.shieldK = e.k; p.shMax = s.cap; p.mit = s.mit; p.slow = s.slow;
    p.sh = e.ch != null ? Math.min(s.cap, e.ch) : s.cap;
    Sfx.play('loot'); this.say(`裝備了 ${s.name}`, RARITY[s.r].color);
  },

  bagAction(idx, act, fromPocket) {
    const p = this.p;
    const list = fromPocket ? p.pocket : p.bag;
    const e = list[idx];
    if (!e) return;
    const d = ITEMS[e.k];
    if (act === 'use') { if (!fromPocket) this.useBagItem(idx); return; }
    if (act === 'equip') {
      if (d.type === 'weapon') {
        list.splice(idx, 1);
        const slot = !p.weapons[0] ? 0 : !p.weapons[1] ? 1 : p.cur;
        const old = p.weapons[slot];
        p.weapons[slot] = { k: e.k, lvl: e.lvl || 1, ammo: WEAPONS[e.k].mag };
        if (old) list.push({ k: old.k, n: 1, lvl: old.lvl });
        p.cur = slot; p.reloadT = 0;
        Sfx.play('loot');
      } else if (d.type === 'shield') {
        list.splice(idx, 1);
        this.equipShield(e);
      }
    } else if (act === 'pocket') {
      if (p.pocket.length >= pocketCap()) { UI.toast('安全口袋已滿'); return; }
      const one = d.st > 1 && e.n > 1 ? { k: e.k, n: e.n } : e;
      list.splice(idx, 1);
      p.pocket.push(one);
      Sfx.play('ui');
    } else if (act === 'unpocket') {
      const left = bagAdd(p.bag, bagCap(), e);
      if (left === (e.n || 1)) { UI.toast('背包已滿'); return; }
      if (left > 0) e.n = left; else p.pocket.splice(idx, 1);
    } else if (act === 'drop') {
      list.splice(idx, 1);
      this.dropToGround([e]);
    }
    UI.refreshPanel();
  },

  unequipWeapon(slot) {
    const p = this.p;
    const w = p.weapons[slot];
    if (!w) return;
    if (p.bag.length >= bagCap()) { UI.toast('背包已滿'); return; }
    p.bag.push({ k: w.k, n: 1, lvl: w.lvl });
    p.weapons[slot] = null;
    if (p.cur === slot && p.weapons[1 - slot]) p.cur = 1 - slot;
    UI.refreshPanel();
  },

  dropToGround(items) {
    const p = this.p;
    const c = this.openC && Math.hypot(this.openC.x - p.x, this.openC.y - p.y) < 80 ? this.openC : null;
    if (c) { for (const e of items) c.items.push(e); return; }
    let pile = World.containers.find(k => k.type === 'pile' && Math.hypot(k.x - p.x, k.y - p.y) < 40);
    if (!pile) { pile = World.addContainer(p.x + rr(-10, 10), p.y + rr(-10, 10), 'pile', false); pile.searched = true; pile.items = []; }
    for (const e of items) pile.items.push(e);
  },

  // ---------- 噪音與傷害 ----------
  noise(x, y, radius, src) {
    const r2 = radius * radius;
    for (const e of this.arcs) {
      if (e.state === 'attack' || !e.alive) continue;
      if (dist2(e.x, e.y, x, y) < r2) { e.state = 'investigate'; e.alert = { x: x + rr(-60, 60), y: y + rr(-60, 60) }; e.path = null; e.repathT = 0; }
    }
    if (src && src.kind === 'player') {
      for (const r of this.raiders) {
        if (r.state === 'fight' || r.state === 'extract') continue;
        if (dist2(r.x, r.y, x, y) < r2 * 0.5 && r.hostile) { r.state = 'hunt'; r.lastSeen = { x, y }; r.path = null; r.repathT = 0; r.lostT = 0; }
      }
    }
  },

  shoot(a, w, st) {
    const d = st.d;
    let spr = st.spr;
    if (a.kind === 'player') { spr += a.bloom; if (a.moving) spr *= 1.35; if (a.sprint) spr *= 2; a.bloom = Math.min(8, a.bloom + (d.auto ? 0.7 : 0.4) * (1 - 0.15 * ((w.lvl || 1) - 1))); }
    else spr += a.kind === 'raider' ? 3.5 : 0;
    const sr = spr * Math.PI / 180;
    for (let i = 0; i < d.pel; i++) {
      const ang = a.ang + (rand() - 0.5) * sr * 2;
      const mx = a.x + Math.cos(a.ang) * (a.r + 8), my = a.y + Math.sin(a.ang) * (a.r + 8);
      this.bullets.push({ x: mx, y: my, vx: Math.cos(ang) * d.spd, vy: Math.sin(ang) * d.spd, dmg: d.dmg, team: a.team, owner: a, travel: 0, max: d.rng, heavy: d.dmg >= 40, col: a.kind === 'player' ? '#fff3a0' : '#ffb070' });
    }
    w.ammo--;
    const mx = a.x + Math.cos(a.ang) * (a.r + 10), my = a.y + Math.sin(a.ang) * (a.r + 10);
    this.fx.push({ x: mx, y: my, vx: 0, vy: 0, t: 0.05, max: 0.05, c: '#ffe08a', s: 9, glow: true });
    this.noise(a.x, a.y, d.noise, a);
    const vol = a.kind === 'player' ? 1 : 1 - Math.hypot(a.x - this.p.x, a.y - this.p.y) / 1300;
    Sfx.play(d.dmg >= 40 ? 'heavy' : 'shot', vol);
    if (a.kind === 'player') this.cam.shake = Math.min(6, this.cam.shake + (d.dmg >= 40 ? 4 : 1.2));
  },

  arcShoot(e, ang, dmg, spd, col = '#ff4a3a', r = 3) {
    this.bullets.push({ x: e.x + Math.cos(ang) * e.r, y: e.y + Math.sin(ang) * e.r, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, dmg, team: 'arc', owner: e, travel: 0, max: 900, col, rad: r });
    Sfx.play('eshot', 1 - Math.hypot(e.x - this.p.x, e.y - this.p.y) / 1000);
  },

  canHit(b, t) {
    if (!t.alive || t === b.owner) return false;
    if (b.team === 'arc') return t.team !== 'arc';
    if (b.team === 'player') return t.team !== 'player';
    if (b.team === 'raider') {
      if (t.team === 'arc') return true;
      if (t.team === 'player') return b.owner.hostile;
      return false;
    }
    return false;
  },

  updateBullets(dt) {
    const out = [];
    for (const b of this.bullets) {
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      let tw = World.rayWall(b.x, b.y, nx, ny);
      let hit = null, ht = 2, hd = 0;
      const test = t => {
        if (!this.canHit(b, t)) return;
        const pad = b.rad || 0;
        if (Math.abs(t.x - b.x) > 200 && Math.abs(t.x - nx) > 200) return;
        const h = segCircle(b.x, b.y, nx, ny, t.x, t.y, t.r + pad);
        if (h && h.t < ht) { ht = h.t; hit = t; hd = h.d; }
      };
      for (const e of this.arcs) test(e);
      for (const r of this.raiders) test(r);
      test(this.p);
      if (hit && ht <= tw) {
        let dmg = b.dmg, crit = false;
        if (b.team === 'player' || b.team === 'raider') {
          if (hd < hit.r * 0.38 && b.team === 'player') { crit = true; dmg *= hit.kind === 'raider' ? 2.5 : 2; }
          if (hit.kind === 'arc' && hit.def.back) {
            const l = Math.hypot(b.vx, b.vy);
            const dot = (b.vx / l) * Math.cos(hit.ang) + (b.vy / l) * Math.sin(hit.ang);
            if (dot > 0.4) { dmg *= hit.def.back; crit = true; }
          }
        }
        const hx = b.x + (nx - b.x) * ht, hy = b.y + (ny - b.y) * ht;
        this.damage(hit, dmg, b.owner, crit, hx, hy);
        for (let i = 0; i < 4; i++) this.fx.push({ x: hx, y: hy, vx: rr(-120, 120), vy: rr(-120, 120), t: 0.2, max: 0.2, c: hit.kind === 'arc' ? '#ffcc66' : '#ff5555', s: 2 });
        continue;
      }
      if (tw <= 1) {
        const hx = b.x + (nx - b.x) * tw, hy = b.y + (ny - b.y) * tw;
        for (let i = 0; i < 3; i++) this.fx.push({ x: hx, y: hy, vx: rr(-80, 80), vy: rr(-80, 80), t: 0.18, max: 0.18, c: '#cbb', s: 2 });
        continue;
      }
      b.travel += Math.hypot(nx - b.x, ny - b.y);
      b.px = b.x; b.py = b.y;
      b.x = nx; b.y = ny;
      if (b.travel < b.max) out.push(b);
    }
    this.bullets = out;
  },

  damage(t, dmg, src, crit, hx, hy) {
    if (!t.alive) return;
    let hpDmg = dmg;
    if ((t.kind === 'player' || t.kind === 'raider') && t.sh > 0) {
      hpDmg = dmg * (1 - t.mit);
      t.sh = Math.max(0, t.sh - dmg);
      if (t.kind === 'player') Sfx.play('shieldhit');
    }
    t.hp -= hpDmg;
    t.hitT = 0.12;
    const fromPlayer = src && src.kind === 'player';
    if (fromPlayer) {
      this.float(hx || t.x, (hy || t.y) - 10, Math.round(dmg) + (crit ? '!' : ''), crit ? '#ffd23c' : (t.sh > 0 ? '#8cf' : '#fff'), crit ? 18 : 13);
      Sfx.play(crit ? 'crit' : 'hit');
    }
    if (t.kind === 'player') {
      Sfx.play('hurt');
      this.hurtA = Math.min(1, this.hurtA + dmg / 40);
      if (src) this.hurtDir = { a: Math.atan2(src.y - t.y, src.x - t.x), t: 1 };
      this.cam.shake = Math.min(10, this.cam.shake + dmg / 4);
    }
    if (t.kind === 'raider' && src) {
      if (fromPlayer && !t.hostile) { t.hostile = true; this.emote(t, '你找死！'); }
      if (fromPlayer) t.revealed = true;
      if (t.state !== 'fight' || (fromPlayer && t.target !== src)) { t.state = 'fight'; t.target = src; t.react = 0.2; t.lostT = 0; }
    }
    if (t.kind === 'arc' && src && src.alive) {
      if (t.state !== 'attack') { t.state = 'attack'; t.target = src; t.seenT = 0.5; }
      else if (fromPlayer && rand() < 0.3) t.target = src;
      t.lostT = 0;
    }
    if (t.hp <= 0) this.kill(t, src);
  },

  kill(t, src) {
    t.alive = false;
    const fromPlayer = src && src.kind === 'player';
    if (t.kind === 'player') {
      Sfx.play('death');
      this.end(false, src ? `被${src.kind === 'arc' ? src.def.name : '掠手 ' + src.name}擊倒` : '你倒下了');
      return;
    }
    if (t.kind === 'arc') {
      this.boom(t.x, t.y, t.r * 1.6, 0, null);
      const items = [];
      for (const [k, n] of t.def.drops) items.push({ k, n });
      for (const [k, ch] of t.def.dropChance) if (rand() < ch) items.push({ k, n: 1 });
      const c = World.addContainer(t.x, t.y, 'wreck', false);
      c.items = items; c.arcType = t.type; c.big = t.r;
      if (fromPlayer) {
        this.kills.arc++;
        this.kills.byType[t.type] = (this.kills.byType[t.type] || 0) + 1;
        this.giveXP(t.def.xp);
        questEvent('kill', t.type);
        Sfx.play('kill');
        this.say(`擊毀 ${t.def.name} +${t.def.xp} XP`, '#fd8');
        if (t.type === 'queen') this.banner('女王已被擊毀', '帶著反應爐活著撤離！');
      }
    } else if (t.kind === 'raider') {
      const items = t.bag.slice();
      items.push({ k: t.w.k, n: 1, lvl: t.w.lvl });
      if (t.shieldK) items.push({ k: t.shieldK, n: 1, ch: 0 });
      const c = World.addContainer(t.x, t.y, 'body', false);
      c.items = items; c.name = t.name;
      for (let i = 0; i < 10; i++) this.fx.push({ x: t.x, y: t.y, vx: rr(-90, 90), vy: rr(-90, 90), t: 0.5, max: 0.5, c: '#a33', s: 3 });
      if (fromPlayer) {
        this.kills.raider++;
        this.giveXP(150);
        if (t.hostile) questEvent('kill', 'raider');
        Sfx.play('kill');
        this.say(`擊倒掠手 ${t.name} +150 XP`, '#fd8');
      } else {
        if (Math.hypot(t.x - this.p.x, t.y - this.p.y) < 1400) this.say(`掠手 ${t.name} 被 ARC 擊倒了`, '#aaa');
      }
    }
  },

  boom(x, y, radius, dmg, src, hitArc = true) {
    for (let i = 0; i < 18 + radius / 6; i++) {
      const a = rand() * TAU, s = rr(40, radius * 3);
      this.fx.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rr(0.3, 0.7), max: 0.7, c: rand() < 0.5 ? '#ff9a3c' : '#ffd36a', s: rr(3, 7), glow: true });
    }
    for (let i = 0; i < 6; i++) this.fx.push({ x, y, vx: rr(-30, 30), vy: rr(-30, 30), t: 1.2, max: 1.2, c: '#555', s: rr(10, 20), smoke: true });
    this.fx.push({ x, y, vx: 0, vy: 0, t: 0.25, max: 0.25, c: '#fff', s: radius, ring: true });
    const vol = 1 - Math.hypot(x - this.p.x, y - this.p.y) / 1400;
    Sfx.play('boom', vol);
    if (vol > 0.5) this.cam.shake = Math.min(14, this.cam.shake + 8 * vol);
    if (dmg > 0) {
      const all = [this.p, ...this.raiders, ...(hitArc ? this.arcs : [])];
      for (const t of all) {
        if (!t.alive) continue;
        const d = Math.hypot(t.x - x, t.y - y) - t.r;
        if (d > radius) continue;
        if (!World.los(x, y, t.x, t.y)) continue;
        this.damage(t, dmg * (1 - 0.6 * Math.max(0, d) / radius), src, false, t.x, t.y);
      }
    }
    this.noise(x, y, 900, src);
  },

  updateGrenades(dt) {
    for (const g of this.grenades) {
      g.t -= dt;
      const nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
      if (World.pointBlocked(nx, g.y, 4)) g.vx *= -0.5; else g.x = nx;
      if (World.pointBlocked(g.x, ny, 4)) g.vy *= -0.5; else g.y = ny;
      g.vx *= Math.pow(0.12, dt); g.vy *= Math.pow(0.12, dt);
      if (g.t <= 0) { g.done = true; this.boom(g.x, g.y, 130, 95, g.owner); }
    }
    this.grenades = this.grenades.filter(g => !g.done);
  },

  updateLobs(dt) {
    for (const l of this.lobs) {
      l.t += dt;
      if (l.t >= l.total) {
        l.done = true;
        this.boom(l.tx, l.ty, l.r, l.dmg, l.owner, false);
      }
    }
    this.lobs = this.lobs.filter(l => !l.done);
  },

  lob(e, tx, ty, dmg, r, spd) {
    const d = Math.hypot(tx - e.x, ty - e.y);
    this.lobs.push({ sx: e.x, sy: e.y, tx, ty, t: 0, total: Math.max(0.6, d / spd), dmg, r, owner: e });
  },

  emote(r, txt) { r.emote = txt; r.emoteT = 2.5; },

  // ---------- ARC AI ----------
  arcTargets(e) {
    const list = [];
    if (this.p.alive) list.push(this.p);
    for (const r of this.raiders) if (r.alive) list.push(r);
    return list;
  },

  updateArc(e, dt) {
    const d = e.def;
    e.hitT = Math.max(0, e.hitT - dt);
    e.thinkT -= dt;
    e.cool -= dt;
    e.phase += dt;
    if (e.thinkT <= 0) {
      e.thinkT = 0.3;
      // 尋找目標
      let best = null, bd = Infinity;
      for (const t of this.arcTargets(e)) {
        let sight = d.sight;
        if (t.kind === 'player') { sight *= 1 - skillLv('quiet') * 0.1; if (t.sprint) sight *= 1.25; }
        const dd = Math.hypot(t.x - e.x, t.y - e.y);
        if (dd > sight) continue;
        if (e.state === 'attack' && e.target === t) { if (dd < bd) { bd = dd * 0.8; best = t; } continue; }
        if (dd < bd && World.los(e.x, e.y, t.x, t.y)) { bd = dd; best = t; }
      }
      if (best) {
        if (e.state !== 'attack') { e.seenT = 0.6; if (best.kind === 'player' && Math.hypot(best.x - e.x, best.y - e.y) < 700) Sfx.play('charge', 0.6); }
        e.state = 'attack'; e.target = best;
      }
      if (e.state === 'attack' && e.target) {
        const t = e.target;
        e.vis = t.alive && World.los(e.x, e.y, t.x, t.y);
        if (e.vis) { e.lostT = 0; e.lastSeen = { x: t.x, y: t.y }; }
      }
    }
    if (e.state === 'attack') {
      const t = e.target;
      if (!t || !t.alive) { e.state = 'idle'; e.target = null; }
      else {
        if (!e.vis) { e.lostT += dt; if (e.lostT > 5) { e.state = 'investigate'; e.alert = e.lastSeen || { x: t.x, y: t.y }; e.target = null; } }
      }
    }
    e.seenT = Math.max(0, e.seenT - dt);

    // 行為
    if (d.kind === 'boss') return this.updateQueen(e, dt);
    const t = e.target;
    let goal = null, wantDist = 0;
    if (e.state === 'attack' && t) {
      const dd = Math.hypot(t.x - e.x, t.y - e.y);
      const ta = Math.atan2(t.y - e.y, t.x - e.x);
      const turn = d.kind === 'gun' && d.back ? 1.4 : 6;
      e.ang += clamp(angDiff(e.ang, ta), -turn * dt, turn * dt);
      if (d.kind === 'bomb') { goal = t; wantDist = 0; }
      else if (d.kind === 'jump') { goal = t; wantDist = 120; }
      else { goal = e.vis ? null : (e.lastSeen || t); wantDist = d.rng * 0.6; if (e.vis && dd > d.rng * 0.8) goal = t; }
      if (e.vis && goal === null && d.fly) {
        // 無人機繞圈飛
        const side = Math.sin(e.phase * 0.7 + e.id) > 0 ? 1 : -1;
        const sa = ta + Math.PI / 2 * side;
        let mx = Math.cos(sa) * 0.8, my = Math.sin(sa) * 0.8;
        if (dd < wantDist * 0.7) { mx -= Math.cos(ta); my -= Math.sin(ta); }
        else if (dd > wantDist * 1.1) { mx += Math.cos(ta); my += Math.sin(ta); }
        this.moveDir(e, mx, my, d.spd * 0.8, dt);
      } else if (e.vis && goal === null && d.spd > 0) {
        if (dd < wantDist * 0.6) this.moveDir(e, -Math.cos(ta), -Math.sin(ta), d.spd * 0.6, dt);
      }
      this.arcAttack(e, t, dd, dt);
    } else if (e.state === 'investigate' && e.alert) {
      goal = e.alert;
      if (Math.hypot(e.alert.x - e.x, e.alert.y - e.y) < 50) { e.state = 'idle'; e.alert = null; e.home = { x: e.x, y: e.y }; }
      e.ang += angDiff(e.ang, Math.atan2(e.alert ? e.alert.y - e.y : 0, e.alert ? e.alert.x - e.x : 1)) * Math.min(1, dt * 4);
    } else {
      // 巡邏
      if (d.kind === 'laser') { e.ang += dt * 0.6; e.charge = 0; }
      e.wanderT -= dt;
      if (e.wanderT <= 0) {
        e.wanderT = rr(3, 7);
        const a = rand() * TAU, rd = rr(60, 260);
        const x = clamp(e.home.x + Math.cos(a) * rd, 40, World.W - 40), y = clamp(e.home.y + Math.sin(a) * rd, 40, World.H - 40);
        e.goal = d.fly || !World.pointBlocked(x, y, 18) ? { x, y } : null;
        e.path = null;
      }
      goal = e.goal;
      if (goal && Math.hypot(goal.x - e.x, goal.y - e.y) < 20) { e.goal = null; goal = null; }
    }
    if (goal && d.spd > 0) {
      const dd = Math.hypot(goal.x - e.x, goal.y - e.y);
      if (dd > wantDist) {
        const sp = d.spd * (e.state === 'idle' ? 0.45 : 1) * (d.kind === 'bomb' && e.state === 'attack' ? 1 : 1);
        this.navigate(e, goal, sp, dt, d.fly);
        if (e.state !== 'attack') e.ang += angDiff(e.ang, Math.atan2(goal.y - e.y, goal.x - e.x)) * Math.min(1, dt * 4);
      }
    }
  },

  arcAttack(e, t, dd, dt) {
    const d = e.def;
    if (d.kind === 'gun') {
      if (!e.vis || dd > d.rng) { e.burst = 0; return; }
      if (e.seenT > 0) return;
      if (e.burst > 0) {
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = d.fire;
          const lead = dd / d.bspd;
          const tx = t.x + (t.vx || 0) * lead * 0.5, ty = t.y + (t.vy || 0) * lead * 0.5;
          const ang = Math.atan2(ty - e.y, tx - e.x) + rr(-0.07, 0.07);
          const shotAng = d.back ? e.ang + rr(-0.12, 0.12) : ang;
          this.arcShoot(e, shotAng, d.dmg, d.bspd, d.back ? '#ff7a3a' : '#ff4a3a');
          e.burst--;
          if (e.burst <= 0) e.cool = d.cool * rr(0.8, 1.3);
        }
      } else if (e.cool <= 0) { e.burst = d.burst; e.fireT = 0; }
    } else if (d.kind === 'bomb') {
      if (e.arm > 0) {
        e.arm -= dt;
        if (e.arm <= 0) { e.alive = false; this.boom(e.x, e.y, 75, d.dmg, e, false); }
      } else if (dd < d.rng + t.r + 10) { e.arm = 0.45; Sfx.play('beep', 0.8); }
    } else if (d.kind === 'lob') {
      if (e.cool <= 0 && dd < d.rng && e.seenT <= 0 && (e.vis || dd < 300)) {
        e.cool = d.cool * rr(0.8, 1.2);
        this.lob(e, t.x + rr(-40, 40) + (t.vx || 0) * 0.6, t.y + rr(-40, 40) + (t.vy || 0) * 0.6, d.dmg, 70, d.bspd);
      }
    } else if (d.kind === 'jump') {
      if (e.jump) {
        const j = e.jump;
        j.t += dt;
        if (j.t < j.wind) return;
        const k = Math.min(1, (j.t - j.wind) / j.dur);
        e.x = j.sx + (j.tx - j.sx) * k; e.y = j.sy + (j.ty - j.sy) * k;
        e.z = Math.sin(k * Math.PI) * 40;
        if (k >= 1) {
          e.jump = null; e.z = 0;
          World.resolveCircle(e);
          this.boom(e.x, e.y, 95, d.dmg, e, false);
        }
      } else if (e.cool <= 0 && e.vis && dd < d.rng && dd > 80) {
        e.cool = d.cool;
        let tx = t.x, ty = t.y;
        if (World.pointBlocked(tx, ty, e.r)) { tx = (tx + e.x) / 2; ty = (ty + e.y) / 2; }
        e.jump = { sx: e.x, sy: e.y, tx, ty, t: 0, wind: 0.7, dur: 0.5 };
        this.marks.push({ x: tx, y: ty, r: 95, t: 1.2, max: 1.2 });
      }
    } else if (d.kind === 'laser') {
      if (e.vis && dd < d.rng) {
        if (e.cool <= 0) {
          if (e.charge === 0) Sfx.play('charge', 1 - dd / 900);
          e.charge += dt;
          if (e.charge >= d.charge) {
            e.charge = 0; e.cool = d.cool;
            this.hitscan(e, e.ang, d.rng, d.dmg, '#ff2a2a');
            Sfx.play('laser', 1 - dd / 1000);
          }
        }
      } else e.charge = Math.max(0, e.charge - dt);
    }
  },

  hitscan(e, ang, len, dmg, col) {
    const x1 = e.x + Math.cos(ang) * len, y1 = e.y + Math.sin(ang) * len;
    const tw = Math.min(1, World.rayWall(e.x, e.y, x1, y1));
    let hit = null, ht = tw;
    for (const t of [this.p, ...this.raiders]) {
      if (!t.alive) continue;
      const h = segCircle(e.x, e.y, x1, y1, t.x, t.y, t.r);
      if (h && h.t < ht) { ht = h.t; hit = t; }
    }
    const ex = e.x + (x1 - e.x) * ht, ey = e.y + (y1 - e.y) * ht;
    this.beams.push({ x0: e.x, y0: e.y, x1: ex, y1: ey, t: 0.18, max: 0.18, c: col, w: 4 });
    if (hit) this.damage(hit, dmg, e, false, ex, ey);
    return { hit, ex, ey };
  },

  updateQueen(e, dt) {
    const t = e.target;
    if (!(e.state === 'attack' && t)) {
      e.ang += dt * 0.2;
      return;
    }
    if (Math.hypot(e.x - this.p.x, e.y - this.p.y) < 900 && !this.queenSeen) {
      this.queenSeen = true;
      this.banner('女王', '巨型 ARC 首領——瞄準發光核心可造成額外傷害');
    }
    const ta = Math.atan2(t.y - e.y, t.x - e.x);
    const dd = Math.hypot(t.x - e.x, t.y - e.y);
    e.ang += clamp(angDiff(e.ang, ta), -0.8 * dt, 0.8 * dt);
    // 慢慢逼近，但不離巢太遠
    if (dd > 260 && Math.hypot(e.x - e.home.x, e.y - e.home.y) < 500) this.navigate(e, t, e.def.spd, dt, false);
    if (e.sweep) {
      const s = e.sweep;
      s.t += dt;
      const k = s.t / s.dur;
      const a = s.a0 + (s.a1 - s.a0) * k;
      const x1 = e.x + Math.cos(a) * 900, y1 = e.y + Math.sin(a) * 900;
      const tw = Math.min(1, World.rayWall(e.x, e.y, x1, y1));
      let hit = null, ht = tw;
      for (const v of [this.p, ...this.raiders]) {
        if (!v.alive) continue;
        const h = segCircle(e.x, e.y, x1, y1, v.x, v.y, v.r);
        if (h && h.t < ht) { ht = h.t; hit = v; }
      }
      this.beams.push({ x0: e.x, y0: e.y, x1: e.x + (x1 - e.x) * ht, y1: e.y + (y1 - e.y) * ht, t: 0.03, max: 0.03, c: '#ff3050', w: 7 });
      if (hit) this.damage(hit, 75 * dt, e, false, hit.x, hit.y);
      if (k >= 1) e.sweep = null;
      return;
    }
    if (e.cool > 0) return;
    if (!e.vis && dd > 500) return;
    e.atk = (e.atk + 1) % 3;
    if (e.atk === 0) {
      // 迫擊砲齊射
      for (let i = 0; i < 7; i++) {
        const a = rand() * TAU, r = i === 0 ? 0 : rr(40, 200);
        setTimeout(() => { if (e.alive && this.active) this.lob(e, t.x + Math.cos(a) * r, t.y + Math.sin(a) * r, 30, 75, 420); }, i * 160);
      }
      e.cool = 3.2;
    } else if (e.atk === 1 && dd < 900) {
      const side = rand() < 0.5 ? 1 : -1;
      e.sweep = { t: 0, dur: 2.2, a0: ta - 0.7 * side, a1: ta + 0.7 * side };
      Sfx.play('laser');
      e.cool = 3.5;
    } else {
      for (let i = 0; i < 3; i++) {
        const a = rand() * TAU;
        const x = e.x + Math.cos(a) * 90, y = e.y + Math.sin(a) * 90;
        if (!World.pointBlocked(x, y, 12)) { const k = this.spawnArc('tick', x, y); k.state = 'attack'; k.target = t; }
      }
      e.cool = 2.5;
    }
  },

  moveDir(e, mx, my, spd, dt) {
    const l = Math.hypot(mx, my);
    if (l < 1e-3) return;
    const vx = mx / l * spd, vy = my / l * spd;
    e.x += vx * dt; e.y += vy * dt;
    e.vx = vx; e.vy = vy;
    if (!(e.def && e.def.fly)) World.resolveCircle(e);
    else { e.x = clamp(e.x, 20, World.W - 20); e.y = clamp(e.y, 20, World.H - 20); }
  },

  navigate(e, goal, spd, dt, fly) {
    if (fly) { this.moveDir(e, goal.x - e.x, goal.y - e.y, spd, dt); return; }
    // 有直線就直接走，否則用 A*
    e.repathT -= dt;
    const direct = Math.hypot(goal.x - e.x, goal.y - e.y) < 500 && World.clearPath(e.x, e.y, goal.x, goal.y);
    if (direct) { e.path = null; this.moveDir(e, goal.x - e.x, goal.y - e.y, spd, dt); }
    else {
      if (!e.path || e.repathT <= 0 || (e.pathGoal && Math.hypot(e.pathGoal.x - goal.x, e.pathGoal.y - goal.y) > 120 && e.repathT < 0.8)) {
        if (this.pathBudget > 0) {
          this.pathBudget--;
          e.path = World.findPath(e.x, e.y, goal.x, goal.y);
          e.pathGoal = { x: goal.x, y: goal.y };
          e.repathT = rr(1.5, 2.5);
        }
      }
      if (e.path && e.path.length) {
        const n = e.path[0];
        if (Math.hypot(n.x - e.x, n.y - e.y) < 18) e.path.shift();
        if (e.path.length) this.moveDir(e, e.path[0].x - e.x, e.path[0].y - e.y, spd, dt);
      } else this.moveDir(e, goal.x - e.x, goal.y - e.y, spd, dt);
    }
    // 卡住偵測
    e.stuckT += dt;
    if (e.stuckT > 1) {
      if (Math.hypot(e.x - e.lx, e.y - e.ly) < 8) { e.path = null; e.repathT = 0; e.x += rr(-6, 6); e.y += rr(-6, 6); World.resolveCircle(e); }
      e.stuckT = 0; e.lx = e.x; e.ly = e.y;
    }
  },

  separate() {
    const all = [this.p, ...this.raiders, ...this.arcs];
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!b.alive) continue;
        if ((a.def && a.def.fly) !== (b.def && b.def.fly)) continue;
        const dx = b.x - a.x, dy = b.y - a.y, rr2 = a.r + b.r;
        if (Math.abs(dx) > rr2 || Math.abs(dy) > rr2) continue;
        const d = Math.hypot(dx, dy);
        if (d >= rr2 || d < 1e-3) continue;
        const push = (rr2 - d) / 2, nx = dx / d, ny = dy / d;
        const am = a.kind === 'arc' && a.def.spd === 0 ? 0 : 1, bm = b.kind === 'arc' && b.def.spd === 0 ? 0 : 1;
        a.x -= nx * push * am * (bm ? 1 : 2); a.y -= ny * push * am * (bm ? 1 : 2);
        b.x += nx * push * bm * (am ? 1 : 2); b.y += ny * push * bm * (am ? 1 : 2);
      }
    }
  },

  // ---------- 掠手 AI ----------
  updateRaider(r, dt) {
    r.hitT = Math.max(0, r.hitT - dt);
    r.emoteT -= dt;
    r.thinkT -= dt;
    r.fireT -= dt;
    r.vx = 0; r.vy = 0;
    const p = this.p;
    const w = r.w, st = this.wStats(w, r);
    if (r.reloadT > 0) { r.reloadT -= dt; if (r.reloadT <= 0) w.ammo = st.d.mag; }

    if (r.thinkT <= 0) {
      r.thinkT = 0.3;
      // 感知
      let best = null, bd = Infinity;
      for (const e of this.arcs) {
        const dd = Math.hypot(e.x - r.x, e.y - r.y);
        if (dd < 480 && dd < bd && World.los(r.x, r.y, e.x, e.y)) { bd = dd; best = e; }
      }
      if (p.alive) {
        const dd = Math.hypot(p.x - r.x, p.y - r.y);
        if (dd < 560 && World.los(r.x, r.y, p.x, p.y)) {
          if (r.hostile) { if (dd < bd * 1.3 || r.target === p) { best = p; bd = dd; } }
          else {
            if (!r.waved && dd < 420) { r.waved = true; r.revealed = true; this.emote(r, '👋 別開槍，我是友善的'); }
            // 老六：玩家在搜刮或背對時，友善掠手可能背刺
            const facingAway = Math.abs(angDiff(p.ang, Math.atan2(r.y - p.y, r.x - p.x))) > 2;
            if (r.waved && (p.search || UI.panelOpen() || facingAway) && dd < 350 && rand() < 0.012) {
              r.hostile = true; this.emote(r, '😈 抱歉啦'); best = p; bd = dd;
            }
          }
        }
      }
      if (best) {
        if (r.state !== 'fight' || r.target !== best) { r.react = best.kind === 'player' ? rr(0.35, 0.7) : 0.25; }
        r.state = 'fight'; r.target = best; r.lostT = 0; r.lastSeen = { x: best.x, y: best.y };
        if (best === p && !r.revealed) r.revealed = true;
        r.vis = true;
      } else if (r.state === 'fight') {
        r.vis = r.target && r.target.alive && World.los(r.x, r.y, r.target.x, r.target.y) && Math.hypot(r.target.x - r.x, r.target.y - r.y) < 650;
        if (r.vis) r.lastSeen = { x: r.target.x, y: r.target.y };
      }
      // 撤離決策
      if (r.state !== 'fight' && r.state !== 'extract' && (this.elapsed > r.leaveAt || this.time < 100 || r.bag.length >= 10)) {
        r.state = 'extract'; r.goal = null; r.path = null;
      }
    }
    if (r.react > 0) r.react -= dt;

    let spd = 150;
    if (r.state === 'fight') {
      const t = r.target;
      if (!t || !t.alive) { r.state = 'roam'; r.target = null; r.goal = null; return; }
      const dd = Math.hypot(t.x - r.x, t.y - r.y);
      const ta = Math.atan2(t.y - r.y, t.x - r.x);
      if (r.vis) {
        r.ang += clamp(angDiff(r.ang, ta + rr(-0.05, 0.05)), -8 * dt, 8 * dt);
        // 走位
        r.strafeT -= dt;
        if (r.strafeT <= 0) { r.strafeT = rr(0.5, 1.4); r.strafe = rand() < 0.5 ? 1 : -1; }
        const want = Math.min(st.d.rng * 0.6, 380);
        let mx = Math.cos(ta + Math.PI / 2 * r.strafe), my = Math.sin(ta + Math.PI / 2 * r.strafe);
        if (dd > want) { mx += Math.cos(ta) * 1.2; my += Math.sin(ta) * 1.2; }
        else if (dd < want * 0.5) { mx -= Math.cos(ta); my -= Math.sin(ta); }
        this.moveDir(r, mx, my, spd * 0.75, dt);
        // 射擊
        if (r.reloadT <= 0 && r.react <= 0 && dd < st.d.rng * 0.95 && Math.abs(angDiff(r.ang, ta)) < 0.25) {
          if (r.burst > 0) { r.burstT -= dt; if (r.burstT <= 0 && w.ammo > 0) { this.shoot(r, w, st); r.burst--; r.burstT = 0.07; } }
          else if (r.fireT <= 0) {
            if (w.ammo <= 0) this.startReload(r);
            else {
              this.shoot(r, w, st);
              r.fireT = st.d.int * (st.d.auto ? 1.15 : 1.5);
              if (st.d.burst) { r.burst = st.d.burst - 1; r.burstT = 0.07; }
              if (w.ammo <= 0) this.startReload(r);
            }
          }
        }
        if (t === p && !r.revealed) r.revealed = true;
      } else {
        r.lostT += dt;
        if (w.ammo < st.d.mag * 0.5) this.startReload(r);
        if (r.lastSeen) this.navigate(r, r.lastSeen, spd, dt, false);
        if (r.lastSeen && Math.hypot(r.lastSeen.x - r.x, r.lastSeen.y - r.y) < 30) r.lastSeen = null;
        if (r.lostT > 4) { r.state = 'roam'; r.target = null; r.goal = null; }
        if (r.lastSeen) r.ang += angDiff(r.ang, Math.atan2(r.lastSeen.y - r.y, r.lastSeen.x - r.x)) * Math.min(1, dt * 5);
      }
      r.calmT = 0;
      return;
    }
    r.calmT += dt;
    // 回復
    if (r.calmT > 2 && r.hp < 60 && r.healT <= 0) {
      const i = r.bag.findIndex(e => e.k === 'bandage' || e.k === 'medkit');
      if (i >= 0) { r.healT = 2; r.healK = r.bag[i].k; r.bag[i].n--; if (r.bag[i].n <= 0) r.bag.splice(i, 1); }
    }
    if (r.healT > 0) {
      r.healT -= dt;
      if (r.healT <= 0) r.hp = Math.min(r.maxHp, r.hp + ITEMS[r.healK].use.heal);
      spd *= 0.5;
    }
    if (r.reloadT <= 0 && w.ammo < st.d.mag) this.startReload(r);

    if (r.state === 'hunt') {
      if (r.lastSeen) {
        this.navigate(r, r.lastSeen, spd, dt, false);
        r.ang += angDiff(r.ang, Math.atan2(r.lastSeen.y - r.y, r.lastSeen.x - r.x)) * Math.min(1, dt * 5);
        if (Math.hypot(r.lastSeen.x - r.x, r.lastSeen.y - r.y) < 40) r.lastSeen = null;
      } else r.state = 'roam';
      return;
    }
    if (r.state === 'extract') {
      if (!r.goal) {
        let best = null, bd = Infinity;
        for (const e of World.extracts) { const d = Math.hypot(e.x - r.x, e.y - r.y); if (d < bd) { bd = d; best = e; } }
        r.goal = best;
      }
      const e = r.goal;
      if (Math.hypot(e.x - r.x, e.y - r.y) > 30) {
        this.navigate(r, e, spd, dt, false);
        r.ang += angDiff(r.ang, Math.atan2(e.y - r.y, e.x - r.x)) * Math.min(1, dt * 5);
      }
      if (Math.hypot(e.x - r.x, e.y - r.y) < 80) {
        if (e.state === 'idle') this.callElevator(e, r);
        if (e.state === 'open' && Math.hypot(e.x - r.x, e.y - r.y) < e.r) {
          r.alive = false;
          if (Math.hypot(e.x - p.x, e.y - p.y) < 1500) this.say(`掠手 ${r.name} 已撤離`, '#aaa');
        }
      }
      return;
    }
    // 搜刮
    if (r.state === 'loot') {
      r.lootT -= dt;
      if (r.lootT <= 0) {
        const c = r.goal;
        if (c) {
          if (!c.items) c.items = this.rollLoot(c);
          c.searched = true;
          for (let i = c.items.length - 1; i >= 0; i--) {
            const it = c.items[i];
            if (ITEMS[it.k].r >= 1 || rand() < 0.5) { r.bag.push(it); c.items.splice(i, 1); }
          }
          c.claimed = null;
        }
        r.looted++;
        r.goal = null; r.state = 'roam';
      }
      return;
    }
    // 漫遊找箱子
    if (!r.goal || r.goal.searched) {
      let cands = World.containers.filter(c => !c.searched && !c.claimed && c.type !== 'pile');
      cands.sort((a, b) => dist2(a.x, a.y, r.x, r.y) - dist2(b.x, b.y, r.x, r.y));
      cands = cands.slice(0, 4);
      r.goal = cands[Math.floor(rand() * cands.length)] || null;
      if (r.goal) r.goal.claimed = r;
      r.path = null;
    }
    if (r.goal) {
      const g = r.goal;
      this.navigate(r, g, spd * 0.8, dt, false);
      r.ang += angDiff(r.ang, Math.atan2(g.y - r.y, g.x - r.x)) * Math.min(1, dt * 4);
      if (Math.hypot(g.x - r.x, g.y - r.y) < 34) { r.state = 'loot'; r.lootT = CONTAINERS[g.type].t * 1.5; }
    }
  },

  // ---------- 結束 ----------
  end(success, reason) {
    if (this.ended) return;
    this.ended = true;
    this.active = false;
    Input.enabled = false;
    Input.resetTouch();
    UI.closePanel(true);
    const p = this.p;
    const brought = [];
    let value = 0;
    const addAll = list => { for (const e of list) { stashAdd(e); brought.push(e); value += ITEMS[e.k].val * (e.n || 1); } };
    if (success) {
      S.stats.extracts++;
      // 武器、護盾與消耗品回到配裝，其餘進倉庫
      S.loadout.w = p.weapons.map(w => w ? { k: w.k, lvl: w.lvl } : null);
      S.loadout.shield = p.shieldK ? { k: p.shieldK } : null;
      const bag = [];
      const rest = [];
      for (const e of p.bag) (ITEMS[e.k].type === 'con' ? bag : rest).push(e);
      S.loadout.bag = bag;
      addAll(rest);
      addAll(p.pocket);
      this.giveXP(250);
      questEvent('extract', this.mapId);
      for (const w of p.weapons) if (w) value += ITEMS[w.k].val;
    } else {
      S.stats.deaths++;
      // 只有安全口袋內的物品能保留
      addAll(p.pocket);
    }
    S.stats.kills += this.kills.arc;
    S.stats.raiderKills += this.kills.raider;
    if (success) S.stats.best = Math.max(S.stats.best, value);
    // 斯克拉皮帶回的材料
    const rooster = [];
    for (let i = 0; i < S.fac.rooster * 2; i++) {
      const k = pickWeighted(CONTAINERS.trash.table, Math.random);
      const e = { k, n: 1 + Math.floor(rand() * 2) };
      stashAdd(e); rooster.push(e);
    }
    const lvBefore = S.level;
    const xp = success ? this.xpGain : Math.round(this.xpGain * 0.5);
    addXP(xp);
    saveGame();
    UI.showResults({ success, reason, brought, value, xp, kills: this.kills, rooster, levelUp: S.level - lvBefore, map: this.map.name, time: this.elapsed });
  },

  abandon() { this.paused = false; this.end(false, '放棄遠征'); },

  // ---------- 渲染 ----------
  buildMinimap() {
    const c = document.createElement('canvas');
    const N = 220;
    c.width = N; c.height = N;
    const g = c.getContext('2d');
    const k = N / World.W;
    g.fillStyle = this.map.ground; g.fillRect(0, 0, N, N);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (const r of World.roads) g.fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
    for (const z of World.hvZones) { g.fillStyle = 'rgba(255,60,40,0.25)'; g.fillRect(z.x * k, z.y * k, z.w * k, z.h * k); }
    g.fillStyle = '#2a2a2a';
    for (const f of World.floors) g.fillRect(f.x * k, f.y * k, f.w * k, f.h * k);
    g.fillStyle = '#9a9a9a';
    for (const w of World.walls) if (w.kind !== 'border') g.fillRect(w.x * k, w.y * k, Math.max(1, w.w * k), Math.max(1, w.h * k));
    this.mmBase = c;
  },

  drawMinimap(ctx, size, full) {
    const k = size / World.W;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.mmBase, 0, 0, size, size);
    const t = performance.now() / 1000;
    for (const e of World.extracts) {
      const col = e.state === 'open' ? '#5f5' : e.state === 'calling' ? '#ff5' : e.state === 'cool' ? '#777' : '#6cf';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(e.x * k, e.y * k, full ? 8 : 4.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
      if (full) { ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(e.name, e.x * k, e.y * k - 12); }
    }
    if (full) for (const z of World.hvZones) { ctx.fillStyle = '#f97'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('高價值：' + z.name, (z.x + z.w / 2) * k, (z.y + z.h / 2) * k); }
    const q = this.arcs.find(e => e.type === 'queen');
    if (q && this.queenSeen) { ctx.fillStyle = '#f33'; ctx.beginPath(); ctx.arc(q.x * k, q.y * k, 5, 0, TAU); ctx.fill(); }
    // 視野範圍
    const p = this.p;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    const hw = this.vw / 2 / this.scale, hh = this.vh / 2 / this.scale;
    ctx.strokeRect((this.cam.x - hw) * k, (this.cam.y - hh) * k, hw * 2 * k, hh * 2 * k);
    ctx.save();
    ctx.translate(p.x * k, p.y * k); ctx.rotate(p.ang);
    ctx.fillStyle = '#3ff'; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -4.5); ctx.lineTo(-5, 4.5); ctx.closePath(); ctx.fill();
    ctx.restore();
    void t;
  },

  render() {
    const ctx = this.ctx, s = this.scale * this.dpr;
    const W = this.vw, H = this.vh;
    const p = this.p, M = this.map;
    const sx = (rand() - 0.5) * this.cam.shake, sy = (rand() - 0.5) * this.cam.shake;
    const cx = this.cam.x + sx, cy = this.cam.y + sy;
    const hw = W / 2 / this.scale, hh = H / 2 / this.scale;
    const vx0 = cx - hw - 60, vy0 = cy - hh - 60, vx1 = cx + hw + 60, vy1 = cy + hh + 60;
    const inView = (x, y, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;
    const now = performance.now() / 1000;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(s, 0, 0, s, (W / 2 - cx * this.scale) * this.dpr, (H / 2 - cy * this.scale) * this.dpr);

    // 地面
    ctx.fillStyle = M.ground;
    ctx.fillRect(Math.max(0, vx0), Math.max(0, vy0), Math.min(World.W, vx1) - Math.max(0, vx0), Math.min(World.H, vy1) - Math.max(0, vy0));
    // 地面色塊
    const T = 200;
    for (let gx = Math.floor(Math.max(0, vx0) / T); gx * T < Math.min(World.W, vx1); gx++) {
      for (let gy = Math.floor(Math.max(0, vy0) / T); gy * T < Math.min(World.H, vy1); gy++) {
        const h = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
        if (h - Math.floor(h) < 0.45) { ctx.fillStyle = M.ground2; ctx.fillRect(gx * T, gy * T, T, T); }
      }
    }
    ctx.fillStyle = M.road;
    for (const r of World.roads) {
      if (r.x > vx1 || r.x + r.w < vx0 || r.y > vy1 || r.y + r.h < vy0) continue;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    // 道路標線
    ctx.strokeStyle = 'rgba(220,200,120,0.18)'; ctx.lineWidth = 3; ctx.setLineDash([26, 30]);
    ctx.beginPath();
    for (const r of World.roads) {
      if (r.x > vx1 || r.x + r.w < vx0 || r.y > vy1 || r.y + r.h < vy0) continue;
      if (r.w < r.h) { ctx.moveTo(r.x + r.w / 2, Math.max(0, vy0)); ctx.lineTo(r.x + r.w / 2, Math.min(World.H, vy1)); }
      else { ctx.moveTo(Math.max(0, vx0), r.y + r.h / 2); ctx.lineTo(Math.min(World.W, vx1), r.y + r.h / 2); }
    }
    ctx.stroke(); ctx.setLineDash([]);
    for (const d of World.decals) {
      if (!inView(d.x, d.y)) continue;
      if (d.k === 0) { ctx.fillStyle = 'rgba(90,110,60,0.35)'; ctx.beginPath(); ctx.arc(d.x, d.y, d.s, 0, TAU); ctx.fill(); }
      else if (d.k === 1) { ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.ellipse(d.x, d.y, d.s, d.s * 0.5, d.a, 0, TAU); ctx.fill(); }
      else if (d.k === 2) { ctx.fillStyle = 'rgba(140,130,110,0.4)'; ctx.fillRect(d.x, d.y, d.s * 0.4, d.s * 0.3); ctx.fillRect(d.x + d.s * 0.5, d.y + 4, d.s * 0.25, d.s * 0.2); }
      else { ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.cos(d.a) * d.s, d.y + Math.sin(d.a) * d.s); ctx.lineTo(d.x + Math.cos(d.a + 0.8) * d.s * 1.6, d.y + Math.sin(d.a + 0.8) * d.s * 1.6); ctx.stroke(); }
    }
    // 高價值區
    for (const z of World.hvZones) {
      if (z.x > vx1 || z.x + z.w < vx0 || z.y > vy1 || z.y + z.h < vy0) continue;
      ctx.fillStyle = 'rgba(255,60,30,0.07)'; ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeStyle = 'rgba(255,90,50,0.35)'; ctx.lineWidth = 3; ctx.setLineDash([18, 12]); ctx.strokeRect(z.x + 6, z.y + 6, z.w - 12, z.h - 12); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,120,80,0.5)'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('⚠ 高價值區域 ' + z.name, z.x + 16, z.y + 30);
    }
    for (const pad of World.pads) {
      ctx.fillStyle = '#2c2e33'; ctx.fillRect(pad.x, pad.y, pad.w, pad.h);
      ctx.strokeStyle = '#d9b740'; ctx.lineWidth = 6; ctx.strokeRect(pad.x + 20, pad.y + 20, pad.w - 40, pad.h - 40);
      ctx.beginPath(); ctx.arc(pad.x + pad.w / 2, pad.y + pad.h / 2, 120, 0, TAU); ctx.stroke();
    }
    // 建築地板
    for (const f of World.floors) {
      if (f.x > vx1 || f.x + f.w < vx0 || f.y > vy1 || f.y + f.h < vy0) continue;
      ctx.fillStyle = f.hv ? '#3b3330' : '#35332f'; ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = f.x + 40; x < f.x + f.w; x += 40) { ctx.moveTo(x, f.y); ctx.lineTo(x, f.y + f.h); }
      for (let y = f.y + 40; y < f.y + f.h; y += 40) { ctx.moveTo(f.x, y); ctx.lineTo(f.x + f.w, y); }
      ctx.stroke();
    }
    // 撤離點
    for (const e of World.extracts) {
      if (!inView(e.x, e.y, 100)) continue;
      const col = e.state === 'open' ? '#4f4' : e.state === 'calling' ? '#ff4' : e.state === 'cool' ? '#666' : '#4cf';
      ctx.fillStyle = 'rgba(30,40,50,0.9)'; ctx.fillRect(e.x - 60, e.y - 60, 120, 120);
      ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.strokeRect(e.x - 60, e.y - 60, 120, 120);
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(now * 4);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
      const label = e.state === 'idle' ? '撤離電梯（呼叫）' : e.state === 'calling' ? `電梯抵達中 ${Math.ceil(e.t)}s` : e.state === 'open' ? `已開啟！${Math.ceil(e.t)}s` : `冷卻中 ${Math.ceil(e.t)}s`;
      ctx.fillText('⇧ ' + label, e.x, e.y - 72);
    }
    // 投擲物預警
    for (const l of this.lobs) {
      const k = l.t / l.total;
      ctx.strokeStyle = 'rgba(255,80,40,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(l.tx, l.ty, l.r, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,80,40,0.18)'; ctx.beginPath(); ctx.arc(l.tx, l.ty, l.r * k, 0, TAU); ctx.fill();
    }
    for (const m of this.marks) {
      m.t -= 1 / 60;
      ctx.strokeStyle = `rgba(255,50,50,${Math.max(0, m.t / m.max)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.stroke();
    }
    this.marks = this.marks.filter(m => m.t > 0);
    // 容器
    for (const c of World.containers) {
      if (!inView(c.x, c.y)) continue;
      this.drawContainer(ctx, c, now);
    }
    // 牆壁陰影與本體
    const ws = World.query(vx0, vy0, vx1, vy1, []);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const w of ws) if (w.kind !== 'border') ctx.fillRect(w.x + 6, w.y + 8, w.w, w.h);
    for (const w of ws) {
      if (w.kind === 'border') { ctx.fillStyle = '#1a1a1a'; ctx.fillRect(w.x, w.y, w.w, w.h); continue; }
      if (w.kind === 'cover') { ctx.fillStyle = '#6a6458'; ctx.fillRect(w.x, w.y, w.w, w.h); ctx.fillStyle = '#7d776a'; ctx.fillRect(w.x + 3, w.y + 3, w.w - 6, w.h - 6); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1); }
      else { ctx.fillStyle = '#58575a'; ctx.fillRect(w.x, w.y, w.w, w.h); ctx.fillStyle = '#76757a'; ctx.fillRect(w.x, w.y, w.w, Math.min(4, w.h)); }
    }
    // 手雷
    for (const g of this.grenades) {
      ctx.fillStyle = '#3a4'; ctx.beginPath(); ctx.arc(g.x, g.y, 6, 0, TAU); ctx.fill();
      if (Math.floor(now * 8) % 2) { ctx.fillStyle = '#f33'; ctx.beginPath(); ctx.arc(g.x, g.y, 2.5, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = 'rgba(255,60,60,0.5)'; ctx.beginPath(); ctx.arc(g.x, g.y, 130, 0, TAU); ctx.stroke();
    }
    // 實體
    for (const e of this.arcs) if (!e.def.fly && inView(e.x, e.y, 80)) this.drawArc(ctx, e, now);
    for (const r of this.raiders) if (inView(r.x, r.y)) this.drawHuman(ctx, r, now);
    if (p.alive) this.drawHuman(ctx, p, now);
    for (const e of this.arcs) if (e.def.fly && inView(e.x, e.y, 80)) this.drawArc(ctx, e, now);
    // 子彈
    ctx.lineCap = 'round';
    for (const b of this.bullets) {
      if (!inView(b.x, b.y)) continue;
      const l = Math.hypot(b.vx, b.vy);
      const tl = b.team === 'arc' ? 8 : (b.heavy ? 34 : 22);
      ctx.strokeStyle = b.col; ctx.lineWidth = b.team === 'arc' ? (b.rad || 3) * 1.4 : (b.heavy ? 3 : 2);
      ctx.beginPath(); ctx.moveTo(b.x - b.vx / l * tl, b.y - b.vy / l * tl); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // 拋射物
    for (const l of this.lobs) {
      const k = l.t / l.total;
      const x = l.sx + (l.tx - l.sx) * k, y = l.sy + (l.ty - l.sy) * k - Math.sin(k * Math.PI) * 120;
      ctx.fillStyle = '#ff7a2a'; ctx.shadowColor = '#f80'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    }
    // 雷射
    for (const b of this.beams) {
      ctx.strokeStyle = b.c; ctx.globalAlpha = Math.max(0, b.t / b.max); ctx.lineWidth = b.w;
      ctx.shadowColor = b.c; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    // 特效
    for (const f of this.fx) {
      const a = Math.max(0, f.t / f.max);
      if (f.ring) { ctx.strokeStyle = `rgba(255,230,180,${a})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(f.x, f.y, f.s * (1 - a) + 10, 0, TAU); ctx.stroke(); continue; }
      ctx.globalAlpha = f.smoke ? a * 0.5 : a;
      ctx.fillStyle = f.c;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.smoke ? f.s * (2 - a) : f.s, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 傷害數字
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.t * 2);
      ctx.font = `bold ${t.size}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = '#000'; ctx.fillText(t.txt, t.x + 1, t.y + 1);
      ctx.fillStyle = t.color; ctx.fillText(t.txt, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    // 互動提示（世界座標）
    if (this.interTarget && this.interTarget.type === 'container') {
      const c = this.interTarget.c;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(c.x, c.y, 26, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }

    // 螢幕空間
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // 暗角
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 撤離點方向指示
    for (const e of World.extracts) {
      const dx = (e.x - cx) * this.scale, dy = (e.y - cy) * this.scale;
      if (Math.abs(dx) < W / 2 - 20 && Math.abs(dy) < H / 2 - 20) continue;
      const a = Math.atan2(dy, dx);
      const m = 34;
      const kx = (W / 2 - m) / Math.abs(Math.cos(a) || 1e-6), ky = (H / 2 - m) / Math.abs(Math.sin(a) || 1e-6);
      const k = Math.min(kx, ky);
      const x = W / 2 + Math.cos(a) * k, y = H / 2 + Math.sin(a) * k;
      const col = e.state === 'open' ? '#5f5' : e.state === 'calling' ? '#ff5' : e.state === 'cool' ? '#888' : '#6cf';
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -8); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = col; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(Math.round(Math.hypot(e.x - p.x, e.y - p.y) / 10) + 'm', x - Math.cos(a) * 22, y - Math.sin(a) * 22 + 4);
    }
    // 受傷方向
    if (this.hurtDir && this.hurtDir.t > 0) {
      this.hurtDir.t -= 1 / 60;
      const a = this.hurtDir.a;
      ctx.strokeStyle = `rgba(255,40,40,${this.hurtDir.t})`; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.28, a - 0.35, a + 0.35); ctx.stroke();
    }
    // 準心（桌機）
    if (!Input.touch && p.alive && !UI.panelOpen()) {
      const w = this.curW(p);
      const st = w ? this.wStats(w, p) : null;
      const sp = st ? (st.spr + p.bloom) * (p.moving ? 1.35 : 1) : 4;
      const mx = Input.mouse.x, my = Input.mouse.y;
      const md = Math.hypot(mx - W / 2, my - H / 2);
      const gap = 4 + Math.tan(sp * Math.PI / 180) * Math.max(60, md) * 0.6;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - gap - 8, my); ctx.lineTo(mx - gap, my);
      ctx.moveTo(mx + gap, my); ctx.lineTo(mx + gap + 8, my);
      ctx.moveTo(mx, my - gap - 8); ctx.lineTo(mx, my - gap);
      ctx.moveTo(mx, my + gap); ctx.lineTo(mx, my + gap + 8);
      ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillRect(mx - 1, my - 1, 2, 2);
    }
    this.updateHUD();
  },

  drawContainer(ctx, c, now) {
    const def = CONTAINERS[c.type];
    const empty = c.searched && c.items && c.items.length === 0;
    ctx.globalAlpha = empty ? 0.4 : 1;
    if (c.type === 'wreck') {
      const r = (c.big || 14) * 0.8;
      ctx.fillStyle = '#3a3030'; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#655'; ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) { const a = i * 1.7 + c.id; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(a) * r * 1.4, c.y + Math.sin(a) * r * 1.4); ctx.stroke(); }
      if (!empty) { ctx.fillStyle = `rgba(255,120,60,${0.5 + 0.3 * Math.sin(now * 3 + c.id)})`; ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, TAU); ctx.fill(); }
    } else if (c.type === 'body') {
      ctx.fillStyle = '#4a4552'; ctx.beginPath(); ctx.ellipse(c.x, c.y, 16, 10, 0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7a3a3a'; ctx.beginPath(); ctx.arc(c.x + 4, c.y + 6, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ddd'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✝ ' + (c.name || ''), c.x, c.y - 16);
    } else if (c.type === 'pile') {
      ctx.fillStyle = '#8a7a50'; ctx.fillRect(c.x - 8, c.y - 6, 16, 12);
    } else {
      const sz = c.type === 'safe' ? 14 : c.type === 'trash' ? 13 : 15;
      ctx.fillStyle = def.color; ctx.fillRect(c.x - sz, c.y - sz * 0.75, sz * 2, sz * 1.5);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(c.x - sz, c.y - sz * 0.75, sz * 2, sz * 1.5);
      ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(c.x - sz, c.y - sz * 0.75, sz * 2, 4);
      const icon = { trash: '♻', crate: '▣', weapon: '✦', medical: '✚', safe: '⛁' }[c.type];
      ctx.fillStyle = c.type === 'medical' ? '#fff' : '#ddd'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(icon, c.x, c.y + 1); ctx.textBaseline = 'alphabetic';
    }
    if (!c.searched) {
      ctx.strokeStyle = `rgba(255,230,120,${0.35 + 0.25 * Math.sin(now * 3 + c.id)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c.x, c.y, 22, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  drawHuman(ctx, a, now) {
    const isP = a.kind === 'player';
    ctx.save();
    ctx.translate(a.x, a.y);
    // 陰影
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(3, 5, a.r, a.r * 0.8, 0, 0, TAU); ctx.fill();
    // 護盾
    if (a.sh > 0) { ctx.strokeStyle = `rgba(90,180,255,${0.25 + 0.5 * a.sh / a.shMax})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, a.r + 4, 0, TAU); ctx.stroke(); }
    ctx.rotate(a.ang);
    // 槍
    const w = isP ? this.curW(a) : a.w;
    const gl = w ? (WEAPONS[w.k].rng > 900 ? 26 : WEAPONS[w.k].cls === '手槍' ? 15 : 21) : 0;
    if (w) { ctx.fillStyle = '#222'; ctx.fillRect(4, 3, gl, 5); ctx.fillStyle = RARITY[WEAPONS[w.k].r].color; ctx.fillRect(6, 4, 6, 3); }
    // 背包
    ctx.fillStyle = isP ? '#3d5a5a' : '#5a4a3a'; ctx.fillRect(-a.r - 3, -8, 8, 16);
    // 身體
    let body = isP ? '#38c8c0' : (a.revealed ? (a.hostile ? '#d8603a' : '#c8b850') : '#9a8a80');
    if (a.hitT > 0) body = '#fff';
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, a.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    // 頭盔面罩
    ctx.fillStyle = isP ? '#1c3a40' : '#3a2a20'; ctx.beginPath(); ctx.arc(4, 0, a.r * 0.5, -1, 1); ctx.fill();
    ctx.restore();
    if (!isP) {
      ctx.textAlign = 'center'; ctx.font = 'bold 11px sans-serif';
      const tag = a.revealed ? (a.hostile ? '#ff7a50' : '#e8e070') : '#ccc';
      ctx.fillStyle = '#000'; ctx.fillText(a.name, a.x + 1, a.y - a.r - 9);
      ctx.fillStyle = tag; ctx.fillText(a.name, a.x, a.y - a.r - 10);
      if (a.hp < a.maxHp) this.bar(ctx, a.x, a.y - a.r - 6, 30, a.hp / a.maxHp, '#e44', a.sh > 0 ? a.sh / a.shMax : 0);
      if (a.emote && a.emoteT > 0) {
        ctx.font = '12px sans-serif';
        const tw = ctx.measureText(a.emote).width + 12;
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(a.x - tw / 2, a.y - a.r - 42, tw, 20);
        ctx.fillStyle = '#fff'; ctx.fillText(a.emote, a.x, a.y - a.r - 27);
      }
    } else {
      // 動作進度
      const act = a.using || a.search;
      if (act) {
        const k = 1 - act.t / act.total;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 10, 0, TAU); ctx.stroke();
        ctx.strokeStyle = a.using ? '#6f6' : '#fd6'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 10, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
      }
      if (a.reloadT > 0) {
        const w = this.curW(a), st = this.wStats(w, a);
        const k = 1 - a.reloadT / st.rel;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(a.x - 20, a.y + a.r + 8, 40, 5);
        ctx.fillStyle = '#fd6'; ctx.fillRect(a.x - 20, a.y + a.r + 8, 40 * k, 5);
      }
    }
  },

  bar(ctx, x, y, w, k, col, sk) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
    ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * clamp(k, 0, 1), 4);
    if (sk > 0) { ctx.fillStyle = '#6cf'; ctx.fillRect(x - w / 2, y - 3, w * sk, 2); }
  },

  drawArc(ctx, e, now) {
    const d = e.def, R = e.r;
    ctx.save();
    ctx.translate(e.x, e.y - (e.z || 0));
    const hit = e.hitT > 0;
    const metal = hit ? '#fff' : '#5c5f66', dark = hit ? '#ddd' : '#33353a', glow = '#ff3a2a';
    // 陰影
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(d.fly ? 10 : 3, d.fly ? 22 : 5 + (e.z || 0), R, R * 0.7, 0, 0, TAU); ctx.fill();
    ctx.rotate(e.ang);
    if (e.type === 'wasp' || e.type === 'hornet') {
      const arm = R * 1.05;
      ctx.strokeStyle = dark; ctx.lineWidth = 4;
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * arm, Math.sin(a) * arm); ctx.stroke();
        ctx.fillStyle = 'rgba(200,200,200,0.25)';
        ctx.beginPath(); ctx.arc(Math.cos(a) * arm, Math.sin(a) * arm, R * 0.55, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(230,230,230,0.6)'; ctx.lineWidth = 1.5;
        const sp = now * 40 + i;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * arm + Math.cos(sp) * R * 0.55, Math.sin(a) * arm + Math.sin(sp) * R * 0.55);
        ctx.lineTo(Math.cos(a) * arm - Math.cos(sp) * R * 0.55, Math.sin(a) * arm - Math.sin(sp) * R * 0.55); ctx.stroke();
        ctx.strokeStyle = dark; ctx.lineWidth = 4;
      }
      ctx.fillStyle = metal; ctx.beginPath(); ctx.ellipse(0, 0, R * 0.7, R * 0.5, 0, 0, TAU); ctx.fill();
      if (e.type === 'hornet') { ctx.fillStyle = dark; ctx.fillRect(R * 0.3, -R * 0.45, R * 0.8, 4); ctx.fillRect(R * 0.3, R * 0.45 - 4, R * 0.8, 4); }
      ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(R * 0.4, 0, 3.5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    } else if (e.type === 'tick') {
      ctx.strokeStyle = dark; ctx.lineWidth = 2.5;
      for (let i = 0; i < 6; i++) {
        const a = (i < 3 ? -1 : 1) * (0.6 + (i % 3) * 0.7) + Math.sin(now * 20 + i) * 0.15;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R * 1.7, Math.sin(a) * R * 1.7); ctx.stroke();
      }
      ctx.fillStyle = metal; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      const blink = e.arm > 0 ? (Math.floor(now * 16) % 2 ? '#fff' : glow) : glow;
      ctx.fillStyle = blink; ctx.shadowColor = glow; ctx.shadowBlur = e.arm > 0 ? 20 : 8;
      ctx.beginPath(); ctx.arc(R * 0.3, 0, 4, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    } else if (e.type === 'pop') {
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      ctx.fillStyle = metal; ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff7a2a'; ctx.shadowColor = '#f80'; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.42 * (0.85 + 0.15 * Math.sin(now * 5)), 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = dark; ctx.fillRect(R * 0.5, -5, R * 0.8, 10);
    } else if (e.type === 'leaper') {
      ctx.strokeStyle = dark; ctx.lineWidth = 6;
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2 + Math.sin(now * 4 + i) * 0.1;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R * 1.2, Math.sin(a) * R * 1.2); ctx.lineTo(Math.cos(a + 0.3) * R * 1.9, Math.sin(a + 0.3) * R * 1.9); ctx.stroke();
      }
      ctx.fillStyle = metal; ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.75, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(R * 0.55, -6, 3.5, 0, TAU); ctx.arc(R * 0.55, 6, 3.5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    } else if (e.type === 'sentinel') {
      ctx.rotate(-e.ang);
      ctx.fillStyle = dark; ctx.fillRect(-R, -R, R * 2, R * 2);
      ctx.rotate(e.ang);
      ctx.fillStyle = metal; ctx.beginPath(); ctx.arc(0, 0, R * 0.75, 0, TAU); ctx.fill();
      ctx.fillStyle = dark; ctx.fillRect(R * 0.3, -4, R * 1.4, 8);
      ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    } else if (e.type === 'bastion') {
      ctx.fillStyle = dark;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = metal;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.lineTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8); }
      ctx.closePath(); ctx.fill();
      // 背部弱點
      ctx.fillStyle = '#ffd23c'; ctx.shadowColor = '#fc3'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(-R * 0.6, 0, 7, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#222'; ctx.fillRect(R * 0.5, -R * 0.55, R * 0.9, 7); ctx.fillRect(R * 0.5, R * 0.55 - 7, R * 0.9, 7);
      ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(R * 0.45, 0, 5, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    } else if (e.type === 'queen') {
      ctx.strokeStyle = dark; ctx.lineWidth = 10;
      for (let i = 0; i < 6; i++) {
        const a = (i < 3 ? -1 : 1) * (0.5 + (i % 3) * 0.75) + Math.sin(now * 2 + i) * 0.08;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R * 1.3, Math.sin(a) * R * 1.3); ctx.lineTo(Math.cos(a * 1.1) * R * 2.1, Math.sin(a * 1.1) * R * 2.1); ctx.stroke();
      }
      ctx.fillStyle = metal; ctx.beginPath(); ctx.ellipse(0, 0, R, R * 0.8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(-R * 0.2, 0, R * 0.6, R * 0.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd23c'; ctx.shadowColor = '#fc3'; ctx.shadowBlur = 25;
      ctx.beginPath(); ctx.arc(0, 0, R * 0.25 * (0.9 + 0.1 * Math.sin(now * 3)), 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 14;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(R * 0.75, i * 9, 4, 0, TAU); ctx.fill(); }
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    // 雷射充能
    if (e.type === 'sentinel' && e.charge > 0 && e.target) {
      const k = e.charge / d.charge;
      ctx.strokeStyle = `rgba(255,40,40,${0.2 + 0.6 * k})`; ctx.lineWidth = 1 + k * 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(e.x, e.y);
      const len = Math.min(d.rng, Math.hypot(e.target.x - e.x, e.target.y - e.y) + 40);
      ctx.lineTo(e.x + Math.cos(e.ang) * len, e.y + Math.sin(e.ang) * len); ctx.stroke(); ctx.setLineDash([]);
    }
    if (e.state === 'attack' && e.seenT > 0) {
      ctx.fillStyle = '#ff4'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', e.x, e.y - R - 12);
    } else if (e.state === 'investigate') {
      ctx.fillStyle = '#fc6'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', e.x, e.y - R - 12);
    }
    if (e.hp < e.maxHp) {
      const w = e.type === 'queen' ? 140 : Math.max(28, R * 2);
      this.bar(ctx, e.x, e.y - R - 10 - (e.z || 0), w, e.hp / e.maxHp, '#f63', 0);
    }
  },

  updateHUD() {
    const p = this.p, h = this.hud;
    const set = (el, prop, v) => { if (el['_' + prop] !== v) { el['_' + prop] = v; if (prop === 'text') el.textContent = v; else if (prop === 'html') el.innerHTML = v; else el.style[prop] = v; } };
    set(h.hpFill, 'width', (clamp(p.hp / p.maxHp, 0, 1) * 100).toFixed(1) + '%');
    set(h.shFill, 'width', (p.shMax ? clamp(p.sh / p.shMax, 0, 1) * 100 : 0).toFixed(1) + '%');
    set(h.stFill, 'width', (p.stam / p.stamMax * 100).toFixed(1) + '%');
    set(h.hpTxt, 'text', Math.max(0, Math.ceil(p.hp)) + '');
    set(h.shTxt, 'text', p.shieldK ? Math.ceil(p.sh) + '' : '—');
    const w = this.curW(p);
    if (w) {
      const d = WEAPONS[w.k];
      set(h.wName, 'html', `<span style="color:${RARITY[d.r].color}">${d.name}</span> <small>${d.cls} ${'I'.repeat(w.lvl || 1)}</small>`);
      set(h.wAmmo, 'text', p.reloadT > 0 ? '換彈中…' : `${w.ammo} / ${d.mag}`);
    } else { set(h.wName, 'text', '空手'); set(h.wAmmo, 'text', '—'); }
    const o = p.weapons[1 - p.cur];
    set(h.wAlt, 'text', o ? '備用：' + WEAPONS[o.k].name : '');
    const t = Math.max(0, this.time);
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    set(h.timer, 'text', `${mm}:${ss < 10 ? '0' : ''}${ss}`);
    set(h.timer, 'color', t < 60 ? '#f55' : '#fff');
    const cnt = k => p.bag.reduce((a, e) => a + (e.k === k ? e.n : 0), 0);
    set(h.cntHeal, 'text', (cnt('bandage') + cnt('medkit')) + '');
    set(h.cntShield, 'text', cnt('shield_cell') + '');
    set(h.cntGren, 'text', cnt('grenade') + '');
    set(h.hurt, 'opacity', (Math.max(this.hurtA * 0.8, p.hp / p.maxHp < 0.3 ? 0.35 + 0.15 * Math.sin(performance.now() / 200) : 0)).toFixed(2));
    // 互動提示
    const it = this.interTarget;
    let prompt = '';
    if (p.search) prompt = `搜刮中… ${CONTAINERS[p.search.c.type].name}`;
    else if (p.using) prompt = `使用 ${ITEMS[p.using.k].name}…`;
    else if (it) {
      const key = Input.touch ? '' : '[E] ';
      if (it.type === 'container') { const c = it.c; const nm = c.type === 'body' ? `${c.name} 的遺體` : CONTAINERS[c.type].name; prompt = c.searched ? `${key}查看 ${nm}` : `${key}搜刮 ${nm}`; }
      else prompt = `${key}呼叫撤離電梯`;
    }
    set(h.prompt, 'text', prompt);
    set(h.prompt, 'display', prompt ? 'block' : 'none');
    set(h.btnInteract, 'opacity', it ? '1' : '0.35');
    // 撤離進度
    if (p.extractT > 0) { set(h.extractBar, 'display', 'block'); set(h.extractBar, 'html', `撤離中… ${(3 - p.extractT).toFixed(1)}s<div class="xb"><i style="width:${p.extractT / 3 * 100}%"></i></div>`); }
    else set(h.extractBar, 'display', 'none');
    // 目標
    const open = World.extracts.find(e => e.state === 'open');
    const obj = open ? `${open.name}已開啟！` : World.extracts.some(e => e.state === 'calling') ? '電梯抵達中…' : '搜刮物資，前往撤離電梯';
    set(h.objective, 'text', obj);
    // 小地圖
    this.mmT = (this.mmT || 0) + 1;
    if (this.mmT % 3 === 0) this.drawMinimap(this.mmCtx, this.mm.width, false);
  },
};
