// 一局游戏的状态、数值结算、存档 / 读档
import { store } from './store.js?v=1794602144';
import { INITIAL, INITIAL_MADNESS, TAGS, HE_FLAGS, WARM_STREAK, VALUE_KEYS, madTier, DAILY_CAP, CAP_UP, EXCLUSIVE_TAGS, MAX_TAGS_PER_TURN, OUTWARD_TAGS, NO_SCALE_HOPE } from './config/values.js?v=1794602144';
import { AP_PER_SLOT } from './config/world.js?v=1794602144';

export function newRun(outfit = 'initial', loop = 0) {
  return {
    ver: 2, day: 1, slot: 0, loc: 'creek', ap: AP_PER_SLOT, phase: 'map',
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
// 标签和河的状态受「每天 ±3」上限（加、减分开算）；extra（固定剧情、选项、每天自然变化）不受限，除非 opts.capExtra（村里的衣服）
export function applyTags(s, tags = [], heFlags = [], extra = null, opts = {}) {
  tags = [...new Set(tags)];
  for (const grp of EXCLUSIVE_TAGS) { const hit = tags.filter(t => grp.includes(t)); if (hit.length > 1) tags = tags.filter(t => !grp.includes(t) || t === hit[0]); }
  if (tags.includes('想离开') && tags.some(t => OUTWARD_TAGS.includes(t))) tags = tags.filter(t => t !== '想离开');
  tags = tags.slice(0, MAX_TAGS_PER_TURN);
  // 河不在场（1113 晚 A-3，Cora 定「迷雾」）：他没看见、没听见的事不改他的数值。标签照常计数，只有同化生效
  const absent = !!opts.absent;
  if (absent) heFlags = [];
  // 刷结局模式（问他走不走与刷数值 1111，Cora 定）：不用每天 ±3 点的上限，改成同一个标签一天最多算 3 次
  if (opts.grind) {
    const T = s.c.tagDay?.day === s.day ? s.c.tagDay : (s.c.tagDay = { day: s.day, n: {} });
    tags = tags.filter(t => (T.n[t] || 0) < 3);
    for (const t of tags) T.n[t] = (T.n[t] || 0) + 1;
  }
  if (!absent && tags.some(t => t === '冷淡' || t === '拒绝' || t === '想离开')) (s.c ||= {}).negDay = s.day;   // 这一天有负面标签：明早怨恨不自动消
  if (!absent && tags.includes('承诺带他走')) (s.c ||= {}).promiseDay = s.day;   // 第 35–39 天：最近 3 天有没有给他准话
  const dc = {}, de = {};
  const add = (o, k, x) => { o[k] = (o[k] || 0) + x; };
  let warm = false;
  for (const t of tags) {
    const m = TAGS[t]; if (!m) continue;
    if (t === WARM_STREAK.tag) warm = true;
    for (const [k, x] of Object.entries(m)) {
      if (k === 'counter') s.c[x] = (s.c[x] || 0) + 1;
      else if (k === 'madness') { if (!absent) s.madness += x; }
      else add(dc, k, x);
    }
    if (t === '提到外面' && s.v.hope < 30) add(dc, 'resent', 1);   // 他还不信你的时候，听你说外面只会更羡慕
  }
  for (const t of heFlags) {
    const m = HE_FLAGS[t]; if (!m) continue;
    const crossAgain = t === '越界' && s.c.crossDay === s.day;   // 疯神值平衡 1111：越界当天第二次起只算克制和计数
    if (t === '越界') s.c.crossDay = s.day;
    for (const [k, x] of Object.entries(m)) {
      if (k === 'counter') s.c[x] = (s.c[x] || 0) + 1;
      else if (k === 'madness') { if (!crossAgain) s.madness += x; }
      else add(dc, k, x);
    }
  }
  // 回避型依恋：连续热烈回应
  if (absent) { for (const k in dc) if (k !== 'assim') delete dc[k]; }
  else if (warm) { s.c.warmStreak = (s.c.warmStreak || 0) + 1; WARM_STREAK.apply(s.c.warmStreak, dc); }
  else if (tags.length) s.c.warmStreak = Math.max(0, (s.c.warmStreak || 0) - WARM_STREAK.decay);
  const hopeFull = absent ? 0 : tags.filter(t => NO_SCALE_HOPE.includes(t)).reduce((x, t) => x + (TAGS[t]?.hope || 0), 0);   // 说外面的希望不打五折
  if (opts.scale != null && opts.scale !== 1) for (const k in dc) dc[k] *= opts.scale;
  if (opts.scale != null && opts.scale !== 1 && hopeFull) dc.hope = (dc.hope || 0) + hopeFull * (1 - opts.scale);   // 1 点的小事 ×0.5（固定事件、选项不打折）
  if (extra) for (const [k, x] of Object.entries(extra)) add(opts.capExtra ? dc : de, k, x);
  // 每天上限：今天已经加了多少、减了多少
  if (opts.noCap || opts.grind) { for (const [k, x] of Object.entries(dc)) add(de, k, x); for (const k in dc) delete dc[k]; }   // 固定剧情的选项：不受每天上限
  if (!s.c.cap || s.c.cap.day !== s.day) s.c.cap = { day: s.day, up: {}, down: {} };
  const out = {};
  for (const k of VALUE_KEYS) {
    let x = dc[k] || 0;
    if (x > 0) { const cap = (CAP_UP[k] ?? DAILY_CAP) - (k === 'love' && s.c.clingyDay === s.day ? 1 : 0); const room = Math.max(0, cap - (s.c.cap.up[k] || 0)); x = Math.min(x, room); s.c.cap.up[k] = (s.c.cap.up[k] || 0) + x; }
    else if (x < 0) { const room = Math.max(0, DAILY_CAP - (s.c.cap.down[k] || 0)); x = Math.max(x, -room); s.c.cap.down[k] = (s.c.cap.down[k] || 0) - x; }
    x += de[k] || 0;
    if (x) { s.v[k] = clamp(s.v[k] + x); out[k] = x; }
  }
  s.madness = Math.max(-5, Math.min(5, s.madness));
  return out;
}

// —— 存档 ——
// 自动存档：auto；手动：slot1..4（Cora 11/12：四个，名字可以自己起，存在 store 'slotNames'）
export const SLOT_IDS = ['auto', 'slot1', 'slot2', 'slot3', 'slot4'];
export function saveRun(s, id = 'auto') {
  s.savedAt = Date.now();
  store.set('save_' + id, s);
}
export function loadRun(id = 'auto') {
  const s = store.get('save_' + id); if (!s) return s;
  // 旧存档（5 段 × 3 点）：时段 −1（清晨并进上午），行动点不超过 2
  if ((s.ver || 1) < 2) { s.slot = Math.max(0, (s.slot || 0) - 1); s.ver = 2; }
  if (s.ap > AP_PER_SLOT) s.ap = AP_PER_SLOT;
  return s;
}
export function delRun(id) { store.del('save_' + id); }
export function hasActiveRun() { const s = loadRun('auto'); return !!(s && !s.ended); }
export function slotInfo(id) { const s = loadRun(id); return s ? { day: s.day, slot: s.slot, loc: s.loc, savedAt: s.savedAt, ended: s.ended, saveName: s.saveName, f: s.f || {}, done: s.done || [] } : null; }
export function clone(s) { return JSON.parse(JSON.stringify(s)); }

// 名字：河第 1 天自我介绍、牠第 5 天递字条之前，名牌显示 ？？？（旧存档按天数算已经知道）
// 「牠」这个名字揭晓之前，界面上（地图、建议行动）不出现「牠」（测试记录 6）
// 手机语气阶段（人肉 v3 · 3）：生 / 熟 / 近 / 冷
export function phoneStage(s) {
  if (s.v.resent >= 60) return 'cold';
  if (s.day >= 26 && s.v.love >= 60) return 'near';
  if (s.day >= 11 && s.v.love >= 40) return 'warm';
  return 'raw';
}
export function taText(s, t) {
  if (!s || knows(s, '牠')) return t;
  return String(t).replace(/牠的屋子/g, '最高处的破屋').replace(/牠/g, '白头发的人');
}
export function knows(s, who) {
  if (!s) return true;
  if (who === '河') return !!s.f?.know_he || s.day > 1 || s.done?.includes('d1_meet');
  if (who === '牠') return !!s.f?.know_ta || s.done?.includes('d5_ta_suture');
  if (who === '养母') return !!s.f?.know_mother || s.day > 1 || s.done?.includes('d1_night');
  if (who === '衡') return !!s.f?.know_heng || s.day > 4 || s.done?.includes('d4_heng');
  if (who === '满') return !!s.f?.know_man || s.done?.includes('d8_man');
  if (who === '村民·男') return !!s.f?.know_shi;
  if (who === '村民·女') return !!s.f?.know_fang;
  return true;
}
