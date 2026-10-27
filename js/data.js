'use strict';
// 遊戲資料：物品、武器、護盾、ARC 敵人、任務、設施、技能

const RARITY = [
  { name: '普通', color: '#c8c8c8' },
  { name: '罕見', color: '#5fd35f' },
  { name: '稀有', color: '#3fa9ff' },
  { name: '史詩', color: '#c26bff' },
  { name: '傳說', color: '#ffc93c' },
];

// int: 射擊間隔(秒) rel: 換彈(秒) spr: 散布(度) rng: 射程 noise: 噪音半徑
const WEAPONS = {
  kettle:   { name: '水壺',   cls: '手槍',     r: 0, dmg: 24,  int: 0.17,  mag: 16, rel: 1.2, spr: 2.0, spd: 1500, rng: 760,  auto: false, pel: 1, noise: 600,  price: 300 },
  stitcher: { name: '縫補者', cls: '衝鋒槍',   r: 1, dmg: 9,   int: 0.075, mag: 30, rel: 2.0, spr: 7,   spd: 1300, rng: 540,  auto: true,  pel: 1, noise: 650,  price: 900 },
  ferro:    { name: '鐵桿',   cls: '折動步槍', r: 1, dmg: 60,  int: 0.85,  mag: 1,  rel: 1.1, spr: 0.8, spd: 2000, rng: 1000, auto: false, pel: 1, noise: 850,  price: 1000 },
  rattler:  { name: '響尾蛇', cls: '突擊步槍', r: 1, dmg: 13,  int: 0.115, mag: 24, rel: 2.3, spr: 4.5, spd: 1500, rng: 740,  auto: true,  pel: 1, noise: 750,  price: 1200 },
  il_toro:  { name: '公牛',   cls: '霰彈槍',   r: 2, dmg: 11,  int: 0.8,   mag: 5,  rel: 2.6, spr: 16,  spd: 1200, rng: 380,  auto: false, pel: 8, noise: 800,  price: 2200 },
  anvil:    { name: '鐵砧',   cls: '手炮',     r: 2, dmg: 42,  int: 0.5,   mag: 6,  rel: 2.4, spr: 2,   spd: 1800, rng: 820,  auto: false, pel: 1, noise: 850,  price: 2400 },
  arpeggio: { name: '琶音',   cls: '點放步槍', r: 2, dmg: 16,  int: 0.42,  mag: 24, rel: 2.2, spr: 3,   spd: 1700, rng: 820,  auto: false, pel: 1, burst: 3, noise: 750, price: 2600 },
  tempest:  { name: '暴風',   cls: '突擊步槍', r: 3, dmg: 16,  int: 0.095, mag: 30, rel: 2.2, spr: 4,   spd: 1600, rng: 800,  auto: true,  pel: 1, noise: 750,  price: 5200 },
  jupiter:  { name: '木星',   cls: '狙擊步槍', r: 4, dmg: 125, int: 1.3,   mag: 5,  rel: 3.0, spr: 0.4, spd: 2600, rng: 1400, auto: false, pel: 1, noise: 1000, price: 9800 },
};

const SHIELDS = {
  shield_light: { name: '輕型護盾', r: 0, cap: 40,  mit: 0.4,  slow: 1,    price: 250 },
  shield_med:   { name: '中型護盾', r: 1, cap: 70,  mit: 0.45, slow: 0.96, price: 900 },
  shield_heavy: { name: '重型護盾', r: 2, cap: 100, mit: 0.52, slow: 0.9,  price: 2200 },
};

