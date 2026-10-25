'use strict';
// 鍵盤、滑鼠與觸控（雙搖桿）輸入

const Input = {
  keys: {},
  pressed: new Set(),   // 本幀按下的動作
  mouse: { x: 0, y: 0, down: false, inside: false },
  touch: false,
  move: { x: 0, y: 0 },
  aim: { x: 0, y: 0, active: false, mag: 0 },
  sticks: {},
  enabled: false,

  init(canvas) {
    this.canvas = canvas;
    const keymap = {
      KeyR: 'reload', KeyE: 'interact', KeyF: 'interact', KeyQ: 'swap', Digit1: 'w1', Digit2: 'w2',
      KeyH: 'heal', KeyC: 'shield', KeyG: 'grenade', Tab: 'bag', KeyI: 'bag', KeyM: 'map', Escape: 'esc',
    };
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT')) return;
      this.keys[e.code] = true;
      const a = keymap[e.code];
      if (a) { this.pressed.add(a); if (this.enabled && (e.code === 'Tab' || e.code === 'Space')) e.preventDefault(); }
      if (this.enabled && e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.mouse.down = false; });

    canvas.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) { this.mouse.down = true; this.pressed.add('fireStart'); } Sfx.init(); Sfx.resume(); });
    window.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    // 觸控搖桿：左半邊移動、右半邊瞄準射擊
    const zone = document.getElementById('touchZone');
    const opts = { passive: false };
    zone.addEventListener('touchstart', e => this.onTouchStart(e), opts);
    zone.addEventListener('touchmove', e => this.onTouchMove(e), opts);
    zone.addEventListener('touchend', e => this.onTouchEnd(e), opts);
    zone.addEventListener('touchcancel', e => this.onTouchEnd(e), opts);
    window.addEventListener('touchstart', () => { if (!this.touch) { this.touch = true; document.body.classList.add('touch'); } Sfx.init(); Sfx.resume(); }, { passive: true });

    // 開火按鈕：按住持續射擊
    const fb = document.getElementById('fireBtn');
    const fireOn = e => { e.preventDefault(); e.stopPropagation(); this.fireHeld = true; fb.classList.add('down'); Sfx.init(); Sfx.resume(); };
    const fireOff = e => { if (e) e.preventDefault(); this.fireHeld = false; fb.classList.remove('down'); };
    fb.addEventListener('touchstart', fireOn, opts);
    fb.addEventListener('touchend', fireOff, opts);
    fb.addEventListener('touchcancel', fireOff, opts);
    fb.addEventListener('mousedown', fireOn);
    fb.addEventListener('mouseup', fireOff);
    fb.addEventListener('mouseleave', () => fireOff());

    // 觸控按鈕
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

  stickEl(side) { return document.getElementById(side === 'L' ? 'stickL' : 'stickR'); },

  onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const side = t.clientX < window.innerWidth * 0.5 ? 'L' : 'R';
      if (this.sticks[side]) continue;
      this.sticks[side] = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
      const el = this.stickEl(side);
      el.style.display = 'block';
      el.style.left = t.clientX + 'px';
      el.style.top = t.clientY + 'px';
      el.firstElementChild.style.transform = 'translate(-50%,-50%)';
    }
  },
  onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      for (const side of ['L', 'R']) {
        const s = this.sticks[side];
        if (!s || s.id !== t.identifier) continue;
        s.x = t.clientX; s.y = t.clientY;
        this.updateStick(side);
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
        this.stickEl(side).style.display = 'none';
        if (side === 'L') { this.move.x = 0; this.move.y = 0; }
        else { this.aim.active = false; this.aim.mag = 0; }
      }
    }
  },
  updateStick(side) {
    const s = this.sticks[side];
    const R = 55;
    let dx = s.x - s.ox, dy = s.y - s.oy;
    const len = Math.hypot(dx, dy);
    if (len > R) {
      // 搖桿跟著手指拖動，避免手指滑出範圍後失靈
      const k = (len - R) / len;
      s.ox += dx * k; s.oy += dy * k;
      dx = s.x - s.ox; dy = s.y - s.oy;
      const el = this.stickEl(side);
      el.style.left = s.ox + 'px'; el.style.top = s.oy + 'px';
    }
    const mag = Math.min(1, Math.hypot(dx, dy) / R);
    this.stickEl(side).firstElementChild.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    if (side === 'L') {
      const dead = 0.12;
      if (mag < dead) { this.move.x = 0; this.move.y = 0; }
      else { const l = Math.hypot(dx, dy); this.move.x = dx / l * mag; this.move.y = dy / l * mag; }
    } else {
      this.aim.mag = mag;
      if (mag > 0.15) { const l = Math.hypot(dx, dy); this.aim.x = dx / l; this.aim.y = dy / l; this.aim.active = true; }
    }
  },

  resetTouch() {
    this.sticks = {};
    this.fireHeld = false;
    const fb = document.getElementById('fireBtn'); if (fb) fb.classList.remove('down');
    this.move.x = this.move.y = 0;
    this.aim.active = false; this.aim.mag = 0;
    ['L', 'R'].forEach(s => { const el = this.stickEl(s); if (el) el.style.display = 'none'; });
  },

  // 鍵盤移動向量
  keyMove() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.KeyW || k.ArrowUp) y -= 1;
    if (k.KeyS || k.ArrowDown) y += 1;
    if (k.KeyA || k.ArrowLeft) x -= 1;
    if (k.KeyD || k.ArrowRight) x += 1;
    const l = Math.hypot(x, y);
    return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  },

  take(a) { if (this.pressed.has(a)) { this.pressed.delete(a); return true; } return false; },
  endFrame() { this.pressed.clear(); },
};
