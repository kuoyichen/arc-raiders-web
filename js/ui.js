'use strict';
// 介面：斯佩蘭薩基地、遠征面板、結算

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TYPE_LABEL = { mat: '材料', val: '貴重品', con: '消耗品', weapon: '武器', shield: '護盾' };

function itemTile(e, extra = '') {
  const d = ITEMS[e.k];
  const col = RARITY[d.r].color;
  const q = d.st > 1 && (e.n || 1) > 1 ? `<span class="iq">×${e.n}</span>` : '';
  const lv = d.type === 'weapon' ? ` ${'I'.repeat(e.lvl || 1)}` : '';
  return `<div class="it" style="border-left-color:${col}" ${extra}>${q}<div class="ii">${d.icon}</div><div class="in" style="color:${col}">${esc(d.name)}${lv}</div><div class="iv">◎${d.val * (e.n || 1)}</div></div>`;
}

function costHTML(cost) {
  let h = '';
  if (cost.coins) h += `<span class="${S.coins >= cost.coins ? 'have' : 'lack'}">◎ ${cost.coins}</span>`;
  for (const k in (cost.items || {})) {
    const have = stashCount(k), need = cost.items[k];
    h += `<span class="${have >= need ? 'have' : 'lack'}">${ITEMS[k].icon} ${ITEMS[k].name} ${have}/${need}</span>`;
  }
  return `<div class="cost">${h}</div>`;
}

function weaponDesc(k, lvl = 1) {
  const d = WEAPONS[k];
  const lv = lvl - 1;
  const rel = (d.rel * (1 - 0.12 * lv)).toFixed(1), spr = (d.spr * (1 - 0.15 * lv)).toFixed(1);
  return `${d.cls} · 傷害 ${d.dmg}${d.pel > 1 ? '×' + d.pel : ''} · 彈匣 ${d.mag} · 射速 ${Math.round(60 / d.int)}/分 · 換彈 ${rel}s · 散布 ${spr}°${d.burst ? ' · 三連發' : ''}`;
}