// type: mat 材料, val 貴重品, con 消耗品, weapon, shield
const ITEMS = {
  metal:        { name: '金屬零件',   type: 'mat', r: 0, val: 12,   st: 30, icon: '🔧' },
  plastic:      { name: '塑膠零件',   type: 'mat', r: 0, val: 10,   st: 30, icon: '🧴' },
  rubber:       { name: '橡膠',       type: 'mat', r: 0, val: 10,   st: 30, icon: '⚫' },
  fabric:       { name: '布料',       type: 'mat', r: 0, val: 8,    st: 30, icon: '🧵' },
  chem:         { name: '化學藥劑',   type: 'mat', r: 0, val: 16,   st: 20, icon: '⚗️' },
  wires:        { name: '電線',       type: 'mat', r: 1, val: 30,   st: 15, icon: '🔌' },
  battery:      { name: '電池',       type: 'mat', r: 1, val: 35,   st: 10, icon: '🔋' },
  green_parts:  { name: '綠色零件',   type: 'mat', r: 1, val: 45,   st: 10, icon: '🟩' },
  arc_alloy:    { name: 'ARC 合金',   type: 'mat', r: 1, val: 50,   st: 10, icon: '🔩' },
  arc_circuit:  { name: 'ARC 電路',   type: 'mat', r: 2, val: 110,  st: 5,  icon: '💾' },
  cat_bed:      { name: '貓床',       type: 'mat', r: 2, val: 150,  st: 1,  icon: '🛏️' },
  arc_core:     { name: 'ARC 動力核心', type: 'mat', r: 3, val: 320, st: 3, icon: '🔆' },
  queen_reactor:{ name: '女王反應爐', type: 'mat', r: 4, val: 1500, st: 1,  icon: '☢️' },
  scrap_gear:   { name: '生鏽齒輪',   type: 'val', r: 0, val: 18,   st: 10, icon: '⚙️' },
  toaster:      { name: '舊烤麵包機', type: 'val', r: 1, val: 70,   st: 2,  icon: '🍞' },
  watch:        { name: '古董懷錶',   type: 'val', r: 2, val: 260,  st: 3,  icon: '⌚' },
  vase:         { name: '彩繪花瓶',   type: 'val', r: 3, val: 520,  st: 1,  icon: '🏺' },
  bandage:      { name: '繃帶',       type: 'con', r: 0, val: 20,  st: 5, icon: '🩹', use: { heal: 30, t: 2.0 }, price: 60 },
  medkit:       { name: '急救包',     type: 'con', r: 1, val: 80,  st: 3, icon: '💊', use: { heal: 75, t: 3.5 }, price: 220 },
  shield_cell:  { name: '護盾充能器', type: 'con', r: 0, val: 30,  st: 5, icon: '🔷', use: { shield: 40, t: 2.0 }, price: 80 },
  grenade:      { name: '破片手雷',   type: 'con', r: 1, val: 60,  st: 3, icon: '💣', price: 150 },
};
for (const k in WEAPONS) ITEMS[k] = { name: WEAPONS[k].name, type: 'weapon', r: WEAPONS[k].r, val: Math.round(WEAPONS[k].price * 0.4), st: 1, icon: '🔫', price: WEAPONS[k].price };
for (const k in SHIELDS) ITEMS[k] = { name: SHIELDS[k].name, type: 'shield', r: SHIELDS[k].r, val: Math.round(SHIELDS[k].price * 0.4), st: 1, icon: '🛡️', price: SHIELDS[k].price };

// 容器與掉落表 [物品, 權重]；W=隨機武器 S=隨機護盾
const CONTAINERS = {
  trash:   { name: '垃圾堆',   t: 1.2, rolls: [1, 3], color: '#6b6250', table: [['metal', 30], ['plastic', 30], ['rubber', 20], ['fabric', 20], ['chem', 12], ['scrap_gear', 15], ['wires', 8], ['toaster', 3], ['battery', 5], ['green_parts', 3]] },
  crate:   { name: '補給箱',   t: 2.0, rolls: [2, 4], color: '#7a6a3a', table: [['metal', 20], ['wires', 15], ['battery', 12], ['green_parts', 12], ['arc_alloy', 8], ['bandage', 12], ['shield_cell', 10], ['grenade', 5], ['toaster', 6], ['watch', 3], ['cat_bed', 2]] },
  weapon:  { name: '武器箱',   t: 2.5, rolls: [1, 2], color: '#4a5a3a', table: [['W', 45], ['grenade', 20], ['S', 18], ['arc_alloy', 10]] },
  medical: { name: '醫療箱',   t: 1.8, rolls: [2, 3], color: '#8a3a3a', table: [['bandage', 40], ['medkit', 18], ['shield_cell', 30], ['chem', 20]] },
  safe:    { name: '保險箱',   t: 3.5, rolls: [1, 3], color: '#3a4a5a', table: [['watch', 25], ['vase', 8], ['arc_circuit', 20], ['cat_bed', 8], ['battery', 15], ['arc_core', 4], ['green_parts', 15]] },
  wreck:   { name: 'ARC 殘骸', t: 1.6, rolls: [0, 0], color: '#5a2a2a', table: [] },
  body:    { name: '掠手遺體', t: 1.4, rolls: [0, 0], color: '#3a3a4a', table: [] },
  pile:    { name: '地上物品', t: 0.2, rolls: [0, 0], color: '#4a4a3a', table: [] },
};

