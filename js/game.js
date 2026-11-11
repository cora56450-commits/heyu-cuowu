// 主循环：主界面、对话播放、行动点、时段推进、事件、结局判定
import { h, $, A, sleep, showScreen, openOv, closeOv, toast, preload, modal } from './ui/dom.js?v=1794428964';
import { getSettings, store, unlock, getGallery, organsOpen } from './store.js?v=1794428964';
import { chat, ApiError } from './api.js?v=1794428964';
import { pickBits } from './config/lore.js?v=1794428964';
import { favAdd, favText, npcAfterTurn, npcBlock, villageKnowRule, queueHurt, queueKnow, takeKnow } from './npc.js?v=1794428964';
import { KEY_EVENTS, ADULT_NOTE, buildSystem, summaryPrompt, phonePingPrompt, phoneChatPrompt } from './prompt.js?v=1794428964';
import { normTurn, LineStreamer, looseJson, stripTags } from './parse.js?v=1794428964';
import { AI_TAGS } from './config/values.js?v=1794428964';
import { SLOTS, LOCATIONS, TOTAL_DAYS, AP_PER_SLOT, DUSK, NIGHT, heLocation, OUTFITS, STATS_EYE5, SPRITE_DIR, DEFAULT_EXPR, FIRST_LINE, EXPR, SPRITE_FIT, spriteBox, NPC_SPRITES, NPC_FIT, DUO, EXPR_FALLBACK, FEIGN_PATCH, PINCH, PINCH_BOX, VILLAGERS, NPC_PRESENCE, motherAway, locLocked } from './config/world.js?v=1794428964';
import { DAILY, VILLAGE_OUTFIT_ASSIM, OUTSIDE_OUTFIT_ASSIM, WARM_STREAK, madTier } from './config/values.js?v=1794428964';
import { ENDINGS, judgeFinal, MID, AFTERMATH, LOOP_LINE, COVER_OF } from './config/endings.js?v=1794428964';
import { newRun, applyTags, saveRun, loadRun, clone, tierOf, knows, taText, phoneStage } from './state.js?v=1794428964';
import { rollMeta, collectInjections, splitGarble, EXTRA_META, canExtraMeta, markExtraMeta, idleFor, touchActive } from './meta.js?v=1794428964';
import { findCliches, CLICHES } from './config/style.js?v=1794428964';
import { canonViolation, META_RE } from './config/canon.js?v=1794428964';
import { DEMO, DEMO_LAST_DAY } from './config/demo.js?v=1794428964';
import { memoAdd, memoDone, memoTick, apptMemoId } from './memo.js?v=1794428964';
import * as P from './ui/panels.js?v=1794428964';
import { runMinigame } from './ui/minigames.js?v=1794428964';
import { openOrgan, organPuzzle } from './ui/organ.js?v=1794428964';
import { showEnding, showLock } from './ui/ending.js?v=1794428964';

export const G = { s: null, R: null, events: [], busy: false, last: null, backTitle: null };
const SIZE_COST = { small: 1, medium: 2, large: 2 };   // 每个时段只有 2 点：一整段的大事就是 2 点
const HISTORY_KEEP = 12;
// 血腥限频（目标：恋爱六成、血腥三成）：前 4 天两天最多一次，之后每天最多一次。主线事件本身不受限，但写了也会记一次
const GORE_RE = /内脏|器官|胃|肺|肝|肾|脾|胰|胆囊|大肠|小肠|肠子|膀胱|心脏|开膛|剖开|血|缝合|伤口/;
function goreAllowed(s) {
  const g = s.c.goreDays || {};
  if (s.day <= 4) return !(g[s.day] || g[s.day - 1]);
  return !(g[s.day] >= 1);
}
const GORE_HOLD = '今天已经写过内脏、血或缝合了。这一轮不要再写这些，也不要让河主动说起内脏或画；就算玩家问起，也只一笔带过、岔开，不说出器官名字，不描写。把注意力放在人、日常和你们之间。';
const DRAWINGS_HIDDEN = '河的解剖画还没给「你」看过：被问起就收起来、岔开，不说画的是什么。';
// 一个时段的最后一件事：让 AI 把场景收住，不要停在河刚问完一句话
const LAST_ACTION_NOTE = '这是这个时段的最后一件事。写完这件事以后把场景收住（河说完话、各自去忙、或者自然地分开），最后一条不要是等玩家回答的问题。如果这件事是在等人，等到了以后至少写两三句你们之间的来往再收住，不要人一进门就结束。';
const PLACE_WORDS = [['he_room', /河的房间|他的房间|他屋/], ['room', /偏房|我的房间|我屋|我那屋|回屋/], ['yard', /养母家|院子|回家/], ['creek', /溪/], ['ta_house', /牠的屋|缝者|牠那/], ['fields', /田|晒场/], ['peach', /桃花林/], ['tomb', /后山|古墓/], ['border', /村界|雾/], ['path', /石径|村里转/]];
const placeIn = t => (PLACE_WORDS.find(([, re]) => re.test(t)) || [])[0];
const isLockedLoc = id => locLocked(G.s, id);
const BIG_ACTION = { yard: '帮养母做完这一段的活', room: '在偏房歇过这一段', he_room: '陪他待过这一段', creek: '沿着溪往下走一趟', fields: '在地里干完这一段', peach: '在桃花林里走远一点', ta_house: '帮牠收拾一整段', tomb: '在后山走一圈', border: '沿着雾边走一段', path: '在村里慢慢转一圈' };
const SLOT_CLOSE = ['到晌午了。', '日影斜了。', '天暗下来了。', '夜深了。'];
// 衡分的活（d7_work）：对应地点、时段多一条「干活（2 点）」，一天一次；不加同化（人肉 v3 · 4）
const JOBS = {
  fields: { loc: 'fields', slots: [0, 1], note: '「你」在晒场干活（翻晒、收粮）。常碰到石、芳。干活时让村民顺口说一条关于小河的旧事。这只是干活过日子，不要写成「你」在融入村子。' },
  yard: { loc: 'yard', slots: [0, 2], note: '「你」给养母打下手（择菜、挑水、烧火）。养母边干边讲一段村里的旧事，或者教「你」做一道菜。这只是干活过日子，不要写成「你」在融入村子。' },
  ta: { loc: 'ta_house', slots: [1], note: '「你」给牠送午饭。牠吃得很少，吃完写一张字条推给「你」（牠的台词用字条格式）。这只是送饭，不要写成「你」在融入村子。' },
};
// 他欠着的话（主线 1109 §1.4）：s.owes = [{ text, day }]，最多 3 条
// 后期测试修改 §2：he_owes 只收「玩家问了、河躲开了」的；河反问玩家的、这一轮其实答了的、本身踩了设定锁的都不收
// 两句话有 2 个以上相同的词（两个字一组）
function overlap2(a, b) {
  const q = String(a || '').replace(/[^\u4e00-\u9fa5]/g, ''), t = String(b || ''), STOP = /^(你|我|他|她|的|了|是|不|在|有|这|那)/;
  const grams = new Set(); for (let i = 0; i < q.length - 1; i++) { const g = q.slice(i, i + 2); if (!STOP.test(g)) grams.add(g); }
  return [...grams].filter(g => t.includes(g)).length >= 2;
}
// 一句话里有 2 个以上的词出现在河这一轮的台词里（oweOk 同一种算法）
function saidSome(text, played) {
  const said = played.filter(l => l.speaker === '河').map(l => l.text).join('');
  const q = String(text || '').replace(/[^\u4e00-\u9fa5]/g, ''), STOP = /^(你|我|他|的|了|是|不|在|有|这|那|吗|呢|么|什|怎|问)/;
  const grams = new Set(); for (let i = 0; i < q.length - 1; i++) { const g = q.slice(i, i + 2); if (!STOP.test(g)) grams.add(g); }
  return [...grams].filter(g => said.includes(g)).length >= 2;
}
function oweOk(owe, asked, played, s) {
  const t = String(owe).trim();
  if (/[？?吗呢]$/.test(t) || /^(谁让你|你为什么|你怎么|你干嘛|你是不是)/.test(t)) return false;
  if (canonViolation({ speaker: '你', text: t }, s) || canonViolation({ speaker: '你', text: asked || '' }, s)) return false;
  const said = played.filter(l => l.speaker === '河').map(l => l.text).join('');
  const q = String(asked || '').replace(/[^\u4e00-\u9fa5]/g, ''), STOP = /^(你|我|他|的|了|是|不|在|有|这|那|吗|呢|么|什|怎)/;
  const grams = new Set(); for (let i = 0; i < q.length - 1; i++) { const g = q.slice(i, i + 2); if (!STOP.test(g)) grams.add(g); }
  return [...grams].filter(g => said.includes(g)).length < 2;   // 玩家问题里有 2 个以上的词在河的台词里出现过：算答了
}
function dueOwe(s) { return (s.owes || []).find(o => s.day >= o.day + 1 && s.day <= o.day + 3) || null; }
async function phoneOwe(s) {
  // 到第 3 天还没当面碰到（或第 22–24 天他躲着你）：夜里改发短信
  const o = (s.owes || []).find(x => s.day >= x.day + 1 && (s.day >= x.day + 3 || (s.day >= 22 && s.day <= 24)));
  s.owes = (s.owes || []).filter(x => s.day < x.day + 3 || x === o);   // 过期的丢掉
  if (!o) return false;
  s.owes = s.owes.filter(x => x !== o); s.c.oweDay = s.day;
  try {
    const note = `「你」之前说过 / 问过：${o.text}。他当时没接。现在他主动发消息提起来，只说一半，1–2 条，不要解释为什么现在才说。要让人一看就知道他接的是「你」的哪句话（「你那天说……」），那句是「你」说的，不是他问的；是夸他的话就接被夸的反应，不要当成问题回答。`;
    const j = looseJson(await chat({ messages: [{ role: 'system', content: phoneChatPrompt(s, { heHere: false, outfitName: '', allowMeta: false, note, stage: phoneStage(s) }) }, { role: 'user', content: '（他主动发）' }], stream: false, maxTokens: 200 }));
    if (G.s !== s) return true;
    const reps = (Array.isArray(j?.replies) ? j.replies : []).map(r => msgOnly(String(typeof r === 'object' ? (r?.text ?? '') : r))).filter(r => r && !phoneBad(r)).slice(0, 2);
    if (!reps.length) return false;
    reps.forEach((r, i) => pushHe(s, r, i * 3000)); saveRun(s); refreshHud(); toast('手机震了一下。');
    return true;
  } catch { return false; }
}
// 衡说「明天开始」：分到活的第二天才有「干活」（测试报告 · 5③）
const jobOn = s => !!s.f.job && s.day >= (s.f.jobFrom || 0);
// 「河的第一次」之后那一天：回避型，越界之后会自省
const HE_FIRST_AFTER = '昨晚你们越过了那条线。今天河有点别扭：躲着你、话比平时更少，不提昨晚，也不说任何占有的话。他在跟自己较劲，不是在生你的气。';

export async function loadEvents() {
  // 发布版的 events.json 是编码过的（tools/build_dist.py），以 E1: 开头
  const t = await fetch('data/events.json?v=1794428964').then(r => r.text());
  const j = JSON.parse(t.startsWith('E1:') ? (await import('./_k.js?v=1794428964')).decode(t.slice(3)) : t);
  G.events = j.events;
  try { G.assets = new Set(Object.keys(await fetch('assets/manifest.json').then(r => r.json()))); } catch { G.assets = null; }
}
// 素材在不在（新立绘没到之前用替代的）
export const hasAsset = p => !G.assets || G.assets.has(p);

// ———————————————————— 主界面 ————————————————————
function bgFor(loc, slot) {
  const L = LOCATIONS[loc] || LOCATIONS.creek;
  const night = slot === NIGHT; const dusk = slot === DUSK;
  if (night && loc === 'creek') return { src: A('bg/creek_dusk40.webp'), filter: 'brightness(.32) saturate(.45) sepia(.2) hue-rotate(195deg)' };   // 测试记录 21：溪岸没有夜景，用黄昏那张压暗（白天那张压暗了还像白天）
  const src = night && L.bg[1] ? L.bg[1] : L.bg[0];
  const filter = night && !L.bg[1] ? 'brightness(.38) saturate(.55) sepia(.25) hue-rotate(185deg)' : dusk ? 'sepia(.5) saturate(1.15) brightness(.78) hue-rotate(-12deg)' : 'none';   // 黄昏、夜里没有专门的图：滤镜加重，一眼看得出时段
  return { src: A(`bg/${src}.webp`), filter };
}

export function buildMain() {
  const R = {};
  R.bg = h('img', { class: 'bg', alt: '' });
  R.sprite = h('img', { id: 'sprite', class: 'char', alt: '' });     // 河
  R.sprite2 = h('img', { id: 'sprite2', class: 'char', alt: '' });   // 另一个人（牠 / 养母 / 村民）
  R.portrait = h('div', { class: 'user-portrait' });  // 左下角：你现在的样子
  R.cg = h('img', { class: 'cg-layer', alt: '' });
  R.day = h('div', { class: 'day' }); R.slots = h('div', { class: 'slots' }); R.ap = h('div', { class: 'ap' });
  R.appt = h('button', { class: 'appt-badge hidden', title: '约好的事', onclick: e => { e.stopPropagation(); showAppts(); } }, '约');
  R.hud = h('div', { class: 'hud pp' }, R.day, h('div', { class: 'slots-row' }, R.slots, R.appt), R.ap);
  R.badge = h('span', { class: 'badge hidden' });
  const ib = (icon, title, fn, extra) => h('button', { class: 'icon-btn', onclick: fn }, h('img', { src: A(`ui/icon_${icon}.webp`), alt: '' }), title, extra);
  R.top = h('div', { class: 'topbtns' },
    ib('phone', '手机', () => P.openPhone(), R.badge), ib('map', '地图', () => P.openMap(true)),
    ib('stats', '数值', () => P.openStats()), ib('menu', '菜单', () => P.openMenu()));
  R.actHead = h('div', { class: 'head tag' }); R.actList = h('div', { class: 'list' });
  R.input = h('input', { type: 'text', placeholder: '或者，自己写想做什么……', 'aria-label': '自己写想做的事', maxlength: 60, onkeydown: e => { if (e.key === 'Enter') freeAct(); } });
  R.input.addEventListener('input', () => {
    const n = R.input.value.length; R.inputMax = Math.max(R.inputMax || 0, n);
    if (n === 0 && R.inputMax >= 4) { R.inputMax = 0; if (G.R?.chars?.he) metaLine('erased'); }
  });
  R.freeBtn = h('button', { class: 'do', onclick: () => freeAct() }, '做');
  R.free = h('div', { class: 'free btn' }, R.input, R.freeBtn);
  R.leaveBtn = h('button', { class: 'btn', onclick: () => leaveSlot() }, '离开这里');
  R.sleepBtn = h('button', { class: 'btn', onclick: () => sleepToMorning() }, '睡到明天');
  R.row = h('div', { class: 'row' }, R.leaveBtn, R.sleepBtn);
  R.actions = h('div', { class: 'actions' }, R.actHead, R.actList, R.free, R.row);
  R.name = h('div', { class: 'nametag hidden' });
  R.text = h('div', { class: 'text' });
  R.next = h('div', { class: 'next hidden' });
  R.autoBtn = h('button', { onclick: () => { G.auto = !G.auto; R.autoBtn.classList.toggle('on', G.auto); if (G.auto && G.waitClick) G.waitClick(); } }, '自动');
  R.regenBtn = h('button', { onclick: () => regenerate(), title: '让这一段重新生成' }, '重来');
  R.ctl = h('div', { class: 'ctl' }, R.regenBtn, h('button', { onclick: () => P.openLog() }, '记录'), R.autoBtn, h('button', { onclick: () => P.openSaves('save') }, '存档'));
  R.dialog = h('div', { class: 'dialog', onclick: e => { if (!e.target.closest('.ctl') && !e.target.closest('button')) advance(); } }, R.name, R.text, R.next, R.ctl);
  const scr = h('div', {}, R.bg, R.sprite2, R.sprite, R.cg, R.portrait, R.hud, R.top, R.actions, R.dialog);
  // 点画面空白处（背景、立绘、CG）也能推进对话：行动列表收起时，那块地方点了不再「没反应」
  scr.addEventListener('click', e => { if (e.target === scr || [R.bg, R.sprite, R.sprite2, R.cg].includes(e.target)) advance(); });
  showScreen('main', scr);
  G.R = R; G.auto = false;
  return R;
}

// 第 2 天认路结尾河给你手机；之前右上角没有手机（旧存档按天数算已经有了）
export const hasPhone = s => !!s && (!!s.f.has_phone || s.day > 2 || s.done.includes('d2_settle'));
export function refreshHud() {
  const s = G.s, R = G.R; if (!R) return;
  R.day.innerHTML = `第 ${s.day} 天 <small>/ ${DEMO ? DEMO_LAST_DAY : TOTAL_DAYS}</small>`;   // 试玩版显示试玩天数（小修与复查 §3）
  R.slots.replaceChildren(...SLOTS.map((n, i) => h('span', { class: i === s.slot ? 'on' : '' }, n)));
  R.ap.replaceChildren(h('span', { class: 'l' }, '行动'), ...Array.from({ length: AP_PER_SLOT }, (_, i) => h('img', { src: A(i < s.ap ? 'ui/ap_full.webp' : 'ui/ap_empty.webp'), alt: '' })), h('span', { class: 'r' }, `剩 ${s.ap} 点`));
  R.badge.textContent = s.unread; R.badge.classList.toggle('hidden', !s.unread);
  if (getSettings().debug) {   // 疯神值平衡 1111：调试时左下角一直显示疯神值和档位
    let el = document.getElementById('dbg-mad');
    if (!el) { el = h('div', { id: 'dbg-mad', style: { position: 'absolute', left: '8px', bottom: '8px', zIndex: 51, padding: '3px 8px', background: 'rgba(0,0,0,.72)', color: '#e9e2d6', font: '12px/1.5 monospace', pointerEvents: 'none' } }); ($('#stage') || document.body).append(el); }
    const m = Math.round((s.madness || 0) * 100) / 100; el.textContent = `疯神 ${m > 0 ? '+' : ''}${m} · ${{ god: '偏神', mid: '中间', mad: '偏疯' }[madTier(s.madness || 0)]}　好感 ${favText(s)}　读档发现 ${s.c.loadNoticed || 0}/${(s.c.loadNoticed || 0) + (s.c.loadMissed || 0)}`;   // NPC 隐藏好感 1111
  }
  const ap = [...(s.appts || [])].sort((x, y) => x.day * 4 + x.slot - (y.day * 4 + y.slot));
  R.appt.classList.toggle('hidden', !ap.length);   // 直接写出最近的一个约定（测试报告：红色小章「约」不容易发现）
  if (ap.length) {   // 只写哪天哪个时段；鼠标停上去 / 点一下才显示地点（Cora 11/10，数值与怨恨 §6）
    const when = `约 · ${ap[0].day === s.day ? '今天' : ap[0].day === s.day + 1 ? '明天' : `第 ${ap[0].day} 天`}${SLOTS[ap[0].slot]}`;
    R.appt.textContent = when + (ap.length > 1 ? ` 等 ${ap.length} 个` : '');
    R.appt.title = ap.map(a => `约 · ${a.who} · 第 ${a.day} 天${SLOTS[a.slot]} · ${a.place}`).join('\n');
  }
  const phoneBtn = R.top.firstChild, has = hasPhone(s);
  if (phoneBtn.classList.contains('hidden') && has) { phoneBtn.classList.add('appear'); setTimeout(() => phoneBtn.classList.remove('appear'), 1200); }
  phoneBtn.classList.toggle('hidden', !has);
  document.body.classList.toggle('loose', s.v.restraint < 35);
  refreshPortrait();
}
// 行动值旁边闪一下「−N」
function flashCost(n) {
  const R = G.R; if (!R || !n) return;
  const f = h('span', { class: 'ap-flash' }, `−${n}`); R.ap.append(f); setTimeout(() => f.remove(), 1600);
}
export function setScene(loc = G.s.loc) {
  const b = bgFor(loc, G.s.slot); G.R.bg.src = b.src; G.R.bg.style.filter = b.filter;
  const ev = G.s.curEvent && G.events.find(e => e.id === G.s.curEvent);   // 事件自带背景（第 40 天黄昏溪岸）
  if (ev?.bg && hasAsset(`bg/${ev.bg}.webp`)) { G.R.bg.src = A(`bg/${ev.bg}.webp`); G.R.bg.style.filter = 'none'; }
  pickBgm();
}
// BGM：缝合、牠、后山 → 不安；夜里和河独处 → 夜；其他 → 日常
const UNEASY_EVENTS = ['d5_ta_suture', 'd18_injury', 'd25_ta_mad', 'tomb_ta_secret', 'ta_first'];
// 调试（数值与台词排查 §3）：画面左下角显示上一轮的 tags / he_flags / action_size / 实际加减，累计今天各标签出现几次（存 s.c.tagStats，可以从存档里导出）
function debugTags(s, tags, turn, d) {
  const st = ((s.c.tagStats ||= {})[s.day] ||= {});
  for (const t of [...tags, ...(turn.he_flags || []).map(f => '河·' + f)]) st[t] = (st[t] || 0) + 1;
  let el = document.getElementById('dbg-tags');
  if (!el) { el = h('div', { id: 'dbg-tags', style: { position: 'absolute', left: '8px', bottom: '34px', zIndex: 50, maxWidth: '420px', padding: '6px 8px', background: 'rgba(0,0,0,.72)', color: '#e9e2d6', font: '12px/1.5 monospace', whiteSpace: 'pre-wrap', pointerEvents: 'none' } }); $('#stage')?.append(el); }
  const fmt = o => Object.entries(o || {}).filter(([, v]) => v).map(([k, v]) => `${k}${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}`).join(' ') || '—';
  el.textContent = `上一轮 · ${turn.action_size || '?'} ×${turn.action_count || 1}\ntags：${tags.join(' ') || '—'}  河：${(turn.he_flags || []).join(' ') || '—'}\n变化：${fmt(d?.delta || d)}\n今天累计：${Object.entries(st).map(([k, v]) => k + '×' + v).join(' ') || '—'}`;
}
// 小剧情演完之后接着写（测试记录 16 §3）
const AFTER_MINI = '「你」已经在这里，刚才那一段刚刚发生完。直接接着往下写，不要再写推门、进屋、屋里摆设的样子，屋里的东西和刚才一样。';
// 每天自然变化：前一天有过「冷淡 / 拒绝 / 想离开」，怨恨就不自己消（Cora 11/10，数值与台词排查 §5）；第 30 天以后每天另外 +0.5（不受上限，数值与怨恨 §1-7）
// 疯神值平衡 1111：每天往 0 回落 0.25（不越过 0）；一天只回落一次
function madnessDrift(s) {
  if (s.c.driftDay === s.day) return; s.c.driftDay = s.day;
  const m = s.madness || 0; s.madness = m > 0 ? Math.max(0, m - 0.25) : m < 0 ? Math.min(0, m + 0.25) : 0;
}
function dailyDelta(s) { const d = { ...DAILY }; if (s.c.negDay === s.day - 1) delete d.resent; if (s.day >= 30) d.resent = (d.resent || 0) + 0.5; return d; }
// 怨恨的新来源（数值与怨恨 1110 §1）：都由代码加、受每天 ±3 上限
export function addResent(s, n, why) {
  if (!s || !n) return;
  const d = applyTags(s, [], [], { resent: n }, { capExtra: true });
  if (getSettings().debug) console.log('怨恨', why, n, d);
}
// 每天换日时结算（新的一天已经开始，s.day 是新的一天）
function dailyResent(s) {
  const y = s.day - 1;
  // §1-3 他夜里主动发的短信，到第二天结束都没回
  if (s.c.pingDay === y - 1 && !s.f.pingAnswered && s.c.pingPenalized !== s.c.pingDay) { s.c.pingPenalized = s.c.pingDay; addResent(s, 1, '短信没回'); }
  // §1-4 昨天待在满 / 牠 / 村民那里的时段比在他那里多
  const w = s.c.slotWho; if (w && w.day === y && w.other > w.he) addResent(s, 1, '总待在别人那里');
  // §1-6 第 35–39 天（d35 之后），希望 ≥ 50，最近 3 天没有「承诺带他走」
  if (y >= 35 && y <= 39 && s.done.includes('d35_outside') && s.v.hope >= 50 && !(s.c.promiseDay >= y - 2)) addResent(s, 1, '信了你却没听到准话');
}
// §1-4：每个时段结束时记一下这个时段跟谁待着
function noteSlotWho(s) {
  const withHe = heLocation(s.day, s.slot) === s.loc || s.apptNow?.who === '河';
  const other = !withHe && (s.loc === 'ta_house' || rollPresence(s).some(n => ['满', '石', '芳'].includes(n)));
  if (!s.c.slotWho || s.c.slotWho.day !== s.day) s.c.slotWho = { day: s.day, he: 0, other: 0 };
  if (withHe) s.c.slotWho.he++; else if (other) s.c.slotWho.other++;
}
// §1-2：约好了的时段过去了却没去（被固定剧情耽误的在 takeAppt 里已经拿掉，不算）
function sweepMissedAppts(s) {
  const now = s.day * 4 + s.slot;
  const missed = (s.appts || []).filter(a => a.day * 4 + a.slot < now);
  if (!missed.length) return;
  s.appts = s.appts.filter(a => !missed.includes(a));
  for (const a of missed) { memoDone(s, apptMemoId(a)); if (a.who === '河') addResent(s, 2, '约了没去'); else favAdd(s, a.who, -5); }
}
export function pickBgm() {
  const s = G.s; if (!s) return;
  let slot = 'daily';
  if (['ta_house', 'tomb'].includes(s.loc) || UNEASY_EVENTS.includes(s.curEvent)) slot = 'uneasy';
  else if (s.slot === NIGHT && ['he_room', 'room'].includes(s.loc) && (heLocation(s.day, s.slot) === s.loc || s.curEvent)) slot = 'night';
  if (s.curEvent === 'd40_question') slot = 'meta';
  if (s.phase === 'event' && G.eventBgm && G.eventBgm.ev === s.curEvent) slot = G.eventBgm.slot === 'none' ? null : G.eventBgm.slot;   // 事件自己定的 BGM（BGM 与固定小剧情 §1）
  import('./audio.js?v=1794428964').then(a => a.playBgm(slot));
}
// 立绘：河在 sprite，其他人在 sprite2；两个人同时在画面上时河往左让
// 事件 / 某一句切 BGM：daily / night / uneasy / meta / title / none（none = 渐弱到静音）
function setEventBgm(slot) {
  const s = G.s; if (!s || !slot) return;
  G.eventBgm = { ev: s.curEvent, slot };
  import('./audio.js?v=1794428964').then(a => a.playBgm(slot === 'none' ? null : slot));
}
function charSrc(who, expr) {
  if (SPRITE_DIR[who]) {
    const dir = SPRITE_DIR[who];
    let e = expr && EXPR[who][expr] ? expr : DEFAULT_EXPR[who][tierOf(G.s)];
    while (!hasAsset(`sprite/${dir}/${e}.webp`) && EXPR_FALLBACK[e]) e = EXPR_FALLBACK[e];
    return { key: `${dir}/${e}`, src: A(`sprite/${dir}/${e}.webp`), fit: SPRITE_FIT[dir]?.[e] || [600, 0.5, 280, 460], expr: e };
  }
  const n = NPC_SPRITES[who]; if (!n) return null;
  return { key: n, src: A(`sprite/${n}.webp`), fit: NPC_FIT[n] };
}
function layoutChars() {
  const R = G.R; const he = R.chars.he, other = R.chars.other;
  const place = (el, c, x) => { const b = spriteBox(c.fit, c.who, x); Object.assign(el.style, { height: b.height + 'px', left: b.left + 'px', top: b.top + 'px' }); };
  if (he && he.expr === 'pinch') Object.assign(R.sprite.style, { height: PINCH.height + 'px', left: PINCH.left + 'px', top: PINCH.top + 'px' });
  else if (he) place(R.sprite, he, other ? DUO.heX : he.expr === 'point' ? 380 : undefined);
  if (other) place(R.sprite2, other, he ? DUO.otherX : undefined);
  R.sprite.classList.toggle('on', !!he); R.sprite2.classList.toggle('on', !!other);
  updateTwitch();
}
const LEAVE_NAME = { 牠: '牠|白头发的人', 养母: '养母', 满: '满|小女孩|小孩', 衡: '衡|老人', '村民·男': '石|男人', '村民·女': '芳|女人' };
function leftScene(who, text) { const n = LEAVE_NAME[who]; return !!n && new RegExp(`(${n})[^。！？]{0,28}(走了|走开|离开|出去了|转身走|回去了|跑开|跑回)`).test(text || ''); }
function hideOther() { const R = G.R; if (!R?.chars?.other) return; R.chars.other = null; R.sprite2.dataset.key = ''; layoutChars(); }
const HE_STRONG = ['blank', 'dazed', 'alert', 'tears', 'shy'];   // 情绪很强的：不等 3 句，立刻换
function setSprite(who, expr) {
  const R = G.R;
  R.chars ||= { he: null, other: null };
  if (!who) { R.chars = { he: null, other: null }; R.curSprite = null; layoutChars(); return; }
  const c = charSrc(who, expr); if (!c) return;
  c.who = who;
  if (who === '河') { if (R.sprite.dataset.key !== c.key) { R.sprite.src = c.src; R.sprite.dataset.key = c.key; } R.chars.he = c; R.curSprite = c.src; }
  else { if (who === '牠' && c.expr === 'mad' && R.chars.other?.expr !== 'mad' && Math.random() < 0.6) glitchSoon('牠', 250);   // 一部分发疯：牠刚换到发疯那张时闪一下
    if (R.sprite2.dataset.key !== c.key) { R.sprite2.style.visibility = 'hidden'; R.sprite2.onload = () => { R.sprite2.style.visibility = ''; }; R.sprite2.src = c.src; R.sprite2.dataset.key = c.key; } R.chars.other = c; }   // 新图加载好再显示，不闪上一个人
  layoutChars();
}
// 抽动：失焦 / 失神 / 牠发疯一定有；疯子档时河其他立绘偶尔抽（「减少画面晃动」打开时关掉）
function updateTwitch() {}   // 旧的持续抖动已去掉；花屏只在发疯 / meta 的那一刻由 glitchSoon 触发
// 等立绘换好再花屏一下（新图要先加载）
export function glitchSoon(who = '河', delay = 120) { setTimeout(() => { const R = G.R; if (!R) return; glitchOnce(who === '河' ? R.sprite : R.sprite2); }, delay); }
// 抽动：复古电视信号不良（Cora 11/10：雪花噪点、忽明忽暗变透明、横线撕裂、画面卡顿跳帧）。只作用在立绘上，不动背景和对话框
// 一次持续约 0.2–0.45 秒，中间换 5–9 帧：每帧随机撕裂横线、闪烁透明度、偶尔整张上下跳；有的帧定住不动（卡顿）；盖一层按立绘轮廓遮住的雪花
// strong 约 2–4 秒一次，light 约 6–10 秒一次
const noiseCanvas = (() => { let c = null; return (w, hgt) => { c ||= document.createElement('canvas'); c.width = w; c.height = hgt;
  const ctx = c.getContext('2d'), img = ctx.createImageData(w, hgt), d = img.data;
  for (let k = 0; k < d.length; k += 4) { const v = Math.random() * 255; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; }   // 灰度雪花，透明度由外层控制
  ctx.putImageData(img, 0, 0); return c.toDataURL(); }; })();
