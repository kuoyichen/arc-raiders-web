'use strict';
// 第一人稱 3D 渲染（Three.js）。模擬仍在 2D 平面 (x, y) 上進行，渲染時對應到 (x, 高度, y)。

const H = { WALL: 110, COVER: 58, BORDER: 260, EYE: 44, GUN: 36, FLY: 62 };

// 畫質等級：解析度倍率、可視距離、地面貼圖大小、粒子上限
const GFX = [
  { name: '低', pr: 0.7, far: 850, tex: 1024, maxP: 220 },
  { name: '中', pr: 1.1, far: 1150, tex: 1024, maxP: 450 },
  { name: '高', pr: 2, far: 1500, tex: 2048, maxP: 700 },
];

// 各地圖的外觀主題：天空、光線、建材顏色、遠景
const THEMES = {
  dam: { top: 0x5d8fc0, hor: 0xc8d6d0, sun: 0xfff2d8, hemiG: 0x445038, wall: 0x6f6e70, wallTop: 0x9a9890, border: 0x3d4239, sil: 0x41544a, tex: 'concrete',
    cars: [0x7a4a32, 0x5a6a72, 0x8a8270, 0x6a3a32], block: 0x8c8a84, boxes: [0x8a3a2a, 0x2f5a7a, 0x4a6a3a, 0xa0662a], dust: { n: 50, c: 0xf4f4e0, s: 2.2 } },
  city: { top: 0x9a7a58, hor: 0xf0d2a2, sun: 0xffe2b0, hemiG: 0x5a4630, wall: 0xa89070, wallTop: 0xc8b090, border: 0x7a6648, sil: 0x8a6c4e, tex: 'sandstone',
    cars: [0x8a5a3a, 0x9a8a6a, 0x6a5a4a, 0xa06a3a], block: 0xb09a78, boxes: [0x9a5a3a, 0x7a6a4a, 0x5a6a6a, 0xa07a3a], dust: { n: 260, c: 0xe0c090, s: 3 } },
  port: { top: 0x34405a, hor: 0x9aa2b0, sun: 0xe8eeff, hemiG: 0x34363c, wall: 0x5f6873, wallTop: 0x8a929c, border: 0x2e3238, sil: 0x3a4250, tex: 'metal',
    cars: [0x4a5a6a, 0x7a7e84, 0x3a4a5a, 0x8a3a32], block: 0x8a8c90, boxes: [0x2a5a8a, 0xb0802a, 0x8a2a2a, 0x3a7a5a], dust: { n: 0 } },
};
const WEATHERS = [
  { id: 'clear', name: '晴朗', w: 5 },
  { id: 'dusk', name: '黃昏', w: 3 },
  { id: 'overcast', name: '陰天', w: 3 },
];

