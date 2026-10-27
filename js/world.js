'use strict';
// 地圖生成、碰撞、視線與尋路

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function pickWeighted(table, rnd) {
  let sum = 0; for (const t of table) sum += t[1];
  let r = rnd() * sum;
  for (const t of table) { r -= t[1]; if (r <= 0) return t[0]; }
  return table[table.length - 1][0];
}

// 線段與矩形相交，回傳最早的 t (0..1)，沒有則 -1
function segRect(x0, y0, x1, y1, r) {
  const dx = x1 - x0, dy = y1 - y0;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) { if (x0 < r.x || x0 > r.x + r.w) return -1; }
  else {
    let t1 = (r.x - x0) / dx, t2 = (r.x + r.w - x0) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (y0 < r.y || y0 > r.y + r.h) return -1; }
  else {
    let t1 = (r.y - y0) / dy, t2 = (r.y + r.h - y0) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// 線段與圓相交，回傳 {t, d}（d 為圓心到線段的垂直距離），沒有則 null
function segCircle(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0, dy = y1 - y0;
  const L2 = dx * dx + dy * dy || 1e-9;
  let t = ((cx - x0) * dx + (cy - y0) * dy) / L2;
  t = clamp(t, 0, 1);
  const px = x0 + dx * t, py = y0 + dy * t;
  const d = Math.hypot(cx - px, cy - py);
  if (d > r) return null;
  // 進入點
  const back = Math.sqrt(Math.max(0, r * r - d * d)) / Math.sqrt(L2);
  return { t: Math.max(0, t - back), d };
}

const World = {
  W: 3200, H: 3200, CELL: 400,
  walls: [], floors: [], roads: [], decals: [], containers: [], extracts: [], hvZones: [], openSpots: [],
  bucket: null, BS: 160, stamp: 0,
  nav: null, NC: 32, NW: 0, NH: 0,

  gen(mapId, seed) {
    const M = MAPS[mapId];
    const rnd = mulberry32(seed);
    this.rnd = rnd;
    this.map = M; this.mapId = mapId;
    this.walls = []; this.floors = []; this.roads = []; this.decals = []; this.containers = [];
    this.extracts = []; this.hvZones = []; this.openSpots = []; this.pads = [];
    const W = this.W, H = this.H, C = this.CELL, N = W / C;

    // 邊界
    const B = 40;
    this.addWall(-B, -B, W + 2 * B, B, 'border');
    this.addWall(-B, H, W + 2 * B, B, 'border');
    this.addWall(-B, 0, B, H, 'border');
    this.addWall(W, 0, B, H, 'border');

    // 道路（純視覺）
    for (let i = 1; i < N; i++) {
      this.roads.push({ x: i * C - 36, y: 0, w: 72, h: H });
      this.roads.push({ x: 0, y: i * C - 36, w: W, h: 72 });
    }

    const cells = [];
    for (let by = 0; by < N; by++) for (let bx = 0; bx < N; bx++) cells.push({ bx, by, used: null });
    const cellAt = (bx, by) => cells[by * N + bx];
    const edge = cells.filter(c => c.bx === 0 || c.by === 0 || c.bx === N - 1 || c.by === N - 1);

    // 撤離電梯：分散在三個不同方向的邊緣
    const sides = [c => c.by === 0, c => c.bx === N - 1, c => c.by === N - 1, c => c.bx === 0];
    const sideOrder = [0, 1, 2, 3].sort(() => rnd() - 0.5).slice(0, 3);
    for (const s of sideOrder) {
      const opts = edge.filter(c => sides[s](c) && !c.used && !(c.bx === 0 && c.by === 0) && !(c.bx === N - 1 && c.by === N - 1) && !(c.bx === 0 && c.by === N - 1) && !(c.bx === N - 1 && c.by === 0));
      const c = opts[Math.floor(rnd() * opts.length)];
      c.used = 'extract';
      const names = ['北', '東', '南', '西'];
      this.extracts.push({ x: c.bx * C + C / 2, y: c.by * C + C / 2, r: 70, state: 'idle', t: 0, name: names[s] + '側電梯' });
    }

    // 玩家出生點：未使用的邊緣格
    const spawnOpts = edge.filter(c => !c.used);
    const sc = spawnOpts[Math.floor(rnd() * spawnOpts.length)];
    sc.used = 'spawn';
    this.playerSpawn = { x: sc.bx * C + C / 2, y: sc.by * C + C / 2 };

    // 高價值區域
    const inner = cells.filter(c => c.bx >= 2 && c.by >= 2 && c.bx <= N - 3 && c.by <= N - 3 && !c.used);
    if (mapId === 'port') {
      // 中央發射台：開闊區域，女王巢穴
      const cx = Math.floor(N / 2) - 1, cy = Math.floor(N / 2) - 1;
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) cellAt(cx + ox, cy + oy).used = 'pad';
      const pad = { x: cx * C + 40, y: cy * C + 40, w: C * 2 - 80, h: C * 2 - 80 };
      this.pads.push(pad);
      this.hvZones.push({ x: cx * C, y: cy * C, w: C * 2, h: C * 2, name: '發射台', boss: true });
      // 發射台周邊掩體與箱子
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        const px = cx * C + C + Math.cos(a) * 260, py = cy * C + C + Math.sin(a) * 260;
        this.addWall(px - 30, py - 20, 60, 40, 'cover').sub = 'barrier';
        this.addContainer(px + Math.cos(a) * 60, py + Math.sin(a) * 60, rnd() < 0.5 ? 'safe' : 'weapon', true);
      }
    }
    const hvCount = mapId === 'dam' ? 1 : 2;
    for (let i = 0; i < hvCount; i++) {
      const opts = inner.filter(c => !c.used);
      if (!opts.length) break;
      const c = opts[Math.floor(rnd() * opts.length)];
      c.used = 'hv';
      const z = { x: c.bx * C, y: c.by * C, w: C, h: C, name: ['控制塔', '研究所', '機庫'][i % 3] };
      this.hvZones.push(z);
      this.building(c.bx * C, c.by * C, true, 290, 330);
    }

    // 其餘格子
    for (const c of cells) {
      if (c.used) {
        if (c.used === 'extract' || c.used === 'spawn') this.openCell(c.bx * C, c.by * C, 0.4);
        continue;
      }
      if (rnd() < M.density) this.building(c.bx * C, c.by * C, false, 190, 300);
      else this.openCell(c.bx * C, c.by * C, 1);
    }

    // 地面裝飾
    for (let i = 0; i < 900; i++) {
      this.decals.push({ x: rnd() * W, y: rnd() * H, s: 6 + rnd() * 26, k: Math.floor(rnd() * 4), a: rnd() * Math.PI });
    }

    this.buildBuckets();
    this.buildNav();
    // 可生成位置
    for (let y = 1; y < this.NH - 1; y++) for (let x = 1; x < this.NW - 1; x++) {
      if (!this.nav[y * this.NW + x]) this.openSpots.push(x, y);
    }
  },

  addWall(x, y, w, h, kind = 'wall') {
    const r = { x, y, w, h, kind, id: this.walls.length };
    this.walls.push(r);
    return r;
  },

  // 掩體高度：子彈高於此值即可從上方飛過；蹲下時視線低於矮掩體
  COVER_TOP: { car: 40, block: 38, container: 80, desk: 34, barrier: 48 },
  wallTop(w) {
    if (w.kind === 'cover') return this.COVER_TOP[w.sub] || 50;
    return w.kind === 'border' ? H.BORDER : H.WALL;
  },

  addContainer(x, y, type, hv) {
    const c = { x, y, type, hv: !!hv, r: 15, searched: false, items: null, id: this.containers.length, claimed: null };
    this.containers.push(c);
    return c;
  },

  building(x0, y0, hv, minS, maxS) {
    const rnd = this.rnd, C = this.CELL, m = 46, T = 14, D = 72;
    const avail = C - m * 2;
    const bw = Math.min(avail, minS + rnd() * (maxS - minS));
    const bh = Math.min(avail, minS + rnd() * (maxS - minS));
    const bx = x0 + m + rnd() * (avail - bw), by = y0 + m + rnd() * (avail - bh);
    this.floors.push({ x: bx, y: by, w: bw, h: bh, hv });
    let doors = [rnd() < 0.55, rnd() < 0.55, rnd() < 0.55, rnd() < 0.55];
    if (doors.filter(Boolean).length < 2) { doors = [false, false, false, false]; const a = Math.floor(rnd() * 4); doors[a] = true; doors[(a + 2) % 4] = true; }
    const side = (horiz, sx, sy, len, door) => {
      if (!door) { horiz ? this.addWall(sx, sy, len, T) : this.addWall(sx, sy, T, len); return; }
      const p = 34 + rnd() * (len - 68 - D);
      if (horiz) { this.addWall(sx, sy, p, T); this.addWall(sx + p + D, sy, len - p - D, T); }
      else { this.addWall(sx, sy, T, p); this.addWall(sx, sy + p + D, T, len - p - D); }
    };
    side(true, bx, by, bw, doors[0]);
    side(true, bx, by + bh - T, bw, doors[2]);
    side(false, bx, by + T, bh - 2 * T, doors[3]);
    side(false, bx + bw - T, by + T, bh - 2 * T, doors[1]);
    let split = null;
    if (bw > 250 && rnd() < 0.6) {
      const sx = bx + bw * (0.4 + rnd() * 0.2);
      split = sx;
      const len = bh - 2 * T, p = 20 + rnd() * (len - 40 - D);
      this.addWall(sx, by + T, T, p);
      this.addWall(sx, by + T + p + D, T, len - p - D);
    }
    // 室內箱子
    const n = hv ? 3 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 3);
    const table = hv ? [['safe', 25], ['weapon', 25], ['crate', 30], ['medical', 20]] : [['crate', 35], ['trash', 22], ['medical', 15], ['weapon', 14], ['safe', 4]];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 12; tries++) {
        const cx = bx + 36 + rnd() * (bw - 72), cy = by + 36 + rnd() * (bh - 72);
        if (split && Math.abs(cx - split) < 30) continue;
        if (this.containers.some(c => dist2(c.x, c.y, cx, cy) < 50 * 50)) continue;
        this.addContainer(cx, cy, pickWeighted(table, rnd), hv);
        break;
      }
    }
    // 室內家具（小掩體）
    if (rnd() < 0.5 && bw > 200 && bh > 200) {
      const fx = bx + bw * 0.5 - 25, fy = by + bh * 0.5 - 15;
      if (!split || Math.abs(fx + 25 - split) > 60) this.addWall(fx, fy, 50, 30, 'cover').sub = 'desk';
    }
  },

  openCell(x0, y0, amount) {
    const rnd = this.rnd, C = this.CELL;
    const n = Math.floor((2 + rnd() * 4) * amount);
    const placed = [];
    for (let i = 0; i < n; i++) {
      const kind = rnd();
      let w, h, sub;
      if (kind < 0.35) { w = 64; h = 30; sub = 'car'; }          // 車輛殘骸
      else if (kind < 0.7) { w = 36; h = 36; sub = 'block'; }    // 水泥塊
      else { w = 96; h = 40; sub = 'container'; }                // 貨櫃
      if (rnd() < 0.5) { const t = w; w = h; h = t; }
      const x = x0 + 60 + rnd() * (C - 120 - w), y = y0 + 60 + rnd() * (C - 120 - h);
      // 不要擋住電梯中心
      if (Math.abs(x + w / 2 - (x0 + C / 2)) < 110 && Math.abs(y + h / 2 - (y0 + C / 2)) < 110) continue;
      if (placed.some(p => x < p.x + p.w + 40 && x + w + 40 > p.x && y < p.y + p.h + 40 && y + h + 40 > p.y)) continue;
      placed.push({ x, y, w, h });
      this.addWall(x, y, w, h, 'cover').sub = sub;
    }
    const cn = rnd() < 0.8 * amount ? 1 + Math.floor(rnd() * 2) : 0;
    for (let i = 0; i < cn; i++) {
      for (let tries = 0; tries < 10; tries++) {
        const x = x0 + 50 + rnd() * (C - 100), y = y0 + 50 + rnd() * (C - 100);
        if (placed.some(p => x > p.x - 25 && x < p.x + p.w + 25 && y > p.y - 25 && y < p.y + p.h + 25)) continue;
        if (amount < 1 && Math.abs(x - (x0 + C / 2)) < 110 && Math.abs(y - (y0 + C / 2)) < 110) continue;
        this.addContainer(x, y, rnd() < 0.7 ? 'trash' : 'crate', false);
        break;
      }
    }
  },

  buildBuckets() {
    const BS = this.BS, nx = Math.ceil(this.W / BS) + 2, ny = Math.ceil(this.H / BS) + 2;
    this.bnx = nx; this.bny = ny;
    this.bucket = Array.from({ length: nx * ny }, () => []);
    this.wallStamp = new Int32Array(this.walls.length);
    for (const w of this.walls) {
      const x0 = clamp(Math.floor(w.x / BS) + 1, 0, nx - 1), x1 = clamp(Math.floor((w.x + w.w) / BS) + 1, 0, nx - 1);
      const y0 = clamp(Math.floor(w.y / BS) + 1, 0, ny - 1), y1 = clamp(Math.floor((w.y + w.h) / BS) + 1, 0, ny - 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.bucket[y * nx + x].push(w);
    }
  },

  query(x0, y0, x1, y1, out) {
    out.length = 0;
    const BS = this.BS, nx = this.bnx, ny = this.bny;
    const ax = clamp(Math.floor(Math.min(x0, x1) / BS) + 1, 0, nx - 1), bx = clamp(Math.floor(Math.max(x0, x1) / BS) + 1, 0, nx - 1);
    const ay = clamp(Math.floor(Math.min(y0, y1) / BS) + 1, 0, ny - 1), by = clamp(Math.floor(Math.max(y0, y1) / BS) + 1, 0, ny - 1);
    const st = ++this.stamp;
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      for (const w of this.bucket[y * nx + x]) {
        if (this.wallStamp[w.id] === st) continue;
        this.wallStamp[w.id] = st;
        out.push(w);
      }
    }
    return out;
  },

  _q: [],
  // 圓形與牆壁碰撞後推出
  resolveCircle(e) {
    const r = e.r;
    const ws = this.query(e.x - r - 2, e.y - r - 2, e.x + r + 2, e.y + r + 2, this._q);
    for (let pass = 0; pass < 2; pass++) {
      for (const w of ws) {
        const cx = clamp(e.x, w.x, w.x + w.w), cy = clamp(e.y, w.y, w.y + w.h);
        let dx = e.x - cx, dy = e.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2), push = r - d;
          e.x += dx / d * push; e.y += dy / d * push;
        } else {
          // 圓心在矩形內：往最近的邊推
          const l = e.x - w.x, rr = w.x + w.w - e.x, t = e.y - w.y, b = w.y + w.h - e.y;
          const m = Math.min(l, rr, t, b);
          if (m === l) e.x = w.x - r; else if (m === rr) e.x = w.x + w.w + r; else if (m === t) e.y = w.y - r; else e.y = w.y + w.h + r;
        }
      }
    }
    e.x = clamp(e.x, r, this.W - r); e.y = clamp(e.y, r, this.H - r);
  },

  pointBlocked(x, y, pad = 0) {
    const ws = this.query(x - pad, y - pad, x + pad, y + pad, this._q);
    for (const w of ws) if (x > w.x - pad && x < w.x + w.w + pad && y > w.y - pad && y < w.y + w.h + pad) return true;
    return false;
  },

  _q2: [],
  // 線段最早撞到牆壁的 t，沒有回傳 1.0 以上
  rayWall(x0, y0, x1, y1) {
    const ws = this.query(x0, y0, x1, y1, this._q2);
    let best = 2;
    for (const w of ws) {
      const t = segRect(x0, y0, x1, y1, w);
      if (t >= 0 && t < best) best = t;
    }
    return best;
  },

  los(ax, ay, bx, by) { return this.rayWall(ax, ay, bx, by) > 1; },

  buildNav() {
    const NC = this.NC;
    this.NW = Math.ceil(this.W / NC); this.NH = Math.ceil(this.H / NC);
    this.nav = new Uint8Array(this.NW * this.NH);
    const pad = 16;
    for (const w of this.walls) {
      const x0 = clamp(Math.floor((w.x - pad) / NC), 0, this.NW - 1), x1 = clamp(Math.floor((w.x + w.w + pad) / NC), 0, this.NW - 1);
      const y0 = clamp(Math.floor((w.y - pad) / NC), 0, this.NH - 1), y1 = clamp(Math.floor((w.y + w.h + pad) / NC), 0, this.NH - 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const cx = x * NC + NC / 2, cy = y * NC + NC / 2;
        if (cx > w.x - pad && cx < w.x + w.w + pad && cy > w.y - pad && cy < w.y + w.h + pad) this.nav[y * this.NW + x] = 1;
      }
    }
    this.gScore = new Float32Array(this.NW * this.NH);
    this.came = new Int32Array(this.NW * this.NH);
    this.visit = new Int32Array(this.NW * this.NH);
    this.visitId = 0;
  },

  nearestOpen(gx, gy) {
    const NW = this.NW, NH = this.NH;
    for (let r = 0; r < 6; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = gx + dx, y = gy + dy;
        if (x < 0 || y < 0 || x >= NW || y >= NH) continue;
        if (!this.nav[y * NW + x]) return [x, y];
      }
    }
    return null;
  },

  randomOpen(rnd, awayFrom, minD) {
    for (let i = 0; i < 60; i++) {
      const j = Math.floor(rnd() * (this.openSpots.length / 2)) * 2;
      const x = this.openSpots[j] * this.NC + this.NC / 2, y = this.openSpots[j + 1] * this.NC + this.NC / 2;
      if (awayFrom && awayFrom.some(p => dist2(p.x, p.y, x, y) < minD * minD)) continue;
      return { x, y };
    }
    return { x: this.W / 2, y: this.H / 2 };
  },

  // A* 尋路（8 方向）；回傳世界座標路徑點
  findPath(sx, sy, tx, ty, maxIter = 5000) {
    const NC = this.NC, NW = this.NW, NH = this.NH, nav = this.nav;
    let s = [clamp(Math.floor(sx / NC), 0, NW - 1), clamp(Math.floor(sy / NC), 0, NH - 1)];
    let t = [clamp(Math.floor(tx / NC), 0, NW - 1), clamp(Math.floor(ty / NC), 0, NH - 1)];
    if (nav[s[1] * NW + s[0]]) s = this.nearestOpen(s[0], s[1]);
    if (nav[t[1] * NW + t[0]]) t = this.nearestOpen(t[0], t[1]);
    if (!s || !t) return null;
    const si = s[1] * NW + s[0], ti = t[1] * NW + t[0];
    if (si === ti) return [{ x: tx, y: ty }];
    const vid = ++this.visitId;
    const g = this.gScore, came = this.came, visit = this.visit;
    const heap = [], hf = [];
    const push = (i, f) => {
      heap.push(i); hf.push(f);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (hf[p] <= hf[k]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]]; [hf[p], hf[k]] = [hf[k], hf[p]]; k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const li = heap.pop(), lf = hf.pop();
      if (heap.length) {
        heap[0] = li; hf[0] = lf;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < heap.length && hf[l] < hf[m]) m = l;
          if (r < heap.length && hf[r] < hf[m]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; [hf[m], hf[k]] = [hf[k], hf[m]]; k = m;
        }
      }
      return top;
    };
    const h = (i) => { const x = i % NW, y = (i / NW) | 0; const dx = Math.abs(x - t[0]), dy = Math.abs(y - t[1]); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
    visit[si] = vid; g[si] = 0; came[si] = -1;
    push(si, h(si));
    const closedId = vid; // 以 g 判斷即可
    let iter = 0, found = false;
    while (heap.length && iter++ < maxIter) {
      const cur = pop();
      if (cur === ti) { found = true; break; }
      const cx = cur % NW, cy = (cur / NW) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= NW || ny >= NH) continue;
        const ni = ny * NW + nx;
        if (nav[ni]) continue;
        if (dx && dy && (nav[cy * NW + nx] || nav[ny * NW + cx])) continue; // 不切角
        const ng = g[cur] + (dx && dy ? 1.414 : 1);
        if (visit[ni] === vid && g[ni] <= ng) continue;
        visit[ni] = vid; g[ni] = ng; came[ni] = cur;
        push(ni, ng + h(ni));
      }
    }
    void closedId;
    if (!found) return null;
    const cellsPath = [];
    for (let i = ti; i !== -1; i = came[i]) cellsPath.push(i);
    cellsPath.reverse();
    const pts = cellsPath.map(i => ({ x: (i % NW) * NC + NC / 2, y: ((i / NW) | 0) * NC + NC / 2 }));
    pts[pts.length - 1] = { x: tx, y: ty };
    // 路徑平滑：能直線到達就跳過中間點
    const out = [];
    let a = { x: sx, y: sy }, i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 8);
      while (j > i && !this.clearPath(a.x, a.y, pts[j].x, pts[j].y)) j--;
      out.push(pts[j]);
      a = pts[j]; i = j + 1;
    }
    return out;
  },

  // 檢查寬度約 28 的通道是否通暢
  clearPath(x0, y0, x1, y1) {
    const nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny) || 1, o = 12;
    const ox = nx / l * o, oy = ny / l * o;
    return this.los(x0 + ox, y0 + oy, x1 + ox, y1 + oy) && this.los(x0 - ox, y0 - oy, x1 - ox, y1 - oy);
  },
};