// ARC 機器人
const ARC = {
  wasp:     { name: '黃蜂',     hp: 45,   r: 14, spd: 135, fly: true,  kind: 'gun',  dmg: 5,  fire: 0.18, burst: 4,  cool: 1.6, rng: 380, bspd: 700, sight: 460, xp: 40,  drops: [['metal', 2], ['arc_alloy', 1], ['wires', 1]], dropChance: [['arc_circuit', 0.08], ['battery', 0.3]] },
  hornet:   { name: '大黃蜂',   hp: 95,   r: 17, spd: 120, fly: true,  kind: 'gun',  dmg: 8,  fire: 0.14, burst: 6,  cool: 1.8, rng: 440, bspd: 800, sight: 500, xp: 80,  drops: [['arc_alloy', 2], ['wires', 1]], dropChance: [['arc_circuit', 0.25], ['battery', 0.4]] },
  tick:     { name: '跳蚤',     hp: 28,   r: 10, spd: 230, fly: false, kind: 'bomb', dmg: 34, rng: 34,  sight: 380, xp: 25,  drops: [['metal', 1]], dropChance: [['green_parts', 0.25]] },
  pop:      { name: '火球',     hp: 120,  r: 18, spd: 55,  fly: false, kind: 'lob',  dmg: 22, cool: 2.4, rng: 520, bspd: 330, sight: 520, xp: 70,  drops: [['metal', 2], ['chem', 2]], dropChance: [['arc_alloy', 0.5], ['arc_circuit', 0.12]] },
  leaper:   { name: '跳躍者',   hp: 280,  r: 24, spd: 80,  fly: false, kind: 'jump', dmg: 40, cool: 3.2, rng: 420, sight: 560, xp: 150, drops: [['arc_alloy', 3], ['metal', 3]], dropChance: [['arc_circuit', 0.5], ['arc_core', 0.15]] },
  sentinel: { name: '哨兵砲塔', hp: 200,  r: 20, spd: 0,   fly: false, kind: 'laser',dmg: 34, charge: 1.1, cool: 2.6, rng: 720, sight: 720, xp: 120, drops: [['wires', 3], ['battery', 2]], dropChance: [['arc_circuit', 0.6], ['arc_core', 0.1]] },
  bastion:  { name: '堡壘',     hp: 800,  r: 34, spd: 45,  fly: false, kind: 'gun',  dmg: 7,  fire: 0.07, burst: 24, cool: 2.4, rng: 600, bspd: 900, sight: 620, xp: 400, back: 2.2, drops: [['arc_alloy', 5], ['arc_circuit', 2]], dropChance: [['arc_core', 0.8]] },
  queen:    { name: '女王',     hp: 3000, r: 56, spd: 35,  fly: false, kind: 'boss', dmg: 30, cool: 2.0, rng: 900, sight: 800, xp: 1500, drops: [['queen_reactor', 1], ['arc_core', 2], ['arc_circuit', 3]], dropChance: [] },
};

const MAPS = {
  dam:  { name: '大壩戰場', desc: '開闊的河谷與零散建築，適合新手摸路。', density: 0.42, ground: '#3b4433', ground2: '#46503a', road: '#4a4740', danger: 1, unlock: 1 },
  city: { name: '埋葬之城', desc: '黃沙掩埋的密集城區，高價值物資與更多 ARC。', density: 0.78, ground: '#5a4c36', ground2: '#64553c', road: '#4e4434', danger: 1.35, unlock: 3 },
  port: { name: '太空港',   desc: '巨型發射場，女王經常出沒。極度危險。', density: 0.55, ground: '#3a3d44', ground2: '#43474f', road: '#33353b', danger: 1.7, unlock: 6 },
};

const QUESTS = [
  { id: 'q1', from: '席莉絲', name: '第一次遠征', desc: '成功從任何地圖撤離 1 次', type: 'extract', n: 1, rew: { coins: 300, xp: 200, items: [['bandage', 3]] } },
  { id: 'q2', from: '蘭斯', name: '清除黃蜂', desc: '擊毀 5 架黃蜂', type: 'kill', target: 'wasp', n: 5, rew: { coins: 500, xp: 300, items: [['shield_cell', 3]] } },
  { id: 'q3', from: '席莉絲', name: '綠色零件', desc: '交付 5 個綠色零件', type: 'deliver', item: 'green_parts', n: 5, rew: { coins: 600, xp: 300, items: [['stitcher', 1]] } },
  { id: 'q4', from: '索菲亞', name: '貓咪的床', desc: '交付 1 個貓床', type: 'deliver', item: 'cat_bed', n: 1, rew: { coins: 700, xp: 400, items: [['rattler', 1]] } },
  { id: 'q5', from: '蘭斯', name: '電路需求', desc: '交付 3 個 ARC 電路', type: 'deliver', item: 'arc_circuit', n: 3, rew: { coins: 900, xp: 500, items: [['medkit', 2]] } },
  { id: 'q6', from: '塔維', name: '掠手之間', desc: '擊倒 3 名敵對掠手', type: 'kill', target: 'raider', n: 3, rew: { coins: 1000, xp: 500, items: [['shield_med', 1]] } },
  { id: 'q7', from: '塔維', name: '拆除堡壘', desc: '擊毀 1 台堡壘', type: 'kill', target: 'bastion', n: 1, rew: { coins: 1500, xp: 800, items: [['arc_circuit', 2]] } },
  { id: 'q8', from: '索菲亞', name: '動力來源', desc: '交付 2 個 ARC 動力核心', type: 'deliver', item: 'arc_core', n: 2, rew: { coins: 2000, xp: 1000, items: [['tempest', 1]] } },
  { id: 'q9', from: '席莉絲', name: '弒君者', desc: '擊毀女王', type: 'kill', target: 'queen', n: 1, rew: { coins: 6000, xp: 3000, items: [['jupiter', 1]] } },
];

