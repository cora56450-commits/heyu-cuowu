// 一局游戏的状态、数值结算、存档 / 读档
import { store } from './store.js';
import { INITIAL, INITIAL_MADNESS, TAGS, HE_FLAGS, WARM_STREAK, VALUE_KEYS, madTier } from './config/values.js';
import { AP_PER_SLOT } from './config/world.js';

export function newRun(outfit = 'initial', loop = 0) {
  return {
    ver: 1, day: 1, slot: 0, loc: 'creek', ap: AP_PER_SLOT, phase: 'map',
    v: { ...INITIAL }, madness: INITIAL_MADNESS,
    c: {}, f: {}, done: [],
    outfit, loop,
    summary: '', history: [], log: [], turns: 0,
    phone: [], unread: 0, phoneToday: 0,
    meta: { rerolls: 0, loaded: false, sawStats: false, outfitChanged: false, sinceMeta: 0, nextMeta: 6 + Math.floor(Math.random() * 5), feignTurns: 0 },
    lastSugg: [], startedAt: Date.now(), savedAt: Date.now(), ended: null,
  };
}

const clamp = x => Math.max(0, Math.min(100, x));
export const tierOf = s => madTier(s.madness);

// 应用一组标签 + 河的标记 + 额外数值，返回本轮实际的变化（调试 / 记录用）
export function applyTags(s, tags = [], heFlags = [], extra = null) {
  const d = {};
  const add = (k, x) => { d[k] = (d[k] || 0) + x; };
  let warm = false;
  for (const t of tags) {
    const m = TAGS[t]; if (!m) continue;
    if (t === WARM_STREAK.tag) warm = true;
    for (const [k, x] of Object.entries(m)) {
      if (k === 'counter') s.c[x] = (s.c[x] || 0) + 1;
      else if (k === 'madness') s.madness += x;
      else add(k, x);
    }
  }
  for (const t of heFlags) {
    const m = HE_FLAGS[t]; if (!m) continue;
    for (const [k, x] of Object.entries(m)) {
      if (k === 'counter') s.c[x] = (s.c[x] || 0) + 1;
      else if (k === 'madness') s.madness += x;
      else add(k, x);
    }
  }
  // 回避型依恋：连续热烈回应
  if (warm) { s.c.warmStreak = (s.c.warmStreak || 0) + 1; WARM_STREAK.apply(s.c.warmStreak, d); }
  else s.c.warmStreak = Math.max(0, (s.c.warmStreak || 0) - WARM_STREAK.decay);
  if (extra) for (const [k, x] of Object.entries(extra)) add(k, x);
  for (const k of VALUE_KEYS) if (d[k]) s.v[k] = clamp(s.v[k] + d[k]);
  s.madness = Math.max(-5, Math.min(5, s.madness));
  return d;
}

// —— 存档 ——
// 自动存档：auto；手动：slot1..3
export const SLOT_IDS = ['auto', 'slot1', 'slot2', 'slot3'];
export function saveRun(s, id = 'auto') {
  s.savedAt = Date.now();
  store.set('save_' + id, s);
}
export function loadRun(id = 'auto') { return store.get('save_' + id); }
export function delRun(id) { store.del('save_' + id); }
export function hasActiveRun() { const s = loadRun('auto'); return !!(s && !s.ended); }
export function slotInfo(id) { const s = loadRun(id); return s ? { day: s.day, slot: s.slot, loc: s.loc, savedAt: s.savedAt, ended: s.ended, saveName: s.saveName } : null; }
export function clone(s) { return JSON.parse(JSON.stringify(s)); }

// 名字：河第 1 天自我介绍、牠第 5 天递字条之前，名牌显示 ？？？（旧存档按天数算已经知道）
export function knows(s, who) {
  if (!s) return true;
  if (who === '河') return !!s.f.know_he || s.day > 1 || s.done.includes('d1_meet');
  if (who === '牠') return !!s.f.know_ta || s.done.includes('d5_ta_suture');
  return true;
}
