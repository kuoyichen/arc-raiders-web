'use strict';
// 第一人稱 3D 渲染（Three.js）。模擬仍在 2D 平面 (x, y) 上進行，渲染時對應到 (x, 高度, y)。

const H = { WALL: 110, COVER: 58, BORDER: 260, EYE: 44, GUN: 36, FLY: 62 };

const R3 = {
  ready: false,

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
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
    const sky = { dam: 0x9fb2b4, city: 0xc8b088, port: 0x7d8592 }[raid.mapId] || 0x999999;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(sky);
    scene.fog = new THREE.Fog(sky, 260, Input.touch ? 1250 : 1500);
    this.camera.far = Input.touch ? 1300 : 1600;
    this.camera.updateProjectionMatrix();
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x404030, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.65);
    sun.position.set(0.6, 1, 0.35);
    scene.add(sun);
    scene.add(this.camera);

    // 地面貼圖
    const TS = Input.touch ? 1024 : 2048;
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
    const conf = { wall: [H.WALL, 0x6d6c70], cover: [H.COVER, 0x7d7465], border: [H.BORDER, 0x3a3836] };
    for (const kind in kinds) {
      const list = kinds[kind];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(this.geo.box, this.mat(0xffffff), list.length);
      const [hgt, base] = conf[kind];
      list.forEach((w, i) => {
        const hh = kind === 'cover' ? hgt * (0.75 + ((w.id * 37) % 10) / 20) : hgt;
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
      const im = new THREE.InstancedMesh(this.geo.box, this.mat(0x9a9890), list.length);
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
    this.vmBaseX = Input.touch ? 1.1 : 1.4;
    this.hitT = 0; this.hitCrit = false; this.killT = 0;
    this.recoilZ = 0; this.bob = 0;
    this.losCache = new Map();
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
    cam.position.set(p.x + (Math.random() - 0.5) * sh * 0.3, H.EYE + bobY + (Math.random() - 0.5) * sh * 0.3, p.y);
    this.v.set(p.x + Math.cos(p.ang) * 100, H.EYE + bobY * 0.5, p.y + Math.sin(p.ang) * 100);
    cam.lookAt(this.v);

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
      m.visible = d < 1700 * 1700;
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
      if (e.kind === 'raider') m.userData.body.position.y = e.healT > 0 ? -6 : 0;
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
        setTracer(b.x - b.vx / l * L, h, b.y - b.vy / l * L, b.x, h, b.y, b.heavy ? 1.6 : 1.1, b.col);
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
        if (pi >= this.pN) continue;
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

    this.renderer.render(this.scene, cam);
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
      const spr = st ? (st.spr + p.bloom) * (p.moving ? 1.35 : 1) * (p.sprint ? 2 : 1) : 4;
      const px = Math.tan(spr * Math.PI / 180) / Math.tan(this.camera.fov * Math.PI / 360) * Hh / 2;
      const gap = 5 + px;
      const cx = W / 2, cy = Hh / 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
      const lines = () => { ctx.beginPath(); ctx.moveTo(cx - gap - 9, cy); ctx.lineTo(cx - gap, cy); ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + 9, cy); ctx.moveTo(cx, cy - gap - 9); ctx.lineTo(cx, cy - gap); ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + 9); ctx.stroke(); };
      lines();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; lines();
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - 1, cy - 1, 2, 2);
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
  fired(heavy) {
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
