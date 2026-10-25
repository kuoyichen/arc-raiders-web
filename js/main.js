'use strict';
// 啟動與主迴圈

(function () {
  loadGame();
  const canvas = document.getElementById('game');
  Input.init(canvas);
  Raid.init(canvas);
  UI.init();

  // 背景：標題與基地畫面時畫一點飄動的灰塵
  const ctx = canvas.getContext('2d');
  const dust = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 2 + 0.5, v: Math.random() * 0.02 + 0.005 }));
  function idle(dt) {
    const w = canvas.width, h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#14110e'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(242,165,49,0.25)';
    for (const d of dust) {
      d.y -= d.v * dt; d.x += Math.sin(d.y * 10) * 0.0005;
      if (d.y < 0) { d.y = 1; d.x = Math.random(); }
      ctx.beginPath(); ctx.arc(d.x * w, d.y * h, d.s * Raid.dpr, 0, Math.PI * 2); ctx.fill();
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (Raid.active) Raid.frame(now);
    else { idle(dt); Input.endFrame(); }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // 切到背景時自動暫停
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && Raid.active && !Raid.paused) UI.pause(true);
  });
  window.addEventListener('beforeunload', () => saveGame());
})();
