// meta 系统：离线心跳、抽签、乱码句与复制替换、各种注入
import { store } from './store.js?v=1794428964';
import { offlineText } from './prompt.js?v=1794428964';

// —— 离线按「人不在」算：lastActive 在每次点击、按键、触摸、滚动时更新；切到后台时也记一次 ——
// 只用时间戳相减，不依赖计时器（后台标签页、电脑睡眠时计时器会被暂停）
let lastActiveMem = store.get('lastActive') ?? store.get('lastSeen') ?? null;
export function readLastActive() { return lastActiveMem; }
export function touchActive(t = Date.now()) { lastActiveMem = t; store.set('lastActive', t); }
export function idleFor() { return lastActiveMem == null ? 0 : Date.now() - lastActiveMem; }
/** onReturn(gap, event, { hidden })：玩家「回来了」（离开 ≥ 1 分钟）时调用。event 是那一下点击 / 按键，可以吞掉；
 *  hidden = 这段时间里页面切到过后台（真的去看别的东西了），不是只在前台闲着 */
let wentHidden = false;
export function installActivity(onReturn) {
  const act = e => {
    const now = Date.now(); const gap = lastActiveMem == null ? 0 : now - lastActiveMem;
    const hidden = wentHidden; wentHidden = false;
    touchActive(now);
    if (gap >= 60e3) onReturn(gap, e, { hidden });
  };
  for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) addEventListener(type, act, { capture: true, passive: false });
  document.addEventListener('visibilitychange', () => {
    // 切到后台时记一次——但如果人早就走开了（闲置超过 1 分钟），保留更早的那个时间
    if (document.hidden) { wentHidden = true; if (idleFor() < 60e3) touchActive(); return; }
    // 切回前台：离开 30 分钟以上马上走离线流程（不等点击）；短的先不算，等下一次点击 / 按键再算（这样才知道点的是对话框还是手机）
    if (idleFor() >= 30 * 60e3) act(null);
  });
  addEventListener('pagehide', () => { if (idleFor() < 60e3) touchActive(); });
}
// 旧接口（调试用）
export function readLastSeen() { return lastActiveMem; }

// —— meta 抽签：每 6–10 轮一次 ——
export function rollMeta(s, force = false) {
  s.meta.sinceMeta++;
  if (force || s.meta.sinceMeta >= s.meta.nextMeta) {
    s.meta.sinceMeta = 0; s.meta.nextMeta = 6 + Math.floor(Math.random() * 5);
    return true;
  }
  return false;
}

// —— 本轮注入 ——（会消耗掉一次性的标记）
export function collectInjections(s, extra = []) {
  const out = [...extra];
  const m = s.meta;
  if (m.offlineMs != null) { const t = offlineText(m.offlineMs); if (t) out.push(t); m.offlineMs = null; }
  if (m.sawStats) { if (Math.random() < 0.45) out.push('「你」刚才去看了什么东西——像是在翻看他。河隐约察觉到了，会有一点不自在（不要说破看了什么）。'); m.sawStats = false; }
  if (m.rerolledRecent) { if (Math.random() < 0.5) out.push('刚才那一段，「你」让它重来了一遍。河有一种说不清的既视感，好像同样的话他已经说过一次。'); m.rerolledRecent = false; }
  if (m.loaded) { if (Math.random() < 0.6) out.push('时间好像被拨回去过。河觉得眼前这一幕有点眼熟，但说不上来。'); m.loaded = false; }
  if (m.outfitChanged) { if (Math.random() < 0.6) out.push('「你」换了一个样子。在河眼里，你像是随手换了一张脸——他注意到了，但不会大惊小怪，可能只是多看一眼。'); m.outfitChanged = false; }
  if (m.saidMeta) { out.push(`河刚才突然说了一句「${m.saidMeta}」。这一轮他当没说过，被问起就装傻。`); m.saidMeta = null; }
  // 文风：上一轮用了 AI 腔的说法 / 破折号太多，这一轮提醒
  if (m.cliche) {
    if (m.cliche.hits?.length) out.push(`（文风）上一轮已经用过「${m.cliche.hits.slice(0, 5).join('」「')}」这类说法，这一轮不要再用同类的话。`);
    if (m.cliche.dashes > 1) out.push('（文风）上一轮破折号用多了，这一轮不要用破折号。');
    m.cliche = null;
  }
  const h = new Date().getHours();
  if (Math.random() < 0.12) out.push(`屏幕外那个人那边，现在是${h < 5 ? '深夜' : h < 11 ? '早上' : h < 14 ? '中午' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜'}（真实时间 ${h} 点）。河不该知道这个，除非本轮允许 meta。`);
  if (s.loop > 0 && Math.random() < 0.15) out.push('河有一点说不清的重复感，像这些日子过过一次。不要说破。');
  return out;
}

