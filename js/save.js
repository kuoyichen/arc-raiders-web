'use strict';
// 存檔與局外狀態

const SAVE_KEY = 'arc_raiders_web_v1';

function newSave() {
  return {
    v: 1,
    coins: 600,
    xp: 0,
    level: 1,
    sp: 0,
    skills: {},
    fac: { workbench: 1, pocket: 1, backpack: 1, stash: 1, medbay: 1, rooster: 0 },
    stash: [
      { k: 'metal', n: 6 }, { k: 'fabric', n: 4 }, { k: 'bandage', n: 2 },
    ],
    loadout: {
      w: [{ k: 'kettle', lvl: 1 }, null],
      shield: { k: 'shield_light' },
      bag: [{ k: 'bandage', n: 3 }, { k: 'shield_cell', n: 2 }],
      pocket: [],
    },
    quests: { done: [], prog: {} },
    stats: { raids: 0, extracts: 0, deaths: 0, kills: 0, raiderKills: 0, best: 0 },
    settings: { sound: true },
    tutorial: true,
  };
}

let S = null;

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.v === 1) {
        const base = newSave();
        S = Object.assign(base, d);
        S.fac = Object.assign(newSave().fac, d.fac || {});
        S.stats = Object.assign(newSave().stats, d.stats || {});
        return;
      }
    }
  } catch (e) { /* 無痕模式等情況 */ }
  S = newSave();
}

function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* 忽略 */ }
}

function resetGame() {
  S = newSave();
  saveGame();
}

// ---- 衍生數值 ----
function skillLv(id) { return S.skills[id] || 0; }
function bagCap() { return 8 + (S.fac.backpack - 1) * 3 + skillLv('mule') * 2; }
function pocketCap() { return S.fac.pocket; }
function stashCap() { return 40 + (S.fac.stash - 1) * 20; }
function xpForLevel(l) { return 600 + (l - 1) * 400; }

function addXP(n) {
  S.xp += n;
  let ups = 0;
  while (S.xp >= xpForLevel(S.level)) {
    S.xp -= xpForLevel(S.level);
    S.level++;
    S.sp++;
    ups++;
  }
  return ups;
}

// ---- 倉庫操作（倉庫內同種材料合併為一格，武器/護盾各佔一格）----
function itemDef(k) { return ITEMS[k]; }

function stashAdd(entry) {
  const d = ITEMS[entry.k];
  if (!d) return;
  if (d.st > 1) {
    const ex = S.stash.find(e => e.k === entry.k);
    if (ex) { ex.n += entry.n || 1; return; }
    S.stash.push({ k: entry.k, n: entry.n || 1 });
  } else {
    const e = { k: entry.k };
    if (d.type === 'weapon') e.lvl = entry.lvl || 1;
    S.stash.push(e);
  }
}

function stashCount(k) {
  let n = 0;
  for (const e of S.stash) if (e.k === k) n += e.n || 1;
  return n;
}

function stashRemove(k, n) {
  for (let i = S.stash.length - 1; i >= 0 && n > 0; i--) {
    const e = S.stash[i];
    if (e.k !== k) continue;
    const has = e.n || 1;
    if (has > n) { e.n = has - n; n = 0; }
    else { S.stash.splice(i, 1); n -= has; }
  }
}

function canAfford(cost) {
  if (S.coins < (cost.coins || 0)) return false;
  for (const k in (cost.items || {})) if (stashCount(k) < cost.items[k]) return false;
  return true;
}

function payCost(cost) {
  S.coins -= cost.coins || 0;
  for (const k in (cost.items || {})) stashRemove(k, cost.items[k]);
}

function loadoutEmpty() {
  const L = S.loadout;
  return !L.w[0] && !L.w[1];
}

// 背包內堆疊加入；回傳無法放入的數量
function bagAdd(bag, cap, entry) {
  const d = ITEMS[entry.k];
  let n = entry.n || 1;
  if (d.st > 1) {
    for (const e of bag) {
      if (e.k === entry.k && e.n < d.st) {
        const add = Math.min(n, d.st - e.n);
        e.n += add; n -= add;
        if (n <= 0) return 0;
      }
    }
  }
  while (n > 0 && bag.length < cap) {
    if (d.st > 1) {
      const add = Math.min(n, d.st);
      bag.push({ k: entry.k, n: add }); n -= add;
    } else {
      const e = { k: entry.k, n: 1 };
      if (d.type === 'weapon') e.lvl = entry.lvl || 1;
      bag.push(e); n -= 1;
    }
  }
  return n;
}

function questActive() {
  // 依序最多同時三個未完成任務
  return QUESTS.filter(q => !S.quests.done.includes(q.id)).slice(0, 3);
}

function questProgress(q) {
  if (q.type === 'deliver') return Math.min(q.n, stashCount(q.item));
  return Math.min(q.n, S.quests.prog[q.id] || 0);
}

function questEvent(type, target) {
  for (const q of questActive()) {
    if (q.type !== type) continue;
    if (q.target && q.target !== target) continue;
    S.quests.prog[q.id] = (S.quests.prog[q.id] || 0) + 1;
  }
}
