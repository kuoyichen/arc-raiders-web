'use strict';
// 以 WebAudio 合成的簡易音效，不需要任何音檔

const Sfx = {
  ctx: null,
  master: null,
  noiseBuf: null,
  last: {},
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  on() { return this.ctx && S && S.settings.sound; },
  // 同類音效節流，避免爆音
  gate(name, ms) {
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < ms) return false;
    this.last[name] = now;
    return true;
  },
  noise(dur, freq, vol, type = 'lowpass') {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  },
  tone(freq, dur, vol, type = 'square', slide = 0) {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur);
  },
  play(name, vol = 1) {
    if (!this.on()) return;
    vol = Math.max(0, Math.min(1, vol));
    if (vol < 0.03) return;
    switch (name) {
      case 'shot': if (this.gate('shot', 40)) { this.noise(0.12, 2200, 0.5 * vol); this.tone(140, 0.08, 0.2 * vol, 'square', -80); } break;
      case 'heavy': this.noise(0.3, 1200, 0.8 * vol); this.tone(90, 0.25, 0.35 * vol, 'sawtooth', -60); break;
      case 'eshot': if (this.gate('eshot', 60)) { this.tone(900, 0.06, 0.12 * vol, 'square', -500); } break;
      case 'hit': if (this.gate('hit', 50)) this.tone(1600, 0.04, 0.12 * vol, 'triangle'); break;
      case 'crit': if (this.gate('crit', 50)) this.tone(2400, 0.07, 0.18 * vol, 'triangle', 600); break;
      case 'hurt': if (this.gate('hurt', 120)) { this.noise(0.15, 500, 0.4 * vol); this.tone(200, 0.15, 0.2 * vol, 'sawtooth', -100); } break;
      case 'shieldhit': if (this.gate('sh', 90)) this.tone(700, 0.08, 0.15 * vol, 'sine', 300); break;
      case 'boom': this.noise(0.8, 600, 1.0 * vol); this.tone(60, 0.6, 0.5 * vol, 'sine', -30); break;
      case 'reload': this.tone(500, 0.05, 0.12, 'square'); setTimeout(() => this.on() && this.tone(700, 0.05, 0.12, 'square'), 120); break;
      case 'empty': if (this.gate('empty', 200)) this.tone(300, 0.04, 0.1, 'square'); break;
      case 'loot': this.tone(880, 0.06, 0.12, 'sine'); setTimeout(() => this.on() && this.tone(1320, 0.08, 0.12, 'sine'), 60); break;
      case 'search': if (this.gate('search', 300)) this.noise(0.12, 3000, 0.08, 'highpass'); break;
      case 'laser': this.tone(1800, 0.35, 0.25 * vol, 'sawtooth', -1500); break;
      case 'charge': if (this.gate('charge', 300)) this.tone(300, 0.5, 0.08 * vol, 'sine', 1200); break;
      case 'beep': this.tone(1000, 0.08, 0.15 * vol, 'square'); break;
      case 'alarm': this.tone(600, 0.3, 0.2, 'sawtooth', 300); break;
      case 'ui': this.tone(660, 0.04, 0.08, 'triangle'); break;
      case 'buy': this.tone(988, 0.07, 0.12, 'triangle'); setTimeout(() => this.on() && this.tone(1480, 0.1, 0.12, 'triangle'), 70); break;
      case 'extract': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.on() && this.tone(f, 0.25, 0.15, 'triangle'), i * 120)); break;
      case 'death': this.tone(220, 1.2, 0.3, 'sawtooth', -180); break;
      case 'kill': if (this.gate('kill', 80)) { this.tone(1200, 0.06, 0.14, 'square'); setTimeout(() => this.on() && this.tone(1800, 0.08, 0.14, 'square'), 50); } break;
    }
  },
};