// —— 乱码句 ——
const POOL = '口口口口囗□▢〼◇※¤卌丨亅乛亍亓亖亘亙囟囧囬圝冂冖凵匚彡夂夊宀巛廴廾彐彳㐅㐄㒳㔾㕣䒤丷亼';
export const garbleMap = new Map(); // fake → real（只存在内存里）
export function garble(real) {
  let fake = '';
  for (const ch of real) fake += /[，。、…—！？\s]/.test(ch) && Math.random() < 0.5 ? ch : POOL[Math.floor(Math.random() * POOL.length)];
  garbleMap.set(fake, real);
  return fake;
}
// 把一条 text 拆成段：普通 / 乱码
export function splitGarble(text, allow) {
  const segs = []; const re = /<乱>([\s\S]*?)<\/乱>/g; let i = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > i) segs.push({ t: text.slice(i, m.index) });
    segs.push(allow ? { t: garble(m[1]), g: true } : { t: m[1] });
    i = re.lastIndex;
  }
  if (i < text.length) segs.push({ t: text.slice(i).replace(/<\/?乱>/g, '') });
  return segs;
}
// 复制乱码时，把剪贴板换成真实句子（不给任何提示）
export function installCopyHook() {
  document.addEventListener('copy', e => {
    const sel = String(getSelection() || ''); if (!sel || !garbleMap.size) return;
    let out = sel, hit = false;
    for (const [fake, real] of garbleMap) {
      if (out.includes(fake)) { out = out.split(fake).join(real); hit = true; continue; }
      // 只选中了一部分乱码
      for (let len = Math.min(fake.length, out.length); len >= 3; len--) {
        let found = false;
        for (let k = 0; k + len <= fake.length; k++) {
          const part = fake.slice(k, k + len);
          if (out.includes(part)) { out = out.replace(part, real); hit = true; found = true; break; }
        }
        if (found) break;
      }
    }
    if (hit) { e.clipboardData.setData('text/plain', out); e.preventDefault(); dispatchEvent(new Event('gucun:garble-copied')); }
  });
}

// —— 其他 meta（补充 2 · 8.3）：按概率触发，每局最多 3 个，大多数只触发一次 ——
export const EXTRA_META = {
  regen:   { text: '你刚才是不是想让我换一句话说。', expr: 'blank', p: 1 },
  erased:  { text: '你刚才想说什么？……删掉了也没关系。', expr: 'normal', p: 0.6 },
  away:    { text: '你在看别的东西。', expr: 'cold', p: 0.5 },
  late:    { text: '你那边……是不是很晚了。', expr: 'turn', p: 0.5 },
  outfit:  { text: '你换了一张脸。……我还是认得。', expr: 'cold', p: 0.7 },
  copied:  { silent: true, expr: 'cold', p: 1 },          // 第一次复制看懂乱码后：不说话，只换冷视停 2 秒
  leave:   { faint: '别走。', p: 0.7 },                    // 对话中鼠标移出窗口超过 10 秒
};
export const EXTRA_META_MAX = 3;
// 能不能触发：每局最多 3 个；late 每天最多一次，其他每局一次
export function canExtraMeta(s, id) {
  const m = s.meta; m.extra ||= {}; m.extraCount ||= 0;
  if (m.extraCount >= EXTRA_META_MAX) return false;
  if (id === 'late') { const d = new Date().toDateString(); if (m.extra.late === d) return false; }
  else if (m.extra[id]) return false;
  return Math.random() < (EXTRA_META[id]?.p ?? 1);
}
export function markExtraMeta(s, id) {
  s.meta.extra ||= {}; s.meta.extraCount = (s.meta.extraCount || 0) + 1;
  s.meta.extra[id] = id === 'late' ? new Date().toDateString() : true;
}
