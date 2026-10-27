'use strict';
// 第一人稱輸入：鍵盤 + 滑鼠鎖定視角；觸控：左搖桿移動、右側滑動轉視角、開火鍵

const Input = {
  keys: {},
  pressed: new Set(),   // 本幀按下的動作
  mouse: { down: false },
  touch: false,
  move: { x: 0, y: 0 }, // x 左右平移、y 前後（-1 前進）
  lookDX: 0, lookDY: 0, // 本幀累積的視角位移（像素）
  sticks: {},
  enabled: false,
  locked: false,
  fireHeld: false,

  init(canvas) {
    this.canvas = canvas;
    const keymap = {
      KeyR: 'reload', KeyE: 'interact', KeyF: 'interact', KeyQ: 'swap', Digit1: 'w1', Digit2: 'w2',
      KeyH: 'heal', KeyC: 'shield', KeyG: 'grenade', Tab: 'bag', KeyI: 'bag', KeyM: 'map', Escape: 'esc', KeyP: 'esc',
    };
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT')) return;
      this.keys[e.code] = true;
      const a = keymap[e.code];
      if (a && !e.repeat) { this.pressed.add(a); }
      if (this.enabled && (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.mouse.down = false; });

    // 滑鼠：點擊畫面鎖定指標，鎖定後移動滑鼠轉視角
    canvas.addEventListener('mousedown', e => {
      Sfx.init(); Sfx.resume();
      if (e.button !== 0 || this.touch) return;
      if (!this.locked) { this.requestLock(); return; }
      this.mouse.down = true;
    });
    window.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.lookDX += e.movementX || 0;
      this.lookDY += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      document.body.classList.toggle('locked', this.locked);
      if (!this.locked) this.mouse.down = false;
      if (was && !this.locked && this.onUnlock) this.onUnlock();
    });

    // 觸控：左半邊虛擬搖桿移動、右半邊滑動轉視角
    const zone = document.getElementById('touchZone');
    const opts = { passive: false };
    zone.addEventListener('touchstart', e => this.onTouchStart(e), opts);
    zone.addEventListener('touchmove', e => this.onTouchMove(e), opts);
    zone.addEventListener('touchend', e => this.onTouchEnd(e), opts);
    zone.addEventListener('touchcancel', e => this.onTouchEnd(e), opts);
    window.addEventListener('touchstart', () => { if (!this.touch) { this.touch = true; document.body.classList.add('touch'); } Sfx.init(); Sfx.resume(); }, { passive: true });

    // 開火按鈕：按住持續射擊；按住時拖曳也能轉視角
    const fb = document.getElementById('fireBtn');
    const fireOn = e => {
      e.preventDefault(); e.stopPropagation();
      this.fireHeld = true; fb.classList.add('down'); Sfx.init(); Sfx.resume();
      if (e.changedTouches) { const t = e.changedTouches[0]; this.fireTouch = { id: t.identifier, x: t.clientX, y: t.clientY }; }
    };
    const fireMove = e => {
      e.preventDefault();
      if (!this.fireTouch) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this.fireTouch.id) continue;
        this.lookDX += (t.clientX - this.fireTouch.x) * 1.2;
        this.lookDY += (t.clientY - this.fireTouch.y) * 1.2;
        this.fireTouch.x = t.clientX; this.fireTouch.y = t.clientY;
      }
    };
    const fireOff = e => { if (e) e.preventDefault(); this.fireHeld = false; this.fireTouch = null; fb.classList.remove('down'); };
    fb.addEventListener('touchstart', fireOn, opts);
    fb.addEventListener('touchmove', fireMove, opts);
    fb.addEventListener('touchend', fireOff, opts);
    fb.addEventListener('touchcancel', fireOff, opts);
    fb.addEventListener('mousedown', fireOn);
    fb.addEventListener('mouseup', fireOff);
    fb.addEventListener('mouseleave', () => fireOff());

    // 其他觸控按鈕
    document.querySelectorAll('[data-act]').forEach(b => {
      const act = b.dataset.act;
      const fire = e => { e.preventDefault(); e.stopPropagation(); this.pressed.add(act); b.classList.add('down'); Sfx.init(); Sfx.resume(); };
      const up = e => { e.preventDefault(); b.classList.remove('down'); };
      b.addEventListener('touchstart', fire, opts);
      b.addEventListener('touchend', up, opts);
      b.addEventListener('mousedown', fire);
      b.addEventListener('mouseup', up);
    });
  },

  requestLock() {
    if (this.touch || !this.enabled) return;
    try {
      const r = this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* 不支援 */ }
  },
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); },

  onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const side = t.clientX < window.innerWidth * 0.45 ? 'L' : 'R';
      if (this.sticks[side]) continue;
      this.sticks[side] = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
      if (side === 'L') {
        const el = document.getElementById('stickL');
        el.style.display = 'block';
        el.style.left = t.clientX + 'px';
        el.style.top = t.clientY + 'px';
        el.firstElementChild.style.transform = 'translate(-50%,-50%)';
      }
    }
  },
  onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const L = this.sticks.L, R = this.sticks.R;
      if (L && L.id === t.identifier) { L.x = t.clientX; L.y = t.clientY; this.updateStick(); }
      if (R && R.id === t.identifier) {
        this.lookDX += t.clientX - R.x;
        this.lookDY += t.clientY - R.y;
        R.x = t.clientX; R.y = t.clientY;
      }
    }
  },
  onTouchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      for (const side of ['L', 'R']) {
        const s = this.sticks[side];
        if (!s || s.id !== t.identifier) continue;
        delete this.sticks[side];
        if (side === 'L') { document.getElementById('stickL').style.display = 'none'; this.move.x = 0; this.move.y = 0; }
      }
    }
  },
  updateStick() {
    const s = this.sticks.L;
    const R = 55;
    let dx = s.x - s.ox, dy = s.y - s.oy;
    const len = Math.hypot(dx, dy);
    const el = document.getElementById('stickL');
    if (len > R) {
      // 搖桿跟著手指拖動，避免手指滑出範圍後失靈
      const k = (len - R) / len;
      s.ox += dx * k; s.oy += dy * k;
      dx = s.x - s.ox; dy = s.y - s.oy;
      el.style.left = s.ox + 'px'; el.style.top = s.oy + 'px';
    }
    const mag = Math.min(1, Math.hypot(dx, dy) / R);
    el.firstElementChild.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    if (mag < 0.12) { this.move.x = 0; this.move.y = 0; }
    else { const l = Math.hypot(dx, dy); this.move.x = dx / l * mag; this.move.y = dy / l * mag; }
  },

  resetTouch() {
    this.sticks = {};
    this.fireHeld = false; this.fireTouch = null;
    const fb = document.getElementById('fireBtn'); if (fb) fb.classList.remove('down');
    this.move.x = this.move.y = 0;
    this.lookDX = this.lookDY = 0;
    const el = document.getElementById('stickL'); if (el) el.style.display = 'none';
  },

  // 鍵盤移動向量（相對於視角：y=-1 前進、x=1 向右平移）
  keyMove() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.KeyW || k.ArrowUp) y -= 1;
    if (k.KeyS || k.ArrowDown) y += 1;
    if (k.KeyA) x -= 1;
    if (k.KeyD) x += 1;
    const l = Math.hypot(x, y);
    return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  },
  // 方向鍵左右可轉視角（沒有滑鼠時）
  keyTurn() { return (this.keys.ArrowRight ? 1 : 0) - (this.keys.ArrowLeft ? 1 : 0); },

  take(a) { if (this.pressed.has(a)) { this.pressed.delete(a); return true; } return false; },
  endFrame() { this.pressed.clear(); this.lookDX = 0; this.lookDY = 0; },
};