export function glitchOnce(el = G.R?.sprite2?.classList.contains('on') ? G.R.sprite2 : G.R?.sprite, opts = {}) {
  if (!el || !el.classList.contains('on') || !el.parentElement || el._glitching) return;
  if (getSettings().reduceMotion && !opts.force) return;   // 「减少画面晃动」打开时不花屏（调试按钮除外）
  el._glitching = true;
  const parent = el.parentElement, box = { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
  const wrap = h('div', { style: { position: 'absolute', left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px', zIndex: 2, pointerEvents: 'none' } });
  const BANDS = 12 + Math.floor(Math.random() * 5), edges = [0, ...[...Array(BANDS - 1)].map(() => Math.random() * 100).sort((a, b) => a - b), 100];   // 粗细不一的横条
  const slices = edges.slice(0, -1).map((top, k) => { const c = el.cloneNode(); c.removeAttribute('id'); c.dataset.twitch = '';
    Object.assign(c.style, { left: 0, top: 0, width: '100%', height: '100%', animation: 'none', transition: 'none', opacity: 1, clipPath: `inset(${top}% 0 ${100 - edges[k + 1]}% 0)` }); wrap.append(c); return c; });
  const snow = h('div', { style: { position: 'absolute', inset: 0, imageRendering: 'pixelated', backgroundSize: '100% 100%',
    WebkitMaskImage: `url("${el.src}")`, maskImage: `url("${el.src}")`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' } });
  const lines = h('div', { style: { position: 'absolute', inset: 0, background: 'repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0 1px, transparent 1px 3px)',
    WebkitMaskImage: `url("${el.src}")`, maskImage: `url("${el.src}")`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' } });
  wrap.append(snow, lines); parent.append(wrap);
  const prevOpacity = el.style.opacity; el.style.opacity = 0;   // 原图先藏起来，由切片顶上
  const frames = opts.frames || 6 + Math.floor(Math.random() * 6), nw = Math.max(40, Math.round(box.width / 6)), nh = Math.max(60, Math.round(box.height / 6));
  let f = 0;
  const step = () => {
    if (f >= frames) { wrap.remove(); el.style.opacity = prevOpacity; el._glitching = false; return; }
    const hold = f > 0 && Math.random() < 0.3;   // 卡顿：这一帧不动
    if (!hold) {
      const heavy = Math.random() < 0.35;
      for (const s of slices) s.style.translate = `${Math.random() < (heavy ? 0.55 : 0.25) ? (Math.random() * 2 - 1) * (heavy ? 45 : 16) : 0}px 0`;   // 横线撕裂
      wrap.style.translate = `0 ${Math.random() < 0.2 ? (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 10) : 0}px`;   // 偶尔整张上下跳
      wrap.style.opacity = String(Math.random() < 0.3 ? 0.25 + Math.random() * 0.35 : 0.75 + Math.random() * 0.25);   // 忽明忽暗、变透明
      wrap.style.filter = Math.random() < 0.3 ? 'brightness(1.5) contrast(1.3)' : Math.random() < 0.3 ? 'grayscale(1) brightness(.85)' : '';
      snow.style.backgroundImage = `url(${noiseCanvas(nw, nh)})`; snow.style.opacity = String(Math.random() < 0.25 ? 0.75 : 0.3 + Math.random() * 0.3);   // 雪花（偶尔一帧几乎全是雪花）
      lines.style.opacity = String(0.5 + Math.random() * 0.5);
    }
    f++; setTimeout(step, 25 + Math.random() * 20);   // 一帧 25–45 毫秒：抖得急，不像掉帧
  };
  step();
}
// 花屏不再循环触发（Cora 11/10：只在一部分发疯和 meta 的时候闪一下），见 glitchSoon 的调用处
function showCG(id) {
  const R = G.R;
  R.portrait.classList.toggle('under-cg', !!id);
  if (!id) { R.cg.classList.remove('on'); return; }
  R.cg.src = A(`cg/${id}.webp`); R.cg.classList.add('on'); unlock('cgs', id);
}
// 左下角的 user 立绘：换装扮、假死时更新（各装扮本来就不完全一致，不做对齐）
export function refreshPortrait() {
  const R = G.R, s = G.s; if (!R || !s) return;
  const key = s.outfit + (G.feign ? ':feign' : '');
  if (R.portraitKey === key) return;
  R.portraitKey = key;
  R.portrait.replaceChildren(userFigure(s.outfit, !!G.feign));
  R.portrait.classList.toggle('feign', !!G.feign);
}

// 用户立绘（假死脸盖在当前装扮上）
// 五套装扮的原图里脸大小、高低不一样（眼镜那张脸大约大 1.14 倍）：以脸为中心缩放，对齐到「初始」的脸
export function outfitNorm(outfit) {
  const [fx, fy, k = 1] = (OUTFITS[outfit] || OUTFITS.initial).face; const refY = OUTFITS.initial.face[1];
  return { transform: `translateX(${-fx * 100}%) translateY(${(refY - fy) * 100}%) scale(${1 / k})`, transformOrigin: `${fx * 100}% ${fy * 100}%` };
}
// 数值页（Cora 11/10）：「同化」那颗眼球正好压在女主的右眼上。立绘按右眼摆：右眼瞳孔中心放到 STATS_EYE5，那里也是第五颗眼球的中心（红线在这一段很平，正好穿过）
export function statsNorm(outfit) {
  const o = OUTFITS[outfit] || OUTFITS.initial; const [, , k = 1] = o.face; const [ex, ey] = o.eyeR || [0.4, 0.25];
  const H = 900, TOP = 35;
  return { left: STATS_EYE5.x + 'px', transform: `translateX(${-ex * 100}%) translateY(${STATS_EYE5.y - TOP - ey * H}px) scale(${1 / k})`, transformOrigin: `${ex * 100}% ${ey * 100}%` };
}
export function userFigure(outfit, feign) {
  const o = OUTFITS[outfit] || OUTFITS.initial;
  const fig = h('div', { class: 'user-fig', style: outfitNorm(outfit) });
  const img = h('img', { src: A(`sprite/user/${outfit}.webp`), alt: '' });
  fig.append(img);
  if (feign) {
    const face = h('img', { class: 'face', src: A('sprite/user/feign_face.webp'), alt: '' });
    // 用百分比定位：不管立绘最后显示多大，脸都贴在同一个位置
    const place = () => {
      const W = img.naturalWidth, H = img.naturalHeight; if (!W) return;
      const [fx, fy, k = 1] = o.face; const s = H / 1000;   // 立绘按 1000 高量的
      const pw = FEIGN_PATCH[0] * k * s / W, ph = FEIGN_PATCH[1] * k * s / H;
      face.style.width = pw * 100 + '%';
      face.style.left = (fx - pw / 2) * 100 + '%';
      face.style.top = (fy - ph / 2) * 100 + '%';
    };
    if (img.complete) place(); else img.addEventListener('load', place);
    fig.append(face);
  }
  return fig;
}

// ———————————————————— 其他 meta（代码判定，固定台词）————————————————————
G.metaQueue = [];
export async function metaLine(id, force = false) {
  const s = G.s, R = G.R; if (!s || !R || !$('#scr-main.active')) return false;
  if (!force && !canExtraMeta(s, id)) return false;
  if (s.phase === 'event' && !force) return false;   // 固定事件进行中不插 meta
  if (s.phase === 'map' && !force) return false;     // 选地点时不插（测试报告 · 6：系统句挂上河的名牌）
  if (G.busy || G.inTurn || G.waitClick) { if (!G.metaQueue.includes(id)) G.metaQueue.push(id); return true; }
  markExtraMeta(s, id);
  const m = EXTRA_META[id];
  import('./audio.js?v=1794428964').then(a => a.stutter()).catch(() => {});
  if (m.faint) {   // 一行很淡的字，2 秒后消失
    const f = h('div', { class: 'faint-line' }, m.faint); R.dialog.append(f); setTimeout(() => f.remove(), 2200); return true;
  }
  if (m.silent) { const keep = R.text.textContent; setSprite('河', m.expr); R.name.classList.add('hidden'); R.text.textContent = ''; await sleep(2000); R.text.textContent = keep; return true; }
  const keepActions = !R.actions.classList.contains('hidden');
  renderActions('none');
  await playLines([{ speaker: '河', expr: m.expr, text: m.text, glitch: true }]);
  s.meta.saidMeta = m.text; saveRun(s);
  if (keepActions) renderActions('free');
  return true;
}
async function flushMeta() { while (G.metaQueue.length && !G.busy) { const id = G.metaQueue.shift(); await metaLine(id, true); } }
addEventListener('gucun:garble-copied', () => { const s = G.s; if (s && !s.meta.copySeen) { s.meta.copySeen = true; G.metaQueue.push('copied'); } });
// 对话中鼠标移出游戏窗口超过 10 秒
let leaveTimer = null;
document.documentElement.addEventListener('mouseleave', () => { clearTimeout(leaveTimer); leaveTimer = setTimeout(() => { if (G.R && !$('#overlays').children.length) metaLine('leave'); }, 10000); });
document.documentElement.addEventListener('mouseenter', () => clearTimeout(leaveTimer));

// ———————————————————— 对话播放 ————————————————————
function makeQueue() {
  const q = []; let waiter = null, closed = false;
  return {
    push(x) { q.push(x); if (waiter) { waiter(); waiter = null; } },
    close() { closed = true; if (waiter) { waiter(); waiter = null; } },
    async next() { while (!q.length) { if (closed) return null; await new Promise(r => (waiter = r)); } return q.shift(); },
  };
}
// 点击推进：一句刚开始打字 / 刚等点击的 300ms 内不接受（AI 生成时多点的几下不会把下一句跳过去，测试报告 · 4）
export function advance() {
  const now = performance.now();
  if (G.typing) { if (now - (G.lineAt || 0) > 300) G.typing.finish(); return; }
  if (G.waitClick && now - (G.waitAt || 0) > 300) { const f = G.waitClick; G.waitClick = null; f(); }
}
function typeInto(el, segs) {
  const speed = G.forceAuto ? 30 : getSettings().textSpeed;
  el.replaceChildren();
  const spans = segs.map(sg => { const sp = h('span', { class: sg.g ? 'g' : '' }); el.append(sp); return [sp, sg.t]; });
  return new Promise(res => {
    let i = 0, j = 0, timer;
    const finish = () => { clearInterval(timer); for (const [sp, t] of spans) sp.textContent = t; G.typing = null; res(); };
    G.typing = { finish };
    if (speed >= 100) return finish();
    const iv = Math.max(8, 1000 / speed);
    timer = setInterval(() => {
      if (i >= spans.length) return finish();
      const [sp, t] = spans[i]; j++; sp.textContent = t.slice(0, j);
      if (j >= t.length) { i++; j = 0; }
    }, iv);
  });
}
async function showLine(line, opts = {}) {
  const R = G.R, s = G.s;
  if (line.bgm && s?.phase === 'event') setEventBgm(line.bgm);
  if (G.firstCg?.id) { G.firstCg.n++; if ((line.ai ? G.firstCg.n >= 3 : false) || /亲|吻/.test(line.text || '')) { if (hasAsset(`cg/${G.firstCg.id}.webp`)) { await preload(A(`cg/${G.firstCg.id}.webp`)); showCG(G.firstCg.id); } G.firstCg.id = null; } }   // 「第一次」的 CG   // 播到这句时换 BGM（d9 / d21 / d6）
  if (line.goto && s && LOCATIONS[line.goto]) { s.loc = line.goto; setScene(line.goto); }
  if (line.hideHe && G.R.chars?.he) { G.R.chars.he = null; G.R.sprite.dataset.key = ''; layoutChars(); }   // 河走开了（第 15 天：他转身回屋，养母在井边）   // 固定台词中途换地方（满不见了：院子 → 溪岸）
  if (line.show) for (const [who, ex] of Object.entries(line.show)) setSprite(who, ex);
  // 人走了，立绘就撤掉（Cora 11/10：第 1 天牠「转身走了」、第 2 天养母留在认路的画面里）：固定台词用 hide；AI 的旁白写到这个人走了也撤
  const other = G.R.chars?.other;
  if (other && (line.hide === true || line.hide === other.who || (line.speaker === 'narration' && leftScene(other.who, line.text)))) hideOther();
  if (line.glitch || line.bgm === 'meta' || (line.meta && line.speaker === '河')) glitchSoon(line.speaker === 'narration' && G.R.chars?.other && !G.R.chars?.he ? 'other' : '河', 200);   // meta 的那一刻闪一下   // 旁白行也能指定换谁的立绘（牠的舔线 / 发疯 / 哭，牠的舌头与发疯小剧情 §〇）
  if (line.hideCg) showCG(null);
  if (line.cg && hasAsset(`cg/${line.cg}.webp`)) { await preload(A(`cg/${line.cg}.webp`)); showCG(line.cg); if (G.s) { G.s.c.eventCgDay = G.s.day; G.s.c.eventCgAt = G.s.day * 4 + G.s.slot; } }   // 事件里中途换 CG
  const narr = line.speaker === 'narration';
  R.name.classList.toggle('hidden', narr);
  const vn = VILLAGERS[line.speaker];   // 村民名字固定：AI 写的小名（小芳）保留，别的名字一律换回名单里的
  const shown = line.speaker === '村民·男' && line.name === '禾' ? '禾' : line.speaker.startsWith('村民') ? (!knows(G.s, line.speaker) ? '村民' : vn ? (line.name && line.name.replace(/^小/, '') === vn ? line.name : vn) : (line.name || '村民')) : !knows(G.s, line.speaker) ? '？？？' : line.speaker;
  R.name.textContent = narr ? '' : shown;
  if (line.know && G.s) { if (!G.s.f[line.know]) favAdd(G.s, { know_man: '满', know_mother: '养母', know_heng: '衡' }[line.know], 5); G.s.f[line.know] = true; }   // 第一次见面 +5   // 自我介绍这一句还显示 ？？？，之后才有名字
  R.text.classList.toggle('narr', narr);
  // 牠的舌头（测试记录 16 §1，Cora 定）：只有真的舔线头才换舔线那张；别的时候写到舌头、舔，牠正在发疯 / 哭就保持，不然用发疯
  const LICK = /舔.{0,6}线/, TONGUE = /舌|舔/;   // 测试记录 19 §3：只写「线头」不算，要写到「舔」
  const curTa = G.R.chars?.other?.who === '牠' ? G.R.chars.other.expr : null;
  const madScene = /^o\d_/.test(s?.curEvent || '') || s?.curEvent === 'd25_ta_mad';   // 牠不正常的池子 / d25 发疯
  const tongueExpr = t => LICK.test(t) ? 'lick' : /咧|疯|撕/.test(t) ? 'mad' : TONGUE.test(t) ? (madScene ? (['mad', 'cry'].includes(curTa) ? curTa : 'mad') : curTa || null) : null;   // 测试记录 18 §5：亲密戏等别的场合写到舌头，保持现在这张
  if (line.speaker === '牠' && tongueExpr(line.text)) line = { ...line, expr: tongueExpr(line.text) };
  // 河的立绘少换（立绘频率与抽动 1110 §1）：AI 写的台词，表情和现在这张不一样时，同一张至少停 3 句；强情绪的立刻换；固定台词照写明的换
  if (line.speaker === '河' && line.ai && G.R.chars?.he && line.expr && line.expr !== G.R.chars.he.expr && !HE_STRONG.includes(line.expr) && (G.heHold || 0) < 3) line = { ...line, expr: G.R.chars.he.expr };
  G.heHold = (G.heHold || 0) + 1;
  if (!opts.keepSprite && !(line.speaker === '村民·男' && line.name === '禾') && (SPRITE_DIR[line.speaker] || NPC_SPRITES[line.speaker])) { const before = G.R.chars?.he?.expr; setSprite(line.speaker, line.expr); if (line.speaker === '河' && G.R.chars?.he?.expr !== before) G.heHold = 0; }
  else if (line.speaker === 'narration' && !opts.keepSprite && !line.show?.['牠'] && !leftScene('牠', line.text)) {   // 写的是牠走了：不要又把牠放回来   // 固定剧情指定了换哪张（show），就不自动换
    // AI 多半只用旁白写牠（不给牠台词）：旁白写到牠在做事，就把牠的立绘放上来，按内容选表情
    const t = line.text, onStage = G.R.chars?.other?.who === '牠';
    const acting = /(牠|白头发的人)(没|又|就|才|也|只)?(坐|站|抬|转|把|拿|捏|写|推|舔|看|低|伸|笑|停|咬|缝|吐|张|垂|递|收|拨|扯|盯|走|蹲|靠|按)/.test(t);
    if (acting || (onStage && /牠|白头发的人/.test(t))) {
      const e = tongueExpr(t) || (/咧|疯|撕|尖叫|抓狂/.test(t) ? 'mad' : /脸红|红了|躲开视线/.test(t) ? 'shy' : /字条|写/.test(t) ? 'note' : onStage ? G.R.chars.other.expr : 'note');
      if (!onStage || (e !== G.R.chars.other.expr && ['mad', 'cry', 'lick'].includes(e))) setSprite('牠', e);   // 已经在台上：只为发疯 / 哭 / 真舔线换（§1）
    }
  }
  // 牠的称呼：名字揭晓前旁白统一叫「白头发的人」，揭晓后统一叫「牠」
  if (line.speaker === 'narration' && G.s) {
    const known = knows(G.s, '牠'); let t = line.text;
    t = known ? t.replace(/白头发的人|白发(的)?(男子|男人|人)/g, '牠') : t.replace(/白发(的)?(男子|男人|人)|白头发的(男子|男人)/g, '白头发的人').replace(/牠/g, '白头发的人');
    line = { ...line, text: t };
  }
  // 旁白写到某人走了：那人的立绘撤下（测试报告：白发人「顺着溪岸走了」后立绘还在）
  if (narr && !opts.keepSprite) {
    const o = R.chars?.other;
    const oName = o && (o.who === '牠' ? '牠|白头发的人' : o.who === '村民·男' ? '石|那个男人' : o.who === '村民·女' ? '芳|那个女人' : o.who);
    if (o && new RegExp(`(${oName})[^。！？]{0,10}(走了|走远|离开|出去了|转身走|下山|往回走|不见了)`).test(line.text)) { R.chars.other = null; layoutChars(); }
    // 河在这里、旁白写到他，但他还没开口：先把他的立绘放上来（测试报告：男主常常不在画面上）
    if (opts.heHere && !R.chars?.he && /河/.test(line.text)) setSprite('河');
  }
  const segs = splitGarble(line.text, opts.allowGarble);
  s.log.push({ who: narr ? '' : shown, t: segs.map(x => x.t).join(''), d: s.day });
  if (s.log.length > 800) s.log.splice(0, s.log.length - 800);
  R.next.classList.add('hidden');
  G.lineAt = performance.now();
  await typeInto(R.text, segs);
  // 乱码句：前两次在对话框中间隐约浮出一句提示，让玩家想到去复制（复制出来才是真话）
  if (segs.some(x => x.g) && (s.c.garbleHint || 0) < 2 && !s.meta.copySeen) {
    s.c.garbleHint = (s.c.garbleHint || 0) + 1;
    const f = h('div', { class: 'garble-hint' }, '……这句话，好像能复制下来看看。'); R.dialog.append(f); setTimeout(() => f.remove(), 4200);
  }
}
function waitAdvance(textLen = 20) {
  G.R.next.classList.remove('hidden');
  return new Promise(res => {
    G.waitClick = res; G.waitAt = performance.now();
    if (G.auto || G.forceAuto) setTimeout(() => { if (G.waitClick === res) { G.waitClick = null; res(); } }, (getSettings().autoDelay + textLen * 0.04) * 1000);
  });
}
// 播放一组固定台词，最后一句也要点一下
export async function playLines(lines, opts = {}) {
  // 固定台词播放时行动按钮一律收起（数值与怨恨 §4：小剧情 / 说服养母的固定台词播着的时候能点行动，点了会把事件打断、phase 卡在 event）
  const was = G.busy; if (!was) setBusy(true);
  try { for (const l of lines) { await showLine(l, opts); await waitAdvance(l.text.length); } }
  finally { if (!was) setBusy(false); }
  G.R.next.classList.add('hidden');
}
// 播放队列（流式），最后一句不等点击
// 读档卡住（第二轮真人试玩 1111 §1）：读档时 G.gen +1，旧的流程（还在打字、还在等 AI、还在 sleep）醒来发现不是自己这一代了就永远停住，
// 不再抢新流程的 waitClick、不再往画面上写字
const NEVER = () => new Promise(() => {});
export const stale = gen => gen !== G.gen;
async function playQueue(q, opts) {
  let prev = null; const gen = G.gen;
  for (;;) {
    const l = await q.next();
    if (stale(gen)) return NEVER();
    if (!l) break;
    if (prev) await waitAdvance(prev.text.length);
    if (stale(gen)) return NEVER();
    await showLine(l, opts); prev = l;
    if (stale(gen)) return NEVER();
  }
  G.R.next.classList.add('hidden');
}
function loadingText() { G.R.name.classList.add('hidden'); G.R.text.className = 'text narr'; G.R.text.replaceChildren(h('span', { class: 'loading-dots' })); }

// ———————————————————— 行动面板 ————————————————————
let choiceResolver = null;
export function renderActions(mode = 'free', choices = null) {
  const R = G.R, s = G.s;
  R.actions.classList.toggle('hidden', mode === 'none');
  R.actions.classList.toggle('choosing', mode === 'choice');
  R.actions.classList.toggle('over-cg', mode === 'choice' && R.cg.classList.contains('on'));   // CG 上的选项放到下方中间，不盖住脸
  R.free.classList.toggle('hidden', mode !== 'free');
  R.row.classList.toggle('hidden', mode !== 'free');
  if (mode === 'choice') {
    R.actHead.textContent = '选一个';
    R.actList.replaceChildren(...choices.map((c, i) => h('button', { class: 'btn', disabled: !!c.disabled, onclick: () => { if (c.disabled) return; const r = choiceResolver; choiceResolver = null; r && r(i); } }, c.text)));
    return;
  }
  if (mode !== 'free') return;
  if (s.ap <= 0 && s.phase === 'free' && !G.busy) { setTimeout(() => { if (G.s === s && s.ap <= 0 && s.phase === 'free' && !G.busy) endSlot(); }, 0); return; }   // 停在 0 点的界面：自动进下一个时段
  const L = LOCATIONS[s.loc];
  R.actHead.textContent = taText(s, `在${L.name}能做的事`);
  const loc = locationActions(s);
  const hasJob = loc.some(a => a.work);
  const ai = (s.lastSugg || []).filter(x => !(hasJob && /干完这一段|干活|干完活/.test(x.text))).map(x => ({ ...x, kind: 'ai' }));   // 有「干活」时去掉 AI 写的同类建议
  const list = [...loc.filter(a => a.first), ...ai, ...loc.filter(a => !a.first)].map(a => ({ ...a, text: taText(s, a.text) }));
  R.actList.replaceChildren(...list.map(a => h('button', { class: 'btn', 'data-over': (a.cost || 0) > s.ap ? '1' : null, title: (a.cost || 0) > s.ap ? '这个时段剩下的行动点不够了' : null, onclick: () => doAction(a) }, h('span', {}, a.text), h('span', { class: 'cost' }, a.cost ? a.cost + ' 点' : '不花'))));
  setBusy(G.busy);
}
export function setBusy(b) {
  G.busy = b; const R = G.R; if (!R) return;
  R.actions.classList.toggle('busy', !!b);   // 生成 / 播放中整块收起：不再出现「看着能点、其实点不了」（测试报告 · 1）
  for (const el of R.actions.querySelectorAll('button,input')) el.disabled = b || el.dataset.over === '1';
  R.regenBtn.disabled = b || !G.last;
  R.regenBtn.style.opacity = b || !G.last ? .35 : 1;
}
function choose(choices) { renderActions('choice', choices); return new Promise(r => (choiceResolver = r)); }

function locationActions(s) {
  const out = [];
  const add = (text, cost, fn) => out.push({ text, cost, kind: 'local', fn });
  // 小游戏完成后消失（人肉 v3 · 10）：数花瓣没找到一天一次，找到了就拿掉；第 14 天或满在的时候，满会拉你再找一次
  // 找错的花：主线（主线 1109 §0、§4），每天能找一次；满在的时候是和她一起找
  // Cora 11/10：玩完就消失——找到过一次，自己就不再有「数花瓣」；只有满在的时候，她拉你一起找（一天一次）
  if (s.loc === 'peach' && s.c.flowerDay !== s.day) {
    const man = s.f.man_met && rollPresence(s).includes('满');
    if (man) add('和满一起找错的花', 1, () => miniAction('flower'));
    else if (!s.f.flower_found) add('数花瓣', 1, () => miniAction('flower'));
  }
  if (s.loc === 'ta_house') { out.push({ text: '看牠缝东西', cost: 1, kind: 'ai' }); add('看牠写字', 1, () => miniAction('note')); }
  if (s.loc === 'he_room') {
    if (!s.f.puzzle_he) { if (s.c.albumDay !== s.day) add('翻旧相册', 1, () => miniAction('puzzle_he')); }   // 没拼完：一天一次
    else add('看那张照片', 1, () => lookPhoto());   // 拼完：不再是小游戏
    if (organsOpen()) add('翻他的画本', 0, () => P.openOrganShelf());
    if (organsOpen() || s.done.includes('d12_drawings')) add('和他一起看画', 1, () => drawingPuzzle());
  }
  if (s.loc === 'tomb' && !s.f.puzzle_ta_young && s.c.tombPhotoDay !== s.day) add('墓碑前的旧照片', 1, () => miniAction('puzzle_ta'));   // 拼好了就不再出现；没拼好一天一次
  // 说服养母（借鉴机制与结局 §4，Suck Up!）：第 12–33 天、养母家、养母在场；一局最多问 3 次，成功一次就不再出现。点了以后用自由输入问
  if (s.loc === 'yard' && s.day >= 12 && s.day <= 33 && !s.done.includes('persuaded_mother') && (s.c.persuadeTries || 0) < 3 && rollPresence(s).includes('养母'))
    add('问养母小河小时候的事', 1, () => { G.persuade = true; G.R.input.placeholder = '你想怎么问？'; G.R.input.focus(); });
  const job = jobOn(s) && JOBS[s.f.job];
  if (job && job.loc === s.loc && job.slots.includes(s.slot) && s.c.workDay !== s.day) out.unshift({ text: '干活', cost: 2, kind: 'ai', work: true, note: job.note, first: true });
  if (s.loc === 'border' && s.day >= 30) add('往雾里走', 2, () => leaveVillage());   // 一整个时段（往雾里走点数 1111：原来 3 点，每段只有 2 点，永远点不了）
  if (s.loc === 'room' || s.loc === 'yard') add('换衣服', 0, () => P.openOutfit(false));
  return out;
}

// ———————————————————— AI 一轮 ————————————————————
function ctxFor(s, kind, ev, req = {}) {
  const appt = s.apptNow;
  const ae = !ev && s.afterEvent && s.afterEvent.day === s.day && s.afterEvent.slot === s.slot && s.afterEvent.loc === s.loc ? s.afterEvent : null;   // 刚演完固定事件的接话
  const heAway = !ev && !ae?.heHere && heLocation(s.day, s.slot) == null && appt?.who !== '河';
  let present = ev ? undefined : ae ? [...ae.who] : [...rollPresence(s)];   // 固定事件里谁在场由事件本身决定
  if (appt && !appt.flaked && appt.who !== '河' && appt.who !== '牠' && !ev && !present.includes(appt.who)) present = [...present.filter(n => n === '养母'), appt.who];   // 约好的人一定在
  const callNote = !ev && req.free && req.text ? callPresence(s, req.text, present) : null;
  const leftNote = ae?.left ? `${ae.left}已经走了。${ae.left === '满' || ae.left === '养母' || ae.left === '芳' ? '她' : '他'}只停一下、回一句，不回来，不坐下，不长谈。` : null;
  const heHere = ae ? ae.heHere : ev?.heHere ?? (heLocation(s.day, s.slot) === s.loc || !!ev || appt?.who === '河');   // 事件可以用 heHere: false 说明河不在场
  const allowMeta = ev?.forceMeta ? true : kind === 'event' || kind === 'choice' ? false : rollMeta(s);
  const allowGarble = madTier(s.madness) === 'mad' || s.meta.feignTurns > 0;
  const extra = (s.c.warmStreak || 0) >= 2 ? [WARM_STREAK.scaredNote] : [];
  if (ae) extra.push(`刚才那一场刚结束，人还在。最后几句是：${ae.last}。玩家这一下是在接刚才的话。如果有人最后走开了，玩家可以喊住他或追上去：他会停一下、回一句，但不会回来长谈。写完就收住。`);
  if (s.f.he_first_day === s.day) extra.push(HE_FIRST_AFTER);
  if (heHere && (s.c.clingy || 0) >= 6) extra.push('「你」这一阵子一直跟着他，他走到哪你就在哪。他有点不自在：会找个理由走开一会儿，或者话更少，但不说破。'); 
  if (heHere && s.day === 32 && s.done.includes('d32_thread') && !ev) extra.push(s.f.thread_picked ? '「你」早上用针把手腕内侧的一截红线头挑掉了，留下一个新的针眼。河看见会愣一下，问一句「谁让你挑的」，然后不说话，拿药给你按上。' : '「你」手腕内侧有一截红线头（「你」可能用袖子藏着）。河看见会愣一下，不解释，只问一句「疼吗」。');
  if (appt?.flaked && !ev) extra.push(`约好的${appt.who}没来：她被家里叫回去了。可以由旁白或路过的人交代一句。`);
  else if (appt && !ev) extra.push(`之前约好的：${appt.who}和「你」约在第 ${appt.day} 天${SLOTS[appt.slot]}的${appt.place}。${appt.who}已经在这里等你了，接着这个约定演。约好的见面要有内容：${appt.who}准备了一件事要做或一句话要说（带「你」看个地方、给一样东西、问一件事），不要只是走一段就天黑散了。`);
  const missed = s.apptMissed;
  if (missed && !ev && (missed.who === '河' ? heHere : present.includes(missed.who))) { s.apptMissed = null; extra.push(`上次${missed.who}和「你」约在${missed.place}，「你」没去。${missed.who}见到你会有一点反应（不用大闹，一句就好）。`); }
  const todayPhone = (s.phone || []).filter(m => m.day === s.day && m.text);
  if (heHere && todayPhone.length && s.f.phoneMet !== s.day) {
    s.f.phoneMet = s.day;
    extra.push(`今天你们用手机聊过：${todayPhone.slice(-4).map(m => (m.from === 'me' ? '「你」说「' : '他回「') + m.text + '」').join('，')}。见面时他可以接一句（不用逐字重提，也可以不提）。`);
  }
  if (s.c.pingDay === s.day - 1 && !s.f.pingAnswered) extra.push('他昨晚给「你」发的消息，你没回。今天他有点别扭，话更少，也不提这件事。');
  const rules = kind !== 'event' && kind !== 'choice' && !goreAllowed(s) ? [GORE_HOLD] : [];
  // 石、芳第一次出场：先自我介绍（人肉测试 v2 · C3），之后名牌才显示名字
  if (callNote) extra.push(callNote);
  if (req.work && s.f.job === 'fields' && present && !present.some(n => n === '石' || n === '芳')) present.push(Math.random() < 0.5 ? '石' : '芳');   // 晒场干活总能碰到村民
  if (present?.includes('石') && !s.f.know_shi && kind !== 'event' && kind !== 'choice') { rules.push('这是石第一次见「你」：开头代码已经替他说了自我介绍「石。……后坡老郭家的。编筐的。」，不要再写这句，从他接下来的样子和反应写起（speaker 写 "村民·男"，name 写 "石"）'); }
  if (present?.includes('芳') && !s.f.know_fang && kind !== 'event' && kind !== 'choice') { rules.push('这是芳第一次和「你」说话：开头代码已经替她说了自我介绍「芳。叫我小芳也行，都这么叫。……剖鱼的。」，不要再写这句，从她接下来的样子和反应写起（speaker 写 "村民·女"，name 写 "芳"）'); }
  if (kind !== 'event' && kind !== 'choice' && !organsOpen()) rules.push(DRAWINGS_HIDDEN);
  if (!s.f.man_met && kind !== 'event' && kind !== 'choice') rules.push('满还没出场（她第一次出现是第 8 天以后在桃花林）：这之前不要写任何小孩、小女孩出现。');
  for (const n of present || []) { const did = s.c.npcDid?.[n]; if (did?.length) rules.push(`${n}最近几次在做的事：${did.join('；')}。这次换一件别的事。`); }   // 测试记录 20 §4：同一个人别老做同一件事
  if (ev?.id === 'd1_meet' && s.f.egg_village) rules.push('「你」穿着村里的蓝布褂子，河和白头发的人刚才都注意到了。之后谁都不解释这件衣服，玩家问起就岔开。');   // 彩蛋 §9：防止 AI 给这件衣服编来历   // 第 12 天拼图之前
  if (s.c.taAfterDay === s.day && kind !== 'event' && kind !== 'choice') rules.push(TA_AFTER_RULE);
  // 红线头伏笔（1111）：第 32 天以后「你」在河身边，偶尔（约 15%）允许写一次他手腕内侧那个很淡的红点；AI 写过两次就不再给
  if (heHere && !ev && kind !== 'event' && kind !== 'choice' && s.done.includes('d32_thread') && (s.c.heDotWritten || 0) < 2 && Math.random() < 0.15)
    rules.push('这一段如果「你」离河很近（递东西、拉手、他低头做针线），可以顺带写一句旁白：他手腕内侧有一个很淡的红点。只写看见，不解释，谁也不提它是什么。不合适就不写。');
  if (s.fixNote) rules.push(s.fixNote);   // 上一轮删得多：提醒一次写错了什么（设定锁 §3）
  // 他欠着的一句：躲开之后的第 1–3 天，当面碰到就自己提起来（一天最多一条）；第 22–24 天他躲着你，只走手机
  // 欠着的话（测试记录 17 §1）：到达那一轮不给（AI 忙着写场景）；AI 没写就留着，同一个时段最多给两次
  const oweTried = s.c.oweTry && s.c.oweTry.at === s.day * 4 + s.slot ? s.c.oweTry.n : 0;
  const owe = heHere && !ev && kind !== 'arrive' && !(s.day >= 22 && s.day <= 24) && s.c.oweDay !== s.day && oweTried < 2 ? dueOwe(s) : null;
  const inject = collectInjections(s, extra);
  if (leftNote) rules.push(leftNote);
  const ar = s.c.afterRule; if (ar && ar.day === s.day && ar.slot === s.slot && ar.loc === s.loc) rules.push(ar.text);   // 小剧情演完之后这个时段给 AI 的一句（牠不正常之后 / R2 那张纸）
  // 被牠伤到以后第一次和河当面（测试记录 16 §4）：代码先播一两句固定台词，再交给 AI；这一整个时段都带着规则
  const th = s.f.ta_hurt, nowAt = s.day * 4 + s.slot;
  let hurtLines = null;
  if (th && heHere && kind !== 'event' && kind !== 'choice' && (th.seenAt == null || th.seenAt === nowAt)) {
    if (th.seenAt == null && !th.seen) hurtLines = th.lines || null;
    if (!(hurtLines && kind === 'arrive')) rules.push(th.he);   // 到达那一轮先不说，固定句之后那一轮再带
    if (th.seenAt === nowAt && th.lines?.length) { const asked = [...th.lines].reverse().find(l => l.speaker === '河')?.text || ''; rules.push(`他已经问过「${asked.replace(/[「」]/g, '')}」，不要再问。「你」不答，他自己往牠屋子的方向看一眼，不再说话，拿药给你按上。`); }   // 测试记录 19 §4
  }
  if (req.persuade) rules.push(PERSUADE_RULE);
  if (hideDay(s) && !ev) rules.push(HIDE_RULE);
  if (req.combRule) rules.push(req.combRule);
  if (heHere && s.c.hairDown === s.day) rules.push('河今天头发散着，布条在「你」那里。');
  if (s.f.saw_ta_face && s.loc === 'ta_house' && !ev) rules.push('「你」见过牠的脸（梳头那次，牠让你别告诉他）。谁都不提这件事；牠的脸平时照旧被头发遮着，不写像河。');
  if (heHere && !ev && req.text && GO_ASK.test(req.text)) rules.push(goAskRule(s));   // 问他想不想出去
  if (heHere && !ev && kind === 'action' && req.text) { const gr = grindRule(s, req.text); if (gr) rules.push(gr); }   // 刷数值：他察觉
  const npcB = !ev && kind !== 'event' && kind !== 'choice' ? npcBlock(s, present) : '';   // NPC 隐藏好感三档 1111
  if (!ev && kind === 'arrive') { const kr = villageKnowRule(s, present, heHere); if (kr) rules.push(kr); }   // 村里人也知道（知情表）
  return { npcBlock: npcB, hurtLines, format: leftNote ? { lines: '1–3' } : undefined, owe: owe?.text, oweRef: owe, heHere, heAway, heLocName: LOCATIONS[heLocation(s.day, s.slot)]?.name, present, allowMeta, allowGarble, inject, rules, outfitName: OUTFITS[s.outfit]?.name + '（' + OUTFITS[s.outfit]?.note + '）' };
}
function userMsg(s, req) {
  const L = LOCATIONS[s.loc];
  switch (req.kind) {
    case 'arrive': {
      if (req.afterMini) return `【接着刚才】刚才那一段刚演完，「你」还在${L.name}。接着写 1–3 条：在场的人现在在做什么。不写进门、脚步声、屋里的摆设，也不让人说「来了」「坐」。必须给 suggestions。`;   // 测试记录 18 §1
      const from = s.prevLoc && s.prevLoc !== s.loc ? LOCATIONS[s.prevLoc]?.name : null;
      return `【场景切换】上一段已经结束，时间来到第 ${s.day} 天${SLOTS[s.slot]}。` +
        (from ? `「你」刚从${from}走到${L.name}，人现在在${L.name}，已经不在${from}了。` : `「你」现在在${L.name}。`) +
        `${L.name}：${L.desc}\n不要接着写上一段。到达的景色只写 1 句（挑一个这次的新细节，不要重复之前写过的），接着写在场的人在做什么（一共 2–4 条）。旁白里的位置必须是${L.name}，不要写成别的地方。必须给出 suggestions。`;
    }
    case 'action': return `${placeLine(s)}【玩家行动】${req.free ? '（玩家自己输入的）' : ''}${req.text}${req.note ? '\n（' + req.note + '）' : ''}\n写这次行动的经过和结果。${PLAYER_FIRST}` +
      (req.free ? `\n这个时段还剩 ${req.apLeft} 点。这次扣的点数 = action_size 的点数（small 1 / medium 2 / large 3）和 action_count 里大的那个。玩家一次写了两件以上的事，只写前两件的经过，后面的没有发生。如果扣完点数就用完了：${LAST_ACTION_NOTE}` : '') +
      (ASKS.test(req.text) ? '\n' + ANSWER_RULE : '') + (req.last ? '\n' + LAST_ACTION_NOTE : '');
    case 'wake': return `【醒来】「你」从假死中醒过来，地点：${L.name}，${SLOTS[s.slot]}。写醒来那一刻（2–5 条），给出建议行动。`;
    case 'event': {
      const ev = req.event;
      return `${placeLine(s)}【主线事件】${ev.scene}\n刚才已经出现的固定台词：\n${eventLinesText(ev)}\n接着往下写 3–6 条，上面这些固定台词不要再写一遍。${ev.choices ? '写到玩家需要做选择之前停住。suggestions 给空数组。' : ''}`;
    }
    // 选项：把地点、时段和这一场的固定台词一起带上（测试报告 · 2：第 6 天溪边的选项被续写成前一晚房间里的场景）
    case 'choice': {
      const ev = req.event;
      return `${placeLine(s)}【这一场】${ev.scene ? ev.scene + '\n' : ''}这一场已经出现的固定台词：\n${eventLinesText(ev)}\n【玩家选择】${req.text}\n${req.note ? '（这个选择：' + req.note + '）\n' : ''}${ev.after || '写这个选择的结果，然后收住场景。'}\n只写玩家选的这一条的结果，别的选项没有发生。接着这一场往下写，不要接到之前别的场景（比如前一晚的房间）里去。${PLAYER_FIRST}${ASKS.test(req.text) ? '\n' + ANSWER_RULE : ''}\nsuggestions 给空数组。`;
    }
  }
}
// 每一轮都先说清楚「现在在哪、什么时候」
const SLOT_FEEL = ['上午（早饭以后，日头刚上来）', '午后（吃过午饭，日头最高）', '黄昏（太阳快落山，要做晚饭了）', '夜里（天黑了，点着灯）'];
function placeLine(s) {
  const L = LOCATIONS[s.loc];
  return `【现在】第 ${s.day} 天${SLOT_FEEL[s.slot] || SLOTS[s.slot]}，地点：${L ? L.name : s.loc}。台词和旁白里的时间感要对得上（不要在午后说「醒了」「早饭」，不要在上午说「天黑了」）。\n`;
}
function eventLinesText(ev) {
  return (ev.lines || []).filter(l => !l.text.startsWith('{NAME')).map(l => (l.speaker === 'narration' ? '' : l.speaker + '：') + l.text.replace('{FIRST_LINE}', FIRST_LINE)).join('\n') || '（无）';
}
// 玩家做的事要先写出来（测试报告：选「把辣子推到他面前」，后文没有一句写我推了）
const PLAYER_FIRST = '\n第一条先用旁白写出「你」做了这件事（玩家说的话可以用 speaker "你" 原样复述），然后再写别人的反应。别人问了「你」问题，就写到问题为止（或者他自己接下去），不要替「你」回答、不要替「你」做反应——让玩家自己回。';
// 玩家直接问了问题：要有回应（测试报告：问河的问题大多只换来他的动作）
const ASKS = /[？?]|问|是不是|为什么|怎么|什么|吗|呢/;
const ANSWER_RULE = '玩家这次问了问题。被问的人这一轮必须至少说一句话：可以不说实话、可以只答一半、可以岔开，但要用话岔开（各人的躲法见「被问的人都必须开口」），不能只用动作或沉默代替。牠可以用字条。';

/** 跑一轮 AI。返回 normTurn 结果；出错时显示重试并等待 */
export async function doTurn(req) {
  const s = G.s, gen = G.gen;
  if (G.metaQueue.includes('copied')) { G.metaQueue = G.metaQueue.filter(x => x !== 'copied'); await metaLine('copied', true); }
  const snapshot = clone(s);
  if (['arrive', 'action', 'wake'].includes(req.kind)) G.last = { req, snapshot }; else G.last = null;
  const ctx = ctxFor(s, req.kind, req.event, req);
  ctx.loreText = String(req.text || '') + (req.event ? ' ' + eventLinesText(req.event) : '');   // 设定集按话题带：玩家这次的话 + 事件台词
  if (s.fixNote) s.fixNote = null;   // 上一轮写错的提醒只带一轮（已经在 ctx.rules 里了）
  if (req.lines) ctx.format = { ...(ctx.format || {}), lines: req.lines };
  // 点 AI 给的建议：代码先播一句「你……」旁白，AI 写的「你」照旧删（后期测试修改 §4，方案 A）
  const suggLine = req.sugg ? `你${String(req.text).replace(/[。！？…]+$/, '')}。` : null;
  if (suggLine) (ctx.rules ||= []).push(`这一轮开头代码已经写了旁白「${suggLine}」：「你」做了什么已经写过了，从结果写起，第一句不要再写「你」的动作，也不要写「你」说的话。`);
  if (ctx.hurtLines?.length && req.kind !== 'arrive') { await playLines(ctx.hurtLines); s.f.ta_hurt.seenAt = s.day * 4 + s.slot; }   // 播完再记；到达那一轮放到 AI 写完之后（arrive 里接）
  else if (s.f.ta_hurt && ctx.heHere && s.f.ta_hurt.seenAt == null && !s.f.ta_hurt.seen && req.kind !== 'event' && req.kind !== 'choice' && !ctx.hurtLines?.length) s.f.ta_hurt.seenAt = s.day * 4 + s.slot;
  const system = buildSystem(s, ctx);
  promptSize(req.kind === 'event' || req.kind === 'choice' ? '事件' : '当面', system);
  const um = userMsg(s, req);
  if (/线/.test(req.text || '')) s.c.threadTurn = s.turns; else if (s.c.threadTurn !== s.turns) s.c.threadTurn = null;   // 这一轮玩家在说线头（红线头违规检查用）
  // 旧存档里的历史只有 lines：补齐字段，免得模型学着省略 tags / suggestions
  const hist = s.history.map(m => m.role !== 'assistant' || m.content.includes('"suggestions"') ? m
    : { role: 'assistant', content: m.content.replace(/\}\s*$/, ',"tags":[],"action_size":"small","suggestions":[],"he_flags":[],"cg":null}') });
  const messages = [{ role: 'system', content: system }, ...hist, { role: 'user', content: um }];
  setBusy(true); loadingText(); G.inTurn = true;
  const q = makeQueue();
  const opts = { allowGarble: ctx.allowGarble, keepSprite: req.keepSprite, heHere: ctx.heHere && req.kind !== 'event' && req.kind !== 'choice' };   // 固定剧情里的立绘按事件自己的安排
  // 输出检查：不在场的 NPC、不在的河，台词直接丢掉（人肉测试 v2 · 6.4）
  const norm = t => String(t || '').replace(/[「」『』“”"，。,.！？!?…\s]/g, '');
  const okLine = l => {
    if (l.speaker === '你') return ((req.kind === 'action' && !!req.free) || req.kind === 'choice') && norm(l.text) !== '' && norm(req.text).includes(norm(l.text));   // 「你」只能原样复述玩家自己写的话 / 选的那句
    if (req.kind === 'event' || req.kind === 'choice' || ctx.present === undefined) return true;
    if (l.speaker === '河') return ctx.heHere;   // 河不在这个地方（在别处或不在村里）：AI 让他出场的台词删掉
    // 禾（芳的儿子）也写 村民·男：name 是禾，或者没给 name、石不在场、前面写的是禾 → 算禾，名牌也换成禾（测试记录 26）
    const isHe2 = l.speaker === '村民·男' && (l.name === '禾' || (!l.name && s.day >= 14 && !ctx.present.includes('石') && (ctx.present.includes('禾') || HE2_RE.test(narrSeen.slice(-2).join('') + lineSeen.slice(-3, -1).join('')))));
    if (isHe2) l.name = '禾';
    const npc = isHe2 ? '禾' : { 养母: '养母', '村民·男': '石', '村民·女': '芳', 满: '满', 衡: '衡' }[l.speaker];
    if (npc === '禾') { if (s.day < 14) return false; if (ctx.present.includes('禾') || ctx.present.includes('石') || ctx.present.includes('芳') || canBeHere(s, '禾')) { if (!ctx.present.includes('禾')) ctx.present.push('禾'); return true; } return false; }   // 第 14 天之前不出场
    if (!npc || ctx.present.includes(npc)) return true;
    // 测试报告「台词丢了」：旁白已经把人请出来了（「门拉开，院里站着养母」），台词却被删，只剩「她说完就转身」。
    // 养母在自己家（院子、偏房、河的房间）不出门的时段都算在；其他人旁白先写到了、这里本来就可能碰到，也算在场
    const home = ['yard', 'room', 'he_room'].includes(s.loc) && !motherAway(s.day, s.slot);
    const named = { 养母: /养母|婶/, 石: /石/, 芳: /芳/, 满: /满|小女孩/, 衡: /衡|村长/ }[npc];
    // 测试记录 23：芳在场、石路过开口（这一轮别人叫了他 / 上一轮写到他 / 台词自带 name），石那句被删，只剩「说完这句」——这里本来就可能碰到他，就算他在
    const lastTurn = [...(s.history || [])].reverse().find(m => m.role === 'assistant')?.content || '';
    const mentioned = named && (narrSeen.some(t => named.test(t)) || lineSeen.some(t => named.test(t)) || named.test(lastTurn) || (l.name && named.test(l.name)));
    if ((npc === '养母' && home) || (mentioned && canBeHere(s, npc))) { ctx.present.push(npc); return true; }
    return false;
  };
  const HE_MEET = /(碰到|碰见|遇到|遇见|撞见|撞上|看见|看到|瞧见|望见|发现|认出)[^。！？]{0,6}(?<!小)河(?![边水面岸床])|(?<!小)河(?![边水面岸床])[^。！？]{0,10}(站在|坐在|蹲在|靠在|走过来|走来|迎面|出现|从[^。]{0,6}(走|下|过)来|正在|朝你|向你|看着你|回过头|抬起头|也在)|是河[。，…！]/;
  const narrSeen = [];   // 这一轮旁白里已经写到的内容
  const lineSeen = [];   // 这一轮所有台词（别人叫了他的名字也算写到他）
  const fixExpr = l => (l.speaker !== '河' ? l : l.expr === 'cold' ? { ...l, expr: 'aloof' } : l.expr === 'blank' && (s.madness || 0) < 2 ? { ...l, expr: 'dazed' } : l);   // 冷视只给代码用；完全失焦只在偏疯时
  // 石、芳第一次开口：AI 没让他们先自报姓名，就由代码补上那句（名牌在这句之后才变成名字）
  const UNSAID = CLICHES.find(c => c.say.startsWith('「想说什么又没说」')).re;
  const SPEAKER_ALIAS = { he: '河', He: '河', HE: '河', ta: '牠', Ta: '牠', 旁白: 'narration', narrator: 'narration', Narration: 'narration', 母亲: '养母', 婶: '养母', 石: '村民·男', 芳: '村民·女' };
  const clean = l0 => {
    const l = SPEAKER_ALIAS[l0.speaker] ? { ...l0, speaker: SPEAKER_ALIAS[l0.speaker], name: l0.speaker === '石' || l0.speaker === '芳' ? l0.speaker : l0.name } : l0;
    let t = String(l.text || '');
    t = t.replace(/\s*[A-Za-z]{3,}(?:\s+[A-Za-z]{2,})*\s*/g, m => /^[A-Z]/.test(m.trim()) && m.trim().length <= 4 ? m : '');   // 混进来的外语词（如 nuevos）去掉；短的大写缩写保留
    if (l.speaker !== 'narration') t = t.replace(/（[^）]{2,40}）/g, '');   // 台词里的括号舞台说明
    if (l.speaker === 'narration' && UNSAID.test(t)) { if (s.c.unsaidDay === s.day) return null; s.c.unsaidDay = s.day; }   // 「想说又没说」一天最多一次
    if (/牠/.test(t) && /她/.test(t) && !['养母', '满', '芳', '村民·女'].includes(l.speaker) && !(ctx.present || []).some(n => ['养母', '满', '芳'].includes(n))) t = t.replace(/她/g, '牠');   // 牠不是女的（Cora 11/10）：没有别的女性在场时，把「她」换回「牠」
    t = t.trim(); return t ? { ...l, text: t } : null;
  };
  // 设定锁 §1：只有真正播出去的行（clean 之后、加上代码补的自我介绍）才进 history / 摘要；被删的不进记忆
  const INTRO = { '村民·男': ['know_shi', '石', '石。……后坡老郭家的。编筐的。'], '村民·女': ['know_fang', '芳', '芳。叫我小芳也行，都这么叫。……剖鱼的。'] };
  const introduced = new Set();   // 这一轮已经补过 / 已经自我介绍过的（flag 要等那句播出来才设，名牌才会先显示「村民」）
  const played = [], dropped = [];
  let metaUsed = false;
  const out = l => { played.push(l); q.push({ ...l, ai: true }); };
  if (suggLine) out({ speaker: 'narration', text: suggLine });
  // 石 / 芳第一次见：自我介绍由代码先说，免得 AI 先写一堆他的动作再介绍（Cora 11/10）
  if (req.kind !== 'event' && req.kind !== 'choice') for (const [sp, it] of Object.entries(INTRO)) {
    const nm = it[1]; if (!ctx.present?.includes(nm) || s.f[it[0]] || introduced.has(it[0])) continue;
    introduced.add(it[0]); out({ speaker: sp, name: nm, text: it[2], know: it[0] }); favAdd(s, nm, 5);   // 第一次见面 +5
  }
  const pushLine = l0 => {
    let l = clean(l0); if (!l) return;
    const it = INTRO[l.speaker];
    if (it && introduced.has(it[0]) && new RegExp(`^${it[1]}[。，……]`).test(l.text)) return;   // 代码已经替他自我介绍过了，AI 再写一遍就删
    if (it && !s.f[it[0]] && !introduced.has(it[0]) && req.kind !== 'event' && req.kind !== 'choice') {
      introduced.add(it[0]);
      if (new RegExp(`^${it[1]}[。，……]`).test(l.text)) l = { ...l, name: it[1], know: it[0] };
      else out({ speaker: l.speaker, name: it[1], text: it[2], know: it[0] });
    }
    out(fixExpr(l));
  };
  const dropWhy = l => l.speaker === '你' ? '替「你」说了玩家没说的话' : l.speaker === '河' ? `河这时不在这里（他在${ctx.heLocName || '别处'}）` : `${l.speaker === '村民·男' ? '石' : l.speaker === '村民·女' ? '芳' : l.speaker}这时不在场`;
  const take = l0 => {
    if (stale(gen)) return;   // 读档了：这一轮作废
    // 测试记录 17 §3：speaker 写成牠、文字不在「」里、又以「牠 / 白头发」开头的，其实是旁白
    const l = l0.speaker === '牠' && !/^\s*[「『]/.test(l0.text || '') ? { ...l0, speaker: 'narration', expr: undefined } : l0;   // 测试记录 19 §5：牠不说话，不以「」开头的都是旁白
    // 选项 / 自由输入「你」那句只出现一次（Cora 11/10：有时选的选项会跳两遍——AI 先用旁白写「你说了……」又单独写一行「你」）
    if ((req.kind === 'choice' || req.free) && req.text && (l.speaker === '你' || (l.speaker === 'narration' && /^\s*你/.test(l.text || ''))) && overlap2(req.text, l.text)) {   // 只管「你」的台词和以「你」开头的旁白，别人的反应里带到同样的词不删
      if (G.echoed) { dropped.push({ l, why: '「你」那句重复了', meta: true }); return; }
      G.echoed = true;
    }
    if (suggLine && !G.firstTaken) { G.firstTaken = true; if ((l.speaker === 'narration' || l.speaker === '你') && overlap2(suggLine, l.text)) { dropped.push({ l, why: '和代码播的「你……」重复', meta: true }); return; } }   // 测试记录 20 §2
    // Cora 11/10：河不在这里，旁白却写「你」半路碰到他 / 看见他——删掉，这一轮之后写他的旁白也删
    if (!ctx.heHere && l.speaker === 'narration') {
      const tx = String(l.text || '');
      if (HE_MEET.test(tx)) { G.heGhost = true; dropped.push({ l, why: `河这时不在这里（他在${ctx.heLocName || '别处'}），旁白却让「你」碰到他` }); return; }
      if (G.heGhost && (/(?<!小)河(?![边水面岸床])/.test(tx) || /^他/.test(tx))) { dropped.push({ l, why: '接着写碰到河的那段' }); return; }
    }
    if (l.speaker === 'narration') narrSeen.push(l.text);
    lineSeen.push(String(l.text || ''));
    // 河的表情分工 1111：AI 给的「完全失焦」一天最多 1 次（偏疯 2 次），多的换成失神
    // Cora 11/11：「回头」那张只在真的回头时用——这一句和前一句旁白都没写到回头 / 转身，就换成常规
    if (l.speaker === '河' && l.expr === 'turn' && !TURN_RE.test(String(l.text || '') + (narrSeen[narrSeen.length - 1] || ''))) l.expr = 'normal';
    if (l.speaker === '河' && l.expr === 'blank') { const b = s.c.blankDay?.day === s.day ? s.c.blankDay.n : 0; if (b >= (madTier(s.madness) === 'mad' ? 2 : 1)) l.expr = 'dazed'; else s.c.blankDay = { day: s.day, n: b + 1 }; }
    if (hideDay(s) && l.speaker === '河' && !req.event) { dropped.push({ l, why: '第 22–24 天河躲着你，不出场' }); if (!G.hideNoted) { G.hideNoted = true; pushLine({ speaker: 'narration', text: '河不在这里。' }); } return; }
    if (!okLine(l)) { dropped.push({ l, why: dropWhy(l) }); return; }
    const c = canonViolation(l, s);
    if (c) { dropped.push({ l, why: c.text, canon: c.id }); return; }
    const rep = repeatHit(s, l);   // 设定集 §7：同一句台词 / 同一个动作一天内第 3 次 → 删
    if (rep) { dropped.push({ l, why: rep }); return; }
    // 设定锁 §4：作者埋的「不对劲」只走代码通道。不允许 meta 的轮次，河说出明显的 meta 词就删；允许的轮次只留第一句
    if (l.speaker === '河' && (l.meta || META_RE.test(String(l.text || '')))) {
      if (!ctx.allowMeta || metaUsed) { dropped.push({ l, why: ctx.allowMeta ? 'meta 只能有一句' : '这一段不能有 meta', meta: true }); return; }
      metaUsed = true;
      pushLine({ ...l, meta: true }); return;   // 放行的那一句 meta：带上标记，播的时候花屏一下
    }
    pushLine(l);
  };
  const wakeBuf = req.kind === 'wake' ? [] : null;   // 测试记录 17 §5：醒来那段最后一句常被截断，先攒着，结束时最后一句没有句末标点就丢掉
  G.firstTaken = false; G.echoed = false; G.heGhost = false; G.hideNoted = false;
  const streamer = new LineStreamer(l => wakeBuf ? wakeBuf.push(l) : take(l));
  const playing = playQueue(q, opts);
  let raw;
  try {
    raw = await chat({ messages, important: req.kind === 'event' || req.kind === 'choice', onDelta: (_, full) => streamer.feed(full) });
  } catch (e) {
    if (stale(gen)) return NEVER();
    q.close(); await playing; G.inTurn = false;
    restore(s, snapshot);  // 回滚
    return await showError(e, () => doTurn(req), req);
  }
  if (stale(gen)) return NEVER();
  const turn = normTurn(raw);
  G.lastRaw = raw;  // 调试用
  // JSON 不完整时 normTurn 会退回「按换行硬切」，切法和流式不一样；流式已经播了就不再拿它补，免得台词错位、被拆开
  if (turn.ok !== false || streamer.count === 0) for (let i = streamer.count; i < turn.lines.length; i++) (wakeBuf ? wakeBuf.push(turn.lines[i]) : take(turn.lines[i]));
  if (wakeBuf) {
    const lastL = wakeBuf[wakeBuf.length - 1];
    if (wakeBuf.length > 1 && lastL && !/[。！？…」』”）\.!?~～]\s*$/.test(String(lastL.text || ''))) wakeBuf.pop();
    for (const l of wakeBuf) take(l);
  }
  // 到达时河在场，这一轮却没让他出场（没有台词，旁白里也没提）：代码补一句，不调 AI（后期测试修改 §5）
  if (req.kind === 'arrive' && ctx.heHere && !played.some(l => l.speaker === '河' || (l.speaker === 'narration' && /河|他/.test(l.text || ''))))
    out({ speaker: 'narration', text: s.apptNow?.who === '河' ? '河已经在了。看见你，他站起来。' : '河在这里。他看见你，手上的事没停。' });
  q.close();
  await playing; G.inTurn = false;
  if (turn.tags.some(t => t === '冷淡' || t === '拒绝' || t === '想离开')) {   // 测试记录 17 §2：「你」冷淡这一轮，河的 normal 换成淡漠
    for (const l of played) if (l.speaker === '河' && (!l.expr || l.expr === 'normal')) l.expr = 'aloof';
    if (G.R.chars?.he && (G.R.chars.he.expr === 'normal')) setSprite('河', 'aloof');
  }
  // 河的表情分工 1111：承诺带他走 / 温柔回应这一轮，他的表情全是 normal → 最后一句换成含泪（温柔回应 50% 换开心）；一天最多一次
  const warmTag = turn.tags.includes('承诺带他走') ? 'tears' : turn.tags.includes('温柔回应') ? (Math.random() < 0.5 ? 'happy' : 'tears') : null;
  const heLs = played.filter(l => l.speaker === '河');
  if (warmTag && s.c.tearDay !== s.day && heLs.length && heLs.every(l => !l.expr || l.expr === 'normal')) {
    s.c.tearDay = s.day; heLs[heLs.length - 1].expr = warmTag;
    if (G.R.chars?.he) setSprite('河', warmTag);
  }
  G.lastDropped = dropped.map(d => ({ speaker: d.l.speaker, text: d.l.text, why: d.why }));   // 调试用：这一轮删了什么、为什么
  if (getSettings().debug && dropped.length) console.log('dropped', G.lastDropped);
  s.meta.cliche = findCliches(played);
  // 设定锁 §3：流式播出去的收不回来，不整轮重写；删得多（≥3 行，或删完只剩不到 2 行）就在下一轮提醒一次
  const fixable = dropped.filter(d => !d.meta);
  if (fixable.length && (fixable.length >= 3 || played.length < 2)) s.fixNote = `上一段写错了：${[...new Set(fixable.map(d => d.why.replace(/。$/, '')))].slice(0, 3).join('；')}。这一段按事实表和「不能改的设定」写。`;
  // 结算
  if (req.kind === 'action' || req.kind === 'wake' || req.kind === 'arrive') {
    const tags = req.kind === 'action' ? (req.work ? turn.tags.filter(t => t === '亲近') : turn.tags) : [];   // 干活不加同化，只留「亲近」
    const cost = req.cost ?? SIZE_COST[turn.action_size] ?? 1;
    const grind = grindMode(s);
    if (grind) for (const t of tags) { const c = s.c.tagSeen?.day === s.day ? s.c.tagSeen : (s.c.tagSeen = { day: s.day, n: {} }); c.n[t] = (c.n[t] || 0) + 1; if (c.n[t] === 3) s.c.grindPending = s.day; }   // 同一个标签今天第 3 次：下一轮河察觉
    const d = applyTags(s, tags, turn.he_flags, null, { grind, scale: req.kind === 'action' && cost <= 1 && (turn.action_count || 1) <= 1 ? 0.5 : 1 });   // 1 点小事打五折
    // 疯神值平衡 1111：陪河缝东西、学手艺（和河同在一处、行动里有缝 / 针 / 线 / 学）往神拉 0.25，每天最多一次
    if (req.kind === 'action' && ctx.heHere && s.c.calmDay !== s.day && /[缝针线学]/.test(req.text || '')) { s.c.calmDay = s.day; s.madness = Math.max(-5, (s.madness || 0) - 0.25); }
    if (getSettings().debug) { console.log('tags', tags, turn.he_flags, d, s.v); debugTags(s, tags, turn, d); }
    npcAfterTurn(s, req, turn.tags, ctx.present);   // NPC 隐藏好感 1111
  }
  if (played.some(l => GORE_RE.test(l.text || ''))) { s.c.goreDays ||= {}; s.c.goreDays[s.day] = (s.c.goreDays[s.day] || 0) + 1; }
  if (s.meta.feignTurns > 0) s.meta.feignTurns--;
  if (s.done.includes('d32_thread') && played.some(l => l.speaker === 'narration' && /手腕[^。]{0,8}红点|红点[^。]{0,6}手腕/.test(l.text || ''))) s.c.heDotWritten = (s.c.heDotWritten || 0) + 1;
  s.turns++;
  s.history.push({ role: 'user', content: um }, { role: 'assistant', content: JSON.stringify({ lines: played.map(({ speaker, name, expr, text }) => ({ speaker, ...(name ? { name } : {}), ...(expr ? { expr } : {}), text })), tags: turn.tags, action_size: turn.action_size, suggestions: turn.suggestions, he_flags: turn.he_flags, cg: null }) });
  if (s.history.length > HISTORY_KEEP) compressHistory(s);
  if (turn.organ && organsOpen() && !ownedDrawings().includes(turn.organ)) await giveDrawing(turn.organ, 'he');
  if (turn.appointment && !req.propose && !req.apptDeclined) addAppt(s, turn.appointment);
  if (ctx.oweRef) {   // 河这一轮真的提了（台词和欠着的那句有 2 个以上的词重合）才收回；没提就记一次，这个时段内再给一次
    if (saidSome(ctx.oweRef.text, played)) { s.owes = (s.owes || []).filter(o => o !== ctx.oweRef && o.text !== ctx.oweRef.text); s.c.oweDay = s.day; }
    else { const at = s.day * 4 + s.slot; s.c.oweTry = { at, n: (s.c.oweTry?.at === at ? s.c.oweTry.n : 0) + 1 }; }
  }
  // 河记得的事（借鉴机制与结局 §2）：只收玩家原话里真的说过的（和玩家这次写的话有 2 个以上相同的字），最多 8 条
  if (turn.player_fact && (req.free || req.kind === 'choice') && req.text) {
    const said = new Set([...String(req.text)].filter(c => /[\u4e00-\u9fa5]/.test(c) && !'你我他的了是不在有这那吗呢么'.includes(c)));
    if ([...new Set(turn.player_fact)].filter(c => said.has(c)).length >= 2 && !(s.remember || []).some(r => r.text === turn.player_fact))
      s.remember = [...(s.remember || []), { text: turn.player_fact, day: s.day }].slice(-8);
  }
  if (turn.he_owes && ctx.heHere && !ctx.oweRef && oweOk(turn.he_owes, req.text, played, s)) { s.owes = [...(s.owes || []), { text: turn.he_owes, day: s.day }].slice(-3); }
  // 建议过滤（后期测试修改 §7）：手机的事从手机图标进；引号里引的话这一轮台词里没出现过的，不给
  const saidAll = played.map(l => l.text).join('') + (ctx.inject || []).join('');
  const sg = (s.c.suggSeen ||= {});   // 测试记录 20 §4：前几天给过的同一条建议不再给
  turn.suggestions = turn.suggestions.filter(x => !(sg[x.text] != null && sg[x.text] !== s.day && s.day - sg[x.text] <= 5));
  for (const x of turn.suggestions) sg[x.text] = sg[x.text] ?? s.day;
  turn.suggestions = turn.suggestions.filter(x => !/短信|手机|发消息|打电话/.test(x.text) && [...x.text.matchAll(/[「『“"]([^」』”"]{2,})[」』”"]/g)].every(m => saidAll.includes(m[1].slice(0, 4))));
  if (turn.suggestions.length) {
    s.lastSugg = turn.suggestions;
    // 至少一条 2 点的大事：AI 没给就按地点补一条
    const big = s.loc === 'he_room' && heLocation(s.day, s.slot) !== s.loc ? '把他的屋子收拾一遍' : BIG_ACTION[s.loc];   // 他不在：不要「陪他待过这一段」
    if (!s.lastSugg.some(x => x.cost >= 2) && big) s.lastSugg = [...s.lastSugg.slice(0, 3), { text: big, cost: 2 }];
  }
  else if (req.kind === 'action') { s.lastSugg = s.lastSugg.filter(x => x.text !== req.text); if (!s.lastSugg.length) s.lastSugg = [{ text: '四处看看', cost: 1 }, { text: '去找河', cost: 2 }]; }
  else if (req.kind !== 'event' && req.kind !== 'choice' && !s.lastSugg.length) s.lastSugg = [{ text: '四处看看', cost: 1 }, { text: '去找河', cost: 2 }];
  turn.played = played;
  // 测试记录 20 §4：记下在场的人这一轮在做什么（旁白里写到他的那一句，取前 16 个字），最多 3 条
  if (ctx.present?.length) for (const n of ctx.present) {
    const nm = { 石: /石|他/, 芳: /芳|她/, 满: /满|她/, 养母: /养母|她/, 衡: /衡|他/ }[n]; if (!nm) continue;
    const l = played.find(x => x.speaker === 'narration' && new RegExp(n).test(x.text)) ; if (!l) continue;
    const did = [...(s.c.npcDid ||= {})[n] || []]; did.push([...l.text].slice(0, 16).join('')); s.c.npcDid[n] = did.slice(-3);
  }
  if (req.kind === 'arrive' && ctx.hurtLines?.length) turn.hurtAfter = ctx.hurtLines;
  setBusy(false);
  saveRun(s);
  return turn;
}

const HE2_RE = /禾|芳家那小子|半大小子/;
const TURN_RE = /回头|回过头|转身|转过身|转过来|扭头|回身|侧过/;
// 防重复（设定集 §7）：同一句台词、或旁白里同一个动作（剪灯芯、绕线、刮鱼鳞……）一天内第 3 次 → 删掉，下一轮提醒
const REPEAT_ACTS = [['剪灯芯', /(剪|挑|拨)[^。，]{0,3}灯芯/], ['绕线', /绕[^。，]{0,2}线/], ['刮鱼鳞', /刮[^。，]{0,2}鳞/], ['清嗓子', /清[^。，]{0,2}嗓子/], ['转碗沿', /碗沿[^。，]{0,3}转|转[^。，]{0,3}碗沿/], ['理被角', /(理|拉平|掖)[^。，]{0,3}被角/], ['剪线头', /剪[^。，]{0,3}线头/], ['摆正', /摆正/], ['咬断线', /咬断/]];
function repeatHit(s, l) {
  if (!l.text || l.speaker === '你') return null;
  const R = s.c.repDay?.day === s.day ? s.c.repDay : (s.c.repDay = { day: s.day, lines: {}, acts: {} });
  const key = String(l.text).replace(/[「」『』。，、！？…—\s]/g, '');
  if (key.length >= 4) { const n = R.lines[key] = (R.lines[key] || 0) + 1; if (n >= 3) return '同一句话今天已经说过两次了，换一句'; }
  for (const [name, re] of REPEAT_ACTS) if (re.test(l.text)) { const n = R.acts[name] = (R.acts[name] || 0) + 1; if (n >= 3) return `「${name}」这个动作今天已经写过两次了，换别的`; }
  return null;
}
function restore(target, snap) {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, clone(snap));
}
function showError(e, retry, req) {
  const R = G.R;
  const msg = e instanceof ApiError ? e.message : '出错了：' + (e?.message || e);
  console.warn(e, e?.detail);
  R.name.classList.add('hidden');
  return new Promise(res => {
    const box = h('div', { class: 'err' }, msg, h('br'),
      h('button', { class: 'btn', onclick: ev => { ev.stopPropagation(); res(retry()); } }, '重试'),
      h('button', { class: 'btn', onclick: ev => { ev.stopPropagation(); P.openSettings(); } }, '去设置'),
      req.kind === 'event' || req.kind === 'choice' ? h('button', { class: 'btn', onclick: ev => { ev.stopPropagation(); setBusy(false); res({ lines: [], tags: [], suggestions: [], he_flags: [], skipped: true }); } }, '跳过这段') : null);
    R.text.className = 'text'; R.text.replaceChildren(box);
  });
}

// 旧对话压缩成摘要（后台进行，失败就直接丢弃）
async function compressHistory(s) {
  const old = s.history.splice(0, s.history.length - 8);
  const convo = old.map(m => {
    if (m.role === 'user') return m.content.split('\n')[0];
    const j = looseJson(m.content); return (j?.lines || []).map(l => (l.speaker === 'narration' ? '' : l.speaker + '：') + l.text).join(' ');
  }).join('\n');
  try {
    const raw = await chat({ messages: [{ role: 'user', content: summaryPrompt(s.summary, convo) }], stream: false, maxTokens: 500 });
    const j = looseJson(raw); if (j?.summary) s.summary = String(j.summary).slice(0, 500);
  } catch { s.summary = (s.summary + ' ' + convo.replace(/\n/g, ' ')).slice(-500); }
}

// 重新生成：回滚到这轮之前，再来一次（记录下来，meta 会用）
async function regenerate() {
  if (G.busy || !G.last) return;
  const { req, snapshot } = G.last;
  restore(G.s, snapshot);
  G.s.meta.rerolls++; G.s.meta.rerolledRecent = true;
  if (G.R?.chars?.he) addResent(G.s, 1, '当面重新生成');   // 数值与怨恨 §1-5
  refreshHud();
  await metaLine('regen');
  await afterTurn(await doTurn(req), req);
}

// ———————————————————— 行动 ————————————————————
async function doAction(a) {
  if (G.busy) return;
  if (G.s.ap <= 0) return endSlot();   // 点数用完：不能再选，直接进下一个时段
  if (a.kind === 'local') { setBusy(true); try { await a.fn(); } finally { if (!G.inTurn) setBusy(false); } return; }
  const dest = a.kind === 'ai' && /^(去|回|到|走去|走到|回到)/.test(a.text) && placeIn(a.text);   // 建议本身是去别的地方：走地图换地点（花 1 点）
  if (dest && dest !== G.s.loc && !isLockedLoc(dest)) return arrive(dest, true);
  const combS = a.kind === 'ai' ? await combAct(a.text) : null; if (combS === true) return;
  const req = { kind: 'action', text: a.text, cost: a.cost, last: G.s.ap - (a.cost || 1) <= 0, note: a.note, work: a.work, sugg: a.kind === 'ai', combRule: combS?.rule };
  if (a.work) { G.s.c.workDay = G.s.day; if (G.s.f.job === 'ta') G.s.c.taLine = (G.s.c.taLine || 0) + 1; }
  await afterTurn(await mustAnswer(await doTurn(req), req), req);
}
// 世界书第一步「先量」（借鉴机制与结局 §3）：调试模式下每轮记 system prompt 字数，当面 / 手机 / 事件分开；控制台看 G.promptStats
function promptSize(kind, text) {
  if (!getSettings().debug) return;
  const st = (G.promptStats ||= {}); (st[kind] ||= []).push(text.length);
  const a = st[kind]; console.log(`system 字数 · ${kind}：${text.length}（这类平均 ${Math.round(a.reduce((x, y) => x + y, 0) / a.length)}，共 ${a.length} 轮）`);
}
// 意图兜底台词（借鉴机制与结局 §5，Façade）：玩家问河是不是 AI / 提存档、屏幕这类，代码认出来、播固定台词、扣 1 点，不调 AI、不进 history
const META_ASK = /(你|河).{0,3}(是不是|是)?.{0,2}(AI|ai|Ai|人工智能|机器人|程序|NPC|npc|假的)|存档|读档|退出|关掉游戏|玩家|屏幕|电脑前|这是游戏/;
const PERSUADE_LINES = [
  { speaker: '养母', text: '他刚来那年，也天天往桃花林跑。' },
  { speaker: '养母', text: '一天找一朵。找着了就攥在手里，攥到花烂。' },
  { speaker: '养母', text: '有一回他往雾里走，三天才回来。烧了半个月。' },
  { speaker: '养母', text: '……好了以后，还偷着去。去了就绕回来。' },
];
const PERSUADE_RULE = '「你」这一轮在问养母小河小时候的事。养母的软处：她只在「你」表现出真心关心小河的身体、吃饭、睡觉时才松口；直接打听身世、拿别人的话套她、提「那边」，她就岔开。输出里加 "persuaded": true 或 false：她这次松没松口。松口了，这一轮只写到她叹口气、放下手里的活、准备开口为止，不要写她说了什么（接下来的话由代码接上）；没松口就照常写她岔开。';
async function metaAsk(t) {
  const s = G.s;
  const heHere = heLocation(s.day, s.slot) === s.loc || s.apptNow?.who === '河' || (s.afterEvent?.heHere && s.afterEvent.day === s.day && s.afterEvent.slot === s.slot && s.afterEvent.loc === s.loc);
  const q = t.match(/[「『“"]([^」』”"]+)[」』”"]/);
  const act = q ? t.slice(0, q.index).replace(/[：:，,。\s]+$/, '') : '';
  const lines = [...(act ? [{ speaker: 'narration', text: `你${act.replace(/^你/, '')}。` }] : []), { speaker: '你', text: q ? q[1] : t }];
  if (!heHere) lines.push({ speaker: 'narration', text: '没有人回答你。风从溪那边吹过来。' });
  else {
    const n = s.c.metaAsk = (s.c.metaAsk || 0) + 1;
    if (n === 1) lines.push({ speaker: '河', expr: 'normal', text: '……什么？' }, { speaker: 'narration', text: '他手上的针停了一下。' }, { speaker: '河', expr: 'normal', text: '你说的那个词，我没听过。' });
    else if (n === 2) lines.push({ speaker: '河', expr: 'alert', text: '你又说这个。' }, { speaker: 'narration', text: '他看着你，看了很久。' }, { speaker: '河', expr: 'alert', text: '……你那边的人，都这么说话吗。' });
    else { setSprite('河', 'aloof'); lines.push({ speaker: 'narration', text: '他没有回答。他把你刚才碰歪的碗摆正。' }); if (n === 3) applyTags(s, [], [], { resent: 1 }, { noCap: true }); }
  }
  const end = s.ap <= 1;
  await spendLocal(1, lines);
  if (!end) flashCost(1);
}
// 测试记录 20 §6：玩家这轮是提问、河在场却一句台词都没有 → 再来一轮（不扣点），让他用话回答
// 被问的人必须开口（NPC必须开口回答_1111）：不只河，衡和所有 NPC。玩家问了 / 对谁说了话，那个人一句台词都没有 → 重写一次
const ASKEE = [   // [识别玩家点名的词, 这个人在 played 里的 speaker / name, 叫法, 躲法]
  ['河', /河|小河/, l => l.speaker === '河', '河', '哪怕只回一半、岔开'],
  ['衡', /衡|村长/, l => l.speaker === '衡', '衡', '反问「你问这个做什么。」、讲规矩「住满了，你就知道了。」或者派活岔开'],
  ['养母', /养母|婶|阿姨|大娘/, l => l.speaker === '养母', '养母', '一句家务话把话头按下去，比如「吃饭。」'],
  ['芳', /芳/, l => l.speaker === '村民·女' || l.name === '芳' || l.name === '小芳', '芳', '嘴碎地扯到别人家的事上'],
  ['石', /石/, l => l.speaker === '村民·男' || l.name === '石', '石', '「这得问小河。」'],
  ['满', /满/, l => l.speaker === '满', '满', '「我不知道……你别告诉小河哥哥我说过。」'],
  ['牠', /牠|白头发/, l => l.speaker === '牠' || (l.speaker === 'narration' && /字条|纸条/.test(l.text || '')), '牠', '写一张字条，可以只写一半或写「……」'],
];
async function mustAnswer(turn, req) {
  const s = G.s;
  if (!turn || turn.skipped || req.answerRetry || req.kind !== 'action' || !(ASKS.test(req.text || '') || /[「“"]/.test(req.text || '') || /(跟|对|和|问|告诉|叫)/.test(req.text || ''))) return turn;   // 提问，或者对谁说了话（Cora 11/10）
  const heHere = heLocation(s.day, s.slot) === s.loc || s.apptNow?.who === '河';
  const present = new Set([...(heHere ? ['河'] : []), ...rollPresence(s), ...(s.loc === 'ta_house' ? ['牠'] : [])]);
  const t = String(req.text || '');
  // 被问的是谁：玩家点了名就是那个人；没点名，河在就算河，不在就算在场的唯一一个人
  let who = ASKEE.filter(a => present.has(a[0]) && a[1].test(t.replace(/小河哥哥/g, '小河')));
  if (who.length > 1) who = who.filter(a => a[0] !== '河' || !/小河/.test(t) || /(问|跟|对)(他|河|小河)/.test(t));   // 问别人「小河……」的时候，被问的不是河
  if (!who.length) { const only = [...present]; who = ASKEE.filter(a => a[0] === (present.has('河') ? '河' : only.length === 1 ? only[0] : '')); }
  const a = who[0]; if (!a) return turn;
  if ((turn.played || []).some(a[2])) return turn;
  const r2 = { kind: 'action', text: '（你等着回答）', cost: 0, answerRetry: true, note: `${a[3]}刚才没开口。这一轮${a[3]}必须用一两句话接「你」刚才说的「${t.slice(0, 30)}」：可以不说实话、只答一半，用话岔开（${a[4]}）；不能只写动作或沉默。` };
  await doTurn(r2);
  return turn;   // 扣点、说服判定都按原来那一轮算
}
async function freeAct() {
  const t = G.R.input.value.trim(); if (!t || G.busy) return;
  if (G.s.ap <= 0) return endSlot();
  G.R.input.value = ''; G.R.inputMax = 0;
  if (META_ASK.test(t) && G.s.phase === 'free') return metaAsk(t);
  const combF = G.s.phase === 'free' ? await combAct(t) : null; if (combF === true) return;
  if (hideDay(G.s) && HIDE_CALL.test(t) && G.s.phase === 'free') {   // 第 22–24 天找河：不调 AI，扣 1 点
    setBusy(true); try { await playLines([{ speaker: 'narration', text: '你四处看了看。河不在。' }]); } finally { setBusy(false); }
    G.s.ap = Math.max(0, G.s.ap - 1); saveRun(G.s); refreshHud(); flashCost(1);
    return G.s.ap <= 0 ? endSlot() : renderActions('free');
  }   // 问「你是不是 AI」这类：不交给 AI（借鉴机制与结局 §5）
  const persuade = G.persuade && G.s.loc === 'yard'; G.persuade = false; G.R.input.placeholder = '或者，自己写想做什么……';
  if (persuade) G.s.c.persuadeTries = (G.s.c.persuadeTries || 0) + 1;
  // 自己写的行动：AI 判断这次实际做了几件事，扣「规模」和「件数」里大的那个（二测 · 1：按标点猜件数两头都错）；扣了几点在行动值旁边闪一下
  const req = { kind: 'action', text: t, free: true, apLeft: G.s.ap, last: G.s.ap <= 1, persuade, combRule: combF?.rule };
  const prop = parseProposal(G.s, t, proposeTarget(G.s, t), G.s.loc);
  if (prop && prop.who === '河' && heApptCapHit(G.s, prop.day)) {   // 约太勤：河推掉，爱慕 −1、克制 +1（不进备忘录）
    const when = prop.day === G.s.day + 1 ? '明天' : prop.day === G.s.day ? '今天' : '那天';
    req.note = `「你」想约河，但这几天已经约得太多了。他有点不自在，往后退了一步：推掉，原话「${when}不行。」，不约，appointment 写 null。`;
    req.apptDeclined = true;
  } else if (prop && await confirmProposal(prop)) { prop.capChecked = true; req.propose = prop; }   // 「算了」：不约，照常把这句话当普通行动发出去（后期测试修改 §3：之前整句被吞掉）
  let turn = await doTurn(req);
  if (req.apptDeclined && !turn.skipped) applyTags(G.s, [], [], { love: -1, restraint: 1 });
  if (req.propose && !turn.skipped) settleProposal(G.s, req.propose, turn.appointment);
  turn = await mustAnswer(turn, req);
  if (persuade && turn.persuaded && !turn.skipped && !G.s.done.includes('persuaded_mother')) {   // 说服成功：AI 写完，代码接固定台词（不走 AI）
    G.s.done.push('persuaded_mother');
    setBusy(true);   // 养母说完之前不能点别的（测试记录 13）
    try { await waitAdvance(); await playLines(PERSUADE_LINES); } finally { setBusy(false); }
  }
  await afterTurn(turn, req);
}
async function afterTurn(turn, req) {
  const s = G.s;
  await flushMeta();
  const hr = new Date().getHours(); if (hr >= 1 && hr < 5) await metaLine('late');
  if (req.kind === 'action') {
    const cost = req.free ? Math.min(s.ap, Math.max(SIZE_COST[turn.action_size] ?? 1, turn.action_count || 1)) : req.cost ?? SIZE_COST[turn.action_size] ?? 1;
    s.ap = Math.max(0, s.ap - cost);
    req.spent = cost;
  }
  saveRun(s);
  refreshHud();
  if (req.free && req.spent) flashCost(req.spent);   // HUD 刷新之后再闪，不然会被刷掉
  if (s.ap <= 0) {   // 点数用完：读完最后一句点一下，收尾旁白自己走，不用再点（之前要多点两下）
    renderActions('none'); await sleep(300); await waitAdvance();
    await showLine({ speaker: 'narration', text: SLOT_CLOSE[s.slot] || '时间过去了。' }); G.R.next.classList.add('hidden'); await sleep(1100);
    return endSlot();
  }
  renderActions('free');
}
async function spendLocal(cost, lines) {
  const s = G.s;
  if (lines?.length) { renderActions('none'); await playLines(lines); }
  s.ap = Math.max(0, s.ap - cost); refreshHud(); saveRun(s);
  if (s.ap <= 0) return endSlot();
  renderActions('free');
}
// 相册拼完以后：看那张照片（河在场时他接一句，前期「放回去」，后期多讲一点车灯的事）
async function lookPhoto() {
  const s = G.s, he = heLocation(s.day, s.slot) === s.loc;
  const lines = [{ speaker: 'narration', text: '照片还夹在那一页。一个很小的孩子，站在一辆车前面，车灯亮着。' }];
  if (he && s.day < 20) lines.push({ speaker: '河', expr: 'pout', text: '……又看。放回去。' });
  else if (he) lines.push({ speaker: '河', expr: 'dazed', text: '车灯很亮。我只记得这个。' }, { speaker: '河', expr: 'normal', text: '后来就到这儿了。……别的不记得了。' });
  else lines.push({ speaker: 'narration', text: '孩子没有看镜头。他在看车灯。' });
  await spendLocal(1, lines);
}
async function miniAction(name) {
  const s = G.s;
  s.f.anyEnding = Object.keys(getGallery().endings || {}).length > 0;
  if (name === 'puzzle_he') s.c.albumDay = s.day;
  if (name === 'flower') s.c.flowerDay = s.day;
  if (name === 'puzzle_ta') s.c.tombPhotoDay = s.day;
  const res = await runMinigame(name, s);
  if (name === 'puzzle_he') {   // 翻他的旧相册：他在场当场有反应；不在的话，过一个时段发消息
    const heThere = heLocation(s.day, s.slot) === s.loc;
    if (res.success && heThere) res.lines = [...(res.lines || []).slice(0, 0), { speaker: 'narration', text: '照片拼好了。一个很小的孩子，站在一辆车前面，车灯亮着。', cg: 'puzzle_photo' },
      { speaker: '河', expr: 'alert', text: '……谁让你翻的。' }, { speaker: 'narration', text: '他走过来，把照片拿起来，看了很久。' },
      { speaker: '河', expr: 'dazed', text: '那年我六岁。车灯很亮。' }, { speaker: '河', expr: 'normal', text: '放回去吧。……放回原来那页。' }];
    else if (res.success) s.c.puzzleMsg = { day: s.day, slot: s.slot };
    else if (heThere) res.lines = [{ speaker: '河', expr: 'normal', text: '翻完放回去。' }];
  }
  if (name === 'flower' && res.success) {   // 数花瓣找到之后：按在场的人（人肉 v3 · 6）
    unlock('misc', 'five_petal');
    if (s.c.flowerFound === 1) toast('你把它放进了口袋。');
    if (heLocation(s.day, s.slot) === s.loc) {
      res.lines = [{ speaker: '河', expr: 'normal', text: '……五瓣的。' }, { speaker: '河', expr: 'pout', text: '别给别人看。' }, { speaker: 'narration', text: '他把那朵花拿过去，夹进了画本里。' }];
      applyTags(s, [], [], { love: 1 }, { noCap: true });
    } else if (s.day > 8 && s.f.man_met && rollPresence(s).includes('满')) {
      res.lines = [{ speaker: '满', text: '你也找到了。' }, { speaker: '满', text: '我每天都找。每天只有一朵。' }, { speaker: 'narration', text: '她把花瓣一片一片摘下来，数到五，停了。' }];
    }
  }
  await spendLocal(1, res.lines);
  if (name === 'puzzle_he') showCG(null);
}
// 器官图 = 河画的解剖图
const ownedDrawings = () => { const g = getGallery(); return Object.keys(g.organs).filter(id => g.organs[id]); };
async function giveDrawing(id, how) {
  const { ORGANS } = await import('./config/world.js?v=1794428964');
  const o = ORGANS.find(x => x.id === id); if (!o) return;
  unlock('organs', id);
  if (how === 'he') await playLines([{ speaker: '河', expr: 'shy', text: '……这个给你。画得不好。' }]);
  await openOrgan(id, ownedDrawings());
}
async function sketchbook() {
  const { ORGANS } = await import('./config/world.js?v=1794428964');
  const left = ORGANS.filter(o => !ownedDrawings().includes(o.id));
  if (!left.length) return spendLocal(1, [{ speaker: 'narration', text: '画本你都翻过了。每一页的线条都很细，标注写得很工整。' }]);
  const o = left[Math.floor(Math.random() * left.length)];
  await playLines([{ speaker: 'narration', text: `画本里夹着一张${o.name}。线条很细，旁边用小字写着标注。` }]);
  await giveDrawing(o.id);
  await spendLocal(1, []);
}
// 器官归位：十张画全给，拼完一次就全部解锁（回想、「河的画」）
async function organsGame() {
  const { ORGANS } = await import('./config/world.js?v=1794428964');
  const first = !organsOpen();
  const res = await organPuzzle(ORGANS.map(o => o.id), hasAsset('ui/torso.webp'));
  if (res.success) {
    for (const o of ORGANS) unlock('organs', o.id);
    unlock('misc', 'organ_puzzle');
    if (first) applyTags(G.s, [], [], { love: 3 });
  } else res.lines = [{ speaker: 'narration', text: '画被他收回了画本里。' }, { speaker: '河', expr: 'normal', text: '……下次再放。' }];
  return res;
}
async function drawingPuzzle() {
  const res = await organsGame();
  await spendLocal(1, res.lines);
}
async function leaveVillage() {
  const s = G.s;
  s.c.leaveTries = (s.c.leaveTries || 0) + 1;
  applyTags(s, ['想离开']);
  if (MID.gonegirl(s)) {   // 条件里已经算了他拦不拦得住（爱慕低 / 希望低）
    await playLines([{ speaker: 'narration', text: '你往雾里走。这一次，没有人从后面叫你。' }, { speaker: 'narration', text: '路越来越不像路。' }]);
    return triggerEnding('gonegirl');
  }
  const stopped = MID.heStops(s);
  const req = { kind: 'action', text: '往雾里走，想离开村子', cost: 2, note: stopped ? '河追上来，拦住了玩家。按越界规则写，不写占有。' : '雾把路绕了回来，玩家又走回了村界。河不在。' };
  await afterTurn(await doTurn(req), req);
}

// ———————————————————— 时段 ————————————————————
// 事件条件（visit 事件和带 cond 的固定事件共用）
function condOk(s, c = {}) {
  if (c.minDay && s.day < c.minDay) return false;
  if (c.maxDay && s.day > c.maxDay) return false;
  for (const id of [...(c.done || []), ...(c.doneEvents || [])]) if (!s.done.includes(id)) return false;
  if (c.slot != null && s.slot !== c.slot) return false;
  if (c.maxSlot != null && s.slot > c.maxSlot) return false;
  if (c.outfit && s.outfit !== c.outfit) return false;
  if (c.slots && !c.slots.includes(s.slot)) return false;
  if (c.heAt && heLocation(s.day, s.slot) !== s.loc) return false;   // 河按日程正好在这里（小剧情）
  if (c.named != null && !!s.name !== c.named) return false;   // named: true 填了名字才有；false 没填才有
  if (c.organs && !organsOpen()) return false;
  if (c.notDays && c.notDays.includes(s.day)) return false;
  for (const id of c.notDone || []) if (s.done.includes(id)) return false;
  if (c.present && !c.present.every(n => rollPresence(s).includes(n))) return false;   // 这个时段某人在场（T2 芳）
  if (c.loop && !(s.loop > 0)) return false;   // 二周目以后（O7）   // 某件事还没发生才有（满的初遇兜底）   // 按打扮分支的固定台词（彩蛋：开局穿村里的衣服）
  for (const [k, n] of Object.entries(c.counter || {})) if ((s.c[k] || 0) < n) return false;
  if (c.visited && !(s.c.visitedAt?.[c.visited] === s.day && s.loc !== c.visited)) return false;   // 今天去过某处（吃醋 2：身上有牠的味道）
  for (const [k, n] of Object.entries(c.meta || {})) if ((s.meta?.[k] || 0) < n) return false;   // 玩家的真实操作（d9：点过重新生成）
  for (const [k, [lo, hi]] of Object.entries(c.v || {})) if (s.v[k] < lo || s.v[k] > hi) return false;
  for (const [k, val] of Object.entries(c.flags || {})) if (!!s.f[k] !== val) return false;
  for (const [k, val] of Object.entries(c.is || {})) if (s.f[k] !== val) return false;
  return true;
}
// 到时间的固定事件；带 cond 的（比如第 38 天衡送木牌要同化 ≥ 60）条件不满足就算跳过
function dueEvent(s) {
  for (const ev of G.events) {
    if (ev.trigger || s.done.includes(ev.id) || !(s.day > ev.day || (s.day === ev.day && s.slot >= ev.slot))) continue;
    if (ev.cond && !condOk(s, ev.cond)) { s.done.push(ev.id); continue; }
    if (ev.day < s.day && !(ev.day === s.day - 1 && s.slot === 0)) { s.done.push(ev.id); continue; }   // 旧存档已经过了的新事件不补放；只补昨晚被睡过去的那一个
    return ev;
  }
  return null;
}
function visitEvent(s) {
  const ok = ev => ev.trigger === 'visit' && !(hideDay(s) && (ev.heHere === true || ev.cond?.heAt || (ev.lines || []).some(l => l.speaker === '河'))) && !s.done.includes(ev.id) && (ev.loc === s.loc || ev.locs?.includes(s.loc)) && !(ev.mini && s.c.miniDay === s.day) && condOk(s, ev.cond);
  const fixed = G.events.find(ev => !ev.pool && ok(ev)); if (fixed) return fixed;
  // 牠不正常的池子（牠的舌头与发疯小剧情 §三）：走进牠的屋子 30% 抽一段满足天数、没演过的；被牠伤过的那一天不再抽
  if (s.loc !== 'ta_house' || s.c.taHurtDay === s.day || Math.random() >= 0.3) return null;
  const pool = G.events.filter(ev => ev.pool === 'ta_odd' && ok(ev));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
// 日程：AI 写的 appointment → 记下来；到那个时段强制带玩家过去，对方一定在场
const WHO_SPEAKER = { 石: '村民·男', 芳: '村民·女' };
function addAppt(s, a, baseDay = s.day, allowNow = false) {
  const off = { 今天: 0, 明天: 1, 后天: 2 }[a.day] ?? (Number.isFinite(+a.day) ? +a.day - baseDay : 1);
  const slot = SLOTS.indexOf(String(a.slot)); const loc = placeIn(String(a.place || '')) || Object.keys(LOCATIONS).find(k => String(a.place || '').includes(LOCATIONS[k].name));
  const day = baseDay + Math.max(0, off);
  if (slot < 0 || !loc || a.accept === false) return;
  commitAppt(s, { who: String(a.who), day, slot, loc, place: LOCATIONS[loc].name }, allowNow);
}
// 测试记录 20 §5（Cora 定）：和河的约定同一天最多 1 个，连续 3 天里最多 2 个（玩家约和他约一起算）
function heApptDays(s) { return [...new Set([...(s.c.heApptDays || []), ...(s.appts || []).filter(a => a.who === '河').map(a => a.day)])]; }
function heApptCapHit(s, day) {
  const ds = heApptDays(s);
  if (ds.includes(day)) return true;
  return [[day - 2, day - 1], [day - 1, day + 1], [day + 1, day + 2]].some(([a, b]) => ds.includes(a) && ds.includes(b));
}
function commitAppt(s, ap, allowNow = false) {
  const { day, slot, loc } = ap;
  if (ap.who === '河' && !ap.capChecked && heApptCapHit(s, day)) return false;
  if (ap.who === '河' && day >= 22 && day <= 24) return false;   // 第 22–24 天他躲着你：新约一律推掉   // 他主动约 / 手机里约到上限：不记
  const at = day * 4 + slot, now = s.day * 4 + s.slot;
  if (day > 41 || at < now || (at === now && !allowNow)) return false;
  for (const x of s.appts || []) if (x.day === day && x.slot === slot) memoDone(s, apptMemoId(x));   // 同一时段的旧约定被顶掉：备忘录里划掉
  s.appts = (s.appts || []).filter(x => !(x.day === day && x.slot === slot));
  if (at === now) {   // 手机回复到的时候正好就是约的这个时段：还在选地点的话直接带过去
    if (s.phase === 'map' && !G.busy) { s.apptNow = ap; closeOv('map'); arrive(loc, false); }
    return true;
  }
  s.appts.push(ap);
  if (ap.who === '河') s.c.heApptDays = [...new Set([...(s.c.heApptDays || []), day])];
  memoAdd(s, { id: apptMemoId(ap), text: `第 ${day} 天 ${SLOTS[slot]} · ${ap.who} · ${ap.place}`, at });   // 备忘录：只记最终时间（挪过的也一样）
  refreshHud(); return true;
}
function showAppts() {
  const list = (G.s?.appts || []).map(a => h('div', { class: 'ds', style: { fontSize: '20px', lineHeight: '2' } }, `${a.who} · 第 ${a.day} 天${SLOTS[a.slot]} · ${a.place}`));
  modal('appts', '约好的事', h('div', {}, ...(list.length ? list : [h('div', {}, '没有约好的事。')])), { buttons: [{ label: '知道了', value: 1 }] });
}
// 玩家主动约人：从输入里认出「什么时候、在哪」，弹框确认，再由对方决定答不答应（人肉 v3 · 2）
const DAY_WORDS = [[/后天/, 2], [/明天|明早|明晚|明儿/, 1], [/今天|今晚|待会|等会/, 0]];
const SLOT_WORDS = [[/上午|早上|一早|明早|清早/, 0], [/午后|下午|中午|晌午/, 1], [/黄昏|傍晚|太阳落山/, 2], [/晚上|夜里|今晚|明晚|半夜/, 3]];
// 约人要有「约」的意图词；只有地点 + 时间词不算（后期测试修改 §3：「早上在村界，你为什么……」被当成约人）。「看见 / 遇见」这类不算「见」
const INTENT = /约|(?<![看听遇瞧撞梦])见(?!过)|等你|等我|一起|来找|碰头|过来|陪我|带我/;
const PAST = /昨天|前天|那天|刚才|之前|上次|(早上|上午|中午|下午|午后|黄昏|傍晚|晚上|夜里)(在|你|他|她|的时候)/;   // 说的是过去的事
export function parseProposal(s, text, who, defaultLoc) {
  const d = DAY_WORDS.find(([re]) => re.test(text)), sl = SLOT_WORDS.find(([re]) => re.test(text));
  if (!sl || !who || !INTENT.test(text) || (PAST.test(text) && !d)) return null;
  const slot = sl[1], day = s.day + (d ? d[1] : slot > s.slot ? 0 : 1);
  if (day * 4 + slot <= s.day * 4 + s.slot || day > 41) return null;
  const loc = placeIn(text) || defaultLoc; if (!loc || !LOCATIONS[loc]) return null;
  let d2 = day, s2 = slot, moved = false;
  for (let i = 0; i < 4 && eventAt(s, d2, s2); i++) { moved = true; s2++; if (s2 > 3) { s2 = 0; d2++; } }   // 那个时段有固定剧情：往后挪
  if (eventAt(s, d2, s2) || d2 > 41) return null;
  return { who, day: d2, slot: s2, loc, place: LOCATIONS[loc].name, moved };
}
export function confirmProposal(p) {
  return modal('propose', null, h('div', { style: { fontSize: '24px', textAlign: 'center', letterSpacing: '2px', padding: '8px 0' } }, `约 ${p.who} · 第 ${p.day} 天 ${SLOTS[p.slot]} · ${p.place}`,
    p.moved ? h('div', { style: { fontSize: '15px', color: '#8a7f72', marginTop: '10px', letterSpacing: '1px' } }, '你说的那个时候村里有事，挪到了这个时候。') : null), { buttons: [{ label: '约好', value: true }, { label: '算了', value: false }] });
}
const proposeNote = p => `「你」约${p.who}：第 ${p.day} 天${SLOTS[p.slot]}，在${p.place}。${p.moved ? '（玩家原话里的时间那天村里有事，已经改成这个时间。）' : ''}台词里提到时间地点，只能说「第 ${p.day} 天${SLOTS[p.slot]}，${p.place}」（可以说成今天 / 明天 / 后天），不要说成别的时间或地方。由${p.who}决定答不答应（看关系和${p.who === '河' ? '他' : '对方'}自己的安排；衡多半不答应，比如「我没空陪外人」；满几乎都答应）。台词里让${p.who}回答，不答应要给一句理由。appointment 写 {"who":"${p.who}","day":"…","slot":"${SLOTS[p.slot]}","place":"${p.place}","accept":true 或 false}。`;
function proposeTarget(s, text) {
  if (/牠|白头发/.test(text)) return s.loc === 'ta_house' ? '牠' : null;
  for (const [name, re] of CALL_NAMES) if (re.test(text)) return name === '养母' ? (s.loc === 'yard' ? name : null) : rollPresence(s).includes(name) || canBeHere(s, name) ? name : null;
  if (heLocation(s.day, s.slot) === s.loc || s.apptNow?.who === '河') return '河';
  return rollPresence(s).find(n => n !== '养母') || rollPresence(s)[0] || null;
}
function settleProposal(s, p, ap) {
  if (ap ? ap.accept !== false : true) { if (commitAppt(s, p, true)) toast(`约好了：${p.who} · 第 ${p.day} 天${SLOTS[p.slot]} · ${p.place}`); }
  else toast('没约成。');
  refreshHud(); saveRun(s);
}
// 这个时段有没有固定剧情（约人时避开）
function eventAt(s, day, slot) { return G.events.find(e => !e.trigger && e.day === day && e.slot === slot && !s.done.includes(e.id) && (!e.cond || condOk({ ...s, day, slot }, e.cond))); }
function takeAppt(s, blocked) {
  const a = (s.appts || []).find(x => x.day === s.day && x.slot === s.slot); if (!a) return null;
  s.appts = s.appts.filter(x => x !== a);
  memoDone(s, apptMemoId(a));   // 兑现了或者被耽误了：备忘录里划掉
  if (a.who !== '河' && a.who !== '牠') favAdd(s, a.who, blocked ? -5 : 8);   // 约了这个人：去了 +8，没去 −5
  if (blocked) { s.apptMissed = a; toast(`和${a.who}约在${a.place}的事，被别的事耽误了。`, 3200); return null; }   // 这个时段被固定剧情占了：没去成，下次见面对方有反应
  if (a.who === '满' && !s.f.man_flaked && Math.random() < 0.35) { s.f.man_flaked = true; a.flaked = true; }   // 满可能被叫回家，爽约一次
  return a;
}
// 备忘录里不靠某一刻写入、按状态补的条目：衡分的活、满（备忘录任务单 §2）。隐藏事件不记
// 备忘录后期多一行字（备忘录留痕 §2，B）：d25 之后、一局最多 2 次、夜里时段开始时 25%（第一次最早第 27 天）；只挂在已经划掉的旧条目下面，不提示不加红点
const MEMO_EXTRA = ['你那边几点', '这条我也记过', '那天他不在这里', '别全信'];
function memoExtra(s, force = false) {
  if (!force && !(s.slot === NIGHT && G.inSlotStart)) return;
  const n = (s.memo || []).filter(m => m.extra).length;
  if (n >= 2 || !s.done.includes('d25_ta_mad') || s.day < 27 || (!force && Math.random() >= 0.25)) return;
  const old = (s.memo || []).filter(m => m.done && !m.ghost && !m.extra && m.day < s.day);
  const he = old.filter(m => /^appt_.*_河$/.test(m.id || ''));
  const used = (s.memo || []).map(m => m.extra).filter(Boolean);
  let text = MEMO_EXTRA.find(t => !used.includes(t) && (t !== '你那边几点' || he.length));
  const target = text === '你那边几点' ? he[he.length - 1] : (he[he.length - 1] || old[old.length - 1]);
  if (!text || !target) return;
  target.extra = text;
}
export function memoSync(s) {
  if (!s || !hasPhone(s)) return;
  const job = s.f.job && JOBS[s.f.job];
  if (job) memoAdd(s, { id: 'job', text: `每天${job.slots.map(i => SLOTS[i]).join('、')} · ${LOCATIONS[job.loc].name}有活`, until: 29 });   // 和 morningHint 的 s.day < 30 一致
  if (s.f.man_met) memoAdd(s, { id: 'man', text: '满常在桃花林', until: 33 });
  // 第 40 天回档留痕（备忘录留痕 §1）：每次回档一条，一开始就是划掉的；读档回来也按存档外面的记录补上
  if (s.day >= 40) (store.get('d40')?.said || []).forEach((t, k) => memoAdd(s, { id: `d40_said_${k + 1}`, day: 40, text: `第 40 天 黄昏 · 溪边 · 你说了：${t}`, done: true, ghost: true }));
  memoExtra(s);
  memoTick(s);
}
function morningHint(s) {
  if (s.day === 22) return '养母说：牠这几天不对。夜里听见那边摔东西，别过去，喊小河。';   // d25 铺垫 §3：这一天固定
  const opts = [];
  const he = heLocation(s.day, 1); if (he) opts.push(`养母说：小河午后在${LOCATIONS[he].name}。`);
  else opts.push('养母说：小河今天一早就出去了，没说去哪。');
  const job = jobOn(s) && JOBS[s.f.job]; if (job && s.day < 30) opts.push({ fields: '养母说：今天晒场收豆子，人手不够。', yard: '养母说：今天要腌菜，你早点来帮手。', ta: '养母说：牠那边缺线，送饭的时候顺路带一卷。' }[s.f.job]);
  if (s.f.man_met && s.day < 34) opts.push('养母说：满那孩子又在桃花林里转了一早上。');
  const a = (s.appts || []).find(x => x.day === s.day); if (a) opts.push(`你记得：今天${SLOTS[a.slot]}和${a.who}约在${a.place}。`);
  return a ? opts[opts.length - 1] : opts[s.day % opts.length];
}
// 日常 CG：上午到院子是早饭，黄昏到院子是饭桌，夜里在他房间（他在）是灯下；同一种一天最多一次
// 日常 CG 分三个阶段轮换，按场景挑，一天最多一张（中后期文件 §1）
const DAILY_POOLS = [
  { to: 13, ids: ['daily_table', 'daily_breakfast', 'daily_lamp', 'daily_chili'] },
  { to: 27, ids: ['daily_table_mid', 'daily_lamp_mid', 'daily_laundry'] },
  { to: 41, ids: ['daily_table_late', 'daily_lamp_late', 'daily_breakfast', 'daily_wait_late'] },
];
const DAILY_WHERE = {   // 饭桌：黄昏养母家；早饭：上午养母家；灯下：夜里河的房间（他在）；洗衣：上午 / 午后溪岸；晒辣椒：午后 / 黄昏养母家
  table: (s) => s.loc === 'yard' && s.slot === DUSK, breakfast: (s) => s.loc === 'yard' && s.slot === 0,
  lamp: (s, he) => s.loc === 'he_room' && s.slot === NIGHT && he, laundry: (s) => s.loc === 'creek' && s.slot <= 1,
  chili: (s) => s.loc === 'yard' && (s.slot === 1 || s.slot === DUSK),
  wait: (s, he) => s.loc === 'yard' && s.slot === NIGHT && he,   // 门槛：后期夜里回到院子，他坐在门外台阶上等
};
// 后期饭桌 CG 1111：中后期两张饭桌 CG 保底一次——还没看过，黄昏在养母家就出，不管当天有没有事件 CG（同一个时段不叠）
const TABLE_DUE = [{ id: 'daily_table_mid', from: 15, to: 27 }, { id: 'daily_table_late', from: 28, to: 41 }];
export function tableDue(s) {
  const t = TABLE_DUE.find(x => s.day >= x.from && s.day <= x.to);
  return t && !getGallery().cgs[t.id] && hasAsset(`cg/${t.id}.webp`) && s.c.dailyCg?.day !== s.day ? t.id : null;
}
function dailyCG(s) {
  s.c.dailyCg ||= {}; if (s.c.dailyCg.day === s.day) return null;
  const due = tableDue(s);
  if (due && s.loc === 'yard' && s.slot === DUSK && s.c.eventCgAt !== s.day * 4 + s.slot) { s.c.dailyCg.day = s.day; return due; }
  if (s.c.eventCgDay === s.day) return null;   // 同一天已经出过事件 CG，就不再出日常 CG（主线 1109 §5.2）
  const he = heLocation(s.day, s.slot) === s.loc;
  const pool = DAILY_POOLS.find(p => s.day <= p.to)?.ids || [];
  const ok = pool.filter(id => DAILY_WHERE[id.split('_')[1]]?.(s, he) && hasAsset(`cg/${id}.webp`));
  if (!ok.length) return null;
  const id = ok[s.day % ok.length];   // 同一场景有两张可选（黄昏的饭桌 / 晒辣椒）时按天数轮
  s.c.dailyCg.day = s.day; return id;
}
// 手机：他不秒回。你发的消息下一个时段才回（第 22、23 天隔两个时段），第一句先交代刚才在干什么；夜里发的有时当晚回，没回的第二天上午回（开头不固定）
export const NIGHT_SLOT = NIGHT;
const HE_DOING = { ta_house: '刚才在牠那儿学手艺', fields: '刚才在地里干活', creek: '刚才在溪边', he_room: '刚才在自己屋里', yard: '刚才在院子里干活', peach: '刚才在桃花林', tomb: '刚才在后山' };
// 地图上的「有事」：约好的人、干活、能碰到的人（拜访事件）
// 地图卡片补两行（地图卡片补内容 1110，Cora 定 2 + 3）
// 上次在这里：最近一次在这里演完的、有 KEY_EVENTS 的事件；没有就「第 N 天来过」；没来过不显示
export function mapRecall(s, loc) {
  const e = s.c.lastAt?.[loc], v = s.c.visitedAt?.[loc];
  if (e && KEY_EVENTS[e.id]) return `上次：第 ${e.day} 天，${KEY_EVENTS[e.id].replace(/^你/, '')}。`;
  return v != null ? `上次：第 ${v} 天来过。` : null;
}
// 可能碰到谁：只写常态（不掷骰子），只写认识的人；不认识的写「有人」；河不写在这里（已有「河可能在这里」）；牠只写在牠的屋子
export function mapMaybe(s, loc) {
  const slot = s.slot, out = [];
  if (loc === 'yard' && !motherAway(s.day, slot)) out.push('养母');
  if (loc === 'ta_house') out.push('牠');
  for (const [n, p] of Object.entries(NPC_PRESENCE[loc]?.[slot] || {})) { if (p < 0.2 || (n === '满' && !s.f.man_met)) continue; out.push(n); }
  if (!out.length) return null;
  const SP = { 石: '村民·男', 芳: '村民·女' };
  const names = [...new Set(out.map(n => knows(s, SP[n] || n) ? n : '有人'))];
  return `可能碰到：${names.join('、')}`;
}
// 「这个时段：河可能在这里」只有 30% 的时段显示（Cora 11/10：一直提示，玩家就总黏着河）；同一个时段里不变
export function heHintShown(s) {
  // Cora 11/11：「河可能在这里」出现太多 → 每个时段 15%，一天最多一次（原来 30%，一天平均一次多）
  if (!s.c.heHint || s.c.heHint.day !== s.day || s.c.heHint.slot !== s.slot) {
    const shownToday = s.c.heHintDay === s.day;
    const show = !shownToday && !!heLocation(s.day, s.slot) && Math.random() < 0.15;   // 他不在的时段不占这一次
    if (show) s.c.heHintDay = s.day;
    s.c.heHint = { day: s.day, slot: s.slot, show };
  }
  return s.c.heHint.show;
}
export function mapMarks(s) {
  const m = {};
  for (const a of s.appts || []) if (a.day === s.day && a.slot === s.slot) m[a.loc] = `${a.who}在等你`;
  const job = jobOn(s) && JOBS[s.f.job];
  if (job && job.slots.includes(s.slot) && s.c.workDay !== s.day) m[job.loc] ||= '有活';
  if (s.slot === DUSK && tableDue(s)) m.yard ||= '养母叫你回来吃饭';   // 后期饭桌 CG 1111：备忘录不记
  for (const ev of G.events) if (ev.trigger === 'visit' && !ev.noMark && ev.loc && !s.done.includes(ev.id) && condOk(s, ev.cond)) m[ev.loc] ||= '好像有人';   // 小剧情是碰上的，不标
  return m;
}
export function phoneReplyNow() { return G.s ? phoneReplies(G.s, true) : Promise.resolve(); }
async function phoneReplies(s, now = false) {
  // 拼了他的旧相册、他不在：过一个时段他发现了
  const pm = s.c.puzzleMsg;
  if (pm && (s.day - pm.day) * SLOTS.length + (s.slot - pm.slot) >= 1) {
    s.c.puzzleMsg = null; pushHe(s, '相册你动了。'); pushHe(s, '照片放反了一页。', 3000); pushHe(s, '……没关系。', 6000);
    saveRun(s); refreshHud(); toast('手机震了一下。');
  }
  const p = s.phonePending; if (!p) return;
  if (s.c.hengAsk && p.day >= s.c.hengAsk) {   // 第 31 天夜里「衡跟你说什么了。」之后你回的第一条
    s.c.hengAsk = null; s.phonePending = null; pushHe(s, '……没什么。睡吧。'); saveRun(s); refreshHud(); toast('手机震了一下。'); return;
  }
  if (s.c.taAfterDay === s.day && p.day === s.day) {   // 牠先于河的第二天：你回什么他都只回「嗯。」，不调 AI
    s.phonePending = null; pushHe(s, '嗯。'); saveRun(s); refreshHud(); toast('手机震了一下。'); return;
  }
  if (s.f.first_msg_reply && p.day > (s.f.first_msg_day ?? p.day)) s.f.first_msg_reply = false;   // 那一晚没回：之后的消息正常回
  if (s.f.first_msg_reply && (s.day - p.day) * SLOTS.length + (s.slot - p.slot) >= 1) {   // 第一次消息：不管你回什么，他只回一句
    s.phonePending = null; s.f.first_msg_reply = false;
    for (const m of s.phone) if (m.from === 'me' && m.note?.startsWith('已送达')) m.note = '已读';
    pushHe(s, '嗯。睡吧。'); saveRun(s); refreshHud(); toast('手机震了一下。'); return;
  }
  const gap = (s.day - p.day) * SLOTS.length + (s.slot - p.slot);
  const stage = phoneStage(s);
  if (gap < (now ? 0 : (p.day >= 22 && p.day <= 24) || stage === 'cold' ? 2 : 1)) return;   // 冷：隔两个时段；近：这一时段内就回
  s.phonePending = null;
  if (!p.propose && stageCgMessages(s)) return;
  const where = heLocation(p.day, p.slot);
  // 夜里别老「睡着了」（1111）：当晚回的是没睡；第二天上午回的，开头可以交代一句也可以不交代，连着两次交代过第三次就不交代
  const nightLate = !now && p.slot === NIGHT, explainOk = (s.c.nightExplain || 0) < 2;
  const note = (p.propose ? proposeNote(p.propose) + '\n' : '') + (now ? (p.slot === NIGHT ? '夜里了，他还没睡（灯下在缝东西），这次回得很快。' : '他这次回得很快，就在这一时段里。') : nightLate ? (explainOk ? '你的消息是夜里发的，他现在才看到。可以（不是必须）用很短的一句交代，比如「刚醒。」「早上才看到。」「昨晚灯灭得早。」，也可以什么都不交代直接回。不要写「睡着了」。' : '你的消息是夜里发的，他现在才看到。这次不要交代为什么现在才回，直接回你的话。不要写「睡着了」。') : `他隔了一段时间才回。他刚才的去向是：${HE_DOING[where] || '出去了，没说去哪（不要编具体地点）'}——只能说这个，不要说别的地方。第一句先很短地交代刚才在干什么、为什么没看手机，再回你的话。`);
  try {
    const recent = s.phone.slice(-12).filter(m => m.text && m.from !== 'sys').map(m => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text }));
    const ask = async fix => { const sys = phoneChatPrompt(s, { heHere: false, outfitName: '', allowMeta: false, loreText: recent.filter(m => m.role === 'user').slice(-1)[0]?.content || '', note: fix ? `${note}\n上一次写错了：${fix}。这次按「不能改的设定」写。` : note, stage }); promptSize('手机', sys); const j = looseJson(await chat({ messages: [{ role: 'system', content: sys }, ...recent], stream: false, maxTokens: 300 })); return [j, (Array.isArray(j?.replies) ? j.replies : []).map(r => String(typeof r === 'object' ? (r?.text ?? '') : r).trim()).filter(Boolean).slice(0, 3)]; };
    // AI 偶尔返回空内容（二测 · 2），或者违反设定锁（§3，手机不是流式，整段先检查）：两种情况合计最多重试 1 次（一条回复最多调 2 次 API）。
    // 违规的重试带上「写错了什么」；重试后还违规的那几条删掉；还是空的，就不拿兜底句糊弄，记成他欠着的话，之后他自己提起来
    let [j, reps] = await ask();
    const bads = reps.map(phoneBad).filter(Boolean);
    if (!reps.length || bads.length) {
      G.lastDropped = reps.filter(phoneBad).map(text => ({ speaker: '河（手机）', text, why: phoneBad(text).text }));
      [j, reps] = await ask(bads.length ? [...new Set(bads.map(c => c.text.replace(/。$/, '')))].join('；') : undefined);
      reps = reps.filter(r => { const b = phoneBad(r); if (b) G.lastDropped.push({ speaker: '河（手机·重试）', text: r, why: b.text }); return !b; });
      if (getSettings().debug && G.lastDropped.length) console.log('phone dropped', G.lastDropped);
    }
    if (G.s !== s) return;
    if (!reps.length) {
      const last = [...s.phone].reverse().find(m => m.from === 'me' && m.text)?.text || '';
      // 后期测试修改 §2：因为违规被删光的不记（不是 AI 返回空）；玩家这条本身踩了设定锁（「你说的同乡是谁」）也不记，免得把错喂回去
      // Cora 11/10：「可爱」「好」这种短的一两句不算他欠着的（不然隔天他会回「不是随口问的」）；问句写「问」，其他写「说」
      const worth = last.replace(/[^\u4e00-\u9fa5]/g, '').length >= 5 || /[？?吗呢]$/.test(last.trim());
      if (last && worth && !G.lastDropped?.length && !canonViolation({ speaker: '你', text: last }, s)) s.owes = [...(s.owes || []), { text: [...(`「你」在手机上${/[？?吗呢么]\s*$/.test(last) ? '问他' : '跟他说'}：「${last}」`)].slice(0, 30).join(''), day: s.day - 1 }].slice(-3);   // 记成昨天欠下的：明天起就能提
      reps = p.slot === NIGHT ? [['刚看到。', '嗯。', '早。'][(s.c.nightFallback = ((s.c.nightFallback ?? -1) + 1) % 3)]] : [];   // 夜里发的：兜底轮着选（1111）；白天：只显示「已读」
    }
    const tags = (Array.isArray(j?.tags) ? j.tags : []).filter(x => AI_TAGS.includes(x));
    if (p.propose) settleProposal(s, p.propose, j?.appointment);
    else if (j?.appointment?.who) addAppt(s, j.appointment, p.day, true);   // 手机里约好的也进日程（按你发消息那天算「今天 / 明天」）
    if (tags.length) applyTags(s, tags, [], null, { grind: grindMode(s) });   // 聊天也改数值，和当面一样受每天 ±3 上限
    for (const m of s.phone) if (m.from === 'me' && m.note?.startsWith('已送达')) m.note = '已读';
    // 「睡着了」一局最多 2 次（1111）：超了那一句去掉；第二天上午回的有没有交代，记连续次数
    reps = reps.map(msgOnly).filter(Boolean).filter(r => { if (!/睡着了/.test(r)) return true; if ((s.c.sleptSaid || 0) >= 2) return false; s.c.sleptSaid = (s.c.sleptSaid || 0) + 1; return true; });
    if (nightLate) s.c.nightExplain = reps.length && /刚醒|醒了|才看到|刚看到|灯灭/.test(reps[0]) ? (s.c.nightExplain || 0) + 1 : 0;
    reps.forEach((r, i) => pushHe(s, r, i * 3000));
    saveRun(s); refreshHud(); if (reps.length) toast('手机震了一下。');
  } catch { s.phonePending = p; }   // 没连上：下个时段再试
}

// 手机：夜里他主动发消息
// AI 偶尔会把旁白和消息写在一起（「手机亮了一下。屏幕上只有一句：『……』」）：只留引号里他发的那句
// 手机「他那边」CG（Cowork 方案 11/09）：每张一局只闪一次；怨恨优先于好感。
// 轮到某一张时，那一次的消息用固定句（不调用 AI），打开手机先闪这张、下方淡入一行小字
export const PHONE_CG = {
  phone_night: { slot: 3, cap: '他那边也是夜里。' },
  phone_cold: { slot: 3, ok: s => s.v.resent >= 60, cap: '屏幕亮了一下，又暗了。', msgs: [] },
  phone_sour: { slot: 2, ok: s => s.v.resent >= 35 && s.v.resent < 60, cap: '他看到了。', msgs: ['嗯。'] },
  phone_near: { slot: 3, ok: s => phoneStage(s) === 'near', cap: '屏幕一直亮着，他没睡。', msgs: [{ t: '睡了吗。', recall: true }, '没事。', '明天还去溪边吗。'] },
  phone_warm: { slot: 3, ok: s => phoneStage(s) === 'warm', cap: '他打了一行，删了，又打了一行。', msgs: ['刚回来。', '手上都是线头。', '你吃了没。'] },
};
function stageCgMessages(s) {
  s.c.phoneCgSeen ||= [];
  const id = ['phone_cold', 'phone_sour', 'phone_near', 'phone_warm'].find(k => !s.c.phoneCgSeen.includes(k) && PHONE_CG[k].ok(s) && PHONE_CG[k].slot === s.slot && hasAsset(`cg/${k}.webp`));   // 只在游戏里对应的时段出（夜里 / 黄昏）
  if (!id) return false;
  s.c.phoneCgSeen.push(id); s.c.phoneCgPending = id;
  for (const m of s.phone) if (m.from === 'me' && m.note?.startsWith('已送达')) m.note = '已读';
  PHONE_CG[id].msgs.forEach((m, i) => {
    if (typeof m === 'string') pushHe(s, m, (i + 1) * 3000);
    else { pushHe(s, m.t, i * 3000); const last = s.phone[s.phone.length - 1]; last.recallAt = 3000; }   // 3 秒后变成「对方撤回了一条消息」（打开手机时才开始算）
  });
  saveRun(s); refreshHud(); toast(id === 'phone_cold' ? '手机亮了一下。' : '手机震了一下。');
  return true;
}
// 手机消息违反设定锁吗（联系人、身世、铁皮盒…），或者 AI 自己写了屏幕外的话（那是作者的通道）
function phoneBad(t) { return canonViolation({ speaker: '河', text: t }, G.s) || (META_RE.test(t) ? { id: 'meta', text: '手机里不能写屏幕外的事' } : null); }
function msgOnly(t) { t = stripTags(t); const m = t.match(/[「『“"]([^」』”"]{1,60})[」』”"]/); return (m && /[。：:，]/.test(t.slice(0, m.index)) ? m[1] : t).trim(); }
function pushHe(s, text, delay = 0) { s.phone.push({ from: 'he', text, ts: Date.now() + delay, day: s.day }); s.unread = (s.unread || 0) + 1; }
function heInvite(s) {
  const d = s.day + 1;
  const slot = [2, 1, 0, 3].find(sl => heLocation(d, sl) && !eventAt(s, d, sl) && !(s.appts || []).some(a => a.day === d && a.slot === sl));
  if (slot == null) return false;
  const loc = heLocation(d, slot);
  s.c.nextHeAppt = s.day + 3 + (Math.random() < 0.5 ? 1 : 0);
  if (!commitAppt(s, { who: '河', day: d, slot, loc, place: LOCATIONS[loc].name })) return false;
  const tail = ['来不来随你。', '我在那儿。', '……不来也行。', '你要是有空。', '我早点去。'];
  s.c.inviteTails ||= []; const left = tail.filter(x => !s.c.inviteTails.includes(x)); const pick = (left.length ? left : tail)[s.day % (left.length || tail.length)];
  s.c.inviteTails.push(pick);   // 模板句一局里不重复（测试报告：「……不来也行。」不同天一字不差出现两次）
  pushHe(s, `${['明天', '明儿'][s.day % 2]}${SLOTS[slot]}，${LOCATIONS[loc].name}。`); pushHe(s, pick, 3000);
  saveRun(s); refreshHud(); toast('手机震了一下。'); return true;
}
async function phoneNight(s) {
  // 第一次收到他的消息：第 3 天夜里起，第一个和他不在一起的夜里（人肉测试 v2 · 手机提前）
  if (hasPhone(s) && !s.f.first_msg && s.day >= 3 && heLocation(s.day, s.slot) !== s.loc) {
    s.f.first_msg = true; s.f.first_msg_reply = true; s.f.first_msg_day = s.day; s.c.nextPing = Math.max(s.c.nextPing || 0, s.day + 3);
    s.phone.push({ from: 'sys', text: '手机在枕头边亮了一下。', ts: Date.now(), day: s.day });
    pushHe(s, '灯芯剪了吗。'); pushHe(s, '……我妈让我问的。', 3000);
    s.c.phoneCgSeen = [...(s.c.phoneCgSeen || []), 'phone_night']; s.c.phoneCgPending = 'phone_night';
    saveRun(s); refreshHud(); toast('手机震了一下。'); return;
  }
  if (!hasPhone(s)) return;
  // 第 31 天衡来过的那天夜里：固定一条，代替 AI 那条；你回什么他都只回「……没什么。睡吧。」（中期与吃醋 1111 §一）
  if (s.day === 31 && s.done.includes('d31_heng') && !s.f.d31_phone) {
    s.f.d31_phone = true; s.c.hengAsk = s.day; pushHe(s, '衡跟你说什么了。');
    saveRun(s); refreshHud(); toast('手机震了一下。'); return;
  }
  if (await phoneOwe(s)) return;   // 欠着的那句，三天里没当面说成：今晚发短信
  if (s.day === 39 && !s.f.d39_phone) {
    s.f.d39_phone = true; pushHe(s, '明天黄昏，溪边。'); pushHe(s, '别带东西。', 4000);
    saveRun(s); refreshHud(); toast('手机震了一下。'); return;
  }
  if (s.day >= 4 && s.day < 38 && !(s.day >= 21 && s.day <= 24) && s.day >= (s.c.nextHeAppt ?? 5) && heInvite(s)) return;   // 河主动约（人肉 v3 · 12）
  if (s.day >= 39 || s.day < (s.c.nextPing || 3) || (s.day >= 22 && s.day <= 24)) return;
  const ignoredLast = s.c.pingDay && !s.f.pingAnswered;
  s.c.nextPing = s.day + 3 + (Math.random() < 0.5 ? 1 : 0);
  s.c.pingDay = s.day; s.f.pingAnswered = false;
  if (stageCgMessages(s)) return;
  try {
    let text = '你那边现在几点';   // 上一条你没回：他问的是屏幕外的时间（一局只问一次，之后照常让 AI 写）
    if (!ignoredLast || s.f.askedTime) { const j = looseJson(await chat({ messages: [{ role: 'system', content: phonePingPrompt(s) }, { role: 'user', content: '（发一条）' }], stream: false, maxTokens: 120 })); text = msgOnly(String(j?.replies?.[0] || '')).slice(0, 40); if (!text || phoneBad(text)) text = '睡了吗'; }
    if (G.s !== s) return;
    if (text === '你那边现在几点') s.f.askedTime = true;
    pushHe(s, text); saveRun(s); refreshHud(); toast('手机震了一下。');
  } catch {}
}

// 这个时段谁在场：代码先抽签（每个时段最多 1 个 NPC），再告诉 AI，AI 只能让在场的人说话
function rollPresence(s) {
  if (s.present && s.present.day === s.day && s.present.slot === s.slot && s.present.loc === s.loc) { const w = s.present.who; return Array.isArray(w) ? w : w ? [w] : []; }
  const table = NPC_PRESENCE[s.loc]?.[s.slot] || {};
  const away = heLocation(s.day, s.slot) == null;
  const who = [];
  if (s.loc === 'yard' && !motherAway(s.day, s.slot)) who.push('养母');   // 养母在自己家不占名额
  for (const [name, p] of Object.entries(table)) {
    if (name === '满' && !s.f.man_met) continue;            // 满：第 8 天初遇之后才会随机出现
    if (Math.random() < Math.min(0.95, p * (away ? 1.5 : 1))) { who.push(name); break; }   // 其他人每个时段最多 1 个
  }
  s.present = { day: s.day, slot: s.slot, loc: s.loc, who };
  return who;
}
// 玩家点名找人：这个人在这个地点有可能出现，就让他在场；不可能在，就让 AI 一句话交代他去哪了
const NOT_NAME = { 石: '头板阶子块桥凳缝墙碑灰磨榴', 满: '地了意足脸身满月天山屋院头是', 芳: '香草' };
const nameRe = n => new RegExp(`(?:^|[找叫问喊跟和对向给陪帮见等])${n}(?![${NOT_NAME[n] || ''}])|${n}(?=[，。！？、])`);   // 单字名要有上下文，免得「石头」「满地」被当成点名
const CALL_NAMES = [['禾', /禾|芳家那小子|芳的儿子/], ['养母', /养母|婶|小河他妈/], ['石', nameRe('石')], ['芳', /小芳|芳姐|芳婶/], ['芳', nameRe('芳')], ['满', nameRe('满')], ['衡', /衡|村长/]];
function canBeHere(s, name) { if (name === '禾') return s.day >= 14 && ['fields', 'creek', 'peach'].includes(s.loc) && s.slot < NIGHT;   // 禾跟着石：田地晒场、溪边、桃花林（测试记录 26）
  return name === '养母' ? s.loc === 'yard' && !motherAway(s.day, s.slot) : (NPC_PRESENCE[s.loc]?.[s.slot]?.[name] || 0) > 0 && (name !== '满' || !!s.f.man_met); }
function callPresence(s, text, present) {
  for (const [name, re] of CALL_NAMES) {
    if (!re.test(text) || present.includes(name)) continue;
    const possible = canBeHere(s, name);
    if (possible) { const keep = present.filter(n => n === '养母'); present.splice(0, present.length, ...keep, name); s.present.who = [...present]; }
    else return `「你」在找${name === '养母' ? '养母' : name}，但${name === '养母' ? '她' : '他'}现在不在这里${name === '养母' && s.loc === 'yard' ? '（上后坡了）' : ''}。用一句旁白交代去哪了，不要写成人在却不说话。`;
  }
  return null;
}

export async function startSlot() {
  const s = G.s;
  sweepMissedAppts(s);
  G.inSlotStart = true; memoSync(s); G.inSlotStart = false;
  s.ap = AP_PER_SLOT; s.lastSugg = []; G.last = null;
  refreshHud(); setSprite(null); showCG(null);
  phoneReplies(s);                       // 上个时段你发的消息，他现在才回
  const ev = dueEvent(s);
  if (s.slot === NIGHT && !ev?.quietPhone) phoneNight(s);   // 夜里：第 39 天约见，或者他隔几天主动发一条（d9 窗外那晚让给事件）
  // 连着 3 天没去干活：衡来催一次（第 30 天以后不催）
  if (!ev && s.slot === 0 && jobOn(s) && s.day < 30 && s.day - Math.max(s.c.workDay ?? 7, s.c.nagDay ?? 0) >= 3) {
    s.c.nagDay = s.day;
    await playLines([{ speaker: 'narration', text: '衡在院门口站了一下。' }, { speaker: '衡', text: '活呢。' }]);
  }
  if (hideDay(s)) {   // 这三天和河的约：他在手机上推掉，备忘录划掉
    const his = (s.appts || []).filter(a => a.who === '河' && a.day >= 22 && a.day <= 24);
    if (his.length) { s.appts = s.appts.filter(a => !his.includes(a)); for (const a of his) memoDone(s, apptMemoId(a)); pushHe(s, '这两天不行。'); saveRun(s); refreshHud(); toast('手机震了一下。'); }
  }
  if (!ev && s.slot === 0 && (s.day === 22 || s.day === 23) && s.c.hideSaid !== s.day) {   // 养母说出来
    s.c.hideSaid = s.day;
    await playLines([{ speaker: '养母', text: s.day === 22 ? '小河一早就走了。……没说去哪。' : '又出去了。饭也没吃。' }]);
    setSprite(null);
  }
  const appt = takeAppt(s, !!ev);
  if (ev) return runEvent(ev);
  if (appt && LOCATIONS[appt.loc]) { s.apptNow = appt; s.phase = 'map'; return arrive(appt.loc, false); }   // 约好的：直接带过去
  s.phase = 'map'; saveRun(s);
  setScene(); renderActions('none');
  G.R.name.classList.add('hidden'); G.R.text.className = 'text narr'; G.R.text.textContent = `${SLOTS[s.slot]}。要去哪里？`;
  if (s.slot === 0 && s.c.hintDay !== s.day) {   // 每天早上一句当天的小事（人肉 v3 · 12），显示在地图右边的说明栏
    s.c.hintDay = s.day; s.c.hintText = morningHint(s);
    // 备忘录只记养母交代的事；河当天去向（第二天就没用）、约定（单独记过）不记；「满那孩子…」只记第一次；和前一天一样的不再记（后期测试修改 §8）
    const ht = s.c.hintText || '', text = ht.replace(/^养母说：/, '');
    const skip = !ht || ht.startsWith('你记得') || /小河(午后在|今天一早)/.test(ht) || (/^满那孩子/.test(text) && s.c.memoManHint) || (s.memo || []).some(m => m.id === `hint_${s.day - 1}` && m.text === text);
    if (hasPhone(s) && !skip) { memoAdd(s, { id: `hint_${s.day}`, text, until: s.day }); if (/^满那孩子/.test(text)) s.c.memoManHint = true; }
  }
  P.openMap(false);
}
export async function arrive(loc, viaMap, opts = {}) {
  const s = G.s;
  if (s.phase === 'free' && viaMap) { s.ap = Math.max(0, s.ap - 1); if (s.ap <= 0) { s.loc = loc; return endSlot(); } }
  s.prevLoc = s.loc; s.loc = loc; s.phase = 'free'; s.lastSugg = [];
  if (loc === 'ta_house') s.c.taVisits = (s.c.taVisits || 0) + 1;
  (s.c.visitedAt ||= {})[loc] = s.day;
  if (heLocation(s.day, s.slot) === loc || s.apptNow?.who === '河') s.c.visitedHe = true;
  if (s.apptNow && s.apptNow.loc !== loc) s.apptNow = null;   // 约好的地方走开了，约定就算过了
  setSprite(null); setScene(); refreshHud(); saveRun(s);
  const ev = opts.skipVisit ? null : visitEvent(s);
  if (ev) return runEvent(ev);
  // 衡分的活（Cora 11/10）：到了干活的地方先把活干了（一句固定台词，不花点），算这一天做过，之后照常选别的；衡就不会再来问「活呢」
  const job = jobOn(s) && JOBS[s.f.job];
  if (!opts.afterMini && job && job.loc === loc && job.slots.includes(s.slot) && s.c.workDay !== s.day) {
    s.c.workDay = s.day; if (s.f.job === 'ta') s.c.taLine = (s.c.taLine || 0) + 1; if (s.f.job === 'yard') favAdd(s, '养母', 5);
    await playLines([{ speaker: 'narration', text: { ta: '你先把午饭给牠送过去。牠接过碗，点了一下头。', fields: '你先在晒场帮着翻了一阵豆子，手上沾了一层灰。', yard: '你先给养母打下手，择完了一篮子菜。' }[s.f.job] }]);
  }
  if (s.c.combDusk === s.day && s.slot === DUSK && loc === 'yard' && !motherAway(s.day, s.slot) && !opts.afterMini) {   // 梳头那天黄昏：养母看出来扎歪了
    s.c.combDusk = null;
    await playLines([{ speaker: '养母', text: '今天扎得歪。' }, ...(heLocation(s.day, s.slot) === 'yard' ? [{ speaker: '河', expr: 'shy', text: '……嗯。' }] : [])]);
  }
  if (s.day === 23 && s.slot === DUSK && (loc === 'creek' || loc === 'peach') && !s.c.glimpse23 && !opts.afterMini) {   // 远远看见他一次
    s.c.glimpse23 = true; await playLines([{ speaker: 'narration', text: '远远地，溪那头有个人影站了一下。你再看，已经没了。' }]);
  }
  // 村里人也知道（中期与吃醋 1111 §四）：在场、河不在，先播那几句，再交给 AI
  const kn = !opts.afterMini && takeKnow(s, rollPresence(s), heLocation(s.day, s.slot) === loc || s.apptNow?.who === '河');
  if (kn?.lines.length) {
    await playLines(kn.lines);
    s.c.afterRule = { day: s.day, slot: s.slot, loc: s.loc, text: (s.c.afterRule?.day === s.day && s.c.afterRule?.slot === s.slot && s.c.afterRule?.loc === s.loc ? s.c.afterRule.text : '') + `${kn.who}刚才已经提过「你」的事了（${kn.lines.filter(l => l.speaker !== 'narration').map(l => l.text).join('')}），不要再提一遍。` };
  }
  renderActions('free'); setBusy(true);
  const daily = dailyCG(s);
  if (daily) { await preload(A(`cg/${daily}.webp`)); showCG(daily); }
  const req = { kind: 'arrive', afterMini: !!opts.afterMini };
  const turn = await doTurn(req);
  if (daily) showCG(null);
  // 测试记录 18 §2：被牠伤到后第一次见河——到达那一轮照常写完，再播固定句，再来一轮 AI 接着写（不扣点）
  if (turn?.hurtAfter?.length && G.s === s) {
    await waitAdvance(); await playLines(turn.hurtAfter); s.f.ta_hurt.seenAt = s.day * 4 + s.slot;
    const req2 = { kind: 'action', text: '（你没回答，看了一眼自己的手）', cost: 0 };
    return afterTurn(await doTurn(req2), req2);
  }
  await afterTurn(turn, req);
}
async function leaveSlot() { if (!G.busy) endSlot(); }
async function sleepToMorning() {
  if (G.busy) return;
  const s = G.s;
  // 直接跳到第二天清晨（今天还没发生的固定事件不会被跳过：跳到它所在的时段为止）
  const evs = G.events.filter(ev => !ev.trigger && !s.done.includes(ev.id) && (ev.day === s.day && ev.slot > s.slot));
  if (evs.length) { s.slot = Math.min(...evs.map(e => e.slot)) - 1; }
  else { s.slot = NIGHT; }
  endSlot();
}
export async function endSlot() {
  const s = G.s;
  if (G.endingSlot) return; G.endingSlot = true; setTimeout(() => { G.endingSlot = false; }, 400);   // 时段切换时连点不会连跳两个时段
  if (G.R) renderActions('none');
  s.phase = 'map'; if (!D40_NAMES.includes(s.saveName)) s.saveName = null; s.f.d40_atChoice = false;
  // 黏人：连续 6 个时段都去他在的地方 → 他不自在，当天爱慕上限 −1；隔开一个时段清零
  s.c.clingy = s.c.visitedHe ? (s.c.clingy || 0) + 1 : 0; s.c.visitedHe = false;
  if (s.c.clingy >= 6) s.c.clingyDay = s.day;
  noteSlotWho(s);
  s.apptNow = null;
  if (s.outfit === 'village') applyTags(s, [], [], { assim: VILLAGE_OUTFIT_ASSIM }, { capExtra: true });   // 衣服加的同化也算进每天上限
  if (s.outfit === 'outside') applyTags(s, [], [], { assim: OUTSIDE_OUTFIT_ASSIM }, { capExtra: true });   // 外面的衣服：往回拉
  s.slot++;
  if (s.slot >= SLOTS.length) {
    if (DEMO && s.day >= DEMO_LAST_DAY) return demoEnd(true);   // 试玩版：最后一天夜里过完就结束
    s.slot = 0; s.day++; s.phoneToday = 0;
    applyTags(s, [], [], dailyDelta(s)); dailyResent(s); madnessDrift(s);
  }
  saveRun(s);
  const gen = G.gen;
  await transition(`第 ${s.day} 天 · ${SLOTS[s.slot]}`);
  if (stale(gen)) return;
  startSlot();
}
async function transition(text) {
  const ov = openOv('trans', h('div', { style: { background: '#0b0907', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d8cfc2', fontSize: '30px', letterSpacing: '10px' } }, text));
  await sleep(1300); ov.style.transition = 'opacity .5s'; ov.style.opacity = 0; await sleep(500); closeOv('trans');
}

// ———————————————————— 事件 ————————————————————
export async function runEvent(ev, opts = {}) {
  const s = G.s;
  if (ev.loc) s.loc = ev.loc;   // locs（几处都行）的小剧情：就在玩家现在的地方演
  if (!s.done.includes(ev.id)) for (const l of [...(ev.lines || []), ...(ev.endLines || [])]) if (l.know) s.f[l.know] = false;   // 读档重放：名牌在自我介绍之后才变
  s.phase = 'event'; s.curEvent = ev.id; G.eventBgm = ev.bgm ? { ev: ev.id, slot: ev.bgm } : null;
  if (ev.mini) s.c.miniDay = s.day;   // 新增小剧情：一天最多一段
  if (ev.pool === 'ta_odd' || ev.id === 'd25_ta_mad') s.c.taOddDay = s.day;   // 牠今天发过疯（梳头不触发）
  saveRun(s);
  setScene(); refreshHud(); setSprite(null); renderActions('none');
  if (ev.special === 'd40' && !s.f.d40_warned) await d40Warning();
  if (ev.cg && hasAsset(`cg/${ev.cg}.webp`)) { await preload(A(`cg/${ev.cg}.webp`)); showCG(ev.cg); s.c.eventCgDay = s.day; s.c.eventCgAt = s.day * 4 + s.slot; }
  const fixed = expandLines(ev.lines || []).map(l => l.text === '{NAME_ANSWER}'
    ? (s.name ? { speaker: '你', text: `「${s.name}。」` } : { speaker: 'narration', text: '你张了张嘴，没说出来。' })
    : { ...l, text: l.text.replace('{FIRST_LINE}', FIRST_LINE) });
  if (ev.id === 'd40_question' && s.f.noticedGrind && !s.done.includes(ev.id)) {   // 第 40 天开场：他数着（问他走不走与刷数值 1111）
    const n = s.c.loads || 0;
    fixed.splice(Math.max(0, fixed.findIndex(l => l.speaker === '河')), 0, { speaker: '河', expr: 'blank', text: '你说了很多遍。……我数着。' }, ...(n >= 3 ? [{ speaker: '河', expr: 'blank', text: `你回来了${cnNum(n)}次。` }] : []));
  }
  if (ev.id === 'd1_meet' && s.loop > 0) fixed.splice(1, 0, { speaker: 'narration', text: LOOP_LINE });  // 第二周目
  await playLines(fixed);
  if (ev.ask && !s.done.includes(ev.id)) {   // 固定的小问答（第 14 天「你喜欢几瓣的？」，1112）：选完记标记，再接后面的流程
    await playLines(expandLines(ev.ask.lines));
    const i = await choose(ev.ask.choices); const c = ev.ask.choices[i];
    renderActions('none'); applyTags(s, c.tags || [], [], c.delta, { noCap: true }); Object.assign(s.f, c.set || {});
    await playLines(expandLines(c.lines || []));
  }
  if (ev.special === 'final') return finalJudge();
  if (ev.scene) await doTurn({ kind: 'event', event: ev, keepSprite: opts.keepSprite });
  if (ev.special?.startsWith('minigame:')) {
    const name = ev.special.split(':')[1];
    const res = name === 'organs' ? await organsGame() : await runMinigame(name, s);
    if (res.lines?.length) await playLines(res.lines);
  }
  const choices = ev.choices?.filter(c => !c.if || condOk(s, c.if))   // 选项可以按条件出现
    .map(c => c.needs && !condOk(s, c.needs) ? { ...c, text: '……', disabled: true } : c);   // needs 不满足：显示成「……」灰掉（第 34 天口袋里没有五瓣花）
  let fixedEnd = false;
  if (choices?.length) {
    if (ev.bgmAfter) setEventBgm(ev.bgmAfter);   // d21：meta 那一句过后回到夜里
    const i = ev.special === 'd40' ? await d40Choose(ev) : await choose(choices);
    const c = choices[i];
    renderActions('none');
    applyTags(s, c.tags || [], [], c.delta, { noCap: true });   // 固定事件的选项不受每天上限
    if (c.counter) s.c[c.counter] = (s.c[c.counter] || 0) + 1;
    Object.assign(s.f, c.set || {});
    if (c.set?.job) s.f.jobFrom = s.day + 1;
    // 特殊判定
    if (c.first) return firstNight(ev, c);   // 「第一次」：黑屏 → CG → 第二天早上
    if (ev.special === 'injury') {
      if (MID.departures({ ...s, madTier: tierOf(s) })) { markDone(s, ev); return triggerEnding('departures'); }
      applyTags(s, [], ['缝好了人']);
    }
    if (ev.special === 'ta_mad' && s.f.ta_mad_involved && MID.theseusHeLate(s)) {
      markDone(s, ev);
      await playLines([{ speaker: 'narration', text: '你被拖进了屋子。门在背后关上。' }, { speaker: 'narration', text: '河没有来。' }]);
      return triggerEnding('theseus');
    }
    let note = c.note;
    // 冲进去、河来得及（后期测试修改 §12 → 测试记录 14 §3）：AI 只写到「你」抓住牠为止，河怎么赶到由代码在 AI 之后补一句
    const heRescue = ev.special === 'ta_mad' && s.f.ta_mad_involved;
    if (heRescue) note = [note, '河怎么赶到由代码写。你只写「你」冲进去、抓住牠为止，不要写河出现。'].filter(Boolean).join('');
    if (ev.special === 'd40') {
      await playLines(D40_AFTER[c.set?.d40] || []);
      await playLines([{ speaker: 'narration', text: '天黑下来。他把鞋穿上，先走了。' }]);
      s.summary = (s.summary || '') + `第四十天黄昏，你对他说了「${c.text.replace(/[「」。]/g, '')}」。`;   // 第 41 天 AI 会知道
    } else if (c.lines) { await playLines(c.lines); fixedEnd = true; }   // 只有固定台词的选项：不调用 AI
    else await doTurn({ kind: 'choice', event: ev, text: c.text, note });
    if (ev.afterChoice && !fixedEnd) { await waitAdvance(); await playLines(expandLines(ev.afterChoice)); fixedEnd = true; }   // 这一场最后的固定收尾（第 14 天桃花节：AI 写完选项那一轮之后，测试记录 26）
    if (heRescue) { await waitAdvance(); await playLines([{ speaker: 'narration', text: '你刚抓住牠的手腕，门又被撞开了。河冲进来，从后面按住了牠的手。' }]); fixedEnd = true; }
  }
  const tail = ev.endLines ? expandLines(ev.endLines) : [];   // AI 那段、选项之后再接的固定台词（认路结尾给手机、第 6 天「你会走吗」）
  if (tail.length) {
    if (!fixedEnd && (ev.scene || choices?.length)) await waitAdvance();   // AI 写的最后一句先让玩家读完，不被固定台词立刻盖掉
    await playLines(tail); fixedEnd = true;
  }
  Object.assign(s.f, ev.set || {});
  if (ev.delta && !s.done.includes(ev.id)) applyTags(s, [], [], ev.delta, { noCap: true });   // 没有选项的固定剧情自带的数值（吃醋 2）
  if (!s.done.includes(ev.id)) for (const [k, n] of Object.entries(ev.addCounter || {})) {   // 事件给的东西（d8 满塞给你的那朵五瓣花，二测 · 3）
    s.c[k] = (s.c[k] || 0) + n;
    if (k === 'flowerFound') { s.f.flower_found = true; if (s.c[k] === n) toast('你把它放进了口袋。'); }
  }
  if (ev.set?.has_phone) refreshHud();
  if (ev.heFlags) applyTags(s, [], ev.heFlags);
  if (ev.unlockMisc) unlock('misc', ev.unlockMisc);
  for (const id of ev.alsoDone || []) if (!s.done.includes(id)) s.done.push(id);   // 兜底事件：原来那件算完成
  if (KEY_EVENTS[ev.id] && !ev.pool) (s.c.lastAt ||= {})[s.loc] = { day: s.day, id: ev.id };   // 地图卡片「上次在这里」（牠不正常的池子不记）
  markDone(s, ev);
  // 事件最后是 AI 写的段落（流式播放，最后一句不等点击）或选项结果时，才在这里等一下点击；
  // 只有固定台词的事件（比如衡的初见），最后一句在 playLines 里已经点过了，再等一次会像「点了没反应」
  if ((ev.scene || choices?.length || ev.special) && !fixedEnd) await waitAdvance();
  G.R.next.classList.add('hidden');
  showCG(null);
  if (ev.trigger === 'offline') return; // 离线事件不占时段
  if (ev.hurt) { queueHurt(s, ev.id); s.f.ta_hurt = { day: s.day, what: ev.hurt.what, he: ev.hurt.he, lines: ev.hurt.lines }; s.c.taHurt = (s.c.taHurt || 0) + 1; s.c.taHurtDay = s.day; }   // O5 / O6：被牠伤到了
  if (ev.mini && ev.thenArrive) {   // 牠不正常的那几段：演完接 AI 的到达那一轮，告诉 AI 牠自己不提
    G.eventBgm = null; s.c.afterRule = { day: s.day, slot: s.slot, loc: s.loc, text: (ev.afterRule || '牠刚才那样，牠自己不提；「你」问起，牠写一张字条岔开，或者装作没听见。') + AFTER_MINI };
    return arrive(s.loc, false, { skipVisit: true, afterMini: true });
  }
  if (ev.mini) {   // 新增小剧情（BGM 与固定小剧情 §2）：是碰上的，不占时段；演完回到自由行动，行动点不动
    G.eventBgm = null; s.phase = 'free'; s.lastSugg = [{ text: '四处看看', cost: 1 }, { text: '去找河', cost: 2 }];
    const heIn = [...(ev.lines || []), ...(ev.choices || []).flatMap(c => c.lines || [])].some(l => l.speaker === '河');
    if (heIn) s.afterEvent = { day: s.day, slot: s.slot, loc: s.loc, id: ev.id, heHere: true, who: [], last: '' };
    if (ev.afterRule || heIn) s.c.afterRule = { day: s.day, slot: s.slot, loc: s.loc, text: (ev.afterRule || '') + AFTER_MINI };   // 测试记录 14 §2：演完河还在，AI 让他说话不能被当成「不在场」删掉
    setScene(); refreshHud(); saveRun(s); renderActions('free'); return;
  }
  if (replyWindow(ev)) return;
  return endSlot();
}
// 固定事件结束后留 1 点接话（二测 · 4：d4、d6 结束直接跳时段，玩家没法当场接衡和河的话）
// 事件里的人都还在；最后走开的人可以喊住，他停一下、回一句
const NPC_OF = { 养母: '养母', '村民·男': '石', '村民·女': '芳', 满: '满', 衡: '衡' };
function replyWindow(ev) {
  const s = G.s;
  if (ev.special || ev.noReply || s.ended || DEMO && s.day > DEMO_LAST_DAY) return false;
  const all = [...(ev.lines || []), ...(ev.endLines || [])].filter(l => !l.if || condOk(s, l.if));
  const who = [...new Set(all.map(l => NPC_OF[l.speaker]).filter(Boolean))];
  const heHere = ev.heHere !== false && all.some(l => l.speaker === '河') || ev.heHere === true;
  if (!heHere && !who.length) return false;
  const last = all.filter(l => !l.text.startsWith('{')).slice(-3).map(l => (l.speaker === 'narration' ? '' : l.speaker + '：') + l.text.replace('{FIRST_LINE}', FIRST_LINE)).join(' ');
  // 事件最后几句里有人走开了（后期测试修改 §6）：接话这一轮他只停一下、回一句
  const tail3 = all.filter(l => !l.text.startsWith('{')).slice(-3);
  const goneLine = tail3.find(l => /走了|走开|跑了|跑回|跑开|出去|转身|离开/.test(l.text));
  const left = goneLine ? (heHere && (goneLine.speaker === '河' || /他|河/.test(goneLine.text)) ? '河' : who.find(n => goneLine.text.includes(n)) || (who.length === 1 ? who[0] : heHere ? '河' : null)) : null;
  s.afterEvent = { day: s.day, slot: s.slot, loc: s.loc, id: ev.id, heHere, who, last, left };
  s.phase = 'free'; s.ap = 1;
  s.lastSugg = [{ text: heHere ? '回他一句' : '接着说点什么', cost: 1 }];
  refreshHud(); saveRun(s); renderActions('free');
  return true;
}
// 固定台词里的占位：{NAME_CUSTOM} = 名字不是单字时，河解释单字名习俗（人肉测试 v2 · C5）
const OUTFIT_TOP = { initial: '毛衣', glasses: '毛衣', redthread: '毛衣', outside: '开衫', village: '蓝布褂子' };
function expandLines(lines) {
  const s = G.s, name = s?.name || '', short = [...name].pop() || '';
  return lines.flatMap(l => {
    if (l.if && !condOk(s, l.if)) return [];   // 按数值 / 之前的选择分支的固定台词
    if (l.text?.includes('{NAME_SAME}')) l = { ...l, text: l.text.replace('{NAME_SAME}', [...name].length > 1 ? `同${['', '一', '两', '三', '四'][[...name].length] || '几'}个字` : '同一个字') };   // R2 名字
    if (l.text?.includes('{OUTFIT_TOP}')) l = { ...l, text: l.text.replace('{OUTFIT_TOP}', OUTFIT_TOP[s?.outfit] || '毛衣') };   // 按当前装扮换词（d24 门缝的画，后期测试修改 §11）
    if (l.text !== '{NAME_CUSTOM}') return [l];
    if ([...name].length <= 1) return [];
    return [{ speaker: '河', expr: 'normal', text: `${name}。` }, { speaker: '河', expr: 'dazed', text: '……这里的人，名字都只有一个字。' },
      { speaker: '河', expr: 'normal', text: `村里会叫你「${short}」。` }, { speaker: 'narration', text: '他停了一下。' }, { speaker: '河', expr: 'turn', text: '我叫你全名。' }];   // 原文「我叫全的。」测试里被读成「他叫全」，改得直白一点
  });
}
// 「第一次」：AI 写亲密戏 → 黑屏 → CG（不配文字）→ 第二天早上
async function firstNight(ev, c) {
  const s = G.s;
  renderActions('none');
  // 亲密戏：成人内容开着由 AI 写（作者要求可以直接写，ADULT_NOTE 再重复一次）；关着就播固定的擦边段落（测试记录 14 §7），都写完再黑屏 → CG → 第二天
  // 测试记录 19 §1：CG 在亲密戏中间就出来（写到亲 / 吻的那一句，或者 AI 的第 3 句），后面的字压在 CG 上接着播
  G.firstCg = { id: ev.firstCg, n: 0 };
  if (ev.intimate && getSettings().adult) {
    const t = await doTurn({ kind: 'choice', event: { ...ev, after: ev.intimate + '\n' + ADULT_NOTE }, text: c.text, lines: '8–16' });
    await waitAdvance();
    if (ev.moleLines && !(t?.played || []).some(l => /痣/.test(l.text || ''))) await playLines(ev.moleLines);   // 河的痣（1111）：AI 没写到，黑屏前补上
  } else if (ev.softLines?.length) await playLines(expandLines(ev.softLines));
  if (G.firstCg?.id && hasAsset(`cg/${G.firstCg.id}.webp`) && !G.R.cg.classList.contains('on')) { showCG(G.firstCg.id); await waitAdvance(); }   // 没写到亲 / 吻也出一下
  G.firstCg = null;
  setSprite(null);
  const black = openOv('black', h('div', { style: { background: '#000', opacity: 0, transition: 'opacity 1.6s' } }));
  await sleep(50); black.style.opacity = 1; await sleep(1900);
  const b2 = black;   // 黑屏里收 CG，直接到第二天
  showCG(null);
  Object.assign(s.f, ev.firstSet || {});
  if (ev.firstSet?.he_first_awkward) s.f.he_first_day = s.day + 1;   // 第二天他别扭
  if (!s.done.includes(ev.id)) s.done.push(ev.id);
  if (ev.id === 'he_first' || ev.id === 'ta_first') queueKnow(s, ev.id + '_mother', '养母', s.day + 1, s.day + 2);   // 第二天第一次回养母家，养母的反应
  s.day++; s.slot = 0; s.phoneToday = 0; applyTags(s, [], [], dailyDelta(s)); dailyResent(s); madnessDrift(s);
  setScene(); refreshHud(); saveRun(s);
  b2.style.opacity = 0; await sleep(1300); closeOv('black');
  await playLines(ev.morning || []);
  s.curEvent = null; s.phase = 'map'; saveRun(s);
  if (ev.id === 'ta_first' && !s.done.includes('he_first')) return taFirstAfter(s);
  return startSlot();
}
// 牠的第一次比河的早：第二天上午（给ClaudeCode_牠先于河_第二天_1111，台词全固定）
// A：手机里三条夜里的消息 + 早上一条；B：玩家看完手机（或没看就点地图）出门，在牠屋外的坡上碰到他
const TA_AFTER_B = [
  { speaker: 'narration', text: '你从牠屋里出来，太阳刚上坡。' },
  { speaker: 'narration', text: '河在坡底下站着，手里拎着针线盒。他每天这个时候来学手艺。', show: { '河': 'normal' } },
  { speaker: 'narration', text: '他看见你。看了你出来的那扇门，又看回你。', show: { '河': 'blank' } },
  { speaker: 'narration', text: '他走上来，在你面前停住。目光落在你领口上。' },
  { speaker: '河', expr: 'blank', text: '……扣子。' },
  { speaker: 'narration', text: '扣子扣到了最上面一颗。他伸手，解开了那一颗。' },
  { speaker: '河', expr: 'aloof', text: '这样喘得过气。' },
  { speaker: 'narration', text: '他从你身边走过去，推开牠的门，进去了。没有回头。', hide: true },
];
export const TA_AFTER_RULE = '河知道「你」昨晚睡在牠那里。他不提，不问，话比平时少；「你」主动提起，他只说一句「……牠缝得比我好。」就岔开。';
export async function taFirstAfter(s) {
  const H = 3600e3, now = Date.now();
  const nightOf = new Date(now); nightOf.setHours(0, 0, 0, 0);   // 消息时间：前一晚夜里、更晚、快天亮（相对今天零点），早上一条现在
  const night = [['灯还亮着。', -2.5], ['你不在偏房。', 1.5], ['……', 4.8]];
  for (const [text, h] of night) s.phone.push({ from: 'he', text, ts: Math.min(now - 60e3, nightOf.getTime() + h * H), day: s.day - 1 });
  s.phone.push({ from: 'he', text: '早饭在锅里。', ts: now, day: s.day });
  s.unread = (s.unread || 0) + 4; s.c.taAfterDay = s.day; s.loc = 'ta_house';
  applyTags(s, [], [], { resent: 2 }, { noCap: true });
  s.phase = 'map'; saveRun(s); setScene('ta_house'); refreshHud(); renderActions('none');
  toast('手机震了好几下。');
  G.R.name.classList.add('hidden'); G.R.text.className = 'text narr'; G.R.text.textContent = '手机上有几条未读。';
  // 等玩家看完手机关掉，或者直接点地图
  await new Promise(res => {
    G.taAfterWait = res;
    const ob = new MutationObserver(() => { if (G.taAfterSawPhone && !$('#ov-phone')) { ob.disconnect(); res(); } else if ($('#ov-phone')) G.taAfterSawPhone = true; });
    ob.observe($('#overlays') || document.body, { childList: true });
    G.taAfterStop = () => ob.disconnect();
  });
  G.taAfterStop?.(); G.taAfterWait = G.taAfterStop = null; G.taAfterSawPhone = false;
  s.phase = 'event'; saveRun(s);
  await playLines(TA_AFTER_B);
  setSprite(null);
  return startSlot();
}

// ———————————————————— 第 40 天：他会强制读档 ————————————————————
// 「他回了几次档」记在存档外面（store 'd40'），读别的档绕回来他也记得
// 第 40 天选完之后的固定台词（Cowork 方案 §2）：立绘按顺序换
const D40_AFTER = {
  take:   [{ speaker: '河', expr: 'tears', text: '……好。' }, { speaker: '河', expr: 'smile', text: '那我去收拾。……也没什么要收拾的。' }],
  stay:   [{ speaker: '河', expr: 'shy', text: '留下来。' }, { speaker: '河', expr: 'blank', text: '那你以后，就不用走了。……对吧。' }],
  leave:  [{ speaker: '河', expr: 'giveup', text: '……嗯。' }, { speaker: '河', expr: 'giveup', text: '路我认得。我送你到雾那里。' }],
  silent: [{ speaker: '河', expr: 'turn', text: '……' }, { speaker: '河', expr: 'pout', text: '我知道了。你不用说。' }],
};
const D40_NAMES = ['', '第 40 天 · 再选一次', '第 40 天 · 求你了', '如果这就是你想要的'];
function d40Wanted(s) {
  if (s.v.hope >= 60) return 0;                       // 「我带你走」
  if (s.v.resent >= 60) return 1;                     // 「我留下来」
  if (s.v.love >= 70) return 2;                       // 「我一个人回去」
  return null;
}
async function d40Warning() {
  for (;;) {
    const v = await P.systemNotice('接下来的剧情会改动你的存档。建议先在一个空的存档位另存一份。', [{ label: '去存档', value: 'save' }, { label: '继续', value: 'go' }]);
    if (v === 'save') { await P.openSaves('save', true); continue; }
    break;
  }
  G.s.f.d40_warned = true;
}
function rewriteSaves(state, name) {
  // 改写：自动存档 + 玩家最近一次用过的手动存档位；其他存档位不动
  state.saveName = name;   // 当前进度也带着这个名字，之后自动存档一直叫这个
  const copy = clone(state);
  saveRun(copy, 'auto');
  const last = store.get('lastSlot');
  if (last && last !== 'auto') saveRun(copy, last);
}
async function heSays(text, expr = 'pinch') { await showLine({ speaker: '河', expr, text }); }
async function d40Choose(ev) {
  const s = G.s; const R = G.R;
  showCG(null);   // 收起 CG，让他的身体露出来
  const meta = store.get('d40', { rewinds: 0 });
  // 选项出现前一刻，自动存一份（回档就读它）
  s.f.d40_warned = true; s.f.d40_atChoice = true; saveRun(s, 'd40');
  const wanted = meta.rewinds >= 3 ? null : d40Wanted(s);
  if (wanted == null) {
    await heSays(meta.rewinds >= 3 ? '……你选吧。' : '你选吧。', meta.rewinds >= 3 ? 'giveup' : 'cold');
    return choose(ev.choices);
  }
  for (;;) {
    const level = Math.min(3, meta.rewinds + 1);
    setSprite('河', 'pinch');
    const i = await pinchChoice(ev.choices, wanted, level);
    if (i === wanted) { if (meta.rewinds === 0) s.madness = Math.max(-5, s.madness - 1.5); clearPinch(); return i; }
    meta.rewinds++; s.f.d40_rewinds = meta.rewinds;
    if (meta.rewinds < 3) meta.said = [...(meta.said || []), ev.choices[i].text.replace(/[「」]/g, '')];   // 备忘录留痕：回档前你说了什么（存在存档外面）
    store.set('d40', meta);
    if (meta.rewinds >= 3) {           // 第 3 次：不再回档，他放弃
      clearPinch();
      await heSays('……', 'giveup'); await waitAdvance(2);
      await heSays('如果这就是你想要的。', 'giveup'); await waitAdvance(10);
      applyTags(s, [], [], { resent: 10 });
      s.f.d40_rewinds = 3;
      rewriteSaves(s, D40_NAMES[3]);
      return i;
    }
    // 第 1、2 次：画面闪、抖，真的读回第 40 天选项之前的存档
    clearPinch();
    const scr = $('#scr-main'); scr.classList.remove('rewind-1', 'rewind-2'); void scr.offsetWidth; scr.classList.add('rewind-' + meta.rewinds);
    await sleep(meta.rewinds === 1 ? 650 : 1000);
    const back = loadRun('d40');
    if (back) {
      back.meta.loaded = true; back.c.loads = (back.c.loads || 0) + 1; back.f.d40_rewinds = meta.rewinds;
      restore(s, back);
      memoSync(s);   // 回档以后备忘录里留一条划掉的「你说了：……」
      rewriteSaves(s, D40_NAMES[meta.rewinds]);
    }
    refreshHud();
    await heSays(meta.rewinds === 1 ? '再选一次。' : '再选一次。……求你了。');
  }
}
function clearPinch() { G.R.pinch?.remove(); G.R.pinch = null; $('#scr-main')?.classList.remove('pinching'); }
// 选项浮在河身上，他的手捏住想要的那个；别的选项上停 1.5 秒他会说「……不是那个。」
function pinchChoice(choices, wanted, level) {
  const R = G.R; clearPinch(); renderActions('none');
  return new Promise(res => {
    let said = false, hoverTimer = null, touchedOnce = new Set();
    const notThat = () => { if (said) return; said = true; showLine({ speaker: '河', expr: 'pinch', text: '……不是那个。' }); };
    const opts = choices.map((c, i) => {
      const b = h('button', { class: 'pinch-opt' + (i === wanted ? ' bleed lv' + level : '') }, c.text);
      if (i !== wanted) {
        b.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') hoverTimer = setTimeout(notThat, 1500); });
        b.addEventListener('pointerleave', () => clearTimeout(hoverTimer));
      }
      b.addEventListener('click', e => {
        // 手机上第一次点别的选项先不生效
        if (i !== wanted && e.pointerType === 'touch' && !touchedOnce.has(i)) { touchedOnce.add(i); notThat(); return; }
        clearTimeout(hoverTimer); res(i);
      });
      return b;
    });
    // 新版：河手里捏着的那个框就是他想要的选项，字写在框上；其他选项竖着排在右边
    const boxImg = PINCH_BOX.img[level];
    if (hasAsset(boxImg)) {
      const k = PINCH_BOX.height / PINCH_BOX.h, [y0, y1] = PINCH_BOX.box[level], [x0, x1] = PINCH_BOX.text;
      const held = opts[wanted]; held.className = 'pinch-held';
      Object.assign(held.style, { left: PINCH_BOX.left + x0 * k + 'px', top: PINCH_BOX.top + y0 * k + 'px', width: (x1 - x0) * k + 'px', height: (y1 - y0) * k + 'px' });
      const others = h('div', { class: 'pinch-others' }, ...opts.filter((_, i) => i !== wanted));
      const fig = h('img', { class: 'pinch-fig', src: A(boxImg), alt: '', style: { left: PINCH_BOX.left + 'px', top: PINCH_BOX.top + 'px', height: PINCH_BOX.height + 'px' } });
      R.pinch = h('div', { class: 'pinch-layer box' }, fig, held, others);
      $('#scr-main').classList.add('pinching');   // 原来的立绘先藏起来，由这张图代替
      $('#scr-main').append(R.pinch);
      return;
    }
    // 旧版（没有新图时）：他想要的那个选项，右端正好在他手指捏住的地方
    const pinchReal = hasAsset('sprite/he/pinch.webp');
    const W = PINCH.height * 699 / 1000;
    const px = PINCH.left + PINCH.point[0] * W, py = PINCH.top + PINCH.point[1] * PINCH.height;
    const list = h('div', { class: 'pinch-list', style: pinchReal ? { left: (px + 36 - 400) + 'px', top: (py - 26 - wanted * 60) + 'px' } : {} }, ...opts);
    // 手和小臂单独一层（从同一张立绘里裁出来），叠在选项上面
    const hand = pinchReal && hasAsset(PINCH.handImg) ? h('img', { class: 'pinch-hand-layer', src: A(PINCH.handImg), alt: '',
      style: { left: PINCH.left + 'px', top: PINCH.top + 'px', height: PINCH.height + 'px' } }) : null;
    R.pinch = h('div', { class: 'pinch-layer' + (pinchReal ? ' real' : '') }, list, hand);
    $('#scr-main').append(R.pinch);
  });
}

function markDone(s, ev) { if (!s.done.includes(ev.id)) s.done.push(ev.id); s.curEvent = null; saveRun(s); }

// ———————————————————— 离线回来 ————————————————————
export async function wakeUp(ms) {
  const s = G.s;
  // 判定离线后、河的反应写完之前，玩家不能操作（防止连点跳过）
  G.forceAuto = true;
  const lock = openOv('wakelock', h('div', { style: { background: 'transparent', cursor: 'wait' } }));
  try { await wakeInner(ms); } finally { G.forceAuto = false; closeOv('wakelock'); G.sleeping = false; $('#scr-main')?.classList.remove('asleep'); }
}
async function wakeInner(ms) {
  const s = G.s;
  s.meta.offlineMs = ms; s.meta.feignTurns = 3;
  addResent(s, ms >= 3 * 24 * 3600e3 ? 5 : ms >= 24 * 3600e3 ? 3 : ms >= 3 * 3600e3 ? 1 : 0, '你不在');   // 数值与怨恨 §1-1
  s.c.offlineCount = (s.c.offlineCount || 0) + 1;
  if (ms >= 24 * 3600e3) s.c.longOffline = (s.c.longOffline || 0) + 1;   // 离开过一天以上（隐藏结局要求从没有过）
  const scr = $('#scr-main'); scr.classList.add('waking');
  // 假死：左下角的你换成闭眼的脸
  G.feign = true;
  setSprite(null); setScene(); refreshHud(); renderActions('none');
  P.fetchOfflineMessages(ms);
  setTimeout(() => scr.classList.remove('waking'), 5000);
  const first = G.events.find(e => e.trigger === 'offline');
  if (first && !s.done.includes(first.id) && ms >= 3 * 3600e3) {
    await runEvent(first);
  } else {
    await playLines([{ speaker: 'narration', text: '你醒了。身体很沉，像在水底躺了很久。' }]);
    G.last = null;
    await doTurn({ kind: 'wake' });
    while (G.typing) await sleep(50);
    await waitAdvance();   // 测试记录 18 §4：最后一句读完再进地图（之前打字到一半地图就弹出来，看起来像截断）
  }
  G.feign = false; refreshPortrait();
}

// 玩家回来了（gap = 现在 − lastActive）。返回 true 表示在游戏里处理掉了
export function playerReturned(gap, e, { hidden = false } = {}) {
  const s = G.s;
  if (!s || !G.R || !$('#scr-main.active')) return false;
  if (gap >= MID.godotDays * 24 * 3600e3) { swallow(e); triggerEnding('godot'); return true; }
  if (gap >= 30 * 60e3) {
    swallow(e);
    if (gap >= MID.lambsMinOfflineH * 3600e3 && MID.lambs({ ...s, madTier: tierOf(s) })) { triggerEnding('lambs'); return true; }
    if (G.busy || G.inTurn || s.phase === 'event' || G.waking) { s.meta.offlineMs = gap; return true; }   // 正在演的时候不打断，下一轮让河知道
    G.waking = true;
    for (const id of ['map', 'phone', 'stats', 'menu', 'saves', 'log']) closeOv(id);
    wakeUp(gap).then(() => { G.waking = false; resumePhase(); });
    return true;
  }
  // 只算点对话框 / 画面（或按空格、回车翻页）；点手机、地图、菜单、设置，以及对话框里「记录 / 自动 / 存档」这些按钮的那一下不算
  const onDialog = !e || (e.type === 'keydown' ? [' ', 'Enter'].includes(e.key)
    : !!e.target?.closest?.('.dialog, #scr-main .bg') && !e.target.closest('button, .ctl'));
  // 1–30 分钟：页面切到过后台（≥ 1 分钟），或者在前台闲置 ≥ 3 分钟，才算走开了一会儿（测试记录 8：之前 1 分钟就算，开着自动播放也会触发）。
  // 自动播放 / 打字 / 等 AI 的时候 startIdleWatch 一直在记「人在」，所以看剧情不会攒出空档
  if (G.R.chars?.he && s.phase !== 'event' && (hidden || gap >= 3 * 60e3) && onDialog) metaLine('away');
  return true;
}
function swallow(e) {
  if (!e) return;
  e.preventDefault?.(); e.stopPropagation?.();
  // 这一下点击不要落到界面上
  const kill = ev => { ev.stopPropagation(); ev.preventDefault(); };
  addEventListener('click', kill, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', kill, { capture: true }), 600);
}
// 网页开在前台但超过 30 分钟没操作：画面上的你先变成假死，对话框写「你睡着了。」（只是画面，判定还是靠时间戳）
// 标签页标题 meta（借鉴机制与结局 §1，OneShot）：切走时标题换一句，切回来马上变回。第 6 天起、一局最多 3 次、每次 30%，同一句不重复；
// 第 40 天起固定「别走」、不限次数。不算进 EXTRA_META_MAX（不打断剧情）
const TITLE = '河边的错误';
const TITLE_LINES = { god: ['……还在吗', '灯还亮着'], mid: ['你去哪了', '饭凉了'], mad: ['我看见你走了', '　'] };
export function installTitleMeta() {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { document.title = TITLE; return; }
    const s = G.s; if (!s || s.ended || !$('#scr-main.active')) return;
    if (s.day >= 40) { document.title = '别走'; return; }
    const m = s.meta; m.titleUsed ||= [];
    if (s.day < 6 || m.titleUsed.length >= 3 || Math.random() >= 0.3) return;
    const left = TITLE_LINES[tierOf(s)].filter(t => !m.titleUsed.includes(t)); if (!left.length) return;
    const t = left[Math.floor(Math.random() * left.length)];
    m.titleUsed.push(t); document.title = t; saveRun(s);
  });
}
export function startIdleWatch() {
  // 在演（台词在打字、AI 在写、自动播放在走）就算人在看：持续记活动时间（小修与复查 1109 §2）
  setInterval(() => { if (!document.hidden && (G.typing || G.inTurn || G.busy || (G.auto && G.waitClick))) touchActive(); }, 5000);
  setInterval(() => {
    if (G.sleeping || G.waking || !G.s || !G.R || !$('#scr-main.active') || G.busy) return;
    if (idleFor() >= 30 * 60e3) {
      G.sleeping = true; G.feign = true; refreshPortrait();
      $('#scr-main').classList.add('asleep');
      G.R.name.classList.add('hidden'); G.R.text.className = 'text narr'; G.R.text.textContent = '你睡着了。';
    }
  }, 20000);
}

// 继续游戏：根据离开时的阶段接上
export async function resumePhase() {
  const s = G.s;
  if (s.phase === 'event' && s.curEvent) { const ev = G.events.find(e => e.id === s.curEvent); if (ev) return runEvent(ev); }
  if (s.phase === 'free') { if (!s.lastSugg?.length) s.lastSugg = [{ text: '四处看看', cost: 1 }, { text: '去找河', cost: 2 }]; setScene(); refreshHud(); renderActions('free'); if (!G.R.text.textContent) { G.R.text.className = 'text narr'; G.R.text.textContent = taText(s, `${LOCATIONS[s.loc].name}。`); } return; }
  return startSlot();
}

// ———————————————————— 结局 ————————————————————
async function finalJudge() {
  const s = G.s;
  s.f.otherEnding = Object.keys(getGallery().endings || {}).some(id => id !== 'button');   // 前目的地一周目打不出（Cora 11/11）
  return triggerEnding(judgeFinal({ ...s, madTier: tierOf(s) }));
}
// 试玩版结束：不进结局，谢谢 + 信箱
async function demoEnd(finished = false) {
  const s = G.s; s.ended = 'demo'; saveRun(s);
  closeOv('map'); renderActions('none'); setSprite(null); showCG(null);
  await P.blackLines(finished ? [`第 ${DEMO_LAST_DAY} 天过完了。`, '试玩就到这里。', '后面的三十二天，还在做。', '谢谢你陪她住了这几天。'] : ['试玩就到这里。', '谢谢你陪她住了这几天。']);
  if (finished) store.set('demo_done', 1);   // 玩完十天：封面的「结局」可以点开了
  G.R = null; G.backTitle();
  if (finished) modal('demodone', '谢谢你玩完试玩版', h('div', { class: 'how-text' },
    '请按照发给你的表格，填一下试玩问卷。你的感受对后面很重要。\n\n另外，封面上的「结局」现在可以点开了：\n能看到完整版有哪些结局，点开每一张，看它怎么达成。\n\n还有想说的，也可以用封面上的「信箱」写给作者。'),
    { buttons: [{ label: '好', value: 1 }] });
  else P.openMailbox();
}
export async function triggerEnding(id) {
  if (DEMO) return demoEnd();   // 试玩版没有结局（比如离线太久的「等待戈多」）
  const s = G.s; const e = ENDINGS[id];
  const firstTime = unlock('endings', id); if (e.cg) unlock('cgs', e.cg);
  s.ended = id; saveRun(s);
  if (AFTERMATH[id]) store.set('after', { kind: AFTERMATH[id], outfit: s.outfit, loc: s.loc, tier: tierOf(s) }); else store.del('after');   // tier：等待戈多按档换后效画面
  if (id === 'truman') store.set('lock_truman', { at: Date.now() });
  // 标题封面：只有「第一次」打出有特殊封面的结局才换；重复打、没有封面的结局（含‘土拨鼠之日’）都保持当前封面
  if (firstTime && COVER_OF[id]) store.set('cover', COVER_OF[id]);
  store.set('lastEnding', id);
  closeOv('map'); G.R = null;
  await showEnding(id, s);
  if (id === 'truman') return showLock();
  if (id === 'groundhog') {
    store.del('after');
    if (!store.get('groundhog_hint')) { store.set('groundhog_hint', 1); await P.blackLines(['没有走到想去的地方。……也许下一次。'], { faint: true }); }   // 只在第一次打出时（数值与台词排查 §4）
    const n = newRun(s.outfit, (s.loop || 0) + 1);
    return startRun(n);
  }
  G.backTitle();
}

// ———————————————————— 开局 ————————————————————
export async function startRun(s) {
  G.s = s; G.last = null;
  store.del('after');
  saveRun(s);
  buildMain(); refreshHud();
  await startSlot();
}
// ———— 当面读档的反应（给ClaudeCode_当面读档的反应_1111）————
const LOAD_PLAIN = ['……刚才是不是有什么不一样了。', '你做了什么？……我好像在哪里，已经听过你这句话。', '等一下。……没事。可能是我睡迷糊了。'];
const pick = a => a[Math.floor(Math.random() * a.length)];
// n：同一个存档第几次读；prev：读档之前那一局（取「你」最后说的话）。返回要先播的几句和怨恨，没有就 null
export function loadReaction(s, n, prev) {
  const lines = []; let resent = 0;
  const tier = madTier(s.madness || 0);
  if (s.heOnScreen) {
    const p = n >= 3 || (s.day >= 38 && s.day <= 41) ? 1 : 0.4 + (tier === 'mad' ? 0.3 : tier === 'god' ? -0.15 : 0) + (n === 2 ? 0.2 : 0);
    if (Math.random() < p) {
      s.c.loadNoticed = (s.c.loadNoticed || 0) + 1;
      const v = s.v, he = (text, expr = 'alert', extra = {}) => ({ speaker: '河', expr, text, ...extra });
      if (n >= 3) { lines.push(he(pick(['又来了。', '……你在找哪一句。']))); resent = 2; }
      else if (v.resent >= 60) { lines.push(he(pick(['你随时能重来。我不能。', '再来几次，我也还是这样。']), 'cold')); resent = 3; }
      else if (tier === 'mad') { lines.push(he(pick(['你又把我叠回去了。……我数着呢。', '刚才那个我，你放哪儿了。']), 'alert', { glitch: true })); resent = 2; }
      else if (v.love >= 70) { lines.push(he(pick(['你在找哪一个我？……这个不好吗。', '……没关系。你想再听一遍，我就再说一遍。']))); resent = 1; }
      else if (v.restraint <= 30) { if (Math.random() < 0.5) lines.push({ speaker: 'narration', text: '他抓住了你的手腕。' }, he('别再拿回去了。')); else lines.push(he('……你又要走一次？')); resent = 2; }
      else if (tier === 'god') { lines.push(he(pick(['……又是这里。没关系，再来一次也行。', '疼的地方，还是那里吗。']))); resent = 1; }
      else { lines.push(he(pick(LOAD_PLAIN))); resent = 2; }
      lines[lines.length - 1].glitch = true;
    } else {
      s.c.loadMissed = (s.c.loadMissed || 0) + 1;
      if (Math.random() < 0.3) lines.push({ speaker: 'narration', text: '他手里的针停了一下，又接着缝。' });
    }
  }
  if (s.taOnScreen || s.loc === 'ta_house') {   // 牠也隐约知道：不加数值，河看不见，AI 之后也不提
    const r = Math.random();
    if (r >= 0.85) {
      const last = [...(prev?.history || [])].reverse().find(m => m.role === 'user' && /【玩家(行动|选择)】/.test(m.content))?.content.match(/【玩家(?:行动|选择)】(?:（玩家自己输入的）)?([^\n]*)/)?.[1] || '';
      const cs = [...last].filter(c => /[\u4e00-\u9fa5]/.test(c) && !'的了是在我你他吗呢么吧啊'.includes(c));
      lines.push({ speaker: '牠', expr: 'note', text: `「${cs.length ? pick(cs) : '又'}」` });
    } else if (r >= 0.5) lines.push({ speaker: 'narration', text: '牠笑了一下。' });
  }
  return lines.length ? { lines, resent } : null;
}
// ———— 给河 / 牠梳头（给ClaudeCode_梳头_1111，台词在 方案与文本/梳头_河与牠_初稿_1111.md）————
const COMB_RE = /梳|扎.{0,2}头发|束发|编.{0,2}辫|绑.{0,2}头发|解.{0,3}头发|摸.{0,3}头发|头发.{0,6}(扎|梳|束|编|绑|理)|(梳|扎|束|编|绑).{0,4}头/;   // 测试记录 21：「把头发重新扎一下」也要认
const cN = (text, k = {}) => ({ speaker: 'narration', text, ...k }), cH = (text, expr = 'normal') => ({ speaker: '河', expr, text }), cT = text => ({ speaker: '牠', expr: 'note', text });
const COMB = {
  河_rash: { delta: { restraint: -1 }, lines: [cN('你的手指刚穿进他的头发，他就抓住了你的手腕。', { show: { 河: 'alert' } }), cN('抓得很紧。他没回头，呼吸乱了一下。'), cH('……别。', 'alert'), cN('过了很久，他才松开，把你的手放回你膝盖上，像放回一件不该碰的东西。')] },
  河_low: { lines: [cN('你的手刚碰到他的发尾，他就往旁边让开了。'), cH('……我自己来。', 'pout'), cN('他把布条解下来，重新扎了一遍，扎得比原来还紧。')] },
  河_mid: { delta: { love: 1 }, lines: [cN('他没躲。你把那根米白布条解下来，头发一下子散开，垂到腰。'), cN('{COMB_LIGHT}'), cN('他坐得很直，一动不动，像在等人给他缝针。'), cH('……别扯。', 'shy'), cN('你用手指一点点把头发理顺，拢到一边，扎上。'), cH('左边高了。'), cN('他伸手摸了摸，手停在那个结上。'), cH('……就这样吧。', 'shy'), cN('那天他一直没有重扎。')] },
  河_high: { delta: { love: 1, restraint: 1 }, lines: [cN('他从抽屉里拿出一把木梳，递给你。'), cH('……梳吧。'), cN('你从发尾梳起。他背对着你，肩膀一点一点松下来。'), cH('小时候我妈也这样。', 'dazed'), cH('……后来我就自己扎了。'), cN('梳到最后，他没让你扎。他把布条放进你手心，合上你的手指。'), cH('先放你那儿。', 'shy')] },
  牠_low: { lines: [cN('你的手还没碰到，牠就攥住了你的手腕。牠的手很冷。'), cT('「不。」')] },
  牠_mid: { delta: { love: 1 }, lines: [cN('牠没拦你，只是抬起一只手，按住了脸前那一片头发。'), cT('「前，不。」'), cN('你从后面梳。头发很长，一直拖到地上，凉得像水。'), cN('梳着梳着，梳齿勾出来一截红线，又一截。还有几片干掉的花瓣，四瓣的，夹在头发里不知道多久了。'), cN('牠一直很安静。梳完了，牠把那几截红线一根一根收进袖子里。')] },
  牠_high: { delta: { love: 1 }, lines: [cN('你梳到前面，牠按着头发的手停了一下，慢慢放下来了。'), cN('你把头发往两边拨开。'), cN('你第一次看清牠的脸。比你想的年轻，眉骨很高，眼睛是锋利的，锋利得不像平时那个人。'), cN('牠没有看你。牠闭着眼睛。'), cN('过了一会儿，牠自己把头发拨回去，盖住了。'), cT('「别，告诉，他。」')] },
};
const COMB_POOL = {
  河: ['他说「左边又高了」', '他自己把布条递过来', '他梳完你的头发作为交换', '他闭着眼', '他嫌你手凉', '他把掉的头发捡起来缠成一小圈收好'],
  牠: ['梳出一根针', '牠把一缕头发剪下来给你', '牠让你编一根辫子，编完又拆了', '牠的头发里有很淡的药味', '牠伸手也碰了一下你的头发'],
};
// 返回 true：这次梳头由代码处理了（固定台词，扣 1 点）；返回 { rule }：交给 AI，带这句；null：不是梳头
async function combAct(t) {
  const s = G.s;
  if (!COMB_RE.test(t) || !/他|河|牠|给|帮|替/.test(t) || hideDay(s)) return null;
  const heHere = heLocation(s.day, s.slot) === s.loc || s.apptNow?.who === '河' || (s.afterEvent?.heHere && s.afterEvent.day === s.day && s.afterEvent.slot === s.slot && s.afterEvent.loc === s.loc);
  const who = s.loc === 'ta_house' && (/牠/.test(t) || !heHere) ? '牠' : heHere ? '河' : null;
  if (!who) return null;
  let key;
  if (who === '牠') {
    if (s.c.taOddDay === s.day || s.c.taHurtDay === s.day) key = 'mad';   // 牠刚发过疯：缩回手
    else key = s.v.love >= 80 ? 'high' : s.v.love >= 40 ? 'mid' : 'low';
  } else key = s.v.restraint <= 30 && !s.f.comb_he_rash ? 'rash' : s.v.love >= 70 ? 'high' : s.v.love >= 40 ? 'mid' : 'low';
  const seen = (s.c.comb ||= {});
  if (key !== 'mad' && seen[who + '_' + key]) return { rule: `「你」又在给${who}梳头。这件事你们做过了，别照抄上次；可以从这里挑一两样写（不用全写）：${pickBits(s, 'comb_' + who, COMB_POOL[who]).join('；')}。${who === '牠' ? '牠的脸不写，不写像河。' : ''}` };
  const C = key === 'mad' ? { lines: [cN('牠把手缩了回去。'), cT('「不。」')] } : COMB[who + '_' + key];
  if (key !== 'mad') seen[who + '_' + key] = true;
  if (key === 'rash') s.f.comb_he_rash = true;
  const lines = C.lines.map(l => l.text === '{COMB_LIGHT}' ? { ...l, text: s.slot >= DUSK ? '灯底下，你才看清，黑头发底下那一层是墨绿的。' : '光从窗纸透进来，你才看清，黑头发底下那一层是墨绿的。' } : l);   // 白天 / 夜里两种（测试记录 21）
  setBusy(true); try { await playLines(lines); } finally { setBusy(false); }
  if (C.delta) applyTags(s, [], [], C.delta, { noCap: true });
  if (who === '河' && key === 'mid') s.c.combDusk = s.day;
  if (who === '河' && key === 'high') s.c.hairDown = s.day;
  if (who === '牠' && key === 'high') s.f.saw_ta_face = true;
  s.ap = Math.max(0, s.ap - 1); saveRun(s); refreshHud(); flashCost(1);
  if (s.ap <= 0) endSlot(); else renderActions('free');
  return true;
}
// ———— 第 22–24 天河躲着你（给ClaudeCode_第22到24天河躲着你_1111）————
export const hideDay = s => s.day >= 22 && s.day <= 24;
const HIDE_RULE = '河这几天谁都找不到（越界之后他在躲「你」）。他这一段绝对不出场：不写他的台词、动作、身影、声音。被问到河在哪，谁都说不知道、没看见；芳可以多嘴一句「你俩吵架了？」。';
const HIDE_CALL = /(和|跟|找|叫|喊|等|陪|去见)(小)?河|河(呢|在哪)/;
// ———— 问他走不走 + 刷数值（给ClaudeCode_问他走不走与刷数值_1111）————
const GO_ASK = /(想不想|要不要|愿不愿意|跟我|和我|我们)(一起)?(出去|离开|走|回去|去外面)|带你(走|出去)/;
const GO_ROWS = [
  ['early', s => s.day <= 21, '当没听懂，岔开', '「……出去？」「线打结了。」'],
  ['hiding', s => s.day >= 22 && s.day <= 23, '只回一个字，走开', '「……不。」'],
  ['resent', s => s.v.resent >= 60, '冷，带刺', '「你出得去。我出不去。」'],
  ['nohope', s => s.v.hope <= 20, '不信', '「你说过的话，第二天就忘了。」'],
  ['want', s => s.v.hope >= 60 && s.v.love >= 60, '想，但不敢说想；停很久', '「……你别骗我。」'],
  ['mad', s => madTier(s.madness || 0) === 'mad', '话歪掉', '「出去是哪边？……雾那边，还是你那边。」'],
  ['rash', s => s.v.restraint <= 30, '冲动，越界一下再收', '「现在就走。」（停住）「……我是说，药还没熬。」'],
  ['god', s => madTier(s.madness || 0) === 'god', '平静、像在安慰「你」', '「你想出去，就出去。我在这里也挺好。」'],
  ['else', () => true, '接住再躲', '「……你想听我说什么。」'],
];
function goAskRule(s) {
  const [k, , how, ex] = GO_ROWS.find(r => r[1](s));
  const n = (s.c.goAsk ||= {})[k] = (s.c.goAsk[k] || 0) + 1;
  return `「你」在问河想不想出去 / 要不要一起走。他这次的反应：${how}。${n === 1 ? `示范：${ex}` : `意思像这样，但不要再用${ex}这句，换一句`}。`;
}
export function grindMode(s) { return !!s.meta?.loaded && s.day >= 30 && Object.keys(getGallery().endings || {}).length > 0; }
const charsOf = t => new Set([...String(t)].filter(c => /[\u4e00-\u9fa5]/.test(c)));
function sameish(a, b) { const A = charsOf(a), B = charsOf(b); if (A.size < 4 || B.size < 4) return false; const [x, y] = A.size <= B.size ? [A, B] : [B, A]; return [...x].filter(c => y.has(c)).length / x.size >= 0.6; }
const GRIND_ROWS = [
  [s => s.v.resent >= 60, '（expr 写 cold）「你说这个，是想让我怎么样？」'],
  [s => madTier(s.madness || 0) === 'mad', '（expr 写 dazed）「你又说一遍。……上一个你也这么说。」'],
  [s => s.v.love >= 70, '（expr 写 tears）「你不用一直说。……我听见了。」'],
  [s => s.v.restraint <= 30, '先一句旁白「他按住你的嘴。」，再让他说（expr 写 pout）「……够了。」'],
  [s => madTier(s.madness || 0) === 'god', '（expr 写 smile）「说一遍就够了。我记得。」'],
  [() => true, '（expr 写 aloof）「……你今天怎么老说这个。」'],
];
function grindRule(s, text) {
  const prev = s.c.recentSay || [];
  s.c.recentSay = [...prev, text].slice(-3);
  if (!grindMode(s) || s.c.grindDay === s.day) return null;
  if (!(s.c.grindPending === s.day || prev.some(p => sameish(p, text)))) return null;
  s.c.grindDay = s.day; s.c.grindPending = null;
  s.c.grindCount = (s.c.grindCount || 0) + 1;
  if (s.c.grindCount === 3) { s.f.noticedGrind = true; addResent(s, 1, '察觉你在刷'); }
  return `「你」这一阵一直在说同样的话。河这一轮察觉了，要说这一句（speaker 写 "河"）：${GRIND_ROWS.find(r => r[0](s))[1]}。其余照常写。`;
}
const CN = '零一二三四五六七八九';
export function cnNum(n) { if (n < 10) return CN[n]; if (n < 20) return '十' + (n % 10 ? CN[n % 10] : ''); if (n < 100) return CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : ''); return String(n); }
// 读档前把上一局流程留下的状态全部复位
export function resetFlow() {
  G.gen = (G.gen || 0) + 1;
  G.busy = false; G.inTurn = false; G.waitClick = null; choiceResolver = null; G.endingSlot = false;
  G.firstCg = null; G.taAfterWait = null; G.forceAuto = false; G.persuade = false; G.eventBgm = null; G.typing = false; G.metaQueue = [];
  for (const id of ['map', 'phone', 'phoneflash', 'black', 'trans', 'mini', 'organ', 'stats', 'outfit', 'cgview', 'sys']) closeOv(id);
}
export async function continueRun(s, offlineMs, alertLine = null) {
  resetFlow();
  G.s = s; G.last = null;
  buildMain(); setScene(); refreshHud();
  if (alertLine) {   // 当面读档的反应（loadReaction 算好的几句）
    const R = typeof alertLine === 'string' ? { lines: [{ speaker: '河', expr: 'alert', text: alertLine, glitch: true }], resent: 2 } : alertLine;
    if (R.resent) import('./audio.js?v=1794428964').then(a => a.stutter()).catch(() => {});
    await playLines(R.lines);
    // 测试记录 21：读档恢复的状态里今天的上限可能已经用完，当面读档不受上限
    if (R.resent) { applyTags(s, [], [], { resent: R.resent }, { noCap: true }); s.meta.saidMeta = R.lines.filter(l => l.speaker === '河').map(l => l.text).join(''); }
    saveRun(s);
  }
  if (offlineMs >= 30 * 60e3) await wakeUp(offlineMs);
  await resumePhase();
}