// costs[i] 為從等級 i+1 升到 i+2 的花費
const FACILITIES = {
  workbench: { name: '槍械工作台', icon: '🛠️', desc: '提高商店武器稀有度，並開放更高的武器升級等級。', max: 3,
    costs: [{ coins: 800, items: { metal: 20, wires: 5 } }, { coins: 2500, items: { arc_alloy: 8, arc_circuit: 3 } }] },
  pocket: { name: '安全口袋', icon: '🔒', desc: '每級 +1 格。放在安全口袋的物品死亡時不會掉落。', max: 3,
    costs: [{ coins: 1000, items: { fabric: 10, green_parts: 4 } }, { coins: 3000, items: { arc_circuit: 3, cat_bed: 1 } }] },
  backpack: { name: '背包工坊', icon: '🎒', desc: '每級背包 +3 格。', max: 3,
    costs: [{ coins: 600, items: { fabric: 15, rubber: 10 } }, { coins: 1800, items: { fabric: 20, arc_alloy: 5 } }] },
  stash: { name: '倉庫擴建', icon: '📦', desc: '每級倉庫 +20 格。', max: 4,
    costs: [{ coins: 500, items: { metal: 15, plastic: 15 } }, { coins: 1500, items: { metal: 30, wires: 8 } }, { coins: 4000, items: { arc_alloy: 10, battery: 6 } }] },
  medbay: { name: '醫療站', icon: '⛑️', desc: '升級後商店販售急救包，治療效果 +20%。', max: 2,
    costs: [{ coins: 900, items: { chem: 10, fabric: 10 } }] },
  rooster: { name: '斯克拉皮的雞窩', icon: '🐓', desc: '公雞斯克拉皮會在每次遠征後替你撿回材料。等級越高撿越多。', max: 3, start: 0,
    costs: [{ coins: 300, items: { plastic: 5 } }, { coins: 1200, items: { rubber: 10, green_parts: 3 } }, { coins: 3000, items: { arc_alloy: 6, toaster: 1 } }] },
};

const SKILLS = {
  vitality: { name: '強健體魄', icon: '❤️', desc: '最大生命 +10', max: 3, col: '生存' },
  scav:     { name: '拾荒專家', icon: '🔍', desc: '搜刮速度 +20%', max: 3, col: '生存' },
  medic:    { name: '野戰醫療', icon: '🩹', desc: '使用治療品速度 +25%', max: 2, col: '生存' },
  stamina:  { name: '耐力',     icon: '🏃', desc: '體力上限與回復 +20%', max: 3, col: '機動' },
  quiet:    { name: '輕巧步伐', icon: '👣', desc: '被 ARC 發現的距離 -10%', max: 3, col: '機動' },
  mule:     { name: '負重訓練', icon: '🎒', desc: '背包 +2 格', max: 3, col: '機動' },
  steady:   { name: '穩定射擊', icon: '🎯', desc: '武器散布 -10%', max: 3, col: '戰鬥' },
  reload:   { name: '快速換彈', icon: '🔄', desc: '換彈時間 -10%', max: 3, col: '戰鬥' },
};

const RAIDER_NAMES = ['老六', '阿凱', '小虎', 'Rook', 'Vex', '鐵鏽', '夜鷹', '阿茂', 'Juno', '拾荒者K', '銀狐', '大雄', 'Kestrel', '灰燼', '阿德', 'Nyx', '沙丘', '小柯'];

const RAID_TIME = 420; // 單局 7 分鐘（原作約 30 分鐘，網頁版縮短）