const UI = {
  tab: 'loadout',
  mapSel: 'dam',
  mode: null,       // 遠征面板：'loot' | 'bag'
  lootC: null,
  mapOpen: false,

  init() {
    $('btnStart').addEventListener('click', () => {
      Sfx.init(); Sfx.resume(); Sfx.play('ui');
      $('title').classList.add('hidden');
      this.showBase();
      if (S.tutorial) this.showHelp(true);
      // 手機嘗試全螢幕
      if (Input.touch && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    });
    $('modal').addEventListener('click', e => { if (e.target.id === 'modal' && this.modalDismiss) this.closeModal(); });
    document.addEventListener('click', e => {
      const sh = document.querySelector('.sheet');
      if (sh && !sh.contains(e.target)) sh.remove();
    }, true);
  },

  toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('show'), 1600);
  },

  modal(html, dismiss = true) {
    $('modalBox').innerHTML = html;
    $('modal').classList.remove('hidden');
    this.modalDismiss = dismiss;
  },
  closeModal() { $('modal').classList.add('hidden'); this.mapOpen = false; },

  // ================= 基地 =================
  showBase() {
    document.body.classList.remove('inraid');
    $('base').classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('touchZone').classList.add('hidden');
    $('touchBtns').classList.add('hidden');
    $('panel').classList.add('hidden');
    this.renderBase();
  },

  renderBase() {
    const need = xpForLevel(S.level);
    $('baseHead').innerHTML = `
      <div class="brand">ARC <span>RAIDERS</span><small>斯佩蘭薩</small></div>
      <div class="stats">
        <div class="lvl">Lv.${S.level}<div class="xpbar"><i style="width:${S.xp / need * 100}%"></i></div></div>
        ${S.sp ? `<span style="color:var(--accent2)">技能點 ${S.sp}</span>` : ''}
        <span class="coin">◎ ${S.coins.toLocaleString()}</span>
      </div>`;
    const qReady = questActive().some(q => questProgress(q) >= q.n);
    const tabs = [['loadout', '🎒 整備'], ['stash', '📦 倉庫'], ['shop', '🛒 商人'], ['workshop', '🛠️ 工坊'], ['quests', '📜 任務' + (qReady ? '<i class="dot"></i>' : '')], ['skills', '⭐ 技能' + (S.sp ? '<i class="dot"></i>' : '')], ['settings', '⚙️ 設定']];
    $('tabs').innerHTML = tabs.map(([k, l]) => `<button class="${this.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
    $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { Sfx.play('ui'); this.tab = b.dataset.tab; this.renderBase(); $('baseBody').scrollTop = 0; });
    const body = $('baseBody');
    body.innerHTML = `<div class="wrap">${this['tab_' + this.tab]()}</div>`;
    this.bindBase(body);
  },

  bindBase(root) {
    root.querySelectorAll('[data-a]').forEach(el => {
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        const a = el.dataset.a, v = el.dataset.v;
        Sfx.play('ui');
        this.act(a, v, el);
      });
    });
  },

  // ---------- 整備 ----------
  tab_loadout() {
    const L = S.loadout;
    const wslot = (i) => {
      const w = L.w[i];
      if (!w) return `<div class="slot" data-a="pickW" data-v="${i}"><div class="sl">武器 ${i + 1}</div><div class="si">＋</div><div class="ss">點擊選擇</div></div>`;
      const d = WEAPONS[w.k];
      return `<div class="slot filled" style="border-color:${RARITY[d.r].color}" data-a="pickW" data-v="${i}"><div class="sl">武器 ${i + 1}</div><div class="si">🔫</div><div class="sn" style="color:${RARITY[d.r].color}">${d.name} ${'I'.repeat(w.lvl || 1)}</div><div class="ss">${d.cls}</div></div>`;
    };
    const sh = L.shield ? SHIELDS[L.shield.k] : null;
    const shSlot = sh ? `<div class="slot filled" style="border-color:${RARITY[sh.r].color}" data-a="pickS"><div class="sl">護盾</div><div class="si">🛡️</div><div class="sn" style="color:${RARITY[sh.r].color}">${sh.name}</div><div class="ss">容量 ${sh.cap} · 減傷 ${Math.round(sh.mit * 100)}%</div></div>`
      : `<div class="slot" data-a="pickS"><div class="sl">護盾</div><div class="si">＋</div><div class="ss">點擊選擇</div></div>`;
    const bag = L.bag.map((e, i) => itemTile(e, `data-a="bagOut" data-v="${i}"`)).join('');
    const bagEmpty = Array.from({ length: Math.max(0, bagCap() - L.bag.length) }, () => `<div class="it empty" data-a="bagIn"><div class="ii">＋</div></div>`).join('');
    const pocket = L.pocket.map((e, i) => itemTile(e, `data-a="pocketOut" data-v="${i}"`)).join('');
    const pocketEmpty = Array.from({ length: Math.max(0, pocketCap() - L.pocket.length) }, () => `<div class="it empty" data-a="pocketIn"><div class="ii">🔒</div></div>`).join('');
    const maps = Object.entries(MAPS).map(([k, m]) => {
      const lock = S.level < m.unlock;
      return `<div class="map ${this.mapSel === k ? 'on' : ''} ${lock ? 'lock' : ''}" data-a="${lock ? 'noop' : 'map'}" data-v="${k}">
        <b>${m.name}</b> <span class="danger">${'☠'.repeat(Math.round(m.danger * 2 - 1))}</span>
        <div class="muted">${lock ? `🔒 需要等級 ${m.unlock}` : m.desc}</div></div>`;
    }).join('');
    const broke = loadoutEmpty();
    const overStash = S.stash.length > stashCap();
    return `
      ${broke ? `<div class="card" style="border-color:var(--accent);margin-bottom:12px"><div class="row"><div class="sp"><b>沒有武器？</b><div class="muted">斯佩蘭薩提供免費的基礎裝備，讓破產的掠手也能重回地表。</div></div><button class="btn primary" data-a="freeKit">領取免費裝備</button></div></div>` : ''}
      <h2>配裝</h2>
      <div class="slots">${wslot(0)}${wslot(1)}${shSlot}</div>
      <div class="grid2" style="margin-top:6px">
        <div><h2>背包 <small class="muted">${L.bag.length}/${bagCap()}</small></h2><div class="items">${bag}${bagEmpty}</div><div class="muted" style="margin-top:6px">點擊物品放回倉庫。撤離成功時消耗品會留在背包。</div></div>
        <div><h2>安全口袋 <small class="muted">${L.pocket.length}/${pocketCap()}</small></h2><div class="items">${pocket}${pocketEmpty}</div><div class="muted" style="margin-top:6px">死亡時安全口袋內的物品不會掉落。遠征中也能把搜到的寶物移進來。</div></div>
      </div>
      <h2>選擇地圖</h2>
      <div class="maps">${maps}</div>
      <div class="deploy">
        ${overStash ? `<span class="res-bad" style="font-size:13px">倉庫超過上限（${S.stash.length}/${stashCap()}），請先出售物品</span>` : ''}
        <span class="muted">${!L.w[0] && !L.w[1] ? '⚠ 尚未裝備武器' : ''}</span>
        <button class="btn primary big" data-a="deploy" ${overStash ? 'disabled' : ''}>🚀 搭乘空降艙出發</button>
      </div>`;
  },

  // ---------- 倉庫 ----------
  sortedStash() {
    const order = { weapon: 0, shield: 1, con: 2, val: 3, mat: 4 };
    return S.stash.map((e, i) => ({ e, i })).sort((a, b) => {
      const da = ITEMS[a.e.k], db = ITEMS[b.e.k];
      return order[da.type] - order[db.type] || db.r - da.r || da.name.localeCompare(db.name);
    });
  },
  tab_stash() {
    const total = S.stash.reduce((a, e) => a + ITEMS[e.k].val * (e.n || 1), 0);
    const tiles = this.sortedStash().map(({ e, i }) => itemTile(e, `data-a="stashItem" data-v="${i}"`)).join('');
    return `
      <div class="row"><h2 class="sp" style="margin:0">倉庫 <small class="muted">${S.stash.length}/${stashCap()} 格 · 總價值 ◎${total.toLocaleString()}</small></h2>
      <button class="btn sm" data-a="sellVal">出售所有貴重品</button></div>
      <div class="muted" style="margin:8px 0 12px">點擊物品可出售、放入背包或裝備。材料用於工坊升級與任務。</div>
      <div class="items">${tiles || '<div class="muted">倉庫空空如也。到地表撿點東西回來吧！</div>'}</div>`;
  },

  // ---------- 商人 ----------
  shopList() {
    const wb = S.fac.workbench;
    const list = ['bandage', 'shield_cell', 'grenade'];
    if (S.fac.medbay >= 2) list.push('medkit');
    list.push('shield_light', 'shield_med');
    if (wb >= 2) list.push('shield_heavy');
    for (const k in WEAPONS) {
      const r = WEAPONS[k].r;
      if (r <= Math.min(3, wb) && r < 4) list.push(k);
    }
    return list;
  },
  tab_shop() {
    const rows = this.shopList().map(k => {
      const d = ITEMS[k];
      const desc = d.type === 'weapon' ? weaponDesc(k) : d.type === 'shield' ? `容量 ${SHIELDS[k].cap} · 減傷 ${Math.round(SHIELDS[k].mit * 100)}%${SHIELDS[k].slow < 1 ? ' · 移動稍慢' : ''}` : d.use ? (d.use.heal ? `回復 ${d.use.heal} 生命` : `回復 ${d.use.shield} 護盾`) : '投擲後爆炸，造成範圍傷害';
      return `<div class="li"><div class="ic">${d.icon}</div><div class="tx"><b style="color:${RARITY[d.r].color}">${d.name}</b> <small class="muted">${RARITY[d.r].name}${d.type === 'weapon' ? ' · ' + WEAPONS[k].cls : ''}</small><div>${desc}</div></div>
        <button class="btn ${S.coins >= d.price ? 'primary' : ''} sm" data-a="buy" data-v="${k}" ${S.coins >= d.price ? '' : 'disabled'}>◎ ${d.price}</button></div>`;
    }).join('');
    return `<h2>商人 · 塔維的攤位</h2><div class="muted" style="margin-bottom:10px">升級槍械工作台可解鎖更高稀有度的武器；升級醫療站可購買急救包。購買的物品會放入倉庫。</div><div class="list">${rows}</div>`;
  },

  // ---------- 工坊 ----------
  wUpCost(w) {
    const r = WEAPONS[w.k].r, l = w.lvl || 1;
    const items = { metal: 6 * l, wires: 2 * l };
    if (l >= 2) items.arc_alloy = l;
    if (l >= 3) items.arc_circuit = 1;
    return { coins: 150 * l * (r + 1), items };
  },
  tab_workshop() {
    const fac = Object.entries(FACILITIES).map(([k, f]) => {
      const lv = S.fac[k];
      const max = lv >= f.max;
      const cost = max ? null : f.costs[lv - (f.start === 0 ? 0 : 1)];
      const pips = Array.from({ length: f.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      return `<div class="li"><div class="ic">${f.icon}</div><div class="tx"><b>${f.name}</b><span class="pips">${pips}</span> <small class="muted">Lv.${lv}</small><div>${f.desc}</div>${cost ? costHTML(cost) : '<div class="cost"><span class="have">已達最高等級</span></div>'}</div>
        ${cost ? `<button class="btn ${canAfford(cost) ? 'primary' : ''} sm" data-a="upFac" data-v="${k}" ${canAfford(cost) ? '' : 'disabled'}>升級</button>` : ''}</div>`;
    }).join('');
    const maxW = Math.min(4, S.fac.workbench + 1);
    const ws = [];
    S.loadout.w.forEach((w, i) => { if (w) ws.push({ w, where: 'loadout', i }); });
    S.stash.forEach((e, i) => { if (ITEMS[e.k].type === 'weapon') ws.push({ w: e, where: 'stash', i }); });
    const wrows = ws.map(({ w, where, i }) => {
      const d = WEAPONS[w.k], l = w.lvl || 1;
      const cost = l < maxW ? this.wUpCost(w) : null;
      return `<div class="li"><div class="ic">🔫</div><div class="tx"><b style="color:${RARITY[d.r].color}">${d.name} ${'I'.repeat(l)}</b> <small class="muted">${where === 'loadout' ? '已裝備' : '倉庫'}</small><div>${weaponDesc(w.k, l)}</div>${cost ? costHTML(cost) : `<div class="cost"><span class="muted">${l >= 4 ? '已達最高等級 IV' : '需要升級槍械工作台'}</span></div>`}</div>
        ${cost ? `<button class="btn ${canAfford(cost) ? 'primary' : ''} sm" data-a="upW" data-v="${where}:${i}" ${canAfford(cost) ? '' : 'disabled'}>升級</button>` : ''}</div>`;
    }).join('');
    return `<h2>設施</h2><div class="list">${fac}</div>
      <h2>武器升級</h2><div class="muted" style="margin-bottom:10px">升級主要提升<b>換彈速度</b>與<b>穩定度</b>（降低散布），不會提高傷害——技術好、打得準，低階槍也能擊倒強敵。爆頭（命中中心）造成 2.5 倍傷害。</div>
      <div class="list">${wrows || '<div class="muted">沒有可升級的武器。</div>'}</div>`;
  },

  // ---------- 任務 ----------
  tab_quests() {
    const act = questActive();
    const rows = act.map(q => {
      const p = questProgress(q), done = p >= q.n;
      const rew = [`◎${q.rew.coins}`, `${q.rew.xp} XP`, ...q.rew.items.map(([k, n]) => `${ITEMS[k].icon}${ITEMS[k].name}${n > 1 ? '×' + n : ''}`)].join('　');
      return `<div class="li"><div class="ic">📜</div><div class="tx"><b>${q.name}</b> <small class="muted">委託人：${q.from}</small><div>${q.desc}</div><div class="prog"><i style="width:${p / q.n * 100}%"></i></div><div class="cost"><span>${p}/${q.n}</span><span class="have">獎勵：${rew}</span></div></div>
        <button class="btn ${done ? 'primary' : ''} sm" data-a="quest" data-v="${q.id}" ${done ? '' : 'disabled'}>${q.type === 'deliver' ? '交付' : '領取'}</button></div>`;
    }).join('');
    return `<h2>任務 <small class="muted">已完成 ${S.quests.done.length}/${QUESTS.length}</small></h2>
      <div class="list">${rows || '<div class="card">所有任務都完成了！你是斯佩蘭薩的傳奇掠手。</div>'}</div>
      <h2>戰績</h2><div class="card"><div class="kv">
      <span>遠征次數</span><span>${S.stats.raids}</span><span>成功撤離</span><span>${S.stats.extracts}</span>
      <span>陣亡</span><span>${S.stats.deaths}</span><span>擊毀 ARC</span><span>${S.stats.kills}</span>
      <span>擊倒掠手</span><span>${S.stats.raiderKills}</span><span>單次最高帶出價值</span><span>◎${S.stats.best.toLocaleString()}</span></div></div>`;
  },

  // ---------- 技能 ----------
  tab_skills() {
    const cols = {};
    for (const [k, s] of Object.entries(SKILLS)) (cols[s.col] = cols[s.col] || []).push([k, s]);
    const html = Object.entries(cols).map(([c, list]) => `<h2>${c}</h2><div class="list">` + list.map(([k, s]) => {
      const lv = skillLv(k);
      const pips = Array.from({ length: s.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('');
      const can = S.sp > 0 && lv < s.max;
      return `<div class="li"><div class="ic">${s.icon}</div><div class="tx"><b>${s.name}</b><span class="pips">${pips}</span><div>${s.desc}（每級）</div></div><button class="btn ${can ? 'primary' : ''} sm" data-a="skill" data-v="${k}" ${can ? '' : 'disabled'}>${lv >= s.max ? '已滿' : '+1'}</button></div>`;
    }).join('') + '</div>').join('');
    return `<div class="card"><b>技能點：${S.sp}</b><div class="muted">每次升級獲得 1 點。擊毀 ARC、搜刮與成功撤離都能獲得經驗值（陣亡只保留一半）。</div></div>${html}`;
  },

  // ---------- 設定 ----------
  tab_settings() {
    return `<h2>設定</h2><div class="list">
      <div class="li"><div class="ic">🔊</div><div class="tx"><b>音效</b></div><button class="btn sm" data-a="sound">${S.settings.sound ? '開啟' : '關閉'}</button></div>
      <div class="li"><div class="ic">❓</div><div class="tx"><b>操作說明</b></div><button class="btn sm" data-a="help">查看</button></div>
      <div class="li"><div class="ic">🗑️</div><div class="tx"><b>重置存檔</b><div>清除所有進度，從頭開始</div></div><button class="btn danger sm" data-a="reset">重置</button></div>
      </div><p class="muted" style="margin-top:20px">本作為受《ARC Raiders》玩法啟發的粉絲自製網頁遊戲，與 Embark Studios 無關。</p>`;
  },

  showHelp(first, back) {
    this.modal(`<h3>🎮 怎麼玩</h3><div class="help">
      <p><b>遊戲循環：</b>在斯佩蘭薩整備 → 空降地表 → 搜刮箱子與 ARC 殘骸 → 找到<b>撤離電梯</b>呼叫並守住 25 秒 → 進入電梯撤離。限時 7 分鐘。</p>
      <p><b>死亡懲罰：</b>身上所有裝備與物品都會掉落，只有<b>安全口袋</b>內的東西能保留。破產時可以領取免費基礎裝備。</p>
      <p><b>掠手：</b>地表上的其他掠手（電腦控制）可能友善、也可能隨時背刺你。名字顏色：灰＝未知、黃＝友善、紅＝敵對。</p>
      <p><b>電腦：</b><kbd>WASD</kbd> 移動 <kbd>滑鼠</kbd> 瞄準射擊 <kbd>Shift</kbd> 衝刺 <kbd>E</kbd> 互動/搜刮 <kbd>R</kbd> 換彈 <kbd>Q</kbd>/<kbd>1</kbd><kbd>2</kbd> 換槍 <kbd>H</kbd> 治療 <kbd>C</kbd> 護盾充能 <kbd>G</kbd> 手雷 <kbd>Tab</kbd> 背包 <kbd>M</kbd> 地圖 <kbd>Esc</kbd> 暫停</p>
      <p><b>手機：</b>左半邊拖曳移動（推到底自動衝刺），右半邊拖曳瞄準，推遠一點就會開火（有瞄準輔助）。右下按鈕互動、換彈、換槍、治療、護盾、手雷。</p>
      <p><b>技巧：</b>射擊目標中心可爆頭（2.5 倍）；堡壘背後的黃色核心是弱點；槍聲和電梯會吸引 ARC。</p></div>
      <div class="acts"><button class="btn primary" id="helpOk">${first ? '開始吧！' : '了解'}</button></div>`, !back);
    $('helpOk').onclick = () => back ? back() : this.closeModal();
    if (first) { S.tutorial = false; saveGame(); }
  },

  // ---------- 基地動作 ----------
  act(a, v, el) {
    const L = S.loadout;
    switch (a) {
      case 'noop': this.toast('尚未解鎖'); return;
      case 'map': this.mapSel = v; break;
      case 'freeKit':
        L.w[0] = { k: 'kettle', lvl: 1 };
        if (!L.shield) L.shield = { k: 'shield_light' };
        bagAdd(L.bag, bagCap(), { k: 'bandage', n: 3 });
        this.toast('已領取免費基礎裝備');
        break;
      case 'pickW': return this.pickModal('weapon', +v);
      case 'pickS': return this.pickModal('shield');
      case 'bagIn': return this.pickModal('bag');
      case 'pocketIn': return this.pickModal('pocket');
      case 'bagOut': stashAdd(L.bag.splice(+v, 1)[0]); break;
      case 'pocketOut': stashAdd(L.pocket.splice(+v, 1)[0]); break;
      case 'deploy': return this.deploy();
      case 'stashItem': return this.stashModal(+v);
      case 'sellVal': {
        let sum = 0;
        for (let i = S.stash.length - 1; i >= 0; i--) { const e = S.stash[i]; if (ITEMS[e.k].type === 'val') { sum += ITEMS[e.k].val * (e.n || 1); S.stash.splice(i, 1); } }
        S.coins += sum; if (sum) Sfx.play('buy');
        this.toast(sum ? `出售獲得 ◎${sum}` : '沒有貴重品可出售');
        break;
      }
      case 'buy': {
        const d = ITEMS[v];
        if (S.coins < d.price) return;
        S.coins -= d.price;
        stashAdd({ k: v, n: 1, lvl: 1 });
        Sfx.play('buy'); this.toast(`購買了 ${d.name}`);
        break;
      }
      case 'upFac': {
        const f = FACILITIES[v], lv = S.fac[v];
        const cost = f.costs[lv - (f.start === 0 ? 0 : 1)];
        if (!cost || !canAfford(cost)) return;
        payCost(cost); S.fac[v]++;
        Sfx.play('buy'); this.toast(`${f.name} 升級到 Lv.${S.fac[v]}`);
        break;
      }
      case 'upW': {
        const [where, i] = v.split(':');
        const w = where === 'loadout' ? L.w[+i] : S.stash[+i];
        const cost = this.wUpCost(w);
        if (!canAfford(cost)) return;
        payCost(cost);
        // payCost 可能移除倉庫中的項目，重新尋找武器參照
        w.lvl = (w.lvl || 1) + 1;
        Sfx.play('buy'); this.toast(`${WEAPONS[w.k].name} 升級到 ${'I'.repeat(w.lvl)}`);
        break;
      }
      case 'quest': {
        const q = QUESTS.find(q => q.id === v);
        if (questProgress(q) < q.n) return;
        if (q.type === 'deliver') stashRemove(q.item, q.n);
        S.quests.done.push(q.id);
        S.coins += q.rew.coins;
        const ups = addXP(q.rew.xp);
        for (const [k, n] of q.rew.items) stashAdd({ k, n, lvl: 1 });
        Sfx.play('extract');
        this.modal(`<h3>✅ 任務完成：${q.name}</h3><div class="kv"><span>硬幣</span><span class="coin">◎ ${q.rew.coins}</span><span>經驗值</span><span>${q.rew.xp}</span>${q.rew.items.map(([k, n]) => `<span>${ITEMS[k].icon} ${ITEMS[k].name}</span><span>×${n}</span>`).join('')}</div>${ups ? `<p class="res-ok">升級了！獲得 ${ups} 技能點</p>` : ''}<div class="acts"><button class="btn primary" onclick="UI.closeModal()">好</button></div>`);
        break;
      }
      case 'skill':
        if (S.sp > 0 && skillLv(v) < SKILLS[v].max) { S.sp--; S.skills[v] = skillLv(v) + 1; Sfx.play('buy'); }
        break;
      case 'sound': S.settings.sound = !S.settings.sound; break;
      case 'help': return this.showHelp(false);
      case 'reset':
        this.modal(`<h3>確定要重置存檔？</h3><p class="muted">所有裝備、倉庫、等級與任務進度都會消失。</p><div class="acts"><button class="btn" onclick="UI.closeModal()">取消</button><button class="btn danger" onclick="resetGame();UI.closeModal();UI.tab='loadout';UI.renderBase();UI.toast('存檔已重置')">重置</button></div>`);
        return;
    }
    saveGame();
    this.renderBase();
  },

  pickModal(kind, slot) {
    const L = S.loadout;
    let filter, title;
    if (kind === 'weapon') { filter = e => ITEMS[e.k].type === 'weapon'; title = `選擇武器 ${slot + 1}`; }
    else if (kind === 'shield') { filter = e => ITEMS[e.k].type === 'shield'; title = '選擇護盾'; }
    else { filter = () => true; title = kind === 'bag' ? '放入背包' : '放入安全口袋'; }
    const list = this.sortedStash().filter(({ e }) => filter(e));
    const cur = kind === 'weapon' ? L.w[slot] : kind === 'shield' ? L.shield : null;
    const tiles = list.map(({ e, i }) => itemTile(e, `data-pick="${i}"`)).join('');
    this.modal(`<h3>${title}</h3>${kind === 'bag' || kind === 'pocket' ? '<div class="muted" style="margin-bottom:8px">可堆疊的物品會一次放入整組（背包每格有堆疊上限）。</div>' : ''}
      <div class="items">${tiles || '<div class="muted">倉庫裡沒有可用的物品。可以到商人那裡購買。</div>'}</div>
      <div class="acts">${cur ? '<button class="btn danger" data-unequip="1">卸下</button>' : ''}<button class="btn" onclick="UI.closeModal()">關閉</button></div>`);
    const box = $('modalBox');
    box.querySelectorAll('[data-pick]').forEach(el => el.onclick = () => {
      const i = +el.dataset.pick;
      const e = S.stash[i];
      if (kind === 'weapon') {
        S.stash.splice(i, 1);
        if (L.w[slot]) stashAdd(L.w[slot]);
        L.w[slot] = { k: e.k, lvl: e.lvl || 1 };
      } else if (kind === 'shield') {
        S.stash.splice(i, 1);
        if (L.shield) stashAdd(L.shield);
        L.shield = { k: e.k };
      } else {
        const target = kind === 'bag' ? L.bag : L.pocket;
        const cap = kind === 'bag' ? bagCap() : pocketCap();
        const d = ITEMS[e.k];
        if (kind === 'pocket') {
          if (target.length >= cap) { this.toast('安全口袋已滿'); return; }
          const n = d.st > 1 ? Math.min(e.n, d.st) : 1;
          target.push(d.type === 'weapon' ? { k: e.k, n: 1, lvl: e.lvl } : { k: e.k, n });
          stashRemove(e.k, n);
          if (d.st === 1) { /* stashRemove 已處理 */ }
        } else {
          const n = d.st > 1 ? e.n : 1;
          const tmp = { k: e.k, n, lvl: e.lvl };
          const left = bagAdd(target, cap, tmp);
          if (left === n) { this.toast('背包已滿'); return; }
          if (d.type === 'weapon' || d.type === 'shield') S.stash.splice(i, 1);
          else stashRemove(e.k, n - left);
        }
      }
      Sfx.play('ui');
      saveGame(); this.closeModal(); this.renderBase();
    });
    const un = box.querySelector('[data-unequip]');
    if (un) un.onclick = () => {
      if (kind === 'weapon') { stashAdd(L.w[slot]); L.w[slot] = null; }
      else { stashAdd(L.shield); L.shield = null; }
      saveGame(); this.closeModal(); this.renderBase();
    };
  },

  stashModal(i) {
    const e = S.stash[i];
    if (!e) return;
    const d = ITEMS[e.k];
    const n = e.n || 1;
    let info = '';
    if (d.type === 'weapon') info = weaponDesc(e.k, e.lvl || 1);
    else if (d.type === 'shield') info = `容量 ${SHIELDS[e.k].cap} · 減傷 ${Math.round(SHIELDS[e.k].mit * 100)}%`;
    else if (d.use) info = d.use.heal ? `回復 ${d.use.heal} 生命，耗時 ${d.use.t}s` : `回復 ${d.use.shield} 護盾，耗時 ${d.use.t}s`;
    // 用途提示
    const uses = [];
    for (const [fk, f] of Object.entries(FACILITIES)) for (const c of f.costs) if (c.items && c.items[e.k]) { uses.push(f.name); break; }
    for (const q of questActive()) if (q.item === e.k) uses.push('任務：' + q.name);
    this.modal(`<h3 style="color:${RARITY[d.r].color}">${d.icon} ${d.name}${d.type === 'weapon' ? ' ' + 'I'.repeat(e.lvl || 1) : ''}</h3>
      <div class="muted">${RARITY[d.r].name} · ${TYPE_LABEL[d.type]} · 單價 ◎${d.val} · 數量 ${n}</div>
      ${info ? `<p>${info}</p>` : ''}${uses.length ? `<p class="muted">用途：${[...new Set(uses)].join('、')}</p>` : ''}
      <div class="acts">
        <button class="btn" data-s="sell1">出售 1 個 (◎${d.val})</button>
        ${n > 1 ? `<button class="btn" data-s="sellAll">全部出售 (◎${d.val * n})</button>` : ''}
        ${d.type === 'weapon' || d.type === 'shield' ? '<button class="btn primary" data-s="equip">裝備</button>' : '<button class="btn primary" data-s="bag">放入背包</button>'}
        <button class="btn" onclick="UI.closeModal()">關閉</button></div>`);
    const box = $('modalBox');
    box.querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
      const s = b.dataset.s;
      const L = S.loadout;
      if (s === 'sell1') { if (d.st === 1) S.stash.splice(S.stash.indexOf(e), 1); else stashRemove(e.k, 1); S.coins += d.val; Sfx.play('buy'); }
      else if (s === 'sellAll') { stashRemove(e.k, n); S.coins += d.val * n; Sfx.play('buy'); }
      else if (s === 'equip') {
        S.stash.splice(S.stash.indexOf(e), 1);
        if (d.type === 'weapon') {
          const slot = !L.w[0] ? 0 : !L.w[1] ? 1 : 0;
          if (L.w[slot]) stashAdd(L.w[slot]);
          L.w[slot] = { k: e.k, lvl: e.lvl || 1 };
        } else { if (L.shield) stashAdd(L.shield); L.shield = { k: e.k }; }
        this.toast('已裝備 ' + d.name);
      } else if (s === 'bag') {
        const left = bagAdd(L.bag, bagCap(), { k: e.k, n });
        if (left === n) { this.toast('背包已滿'); return; }
        stashRemove(e.k, n - left);
        this.toast('已放入背包');
      }
      saveGame(); this.closeModal(); this.renderBase();
    });
  },

  deploy() {
    const L = S.loadout;
    if (S.stash.length > stashCap()) { this.toast('倉庫已滿'); return; }
    const go = () => {
      this.closeModal();
      $('base').classList.add('hidden');
      $('hud').classList.remove('hidden');
      $('touchZone').classList.remove('hidden');
      $('touchBtns').classList.remove('hidden');
      document.body.classList.add('inraid');
      Raid.start(this.mapSel);
    };
    if (!L.w[0] && !L.w[1]) {
      this.modal(`<h3>沒有武器</h3><p class="muted">你確定要赤手空拳上地表嗎？也可以先領取免費基礎裝備。</p><div class="acts"><button class="btn" onclick="UI.closeModal()">取消</button><button class="btn danger" id="goAnyway">硬著頭皮出發</button></div>`);
      $('goAnyway').onclick = go;
      return;
    }
    go();
  },

  // ================= 遠征面板 =================
  panelOpen() { return !!this.mode; },

  openLoot(c) {
    this.mode = 'loot'; this.lootC = c; Raid.openC = c;
    Input.resetTouch();
    this.renderPanel();
  },
  openBag() {
    this.mode = 'bag'; this.lootC = null; Raid.openC = null;
    Input.resetTouch();
    this.renderPanel();
  },
  closePanel(force) {
    this.mode = null; this.lootC = null; Raid.openC = null;
    $('panel').classList.add('hidden');
    const sh = document.querySelector('.sheet'); if (sh) sh.remove();
    if (force) { this.closeModal(); }
  },
  refreshPanel() { if (this.mode) this.renderPanel(); },

  renderPanel() {
    const p = Raid.p, c = this.lootC;
    const el = $('panel');
    el.classList.remove('hidden');
    el.classList.toggle('nobox', !c);
    const cname = c ? (c.type === 'body' ? `${esc(c.name)} 的遺體` : c.type === 'wreck' ? `${ARC[c.arcType] ? ARC[c.arcType].name : 'ARC'} 殘骸` : CONTAINERS[c.type].name) : '';
    const cItems = c ? (c.items.length ? c.items.map((e, i) => itemTile(e, `data-take="${i}"`)).join('') : '<div class="muted">空的</div>') : '';
    const bag = p.bag.map((e, i) => itemTile(e, `data-bag="${i}"`)).join('') + Array.from({ length: Math.max(0, bagCap() - p.bag.length) }, () => '<div class="it empty"></div>').join('');
    const pocket = p.pocket.map((e, i) => itemTile(e, `data-pocket="${i}"`)).join('') + Array.from({ length: Math.max(0, pocketCap() - p.pocket.length) }, () => '<div class="it empty"><div class="ii">🔒</div></div>').join('');
    const wTile = (w, i) => w ? `<div class="it" style="border-left-color:${RARITY[WEAPONS[w.k].r].color}" data-wslot="${i}"><div class="ii">🔫</div><div class="in" style="color:${RARITY[WEAPONS[w.k].r].color}">${WEAPONS[w.k].name} ${'I'.repeat(w.lvl || 1)}</div><div class="iv">${i === p.cur ? '使用中' : '備用'}</div></div>` : '<div class="it empty"><div class="ii">🔫</div></div>';
    const shTile = p.shieldK ? `<div class="it" style="border-left-color:${RARITY[SHIELDS[p.shieldK].r].color}"><div class="ii">🛡️</div><div class="in">${SHIELDS[p.shieldK].name}</div><div class="iv">${Math.ceil(p.sh)}/${p.shMax}</div></div>` : '<div class="it empty"><div class="ii">🛡️</div></div>';
    const value = [...p.bag, ...p.pocket].reduce((a, e) => a + ITEMS[e.k].val * (e.n || 1), 0);
    el.innerHTML = `<div class="ph"><b>${c ? '🔍 ' + cname : '🎒 背包'}</b><span class="muted">攜帶價值 ◎${value}</span><span class="sp"></span>
      ${c && c.items.length ? '<button class="btn primary sm" data-pa="all">全部拿取</button>' : ''}<button class="btn sm" data-pa="close">關閉 ✕</button></div>
      <div class="cols">
        ${c ? `<div><h4>${cname}</h4><div class="items">${cItems}</div><div class="muted" style="margin-top:6px">點擊物品拿取</div></div>` : ''}
        <div>
          <h4>裝備</h4><div class="items">${wTile(p.weapons[0], 0)}${wTile(p.weapons[1], 1)}${shTile}</div>
          <h4>背包 <small>${p.bag.length}/${bagCap()}</small></h4><div class="items">${bag}</div>
          <h4>🔒 安全口袋 <small>${p.pocket.length}/${pocketCap()} · 死亡不掉落</small></h4><div class="items">${pocket}</div>
        </div>
      </div>`;
    el.querySelectorAll('[data-pa]').forEach(b => b.onclick = () => { if (b.dataset.pa === 'close') this.closePanel(); else Raid.takeAll(c); });
    el.querySelectorAll('[data-take]').forEach(b => b.onclick = () => Raid.takeItem(c, +b.dataset.take));
    el.querySelectorAll('[data-bag]').forEach(b => b.onclick = ev => this.itemSheet(ev, +b.dataset.bag, false));
    el.querySelectorAll('[data-pocket]').forEach(b => b.onclick = ev => this.itemSheet(ev, +b.dataset.pocket, true));
    el.querySelectorAll('[data-wslot]').forEach(b => b.onclick = ev => this.weaponSheet(ev, +b.dataset.wslot));
  },

  sheet(ev, title, acts) {
    const old = document.querySelector('.sheet'); if (old) old.remove();
    const sh = document.createElement('div');
    sh.className = 'sheet';
    sh.innerHTML = `<div class="st">${title}</div>` + acts.map(([k, l, cls]) => `<button class="btn sm ${cls || ''}" data-k="${k}">${l}</button>`).join('');
    document.body.appendChild(sh);
    const x = Math.min(ev.clientX, window.innerWidth - 170), y = Math.min(ev.clientY, window.innerHeight - sh.offsetHeight - 10);
    sh.style.left = Math.max(8, x) + 'px'; sh.style.top = Math.max(8, y) + 'px';
    return sh;
  },

  itemSheet(ev, idx, fromPocket) {
    ev.stopPropagation();
    const p = Raid.p;
    const e = (fromPocket ? p.pocket : p.bag)[idx];
    if (!e) return;
    const d = ITEMS[e.k];
    const acts = [];
    if (!fromPocket && d.type === 'con') acts.push(['use', e.k === 'grenade' ? '投擲' : '使用', 'primary']);
    if (d.type === 'weapon' || d.type === 'shield') acts.push(['equip', '裝備', 'primary']);
    if (fromPocket) acts.push(['unpocket', '移到背包']);
    else acts.push(['pocket', '🔒 放入安全口袋']);
    acts.push(['drop', '丟棄', 'danger']);
    const sh = this.sheet(ev, `${d.icon} ${d.name}${(e.n || 1) > 1 ? ' ×' + e.n : ''}`, acts);
    sh.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { sh.remove(); Raid.bagAction(idx, b.dataset.k, fromPocket); });
  },

  weaponSheet(ev, slot) {
    ev.stopPropagation();
    const p = Raid.p;
    const w = p.weapons[slot];
    const acts = [];
    if (slot !== p.cur) acts.push(['use', '切換使用', 'primary']);
    acts.push(['unequip', '卸下到背包']);
    const sh = this.sheet(ev, WEAPONS[w.k].name, acts);
    sh.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
      sh.remove();
      if (b.dataset.k === 'use') { Raid.switchTo(slot); this.refreshPanel(); }
      else Raid.unequipWeapon(slot);
    });
  },

  toggleMap() {
    if (this.mapOpen) { this.closeModal(); return; }
    const size = Math.min(window.innerWidth - 60, window.innerHeight - 110, 640);
    this.modal(`<div class="row"><h3 class="sp" style="margin:0">🗺 ${Raid.map.name}</h3><button class="btn sm" onclick="UI.closeModal()">關閉</button></div>
      <canvas id="bigMap" width="${size}" height="${size}" style="width:${size}px;height:${size}px;margin-top:8px;border-radius:8px;display:block"></canvas>
      <div class="muted" style="margin-top:6px">藍＝可呼叫電梯　黃＝抵達中　綠＝已開啟　紅框＝高價值區域</div>`);
    $('modalBox').style.maxWidth = (size + 40) + 'px';
    this.mapOpen = true;
    const draw = () => {
      if (!this.mapOpen || !Raid.active) { $('modalBox').style.maxWidth = ''; return; }
      const c = $('bigMap'); if (!c) return;
      Raid.drawMinimap(c.getContext('2d'), size, true);
      requestAnimationFrame(draw);
    };
    draw();
  },

  pause(on) {
    Raid.paused = on;
    if (!on) { this.closeModal(); Raid.last = performance.now(); return; }
    Input.resetTouch();
    this.modal(`<h3>⏸ 暫停</h3><p class="muted">剩餘時間 ${Math.floor(Raid.time / 60)}:${String(Math.floor(Raid.time % 60)).padStart(2, '0')}。放棄遠征視同陣亡，只保留安全口袋內的物品。</p>
      <div class="acts" style="justify-content:stretch;flex-direction:column">
        <button class="btn primary" onclick="UI.pause(false)">繼續遊戲</button>
        <button class="btn" onclick="UI.showHelp(false,()=>UI.pause(true))">操作說明</button>
        <button class="btn" onclick="S.settings.sound=!S.settings.sound;saveGame();this.textContent='音效：'+(S.settings.sound?'開':'關')">音效：${S.settings.sound ? '開' : '關'}</button>
        <button class="btn danger" onclick="UI.closeModal();Raid.abandon()">放棄遠征</button></div>`, false);
  },

  // ================= 結算 =================
  showResults(r) {
    const merged = {};
    for (const e of r.brought) { const key = e.k + (e.lvl ? ':' + e.lvl : ''); merged[key] = merged[key] || { k: e.k, n: 0, lvl: e.lvl }; merged[key].n += e.n || 1; }
    const tiles = Object.values(merged).map(e => itemTile(e)).join('');
    const rooster = r.rooster.length ? `<p class="muted">🐓 斯克拉皮帶回了：${r.rooster.map(e => `${ITEMS[e.k].name}×${e.n}`).join('、')}</p>` : '';
    const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60);
    this.modal(`<div class="big-title ${r.success ? 'res-ok' : 'res-bad'}">${r.success ? '✔ 撤離成功' : '✖ 遠征失敗'}</div>
      <p style="text-align:center" class="muted">${esc(r.reason)}</p>
      <div class="kv"><span>地圖</span><span>${r.map}</span><span>存活時間</span><span>${mm}:${String(ss).padStart(2, '0')}</span>
      <span>擊毀 ARC</span><span>${r.kills.arc}</span><span>擊倒掠手</span><span>${r.kills.raider}</span>
      <span>帶回價值</span><span class="coin">◎ ${r.value.toLocaleString()}</span><span>獲得經驗</span><span>${r.xp}${r.success ? '' : '（陣亡減半）'}</span></div>
      ${r.levelUp ? `<p class="res-ok" style="text-align:center">⭐ 升到 Lv.${S.level}！獲得 ${r.levelUp} 技能點</p>` : ''}
      <h4 style="margin:10px 0 6px">${r.success ? '帶回倉庫的物品' : '安全口袋保住的物品'}</h4>
      <div class="items">${tiles || '<div class="muted">什麼都沒有…</div>'}</div>
      ${!r.success ? '<p class="muted">身上的裝備已全部遺失。可在整備頁領取免費基礎裝備。</p>' : '<p class="muted">武器、護盾與消耗品已放回配裝。</p>'}
      ${rooster}
      <div class="acts"><button class="btn primary big" id="backBase" style="width:100%">返回斯佩蘭薩</button></div>`, false);
    Sfx.play(r.success ? 'extract' : 'death');
    $('backBase').onclick = () => { this.closeModal(); this.tab = 'loadout'; this.showBase(); };
    $('hud').classList.add('hidden');
    $('touchZone').classList.add('hidden');
    $('touchBtns').classList.add('hidden');
  },
};