const R3 = {
  ready: false,
  fps: 60,

  init(canvas3d, overlay) {
    this.cv = canvas3d;
    this.ov = overlay;
    this.oc = overlay.getContext('2d');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: !('ontouchstart' in window), powerPreference: 'high-performance' });
    } catch (e) {
      this.failed = true;
      return;
    }
    this.camera = new THREE.PerspectiveCamera(75, 1, 1, 2400);
    this.v = new THREE.Vector3();
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s3 = new THREE.Vector3();
    this.col = new THREE.Color();
    this.yAxis = new THREE.Vector3(0, 1, 0);
    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      sphere: new THREE.SphereGeometry(1, 12, 8),
      sphereLo: new THREE.SphereGeometry(1, 8, 6),
      cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
      hex: new THREE.CylinderGeometry(1, 1, 1, 6),
      disc: new THREE.CylinderGeometry(1, 1, 0.08, 14),
      octa: new THREE.OctahedronGeometry(1),
      ring: new THREE.RingGeometry(0.9, 1, 40),
      disk: new THREE.CircleGeometry(1, 32),
    };
    this.ready = true;
    this.resize();
  },

  resize() {
    if (!this.ready) return;
    const w = this.cv.clientWidth || window.innerWidth, h = this.cv.clientHeight || window.innerHeight;
    const touch = Input.touch;
    void touch;
    const g = this.gfxConf();
    this.renderer.setPixelRatio(g.pr < 1 ? g.pr : Math.min(window.devicePixelRatio || 1, g.pr));
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    // 以水平視野 90° 為準，直向螢幕時限制垂直視野
    const hfov = 90 * Math.PI / 180;
    let vfov = 2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180 / Math.PI;
    vfov = clamp(vfov, 55, 100);
    this.camera.fov = vfov;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.W = w; this.H = h;
  },

  gfxLv() { return S && S.settings.gfx != null ? S.settings.gfx : (Input.touch ? 1 : 2); },
  gfxConf() { return GFX[this.gfxLv()]; },
  applyGfx() {
    this.resize();
    if (this.scene) {
      const g = this.gfxConf();
      this.scene.fog.far = g.far;
      this.camera.far = g.far + 60;
      this.camera.updateProjectionMatrix();
      this.scaleSky();
    }
  },
  scaleSky() {
    const far = this.gfxConf().far;
    if (this.skyDome) this.skyDome.scale.setScalar(far + 20);
    if (this.skyline) this.skyline.scale.setScalar(far * 0.85 / 1000);
  },

  mat(color, opts = {}) { return new THREE.MeshLambertMaterial(Object.assign({ color }, opts)); },
  basic(color, opts = {}) { return new THREE.MeshBasicMaterial(Object.assign({ color }, opts)); },
  mesh(geo, mat, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  },

  // ---------- 建立場景 ----------
  build(raid) {
    if (!this.ready) return;
    const M = raid.map;
    const TH = THEMES[raid.mapId] || THEMES.dam;
    this.theme = TH;
    // 每場隨機天氣與時段
    let wr = Math.random() * WEATHERS.reduce((a, w) => a + w.w, 0), wea = WEATHERS[0];
    for (const w of WEATHERS) { wr -= w.w; if (wr <= 0) { wea = w; break; } }
    this.weather = wea;
    const top = new THREE.Color(TH.top), hor = new THREE.Color(TH.hor), sunC = new THREE.Color(TH.sun);
    let sunI = 0.7, hemiI = 0.8, fogNear = 220;
    this.sunDir = new THREE.Vector3(0.6, 1, 0.35).normalize();
    if (wea.id === 'dusk') {
      top.lerp(new THREE.Color(0x3a3466), 0.6); hor.lerp(new THREE.Color(0xf09458), 0.6); sunC.set(0xffa868);
      sunI = 0.75; hemiI = 0.6; this.sunDir.set(0.9, 0.16, 0.4).normalize();
    } else if (wea.id === 'overcast') {
      top.lerp(new THREE.Color(0x8a9098), 0.7); hor.lerp(new THREE.Color(0xa9adb0), 0.6); sunC.lerp(new THREE.Color(0xcccccc), 0.6);
      sunI = 0.35; hemiI = 0.95; fogNear = 120;
    }
    this.hor = hor;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = hor.clone();
    const gc = this.gfxConf();
    scene.fog = new THREE.Fog(hor.clone(), fogNear, gc.far);
    this.camera.far = gc.far + 60;
    this.resize();
    this.camera.updateProjectionMatrix();
    scene.add(new THREE.HemisphereLight(new THREE.Color(0xfff4e0).lerp(sunC, 0.4), TH.hemiG, hemiI));
    const sun = new THREE.DirectionalLight(sunC, sunI);
    sun.position.copy(this.sunDir);
    scene.add(sun);
    scene.add(this.camera);
    this.buildSky(raid.mapId, top, hor, sunC, wea);

    // 地面貼圖
    const TS = gc.tex;
    const tc = document.createElement('canvas');
    tc.width = tc.height = TS;
    const g = tc.getContext('2d');
    const k = TS / World.W;
    g.fillStyle = M.ground; g.fillRect(0, 0, TS, TS);
    const T = 200;
    for (let gx = 0; gx < World.W / T; gx++) for (let gy = 0; gy < World.H / T; gy++) {
      const hh = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
      if (hh - Math.floor(hh) < 0.45) { g.fillStyle = M.ground2; g.fillRect(gx * T * k, gy * T * k, T * k, T * k); }
    }
    this.groundExtras(g, k, raid.mapId, TS);
    for (const d of World.decals) {
      if (d.k === 0) { g.fillStyle = 'rgba(90,110,60,0.45)'; g.beginPath(); g.arc(d.x * k, d.y * k, d.s * k, 0, TAU); g.fill(); }
      else if (d.k === 1) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(d.x * k, d.y * k, d.s * k, d.s * k * 0.5, d.a, 0, TAU); g.fill(); }
      else if (d.k === 2) { g.fillStyle = 'rgba(150,140,120,0.5)'; g.fillRect(d.x * k, d.y * k, d.s * 0.4 * k, d.s * 0.3 * k); }
    }
    g.fillStyle = M.road;
    for (const r of World.roads) g.fillRect(r.x * k, r.y * k, r.w * k, r.h * k);
    g.strokeStyle = 'rgba(220,200,120,0.35)'; g.lineWidth = Math.max(1, 3 * k); g.setLineDash([26 * k, 30 * k]);
    g.beginPath();
    for (const r of World.roads) {
      if (r.w < r.h) { g.moveTo((r.x + r.w / 2) * k, 0); g.lineTo((r.x + r.w / 2) * k, TS); }
      else { g.moveTo(0, (r.y + r.h / 2) * k); g.lineTo(TS, (r.y + r.h / 2) * k); }
    }
    g.stroke(); g.setLineDash([]);
    for (const z of World.hvZones) { g.fillStyle = 'rgba(255,60,30,0.16)'; g.fillRect(z.x * k, z.y * k, z.w * k, z.h * k); }
    for (const p of World.pads) {
      g.fillStyle = '#2c2e33'; g.fillRect(p.x * k, p.y * k, p.w * k, p.h * k);
      g.strokeStyle = '#d9b740'; g.lineWidth = 6 * k; g.strokeRect((p.x + 20) * k, (p.y + 20) * k, (p.w - 40) * k, (p.h - 40) * k);
      g.beginPath(); g.arc((p.x + p.w / 2) * k, (p.y + p.h / 2) * k, 120 * k, 0, TAU); g.stroke();
    }
    for (const f of World.floors) {
      g.fillStyle = f.hv ? '#3d3431' : '#37342f'; g.fillRect(f.x * k, f.y * k, f.w * k, f.h * k);
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
      g.beginPath();
      for (let x = f.x + 40; x < f.x + f.w; x += 40) { g.moveTo(x * k, f.y * k); g.lineTo(x * k, (f.y + f.h) * k); }
      for (let y = f.y + 40; y < f.y + f.h; y += 40) { g.moveTo(f.x * k, y * k); g.lineTo((f.x + f.w) * k, y * k); }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(tc);
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(World.W, World.H), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(World.W / 2, 0, World.H / 2);
    scene.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(World.W * 3, World.H * 3), this.mat(new THREE.Color(M.ground).multiplyScalar(0.6)));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(World.W / 2, -1, World.H / 2);
    scene.add(outer);

    // 牆壁（以 InstancedMesh 一次繪製）
    const kinds = { wall: [], cover: [], border: [] };
    for (const w of World.walls) kinds[w.kind].push(w);
    const conf = { wall: [H.WALL, TH.wall], border: [H.BORDER, TH.border] };
    const wallTex = this.wallTexture(TH.tex);
    this.buildCovers(kinds.cover, TH);
    for (const kind of ['wall', 'border']) {
      const list = kinds[kind];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(this.geo.box, this.mat(0xffffff, { map: wallTex }), list.length);
      const [hgt, base] = conf[kind];
      list.forEach((w, i) => {
        const hh = hgt;
        this.m4.compose(this.v.set(w.x + w.w / 2, hh / 2, w.y + w.h / 2), this.q.identity(), this.s3.set(w.w, hh, w.h));
        im.setMatrixAt(i, this.m4);
        const shade = 0.85 + ((w.id * 53) % 15) / 50;
        im.setColorAt(i, this.col.setHex(base).multiplyScalar(shade));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      scene.add(im);
    }
    // 牆頂邊線（讓建築更有立體感）
    {
      const list = kinds.wall;
      const im = new THREE.InstancedMesh(this.geo.box, this.mat(TH.wallTop), list.length);
      list.forEach((w, i) => {
        this.m4.compose(this.v.set(w.x + w.w / 2, H.WALL + 2, w.y + w.h / 2), this.q.identity(), this.s3.set(w.w + 4, 4, w.h + 4));
        im.setMatrixAt(i, this.m4);
      });
      scene.add(im);
    }

    // 撤離電梯
    this.extractMeshes = World.extracts.map(e => {
      const grp = new THREE.Group();
      grp.position.set(e.x, 0, e.y);
      grp.add(this.mesh(this.geo.box, this.mat(0x2a3440), 0, 3, 0, 124, 6, 124));
      const pillar = this.mat(0x55606c);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) grp.add(this.mesh(this.geo.box, pillar, sx * 56, 70, sz * 56, 10, 140, 10));
      grp.add(this.mesh(this.geo.box, pillar, 0, 142, 0, 124, 6, 124));
      const glowMat = this.basic(0x44ccff, { transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      const ring = this.mesh(this.geo.ring, glowMat, 0, 7, 0, e.r, e.r, 1);
      ring.rotation.x = -Math.PI / 2;
      grp.add(ring);
      const beamMat = this.basic(0x44ccff, { transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const beam = this.mesh(this.geo.cyl, beamMat, 0, 450, 0, 26, 900, 26);
      grp.add(beam);
      scene.add(grp);
      return { grp, glowMat, beamMat };
    });

    // 容器、實體
    this.cMeshes = new Map();
    this.eMeshes = new Map();

    // 子彈與光束（拉長的方塊）
    this.tracers = new THREE.InstancedMesh(this.geo.box, this.basic(0xffffff, { fog: false }), 600);
    this.tracers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracers.setColorAt(0, this.col.setHex(0xffffff));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    this.orbs = new THREE.InstancedMesh(this.geo.sphereLo, this.basic(0xffffff), 120);
    this.orbs.setColorAt(0, this.col.setHex(0xffffff));
    this.orbs.frustumCulled = false;
    scene.add(this.orbs);
    // 預警圈
    this.rings = [];
    for (let i = 0; i < 40; i++) {
      const m = this.mesh(this.geo.ring, this.basic(0xff4422, { transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }), 0, 2, 0, 1, 1, 1);
      m.rotation.x = -Math.PI / 2; m.visible = false;
      const fill = this.mesh(this.geo.disk, this.basic(0xff4422, { transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }), 0, 0.01, 0, 1, 1, 1);
      m.add(fill);
      m.userData.fill = fill;
      scene.add(m); this.rings.push(m);
    }
    // 爆炸閃光
    this.flashes = [];
    for (let i = 0; i < 8; i++) {
      const m = this.mesh(this.geo.sphere, this.basic(0xffd890, { transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0, 0, 1, 1, 1);
      m.visible = false; scene.add(m); this.flashes.push(m);
    }
    this.flashI = 0;
    // 粒子（圓形貼圖）
    const dc = document.createElement('canvas'); dc.width = dc.height = 64;
    const dg = dc.getContext('2d');
    const grad = dg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.8)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = grad; dg.fillRect(0, 0, 64, 64);
    const dot = new THREE.CanvasTexture(dc);
    const N = 700;
    this.pN = N;
    const pg = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3);
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 9, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    const sg = new THREE.BufferGeometry();
    this.sPos = new Float32Array(200 * 3); this.sCol = new Float32Array(200 * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3));
    this.smoke = new THREE.Points(sg, new THREE.PointsMaterial({ size: 26, map: dot, vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false, sizeAttenuation: true }));
    this.smoke.frustumCulled = false;
    scene.add(this.smoke);

    this.buildViewmodel();
    this.muzzleLight = new THREE.PointLight(0xffc860, 0, 260, 2);
    this.muzzleLight.position.set(1.5, -0.5, -8);
    this.camera.add(this.muzzleLight);
    this.debrisMesh = new THREE.InstancedMesh(this.geo.box, this.mat(0xffffff), 80);
    this.debrisMesh.setColorAt(0, this.col.setHex(0xffffff));
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.count = 0;
    scene.add(this.debrisMesh);
    this.debrisList = [];
    this.buildScatter(raid.mapId, TH);
    this.buildAmbient(TH, dot);
    this.scaleSky();
    this.kick = 0;
    this.fpsAcc = 0; this.fpsN = 0; this.slowT = 0; this.gfxCool = 8;
    this.vmBaseX = Input.touch ? 1.1 : 1.4;
    this.hitT = 0; this.hitCrit = false; this.killT = 0;
    this.recoilZ = 0; this.bob = 0;
    this.losCache = new Map();
  },

  // 漸層天空、太陽與跟著攝影機的遠景輪廓
  buildSky(mapId, top, hor, sunC, wea) {
    const scene = this.scene;
    const geo = new THREE.SphereGeometry(1, 24, 14);
    const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
    const below = hor.clone().multiplyScalar(0.75), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y >= 0) c.copy(hor).lerp(top, Math.pow(y, 0.55)); else c.copy(hor).lerp(below, Math.min(1, -y * 4));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.skyDome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.skyDome.renderOrder = -2;
    scene.add(this.skyDome);
    if (wea.id !== 'overcast') {
      const sm = this.basic(sunC.clone().lerp(new THREE.Color(0xffffff), 0.5), { fog: false, transparent: true, opacity: 0.9, depthWrite: false });
      // 太陽掛在天空球上，跟著一起縮放
      const disc = new THREE.Mesh(this.geo.disk, sm);
      disc.renderOrder = -1;
      disc.position.copy(this.sunDir).multiplyScalar(0.97);
      disc.scale.setScalar(wea.id === 'dusk' ? 0.05 : 0.032);
      disc.lookAt(0, 0, 0);
      this.skyDome.add(disc);
    }
    // 遠景：以半徑 1000 建立，之後依可視距離縮放
    const grp = new THREE.Group();
    this.skyline = grp;
    this.blinkers = [];
    const mix = k => new THREE.Color(this.theme.sil).lerp(hor, k);
    const solid = k => this.basic(mix(k), { fog: false });
    const put = (geo, mat, a, r, y, sx, sy, sz, rz = 0) => {
      const m = this.mesh(geo, mat, Math.cos(a) * r, y, Math.sin(a) * r, sx, sy, sz);
      m.rotation.set(0, -a, rz);
      grp.add(m); return m;
    };
    const cone = new THREE.ConeGeometry(1, 1, 7);
    if (mapId === 'dam') {
      for (let i = 0; i < 26; i++) { const a = i / 26 * TAU + Math.random() * 0.2, h = 120 + Math.random() * 200; put(cone, solid(0.55), a, 1060, h / 2 - 10, 120 + Math.random() * 90, h, 120 + Math.random() * 90); }
      for (let i = 0; i < 30; i++) { const a = i / 30 * TAU + Math.random() * 0.2, h = 70 + Math.random() * 120; put(cone, solid(0.3), a, 960, h / 2 - 10, 70 + Math.random() * 60, h, 70 + Math.random() * 60); }
      // 大壩
      const a0 = Math.random() * TAU;
      put(this.geo.box, solid(0.25), a0, 900, 70, 40, 160, 520);
      put(this.geo.box, solid(0.15), a0, 880, 152, 30, 8, 530);
      for (let i = -2; i <= 2; i++) put(this.geo.box, solid(0.35), a0 + i * 0.12, 885, 40, 8, 80, 18);
      // 電塔
      for (let i = 0; i < 6; i++) { const a = a0 + 1.2 + i * 0.35; put(this.geo.box, solid(0.3), a, 900, 90, 6, 180, 6); put(this.geo.box, solid(0.3), a, 900, 170, 4, 4, 60); }
    } else if (mapId === 'city') {
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * TAU, h = 70 + Math.pow(Math.random(), 1.6) * 300, w = 30 + Math.random() * 80;
        put(this.geo.box, solid(0.2 + Math.random() * 0.35), a, 900 + Math.random() * 120, h / 2 - 10, w, h, w, (Math.random() - 0.5) * 0.25);
      }
      for (let i = 0; i < 18; i++) put(this.geo.sphereLo, solid(0.15), i / 18 * TAU, 820, -5, 120, 35 + Math.random() * 30, 160);
    } else {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * TAU;
        put(this.geo.box, solid(0.15), a, 920, 200, 26, 420, 26);
        put(this.geo.box, solid(0.15), a, 920, 400, 70, 8, 8);
        const rk = put(this.geo.cyl, solid(0.05), a + 0.05, 920, 170, 18, 300, 18);
        void rk;
        put(cone, solid(0.05), a + 0.05, 920, 350, 18, 60, 18);
        const lt = put(this.geo.sphereLo, this.basic(0xff3030, { fog: false }), a, 920, 416, 6, 6, 6);
        this.blinkers.push(lt);
      }
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * TAU;
        put(this.geo.box, solid(0.35), a, 950, 110, 10, 220, 10);
        put(this.geo.box, solid(0.35), a, 950, 215, 10, 10, 160);
      }
      for (let i = 0; i < 24; i++) put(this.geo.box, solid(0.4), Math.random() * TAU, 980, 30, 80 + Math.random() * 120, 60 + Math.random() * 40, 60);
    }
    scene.add(grp);
  },

  // 牆面貼圖：底部髒污、樓層接縫、頂部亮邊（以實例顏色上色）
  wallTexture(kind) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 400; i++) { const v = 200 + Math.random() * 55 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * 64, Math.random() * 128, 2, 2); }
    const grd = g.createLinearGradient(0, 80, 0, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(40,30,20,0.45)');
    g.fillStyle = grd; g.fillRect(0, 80, 64, 48);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, 64, 6);
    if (kind === 'metal') {
      g.fillStyle = 'rgba(0,0,0,0.18)'; for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 2, 128);
      for (let x = -16; x < 64; x += 16) { g.fillStyle = '#d9b02a'; g.beginPath(); g.moveTo(x, 128); g.lineTo(x + 8, 128); g.lineTo(x + 16, 116); g.lineTo(x + 8, 116); g.fill(); }
    } else if (kind === 'sandstone') {
      g.fillStyle = 'rgba(80,50,20,0.15)'; for (let y = 10; y < 128; y += 9) g.fillRect(0, y, 64, 1 + Math.random() * 2);
      g.fillStyle = 'rgba(230,200,150,0.5)'; g.fillRect(0, 108, 64, 20);
    } else {
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, 42, 64, 2); g.fillRect(0, 84, 64, 2);
      g.fillStyle = 'rgba(70,95,50,0.35)'; for (let i = 0; i < 12; i++) g.fillRect(Math.random() * 64, 110 + Math.random() * 18, 6, 18);
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  },

  // 掩體依種類做成車輛殘骸、水泥護欄、貨櫃、桌子
  buildCovers(list, TH) {
    const boxes = [], conts = [];
    const pick = (arr, id) => arr[(id * 7) % arr.length];
    for (const w of list) {
      const cx = w.x + w.w / 2, cz = w.y + w.h / 2, top = World.wallTop(w);
      const shade = 0.85 + ((w.id * 53) % 15) / 50;
      if (w.sub === 'car') {
        const col = pick(TH.cars, w.id);
        boxes.push([cx, 12, cz, w.w, 24, w.h, col, shade]);
        const along = w.w > w.h;
        boxes.push([cx + (along ? w.w * 0.08 : 0), 24 + 8, cz + (along ? 0 : w.h * 0.08), along ? w.w * 0.5 : w.w * 0.85, 16, along ? w.h * 0.85 : w.h * 0.5, 0x2a3038, 1]);
        boxes.push([cx, 3, cz, w.w + 2, 6, w.h + 2, 0x1c1c1c, 1]);
      } else if (w.sub === 'block') {
        boxes.push([cx, 13, cz, w.w, 26, w.h, TH.block, shade]);
        boxes.push([cx, 26 + (top - 26) / 2, cz, w.w * 0.55, top - 26, w.h * 0.55, TH.block, shade * 1.08]);
      } else if (w.sub === 'container') {
        conts.push([cx, top / 2, cz, w.w, top, w.h, pick(TH.boxes, w.id), shade]);
      } else if (w.sub === 'desk') {
        boxes.push([cx, top - 2, cz, w.w, 4, w.h, 0x6a5040, 1]);
        boxes.push([cx, (top - 4) / 2, cz, w.w * 0.9, top - 4, w.h * 0.8, 0x4a3a30, 1]);
      } else if (w.sub === 'barrier') {
        boxes.push([cx, top / 2, cz, w.w, top, w.h, 0xa88a2a, shade]);
        boxes.push([cx, top - 4, cz, w.w + 1, 8, w.h + 1, 0x222222, 1]);
      } else boxes.push([cx, top / 2, cz, w.w, top, w.h, 0x7d7465, shade]);
    }
    const make = (arr, mat) => {
      if (!arr.length) return;
      const im = new THREE.InstancedMesh(this.geo.box, mat, arr.length);
      arr.forEach((b, i) => {
        this.m4.compose(this.v.set(b[0], b[1], b[2]), this.q.identity(), this.s3.set(b[3], b[4], b[5]));
        im.setMatrixAt(i, this.m4);
        im.setColorAt(i, this.col.setHex(b[6]).multiplyScalar(b[7]));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      this.scene.add(im);
    };
    make(boxes, this.mat(0xffffff));
    // 貨櫃：直條紋鐵皮
    const c = document.createElement('canvas'); c.width = 64; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 32);
    g.fillStyle = 'rgba(0,0,0,0.22)'; for (let x = 0; x < 64; x += 5) g.fillRect(x, 0, 2, 32);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 30, 64, 2);
    g.fillStyle = 'rgba(90,50,20,0.25)'; for (let i = 0; i < 8; i++) g.fillRect(Math.random() * 64, 20 + Math.random() * 10, 4, 12);
    make(conts, this.mat(0xffffff, { map: new THREE.CanvasTexture(c) }));
  },

  // 地面貼圖的地圖特色
  groundExtras(g, k, mapId, TS) {
    if (mapId === 'dam') {
      for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(${70 + Math.random() * 30 | 0},${100 + Math.random() * 30 | 0},50,0.35)`; g.beginPath(); g.arc(Math.random() * TS, Math.random() * TS, (20 + Math.random() * 60) * k, 0, TAU); g.fill(); }
      for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(80,100,110,0.45)'; g.beginPath(); g.ellipse(Math.random() * TS, Math.random() * TS, (15 + Math.random() * 30) * k, (8 + Math.random() * 14) * k, Math.random() * 3, 0, TAU); g.fill(); }
    } else if (mapId === 'city') {
      g.strokeStyle = 'rgba(255,230,180,0.12)'; g.lineWidth = Math.max(1, 3 * k);
      for (let y = 0; y < World.H; y += 26) {
        g.beginPath();
        for (let x = 0; x <= World.W; x += 80) { const yy = y + Math.sin(x * 0.01 + y) * 8; x ? g.lineTo(x * k, yy * k) : g.moveTo(0, yy * k); }
        g.stroke();
      }
    } else {
      g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = Math.max(1, 2 * k);
      g.beginPath();
      for (let x = 0; x <= World.W; x += 100) { g.moveTo(x * k, 0); g.lineTo(x * k, TS); }
      for (let y = 0; y <= World.H; y += 100) { g.moveTo(0, y * k); g.lineTo(TS, y * k); }
      g.stroke();
      for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(10,10,15,0.3)'; g.beginPath(); g.ellipse(Math.random() * TS, Math.random() * TS, (10 + Math.random() * 30) * k, (6 + Math.random() * 16) * k, Math.random() * 3, 0, TAU); g.fill(); }
    }
  },

  // 純裝飾物（沒有碰撞）：草叢、沙堆、路燈
  buildScatter(mapId, TH) {
    const lv = this.gfxLv();
    const items = [];
    if (mapId === 'dam') {
      const n = [150, 450, 800][lv];
      for (let i = 0; i < n * 3 && items.length < n; i++) {
        const x = Math.random() * World.W, y = Math.random() * World.H;
        if (World.pointBlocked(x, y, 10)) continue;
        if (World.floors.some(f => x > f.x && x < f.x + f.w && y > f.y && y < f.y + f.h)) continue;
        const s = 3 + Math.random() * 4;
        items.push(['g', x, y, s, 7 + Math.random() * 10]);
      }
    } else if (mapId === 'city') {
      for (const w of World.walls) {
        if (w.kind !== 'wall' || Math.random() > 0.35) continue;
        const along = w.w > w.h, side = Math.random() < 0.5 ? -1 : 1;
        const x = along ? w.x + w.w * (0.2 + Math.random() * 0.6) : w.x + w.w / 2 + side * (w.w / 2 + 6);
        const y = along ? w.y + w.h / 2 + side * (w.h / 2 + 6) : w.y + w.h * (0.2 + Math.random() * 0.6);
        items.push(['s', x, y, along ? 40 + Math.random() * 40 : 18, along ? 18 : 40 + Math.random() * 40]);
      }
    } else {
      const C = World.CELL;
      for (let i = 1; i < World.W / C; i++) for (let j = 1; j < World.H / C; j++) {
        if ((i + j) % 2) continue;
        const x = i * C + 44, y = j * C + 44;
        if (World.pointBlocked(x, y, 8)) continue;
        items.push(['l', x, y]);
      }
    }
    const grass = items.filter(t => t[0] === 'g'), sand = items.filter(t => t[0] === 's'), lamps = items.filter(t => t[0] === 'l');
    if (grass.length) {
      const im = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 4), this.mat(0xffffff), grass.length);
      grass.forEach((t, i) => {
        this.q.setFromAxisAngle(this.yAxis, Math.random() * 3);
        this.m4.compose(this.v.set(t[1], t[4] / 2, t[2]), this.q, this.s3.set(t[3], t[4], t[3]));
        im.setMatrixAt(i, this.m4);
        im.setColorAt(i, this.col.setRGB(0.28 + Math.random() * 0.12, 0.4 + Math.random() * 0.15, 0.18));
      });
      this.scene.add(im);
    }
    if (sand.length) {
      const im = new THREE.InstancedMesh(this.geo.sphereLo, this.mat(new THREE.Color(this.theme.wall).lerp(new THREE.Color(0xe8c890), 0.6)), sand.length);
      sand.forEach((t, i) => { this.m4.compose(this.v.set(t[1], 0, t[2]), this.q.identity(), this.s3.set(t[3] / 2, 10 + Math.random() * 10, t[4] / 2)); im.setMatrixAt(i, this.m4); });
      this.scene.add(im);
    }
    if (lamps.length) {
      const pole = new THREE.InstancedMesh(this.geo.cyl, this.mat(0x50555c), lamps.length * 2);
      const head = new THREE.InstancedMesh(this.geo.box, this.basic(0xfff0c0), lamps.length);
      lamps.forEach((t, i) => {
        this.m4.compose(this.v.set(t[1], 75, t[2]), this.q.identity(), this.s3.set(2.5, 150, 2.5)); pole.setMatrixAt(i * 2, this.m4);
        this.m4.compose(this.v.set(t[1] - 14, 150, t[2] - 14), this.q.setFromAxisAngle(this.yAxis, Math.PI / 4), this.s3.set(1.6, 1.6, 40)); pole.setMatrixAt(i * 2 + 1, this.m4);
        this.m4.compose(this.v.set(t[1] - 26, 148, t[2] - 26), this.q.identity(), this.s3.set(10, 3, 10)); head.setMatrixAt(i, this.m4);
      });
      this.scene.add(pole); this.scene.add(head);
    }
  },

  // 漂浮的沙塵／花粉
  buildAmbient(TH, dot) {
    this.ambient = null;
    const n = Math.round((TH.dust.n || 0) * [0.4, 0.8, 1][this.gfxLv()]);
    if (!n) return;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 700; pos[i * 3 + 1] = Math.random() * 140; pos[i * 3 + 2] = (Math.random() - 0.5) * 700; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.ambient = new THREE.Points(geo, new THREE.PointsMaterial({ size: TH.dust.s, map: dot, color: TH.dust.c, transparent: true, opacity: 0.55, depthWrite: false }));
    this.ambient.frustumCulled = false;
    this.ambientPos = pos;
    this.scene.add(this.ambient);
  },

  buildViewmodel() {
    if (this.vm) this.camera.remove(this.vm);
    const vm = new THREE.Group();
    const dark = this.basic(0x26282c, { depthTest: false, fog: false });
    const mid = this.basic(0x44474d, { depthTest: false, fog: false });
    this.vmStripe = this.basic(0xcccccc, { depthTest: false, fog: false });
    this.vmStripe.color.setHex(0x999999);
    const parts = [
      [dark, 0, 0, 0, 3.2, 3.6, 14],
      [mid, 0, 0.6, -9, 1.4, 1.4, 8],
      [dark, 0, -3.2, 3, 2.2, 4.5, 2.4],
      [this.vmStripe, 0, 1.9, -1, 3.3, 0.6, 6],
      [this.basic(0xc8a080, { depthTest: false, fog: false }), -0.8, -3.6, 5.5, 3, 3, 4],
    ];
    for (const [m, x, y, z, sx, sy, sz] of parts) { const p = this.mesh(this.geo.box, m, x, y, z, sx, sy, sz); p.renderOrder = 999; vm.add(p); }
    const flash = this.mesh(this.geo.octa, this.basic(0xffe080, { depthTest: false, transparent: true, blending: THREE.AdditiveBlending, fog: false }), 0, 0.6, -14.5, 2.2, 2.2, 3.5);
    flash.renderOrder = 1000; flash.visible = false;
    vm.add(flash);
    this.vmFlash = flash;
    vm.scale.setScalar(Input.touch ? 0.12 : 0.13);
    vm.position.set(1.4, -1.25, -4.6);
    this.vm = vm;
    this.camera.add(vm);
  },

  // ---------- 模型 ----------
  flashMat(color, emissive) {
    const m = new THREE.MeshLambertMaterial({ color });
    if (emissive) m.emissive = new THREE.Color(emissive);
    return m;
  },

  makeEntity(e) {
    const grp = new THREE.Group();
    const body = new THREE.Group();
    grp.add(body);
    const G = this.geo;
    const flash = [];
    const metal = () => { const m = this.flashMat(0x6b6e75); flash.push(m); return m; };
    const dark = () => { const m = this.flashMat(0x34363b); flash.push(m); return m; };
    const eye = this.basic(0xff3322);
    const core = this.basic(0xffc030);
    const add = (geo, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => { const m = this.mesh(geo, mat, x, y, z, sx, sy, sz); m.rotation.set(rx, ry, rz); body.add(m); return m; };
    const R = e.r;
    if (e.kind === 'raider') {
      const suit = this.flashMat(0x9a8a80); flash.push(suit);
      add(G.cyl, suit, 0, 20, 0, 11, 32, 11);
      add(G.sphere, this.flashMat(0xd8b8a0), 0, 42, 0, 8.5, 8.5, 8.5);
      add(G.box, this.flashMat(0x2a2a30), 4, 43, 0, 6, 4, 12);
      add(G.box, this.flashMat(0x5a4a3a), -10, 26, 0, 8, 20, 16);
      add(G.box, this.flashMat(0x222222), 12, 30, 5, 22, 4, 4);
      grp.userData.suit = suit;
    } else if (e.type === 'wasp' || e.type === 'hornet') {
      const s = e.type === 'hornet' ? 1.25 : 1;
      add(G.sphere, metal(), 0, 0, 0, R * 0.8, R * 0.45, R * 0.55);
      const rotors = [];
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        add(G.box, dark(), Math.cos(a) * R * 0.55, 0, Math.sin(a) * R * 0.55, R * 1.1, 2, 2, 0, -a, 0);
        const r = add(G.disc, this.basic(0xcfcfcf, { transparent: true, opacity: 0.35 }), Math.cos(a) * R * 1.05, 3, Math.sin(a) * R * 1.05, R * 0.55, 1, R * 0.55);
        rotors.push(r);
      }
      add(G.sphere, eye, R * 0.7, 0, 0, 3.5 * s, 3.5 * s, 3.5 * s);
      if (e.type === 'hornet') { add(G.box, dark(), R * 0.6, -4, 6, R * 0.9, 3, 3); add(G.box, dark(), R * 0.6, -4, -6, R * 0.9, 3, 3); }
      grp.userData.rotors = rotors;
    } else if (e.type === 'tick') {
      add(G.sphere, metal(), 0, 9, 0, R, R * 0.75, R);
      for (let i = 0; i < 6; i++) {
        const a = (i < 3 ? -1 : 1) * (0.6 + (i % 3) * 0.7);
        add(G.box, dark(), Math.cos(a) * R, 4, Math.sin(a) * R, R * 1.4, 2, 2, 0, -a, 0.5 * (i < 3 ? 1 : -1));
      }
      grp.userData.eye = add(G.sphere, eye, R * 0.85, 11, 0, 3.5, 3.5, 3.5);
    } else if (e.type === 'pop') {
      add(G.sphere, dark(), 0, R, 0, R, R, R);
      add(G.sphere, core, R * 0.55, R * 1.05, 0, R * 0.5, R * 0.5, R * 0.5);
      add(G.cyl, dark(), R * 0.6, R * 1.6, 0, 4, 12, 4, 0, 0, -0.6);
    } else if (e.type === 'leaper') {
      add(G.sphere, metal(), 0, 34, 0, R, R * 0.6, R * 0.8);
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        add(G.box, dark(), Math.cos(a) * R * 0.9, 30, Math.sin(a) * R * 0.9, R * 1.2, 4, 4, 0, -a, 0.4);
        add(G.box, dark(), Math.cos(a) * R * 1.6, 14, Math.sin(a) * R * 1.6, 4, 30, 4);
      }
      add(G.sphere, eye, R * 0.95, 38, -6, 4, 4, 4);
      add(G.sphere, eye, R * 0.95, 38, 6, 4, 4, 4);
    } else if (e.type === 'sentinel') {
      grp.userData.base = this.mesh(G.box, dark(), 0, 14, 0, R * 1.8, 28, R * 1.8);
      grp.add(grp.userData.base);
      add(G.sphere, metal(), 0, 40, 0, R * 0.8, R * 0.7, R * 0.8);
      add(G.box, dark(), R * 1.1, 40, 0, R * 1.6, 6, 6);
      add(G.sphere, eye, R * 0.75, 44, 0, 5, 5, 5);
    } else if (e.type === 'bastion') {
      add(G.hex, dark(), 0, 30, 0, R, 44, R);
      add(G.hex, metal(), 0, 56, 0, R * 0.8, 14, R * 0.8);
      add(G.box, dark(), R * 1.0, 40, R * 0.5, R * 1.1, 8, 8);
      add(G.box, dark(), R * 1.0, 40, -R * 0.5, R * 1.1, 8, 8);
      add(G.sphere, core, -R * 0.9, 42, 0, 9, 9, 9);
      add(G.sphere, eye, R * 0.8, 58, 0, 6, 6, 6);
      for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; add(G.box, dark(), Math.cos(a) * R * 0.8, 6, Math.sin(a) * R * 0.8, 14, 12, 14); }
    } else if (e.type === 'queen') {
      add(G.sphere, metal(), 0, 90, 0, R * 1.1, R * 0.7, R * 0.85);
      add(G.sphere, dark(), -R * 0.6, 92, 0, R * 0.7, R * 0.5, R * 0.6);
      add(G.sphere, core, R * 0.2, 118, 0, R * 0.28, R * 0.28, R * 0.28);
      for (let i = -2; i <= 2; i++) add(G.sphere, eye, R * 1.05, 96, i * 10, 4.5, 4.5, 4.5);
      for (let i = 0; i < 6; i++) {
        const a = (i < 3 ? -1 : 1) * (0.5 + (i % 3) * 0.75);
        add(G.box, dark(), Math.cos(a) * R * 1.1, 80, Math.sin(a) * R * 1.1, R * 1.4, 8, 8, 0, -a, 0.5 * (i < 3 ? 1 : -1));
        add(G.box, dark(), Math.cos(a) * R * 1.9, 40, Math.sin(a) * R * 1.9, 8, 85, 8);
      }
    }
    grp.userData.flash = flash;
    grp.userData.body = body;
    this.scene.add(grp);
    return grp;
  },

  makeContainer(c) {
    const grp = new THREE.Group();
    grp.position.set(c.x, 0, c.y);
    const G = this.geo;
    const def = CONTAINERS[c.type];
    const add = (geo, color, x, y, z, sx, sy, sz, ry = 0) => { const m = this.mesh(geo, this.mat(color), x, y, z, sx, sy, sz); m.rotation.y = ry; grp.add(m); return m; };
    const rot = (c.id * 1.3) % Math.PI;
    if (c.type === 'trash') {
      add(G.box, 0x5e5848, 0, 7, 0, 26, 14, 22, rot);
      add(G.box, 0x6f6450, 6, 17, -3, 14, 8, 12, rot + 0.5);
      add(G.cyl, 0x4f5a4a, -9, 9, 7, 6, 18, 6);
    } else if (c.type === 'crate') {
      add(G.box, 0x8a7440, 0, 12, 0, 30, 24, 24, rot);
      add(G.box, 0x6a5630, 0, 24.5, 0, 31, 2, 25, rot);
    } else if (c.type === 'weapon') {
      add(G.box, 0x4f6040, 0, 9, 0, 42, 18, 20, rot);
      add(G.box, 0xd0c060, 0, 18.5, 0, 10, 1, 20.5, rot);
    } else if (c.type === 'medical') {
      add(G.box, 0xa83a34, 0, 11, 0, 28, 22, 22, rot);
      add(G.box, 0xffffff, 0, 22.5, 0, 14, 1, 4, rot);
      add(G.box, 0xffffff, 0, 22.5, 0, 4, 1, 14, rot);
    } else if (c.type === 'safe') {
      add(G.box, 0x3a4a5a, 0, 18, 0, 28, 36, 26, rot);
      add(G.cyl, 0xc0c0c0, 0, 20, 0, 4, 1, 4, rot);
    } else if (c.type === 'wreck') {
      const r = (c.big || 14) * 0.8;
      add(G.cyl, 0x3a3030, 0, 4, 0, r, 8, r);
      for (let i = 0; i < 4; i++) { const a = i * 1.7 + c.id; add(G.box, 0x5a4848, Math.cos(a) * r, 5, Math.sin(a) * r, r * 1.4, 3, 3, -a); }
      grp.userData.glow = add(G.sphere, 0xff7a3a, 0, 10, 0, 3.5, 3.5, 3.5);
      grp.userData.glow.material = this.basic(0xff7a3a);
    } else if (c.type === 'body') {
      add(G.box, 0x4a4552, 0, 5, 0, 34, 10, 16, rot);
      add(G.sphere, 0xd8b8a0, Math.cos(-rot) * 20, 6, Math.sin(-rot) * 20, 7, 6, 7);
    } else {
      add(G.box, 0x8a7a50, 0, 5, 0, 18, 10, 14, rot);
    }
    // 未搜刮的物資標記
    const marker = this.mesh(G.octa, this.basic(0xffd84a, { transparent: true, opacity: 0.9 }), 0, 46, 0, 5, 7, 5);
    grp.add(marker);
    grp.userData.marker = marker;
    void def;
    this.scene.add(grp);
    return grp;
  },

  // ---------- 每幀 ----------
  render(raid, dt) {
    if (!this.ready || !this.scene) return;
    const p = raid.p;
    const now = performance.now() / 1000;
    const cam = this.camera;

    // 攝影機
    const moving = p.moving && p.alive;
    this.bob += dt * (moving ? (p.sprint ? 14 : 9) : 0);
    const bobY = moving ? Math.sin(this.bob) * (p.sprint ? 2.2 : 1.2) : 0;
    const sh = raid.cam.shake;
    const dk = p.dodge ? Math.sin((1 - p.dodge.t / p.dodge.max) * Math.PI) : 0;
    cam.position.set(p.x + (Math.random() - 0.5) * sh * 0.3, (p.eye || H.EYE) - dk * 14 + bobY + (Math.random() - 0.5) * sh * 0.3, p.y);
    this.kick = Math.max(0, this.kick - dt * 0.35);
    const vp = (p.pitch || 0) + this.kick;
    const pc = Math.cos(vp), ps = Math.sin(vp);
    this.v.set(cam.position.x + Math.cos(p.ang) * pc * 100, cam.position.y + ps * 100, cam.position.z + Math.sin(p.ang) * pc * 100);
    cam.lookAt(this.v);
    if (dk) cam.rotateZ(-dk * 0.25 * (p.dodge.side || 0.4));
    if (this.skyDome) this.skyDome.position.copy(cam.position);
    if (this.skyline) this.skyline.position.set(cam.position.x, 0, cam.position.z);
    for (const b of this.blinkers) b.visible = Math.floor(now * 1.5 + b.id) % 2 === 0;
    if (this.ambient) {
      const ap = this.ambientPos, cx = cam.position.x, cz = cam.position.z;
      for (let i = 0; i < ap.length; i += 3) {
        ap[i] += (10 + Math.sin(now + i) * 6) * dt; ap[i + 1] += Math.sin(now * 0.7 + i) * 3 * dt;
        // 以攝影機為中心環繞，粒子永遠在身邊
        const rx = ap[i] - cx, rz = ap[i + 2] - cz;
        if (rx > 350) ap[i] -= 700; else if (rx < -350) ap[i] += 700;
        if (rz > 350) ap[i + 2] -= 700; else if (rz < -350) ap[i + 2] += 700;
      }
      this.ambient.geometry.attributes.position.needsUpdate = true;
    }

    // 槍模型
    const w = raid.curW(p);
    this.vm.visible = !!w && p.alive;
    if (w) {
      this.vmStripe.color.set(RARITY[WEAPONS[w.k].r].color).multiplyScalar(0.8);
      this.recoilZ = Math.max(0, this.recoilZ - dt * 30);
      const st = raid.wStats(w, p);
      const rk = p.reloadT > 0 ? Math.sin((1 - p.reloadT / st.rel) * Math.PI) : 0;
      const sw = moving ? Math.sin(this.bob * 0.5) * 0.6 : 0;
      this.vm.position.set(this.vmBaseX + sw * 0.2, -1.25 - rk * 0.9 + bobY * 0.04 - (p.using ? 1.6 : 0), -4.6 + this.recoilZ * 0.22);
      this.vm.rotation.set(-rk * 0.9 + this.recoilZ * 0.03, 0, rk * 0.3);
      this.vmFlashT = (this.vmFlashT || 0) - dt;
      this.vmFlash.visible = this.vmFlashT > 0;
      this.muzzleLight.intensity = this.vmFlashT > 0 ? 2.2 : 0;
      this.vmFlash.rotation.z = Math.random() * 3;
    }

    // 撤離電梯顏色
    World.extracts.forEach((e, i) => {
      const m = this.extractMeshes[i];
      const c = e.state === 'open' ? 0x44ff55 : e.state === 'calling' ? 0xffee44 : e.state === 'cool' ? 0x777777 : 0x44ccff;
      m.glowMat.color.setHex(c); m.beamMat.color.setHex(c);
      m.glowMat.opacity = 0.25 + 0.2 * Math.sin(now * 4);
      m.beamMat.opacity = e.state === 'cool' ? 0.06 : 0.16 + (e.state === 'open' ? 0.08 * Math.sin(now * 6) : 0);
    });

    // 容器
    for (const c of World.containers) {
      let m = this.cMeshes.get(c);
      if (!m) { m = this.makeContainer(c); this.cMeshes.set(c, m); }
      const empty = c.searched && c.items && c.items.length === 0;
      m.userData.marker.visible = !c.searched;
      if (!c.searched) { m.userData.marker.rotation.y = now * 2 + c.id; m.userData.marker.position.y = 46 + Math.sin(now * 3 + c.id) * 3; }
      if (m.userData.glow) m.userData.glow.visible = !empty;
    }

    // 實體
    const alive = new Set();
    const ents = [...raid.arcs, ...raid.raiders];
    for (const e of ents) {
      if (!e.alive) continue;
      alive.add(e);
      let m = this.eMeshes.get(e);
      if (!m) { m = this.makeEntity(e); this.eMeshes.set(e, m); }
      const d = dist2(e.x, e.y, p.x, p.y);
      m.visible = d < (this.gfxConf().far + 150) ** 2;
      if (!m.visible) continue;
      let y = 0;
      if (e.kind === 'arc' && e.def.fly) y = H.FLY + Math.sin(now * 3 + e.id) * 4;
      if (e.z) y += e.z;
      m.position.set(e.x, y, e.y);
      if (e.type === 'sentinel') { m.userData.body.rotation.y = -e.ang; }
      else m.rotation.y = -e.ang;
      const hit = e.hitT > 0;
      for (const fm of m.userData.flash) fm.emissive.setHex(hit ? 0x777777 : 0x000000);
      if (m.userData.rotors) for (const r of m.userData.rotors) r.rotation.y = now * 30;
      if (m.userData.eye) m.userData.eye.material.color.setHex(e.arm > 0 && Math.floor(now * 16) % 2 ? 0xffffff : 0xff3322);
      if (m.userData.suit) m.userData.suit.color.setHex(e.revealed ? (e.hostile ? 0xc8603a : 0xc8b850) : 0x8a8078);
      if (e.kind === 'raider') { m.userData.body.position.y = e.healT > 0 ? -6 : 0; m.userData.body.scale.y = e.crouch ? 0.7 : 1; }
    }
    for (const [e, m] of this.eMeshes) {
      if (!alive.has(e)) { this.scene.remove(m); this.eMeshes.delete(e); }
    }

    // 子彈與光束
    let ti = 0;
    const tr = this.tracers;
    const setTracer = (x0, h0, y0, x1, h1, y1, thick, color) => {
      if (ti >= 600) return;
      const dx = x1 - x0, dy = y1 - y0, dh = h1 - h0;
      const len = Math.hypot(dx, dy, dh) || 1;
      this.v.set(dx / len, dh / len, dy / len);
      this.q.setFromUnitVectors(this.s3.set(1, 0, 0), this.v);
      this.m4.compose(this.v.set((x0 + x1) / 2, (h0 + h1) / 2, (y0 + y1) / 2), this.q, this.s3.set(len, thick, thick));
      tr.setMatrixAt(ti, this.m4);
      tr.setColorAt(ti, this.col.set(color));
      ti++;
    };
    let oi = 0;
    const orb = (x, h, y, r, color) => {
      if (oi >= 120) return;
      this.m4.compose(this.v.set(x, h, y), this.q.identity(), this.s3.set(r, r, r));
      this.orbs.setMatrixAt(oi, this.m4);
      this.orbs.setColorAt(oi, this.col.set(color));
      oi++;
    };
    for (const b of raid.bullets) {
      const l = Math.hypot(b.vx, b.vy) || 1;
      const h = b.h || H.GUN;
      if (b.team === 'arc') orb(b.x, h, b.y, (b.rad || 3) * 1.3, b.col);
      else {
        const L = b.heavy ? 46 : 30;
        const sl = b.aimed ? (b.vh || 0) / l * L : 0;
        setTracer(b.x - b.vx / l * L, h - sl, b.y - b.vy / l * L, b.x, h, b.y, b.heavy ? 1.6 : 1.1, b.col);
      }
    }
    for (const bm of raid.beams) {
      const k = Math.max(0, bm.t / bm.max);
      setTracer(bm.x0, bm.h0 || 40, bm.y0, bm.x1, bm.h1 || 34, bm.y1, bm.w * (0.5 + k), bm.c);
    }
    // 哨兵充能瞄準線
    for (const e of raid.arcs) {
      if (e.type === 'sentinel' && e.charge > 0 && e.target) {
        const len = Math.min(e.def.rng, Math.hypot(e.target.x - e.x, e.target.y - e.y) + 40);
        setTracer(e.x, 44, e.y, e.x + Math.cos(e.ang) * len, 34, e.y + Math.sin(e.ang) * len, 0.5 + e.charge, '#ff2a2a');
      }
    }
    tr.count = ti;
    tr.instanceMatrix.needsUpdate = true;
    if (tr.instanceColor) tr.instanceColor.needsUpdate = true;

    // 拋射物、手雷
    for (const lb of raid.lobs) {
      const k = lb.t / lb.total;
      orb(lb.sx + (lb.tx - lb.sx) * k, 20 + Math.sin(k * Math.PI) * 160, lb.sy + (lb.ty - lb.sy) * k, 8, '#ff7a2a');
    }
    for (const g of raid.grenades) orb(g.x, 6, g.y, 4, Math.floor(now * 8) % 2 ? '#ff3333' : '#33aa44');
    this.orbs.count = oi;
    this.orbs.instanceMatrix.needsUpdate = true;
    if (this.orbs.instanceColor) this.orbs.instanceColor.needsUpdate = true;

    // 預警圈
    let ri = 0;
    const ring = (x, y, r, k, color) => {
      if (ri >= this.rings.length) return;
      const m = this.rings[ri++];
      m.visible = true; m.position.set(x, 1.5, y); m.scale.set(r, r, 1);
      m.material.color.set(color); m.userData.fill.material.color.set(color);
      m.userData.fill.scale.set(k, k, 1);
    };
    for (const lb of raid.lobs) ring(lb.tx, lb.ty, lb.r, lb.t / lb.total, '#ff5522');
    for (const mk of raid.marks) ring(mk.x, mk.y, mk.r, 1 - mk.t / mk.max, '#ff3333');
    for (const g of raid.grenades) ring(g.x, g.y, 130, 1 - g.t / 1.25, '#ff5555');
    for (let i = ri; i < this.rings.length; i++) this.rings[i].visible = false;

    // 粒子
    let pi = 0, si = 0;
    const maxP = Math.min(this.pN, this.gfxConf().maxP);
    for (const f of raid.fx) {
      if (f.h === undefined) { f.h = f.ring ? 20 : f.glow ? 12 + Math.random() * 30 : 24 + Math.random() * 16; f.vh = f.smoke ? 25 : f.glow ? 30 + Math.random() * 90 : Math.random() * 40; }
      f.h += f.vh * dt; f.vh -= (f.smoke ? 0 : 120) * dt; if (f.h < 1) { f.h = 1; f.vh = 0; }
      const a = Math.max(0, f.t / f.max);
      if (f.ring) {
        if (!f.flashed) { f.flashed = true; const fl = this.flashes[this.flashI++ % this.flashes.length]; fl.visible = true; fl.position.set(f.x, 20, f.y); fl.userData.t = 0.3; fl.userData.r = f.s; }
        continue;
      }
      this.col.set(f.c);
      if (f.smoke) {
        if (si >= 200) continue;
        this.sPos[si * 3] = f.x; this.sPos[si * 3 + 1] = f.h; this.sPos[si * 3 + 2] = f.y;
        this.sCol[si * 3] = this.col.r; this.sCol[si * 3 + 1] = this.col.g; this.sCol[si * 3 + 2] = this.col.b;
        si++;
      } else {
        if (pi >= maxP) continue;
        this.pPos[pi * 3] = f.x; this.pPos[pi * 3 + 1] = f.h; this.pPos[pi * 3 + 2] = f.y;
        this.pCol[pi * 3] = this.col.r * a; this.pCol[pi * 3 + 1] = this.col.g * a; this.pCol[pi * 3 + 2] = this.col.b * a;
        pi++;
      }
    }
    this.points.geometry.setDrawRange(0, pi);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.smoke.geometry.setDrawRange(0, si);
    this.smoke.geometry.attributes.position.needsUpdate = true;
    this.smoke.geometry.attributes.color.needsUpdate = true;
    for (const fl of this.flashes) {
      if (!fl.visible) continue;
      fl.userData.t -= dt;
      if (fl.userData.t <= 0) { fl.visible = false; continue; }
      const k = fl.userData.t / 0.3;
      const r = fl.userData.r * (0.6 - k * 0.3);
      fl.scale.set(r, r * 0.7, r);
      fl.material.opacity = k * 0.55;
    }

    // 碎片
    let di = 0;
    for (const d of this.debrisList) {
      d.t -= dt;
      d.vh -= 500 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.h += d.vh * dt;
      if (d.h < d.s / 2) { d.h = d.s / 2; d.vh *= -0.35; d.vx *= 0.6; d.vy *= 0.6; d.spin *= 0.6; }
      d.r += d.spin * dt;
      if (d.t <= 0 || di >= 80) continue;
      this.q.setFromAxisAngle(d.axis, d.r);
      const k = Math.min(1, d.t * 2);
      this.m4.compose(this.v.set(d.x, d.h, d.y), this.q, this.s3.set(d.s * k, d.s * 0.6 * k, d.s * 0.8 * k));
      this.debrisMesh.setMatrixAt(di, this.m4);
      this.debrisMesh.setColorAt(di, this.col.set(d.c));
      di++;
    }
    this.debrisList = this.debrisList.filter(d => d.t > 0);
    this.debrisMesh.count = di;
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    if (this.debrisMesh.instanceColor) this.debrisMesh.instanceColor.needsUpdate = true;

    this.renderer.render(this.scene, cam);
    this.trackFps(dt);
    this.drawOverlay(raid, dt, now);
  },

  // 世界座標轉螢幕座標；在攝影機後方回傳 null
  project(x, h, y) {
    this.v.set(x, h, y).project(this.camera);
    if (this.v.z > 1 || this.v.z < -1) return null;
    return { x: (this.v.x + 1) / 2 * this.W, y: (1 - this.v.y) / 2 * this.H };
  },

  seen(e, p) {
    // 每 0.2 秒更新一次視線快取
    let c = this.losCache.get(e);
    const now = performance.now();
    if (!c || now - c.t > 200) { c = { t: now, v: World.los(p.x, p.y, e.x, e.y) }; this.losCache.set(e, c); }
    return c.v;
  },

  drawOverlay(raid, dt, now) {
    const ctx = this.oc, W = this.W, Hh = this.H, dpr = raid.dpr;
    const p = raid.p;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.ov.width, this.ov.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';

    // 敵人標示（名字、血條、警示）
    for (const e of [...raid.arcs, ...raid.raiders]) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > 750) continue;
      const top = e.kind === 'raider' ? 58 : (e.def.fly ? H.FLY + 18 : (e.type === 'queen' ? 150 : e.type === 'bastion' ? 80 : e.type === 'leaper' ? 56 : e.type === 'sentinel' ? 62 : e.r * 2 + 12)) + (e.z || 0);
      const s = this.project(e.x, top, e.y);
      if (!s || s.x < -50 || s.x > W + 50) continue;
      if (!this.seen(e, p)) continue;
      if (e.state === 'ambush' && !e.revealed) continue;
      const sc = clamp(300 / Math.max(80, d), 0.5, 1.4);
      if (e.kind === 'raider') {
        ctx.font = `bold ${Math.round(12 * sc + 2)}px sans-serif`;
        const col = e.revealed ? (e.hostile ? '#ff7a50' : '#e8e070') : '#dddddd';
        ctx.fillStyle = '#000'; ctx.fillText(e.name, s.x + 1, s.y - 7);
        ctx.fillStyle = col; ctx.fillText(e.name, s.x, s.y - 8);
        if (e.emote && e.emoteT > 0) {
          ctx.font = '13px sans-serif';
          const tw = ctx.measureText(e.emote).width + 14;
          ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(s.x - tw / 2, s.y - 44, tw, 22);
          ctx.fillStyle = '#fff'; ctx.fillText(e.emote, s.x, s.y - 28);
        }
      } else {
        if (e.callT > 0) {
          const k = (now * 2) % 1;
          ctx.strokeStyle = `rgba(255,90,60,${1 - k})`; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(s.x, s.y + 20, 10 + k * 40, 0, TAU); ctx.stroke();
          ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = '#f96'; ctx.fillText('📡 求援中', s.x, s.y - 26);
        }
        if (e.state === 'attack' && e.seenT > 0) { ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#ff4'; ctx.fillText('!', s.x, s.y - 10); }
        else if (e.state === 'investigate') { ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#fc6'; ctx.fillText('?', s.x, s.y - 10); }
      }
      if (e.hp < e.maxHp) {
        const bw = (e.type === 'queen' ? 160 : 44) * sc;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(s.x - bw / 2 - 1, s.y - 1, bw + 2, 6);
        ctx.fillStyle = e.kind === 'raider' ? '#e44' : '#f63'; ctx.fillRect(s.x - bw / 2, s.y, bw * clamp(e.hp / e.maxHp, 0, 1), 4);
        if (e.sh > 0) { ctx.fillStyle = '#6cf'; ctx.fillRect(s.x - bw / 2, s.y - 3, bw * e.sh / e.shMax, 2); }
      }
    }

    // 傷害數字
    for (const t of raid.texts) {
      if (t.h === undefined) t.h = t.hh || 40;
      t.h += 30 * dt;
      const s = this.project(t.x, t.h, t.y);
      if (!s) continue;
      ctx.globalAlpha = Math.min(1, t.t * 2);
      ctx.font = `bold ${t.size + 2}px sans-serif`;
      ctx.fillStyle = '#000'; ctx.fillText(t.txt, s.x + 1, s.y + 1);
      ctx.fillStyle = t.color; ctx.fillText(t.txt, s.x, s.y);
    }
    ctx.globalAlpha = 1;

    // 撤離點標記
    World.extracts.forEach((e, ei) => {
      const col = e.state === 'open' ? '#5f5' : e.state === 'calling' ? '#ff5' : e.state === 'cool' ? '#999' : '#6cf';
      const dm = Math.round(Math.hypot(e.x - p.x, e.y - p.y) / 10);
      const label = e.state === 'idle' ? '撤離電梯' : e.state === 'calling' ? `抵達中 ${Math.ceil(e.t)}s` : e.state === 'open' ? `已開啟 ${Math.ceil(e.t)}s` : `冷卻 ${Math.ceil(e.t)}s`;
      const s = this.project(e.x, 170, e.y);
      if (s && s.x > 20 && s.x < W - 20 && s.y > 20 && s.y < Hh - 20) {
        ctx.fillStyle = col; ctx.font = 'bold 13px sans-serif';
        ctx.beginPath(); ctx.moveTo(s.x, s.y + 8); ctx.lineTo(s.x - 7, s.y - 4); ctx.lineTo(s.x + 7, s.y - 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#000'; ctx.fillText(`${label} ${dm}m`, s.x + 1, s.y - 9);
        ctx.fillStyle = col; ctx.fillText(`${label} ${dm}m`, s.x, s.y - 10);
      } else {
        // 畫面邊緣箭頭
        const rel = angDiff(p.ang, Math.atan2(e.y - p.y, e.x - p.x));
        const side = rel > 0 ? 1 : -1;
        const x = side > 0 ? W - 26 : 26;
        const y = Hh * 0.36 + ei * 46;
        ctx.save(); ctx.translate(x, y); ctx.scale(side, 1);
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -9); ctx.lineTo(-6, 9); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = col;
        ctx.fillText(dm + 'm', x - side * 4, y + 22);
      }
    });

    // 受傷方向
    if (raid.hurtDir && raid.hurtDir.t > 0) {
      raid.hurtDir.t -= dt;
      const a = angDiff(p.ang, raid.hurtDir.a) - Math.PI / 2;
      ctx.strokeStyle = `rgba(255,40,40,${raid.hurtDir.t})`; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(W / 2, Hh / 2, Math.min(W, Hh) * 0.3, a - 0.35, a + 0.35); ctx.stroke();
    }

    // 準心
    if (p.alive) {
      const w = raid.curW(p);
      const st = w ? raid.wStats(w, p) : null;
      const spr = st ? (st.spr + p.bloom) * (p.moving ? 1.35 : 1) * (p.sprint ? 2 : 1) * (p.crouch ? 0.6 : 1) : 4;
      const px = Math.tan(spr * Math.PI / 180) / Math.tan(this.camera.fov * Math.PI / 360) * Hh / 2;
      const gap = 5 + px;
      const cx = W / 2, cy = Hh / 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
      const lines = () => { ctx.beginPath(); ctx.moveTo(cx - gap - 9, cy); ctx.lineTo(cx - gap, cy); ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + 9, cy); ctx.moveTo(cx, cy - gap - 9); ctx.lineTo(cx, cy - gap); ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + 9); ctx.stroke(); };
      lines();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; lines();
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - 1, cy - 1, 2, 2);
      if (p.crouch) { ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = 'rgba(150,210,255,0.9)'; ctx.fillText('蹲下', cx, cy + gap + 26); }
      // 命中提示
      this.hitT -= dt; this.killT -= dt;
      if (this.hitT > 0 || this.killT > 0) {
        const kill = this.killT > 0;
        ctx.strokeStyle = kill ? '#ff4a3a' : this.hitCrit ? '#ffd23c' : '#fff';
        ctx.lineWidth = kill ? 3.5 : 2.5;
        const r1 = 7, r2 = kill ? 16 : 13;
        ctx.beginPath();
        for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { ctx.moveTo(cx + sx * r1, cy + sy * r1); ctx.lineTo(cx + sx * r2, cy + sy * r2); }
        ctx.stroke();
      }
    }
  },

  hit(crit, kill) {
    if (kill) this.killT = 0.35;
    else { this.hitT = 0.15; this.hitCrit = crit; }
  },
  debris(x, y, h, n, big) {
    if (!this.scene) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = 60 + Math.random() * 160;
      this.debrisList.push({
        x, y, h: h + Math.random() * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vh: 120 + Math.random() * 220,
        s: (3 + Math.random() * 5) * (big ? 2 : 1), r: 0, spin: (Math.random() - 0.5) * 20,
        axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        c: Math.random() < 0.25 ? '#ff5a3a' : (Math.random() < 0.5 ? '#5c5f66' : '#34363b'), t: 1.6 + Math.random(),
      });
    }
    if (this.debrisList.length > 120) this.debrisList.splice(0, this.debrisList.length - 120);
  },

  trackFps(dt) {
    if (dt <= 0) return;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0; this.fpsN = 0;
      const el = document.getElementById('fps');
      if (el) el.textContent = Math.round(this.fps) + ' FPS · 畫質' + this.gfxConf().name;
      // 持續卡頓時自動降低畫質
      this.gfxCool -= 0.5;
      if (this.fps < 26 && this.gfxLv() > 0 && this.gfxCool <= 0 && S.settings.gfxAuto !== false) {
        this.slowT += 0.5;
        if (this.slowT >= 4) {
          S.settings.gfx = this.gfxLv() - 1; saveGame();
          this.applyGfx();
          this.slowT = 0; this.gfxCool = 8;
          UI.toast('偵測到卡頓，已自動將畫質調為「' + this.gfxConf().name + '」');
        }
      } else this.slowT = 0;
    }
  },

  fired(heavy) {
    this.kick = Math.min(0.12, this.kick + (heavy ? 0.045 : 0.012));
    this.recoilZ = Math.min(6, this.recoilZ + (heavy ? 4 : 1.8));
    this.vmFlashT = 0.05;
  },
  dispose() {
    if (!this.scene) return;
    this.scene.traverse(o => {
      if (o.geometry && !Object.values(this.geo).includes(o.geometry)) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    this.scene = null;
    this.renderer.renderLists.dispose();
  },
};
