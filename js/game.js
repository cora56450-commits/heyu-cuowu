// 主循环：主界面、对话播放、行动点、时段推进、事件、结局判定
import { h, $, A, sleep, showScreen, openOv, closeOv, toast, preload, modal } from './ui/dom.js?v=1794222138';
import { getSettings, store, unlock, getGallery, organsOpen } from './store.js?v=1794222138';
import { chat, ApiError } from './api.js?v=1794222138';
import { buildSystem, summaryPrompt, phonePingPrompt, phoneChatPrompt } from './prompt.js?v=1794222138';
import { normTurn, LineStreamer, looseJson } from './parse.js?v=1794222138';
import { AI_TAGS } from './config/values.js?v=1794222138';
import { SLOTS, LOCATIONS, TOTAL_DAYS, AP_PER_SLOT, DUSK, NIGHT, heLocation, OUTFITS, SPRITE_DIR, DEFAULT_EXPR, FIRST_LINE, EXPR, SPRITE_FIT, spriteBox, NPC_SPRITES, NPC_FIT, DUO, EXPR_FALLBACK, FEIGN_PATCH, PINCH, PINCH_BOX, VILLAGERS, NPC_PRESENCE, motherAway } from './config/world.js?v=1794222138';
import { DAILY, VILLAGE_OUTFIT_ASSIM, WARM_STREAK, madTier } from './config/values.js?v=1794222138';
import { ENDINGS, judgeFinal, MID, AFTERMATH, LOOP_LINE } from './config/endings.js?v=1794222138';
import { newRun, applyTags, saveRun, loadRun, clone, tierOf, knows, taText, phoneStage } from './state.js?v=1794222138';
import { rollMeta, collectInjections, splitGarble, EXTRA_META, canExtraMeta, markExtraMeta, idleFor } from './meta.js?v=1794222138';
import { findCliches, CLICHES } from './config/style.js?v=1794222138';
import * as P from './ui/panels.js?v=1794222138';
import { runMinigame } from './ui/minigames.js?v=1794222138';
import { openOrgan, organPuzzle } from './ui/organ.js?v=1794222138';
import { showEnding, showLock } from './ui/ending.js?v=1794222138';

export const G = { s: null, R: null, events: [], busy: false, last: null, backTitle: null };
const SIZE_COST = { small: 1, medium: 2, large: 3 };
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
const LAST_ACTION_NOTE = '这是这个时段的最后一件事。写完这件事以后把场景收住（河说完话、各自去忙、或者自然地分开），最后一条不要是等玩家回答的问题。';
const PLACE_WORDS = [['he_room', /河的房间|他的房间|他屋/], ['room', /偏房|我的房间|我屋|我那屋|回屋/], ['yard', /养母家|院子|回家/], ['creek', /溪/], ['ta_house', /牠的屋|缝者|牠那/], ['fields', /田|晒场/], ['peach', /桃花林/], ['tomb', /后山|古墓/], ['border', /村界|雾/], ['path', /石径|村里转/]];
const placeIn = t => (PLACE_WORDS.find(([, re]) => re.test(t)) || [])[0];
const isLockedLoc = id => { const L = LOCATIONS[id]; return !L || (L.unlockDay && G.s.day < L.unlockDay && !(id === 'border' && G.s.f.border_found)); };
const BIG_ACTION = { yard: '帮养母做完这一段的活', room: '在偏房歇过这一段', he_room: '陪他待过这一段', creek: '沿着溪往下走一趟', fields: '在地里干完这一段', peach: '在桃花林里走远一点', ta_house: '帮牠收拾一整段', tomb: '在后山走一圈', border: '沿着雾边走一段', path: '在村里慢慢转一圈' };
const SLOT_CLOSE = ['到晌午了。', '日影斜了。', '天暗下来了。', '夜深了。'];
// 衡分的活（d7_work）：对应地点、时段多一条「干活（2 点）」，一天一次；不加同化（人肉 v3 · 4）
const JOBS = {
  fields: { loc: 'fields', slots: [0, 1], note: '「你」在晒场干活（翻晒、收粮）。常碰到石、芳。干活时让村民顺口说一条关于小河的旧事。这只是干活过日子，不要写成「你」在融入村子。' },
  yard: { loc: 'yard', slots: [0, 2], note: '「你」给养母打下手（择菜、挑水、烧火）。养母边干边讲一段村里的旧事，或者教「你」做一道菜。这只是干活过日子，不要写成「你」在融入村子。' },
  ta: { loc: 'ta_house', slots: [1], note: '「你」给牠送午饭。牠吃得很少，吃完写一张字条推给「你」（牠的台词用字条格式）。这只是送饭，不要写成「你」在融入村子。' },
};
// 「河的第一次」之后那一天：回避型，越界之后会自省
const HE_FIRST_AFTER = '昨晚你们越过了那条线。今天河有点别扭：躲着你、话比平时更少，不提昨晚，也不说任何占有的话。他在跟自己较劲，不是在生你的气。';

export async function loadEvents() {
  // 发布版的 events.json 是编码过的（tools/build_dist.py），以 E1: 开头
  const t = await fetch('data/events.json?v=1794222138').then(r => r.text());
  const j = JSON.parse(t.startsWith('E1:') ? (await import('./_k.js?v=1794222138')).decode(t.slice(3)) : t);
  G.events = j.events;
  try { G.assets = new Set(Object.keys(await fetch('assets/manifest.json').then(r => r.json()))); } catch { G.assets = null; }
}
// 素材在不在（新立绘没到之前用替代的）
export const hasAsset = p => !G.assets || G.assets.has(p);

// ———————————————————— 主界面 ————————————————————
function bgFor(loc, slot) {
  const L = LOCATIONS[loc] || LOCATIONS.creek;
  const night = slot === NIGHT; const dusk = slot === DUSK;
  const src = night && L.bg[1] ? L.bg[1] : L.bg[0];
  const filter = night && !L.bg[1] ? 'brightness(.42) saturate(.7) hue-rotate(-10deg)' : dusk ? 'sepia(.25) brightness(.9)' : 'none';
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
  showScreen('main', scr);
  G.R = R; G.auto = false;
  return R;
}

// 第 2 天认路结尾河给你手机；之前右上角没有手机（旧存档按天数算已经有了）
export const hasPhone = s => !!s && (!!s.f.has_phone || s.day > 2 || s.done.includes('d2_settle'));
export function refreshHud() {
  const s = G.s, R = G.R; if (!R) return;
  R.day.innerHTML = `第 ${s.day} 天 <small>/ ${TOTAL_DAYS}</small>`;
  R.slots.replaceChildren(...SLOTS.map((n, i) => h('span', { class: i === s.slot ? 'on' : '' }, n)));
  R.ap.replaceChildren(h('span', { class: 'l' }, '行动'), ...Array.from({ length: AP_PER_SLOT }, (_, i) => h('img', { src: A(i < s.ap ? 'ui/ap_full.webp' : 'ui/ap_empty.webp'), alt: '' })), h('span', { class: 'r' }, `剩 ${s.ap} 点`));
  R.badge.textContent = s.unread; R.badge.classList.toggle('hidden', !s.unread);
  R.appt.classList.toggle('hidden', !(s.appts || []).length); R.appt.textContent = (s.appts || []).length > 1 ? `约 ${s.appts.length}` : '约';
  const phoneBtn = R.top.firstChild, has = hasPhone(s);
  if (phoneBtn.classList.contains('hidden') && has) { phoneBtn.classList.add('appear'); setTimeout(() => phoneBtn.classList.remove('appear'), 1200); }
  phoneBtn.classList.toggle('hidden', !has);
  document.body.classList.toggle('loose', s.v.restraint < 35);
  refreshPortrait();
}
export function setScene(loc = G.s.loc) {
  const b = bgFor(loc, G.s.slot); G.R.bg.src = b.src; G.R.bg.style.filter = b.filter;
  const ev = G.s.curEvent && G.events.find(e => e.id === G.s.curEvent);   // 事件自带背景（第 40 天黄昏溪岸）
  if (ev?.bg && hasAsset(`bg/${ev.bg}.webp`)) { G.R.bg.src = A(`bg/${ev.bg}.webp`); G.R.bg.style.filter = 'none'; }
  pickBgm();
}
// BGM：缝合、牠、后山 → 不安；夜里和河独处 → 夜；其他 → 日常
const UNEASY_EVENTS = ['d5_ta_suture', 'd18_injury', 'd25_ta_mad', 'tomb_ta_secret', 'ta_first'];
export function pickBgm() {
  const s = G.s; if (!s) return;
  let slot = 'daily';
  if (['ta_house', 'tomb'].includes(s.loc) || UNEASY_EVENTS.includes(s.curEvent)) slot = 'uneasy';
  else if (s.slot === NIGHT && ['he_room', 'room'].includes(s.loc) && (heLocation(s.day, s.slot) === s.loc || s.curEvent)) slot = 'night';
  if (s.curEvent === 'd40_question') slot = 'meta';
  import('./audio.js?v=1794222138').then(a => a.playBgm(slot));
}
// 立绘：河在 sprite，其他人在 sprite2；两个人同时在画面上时河往左让
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
function setSprite(who, expr) {
  const R = G.R;
  R.chars ||= { he: null, other: null };
  if (!who) { R.chars = { he: null, other: null }; R.curSprite = null; layoutChars(); return; }
  const c = charSrc(who, expr); if (!c) return;
  c.who = who;
  if (who === '河') { if (R.sprite.dataset.key !== c.key) { R.sprite.src = c.src; R.sprite.dataset.key = c.key; } R.chars.he = c; R.curSprite = c.src; }
  else { if (R.sprite2.dataset.key !== c.key) { R.sprite2.style.visibility = 'hidden'; R.sprite2.onload = () => { R.sprite2.style.visibility = ''; }; R.sprite2.src = c.src; R.sprite2.dataset.key = c.key; } R.chars.other = c; }   // 新图加载好再显示，不闪上一个人
  layoutChars();
}
// 抽动：失焦 / 失神 / 牠发疯一定有；疯子档时河其他立绘偶尔抽（「减少画面晃动」打开时关掉）
function updateTwitch() {
  const R = G.R; if (!R) return;
  const calm = getSettings().reduceMotion;
  const he = R.chars?.he, other = R.chars?.other;
  const heT = !calm && he && (['blank', 'dazed'].includes(he.expr) ? 'strong' : tierOf(G.s) === 'mad' ? 'light' : '');
  const oT = !calm && other && other.who === '牠' && other.expr === 'mad' ? 'strong' : '';
  R.sprite.dataset.twitch = heT || ''; R.sprite2.dataset.twitch = oT || '';
}
function twitchLoop() {
  const R = G.R;
  if (R) for (const el of [R.sprite, R.sprite2]) {
    const mode = el.dataset.twitch; if (!mode || !el.classList.contains('on')) continue;
    if (Math.random() < (mode === 'strong' ? 0.5 : 0.15)) {
      const dx = (Math.random() * 4 - 2) * (mode === 'strong' ? 2 : 1), dy = Math.random() * 4 - 2, r = Math.random() * 2 - 1;
      el.style.translate = `${dx}px ${dy}px`; el.style.rotate = `${r}deg`;
      setTimeout(() => { el.style.translate = ''; el.style.rotate = ''; }, 60 + Math.random() * 60);
    }
  }
  setTimeout(twitchLoop, 700 + Math.random() * 1600);
}
twitchLoop();
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
  if (G.busy || G.inTurn || G.waitClick) { if (!G.metaQueue.includes(id)) G.metaQueue.push(id); return true; }
  markExtraMeta(s, id);
  const m = EXTRA_META[id];
  import('./audio.js?v=1794222138').then(a => a.stutter()).catch(() => {});
  if (m.faint) {   // 一行很淡的字，2 秒后消失
    const f = h('div', { class: 'faint-line' }, m.faint); R.dialog.append(f); setTimeout(() => f.remove(), 2200); return true;
  }
  if (m.silent) { const keep = R.text.textContent; setSprite('河', m.expr); R.name.classList.add('hidden'); R.text.textContent = ''; await sleep(2000); R.text.textContent = keep; return true; }
  const keepActions = !R.actions.classList.contains('hidden');
  renderActions('none');
  await playLines([{ speaker: '河', expr: m.expr, text: m.text }]);
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
export function advance() {
  if (G.typing) { G.typing.finish(); return; }
  if (G.waitClick) { const f = G.waitClick; G.waitClick = null; f(); }
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
  if (line.cg && hasAsset(`cg/${line.cg}.webp`)) { await preload(A(`cg/${line.cg}.webp`)); showCG(line.cg); }   // 事件里中途换 CG
  const narr = line.speaker === 'narration';
  R.name.classList.toggle('hidden', narr);
  const vn = VILLAGERS[line.speaker];   // 村民名字固定：AI 写的小名（小芳）保留，别的名字一律换回名单里的
  const shown = line.speaker.startsWith('村民') ? (!knows(G.s, line.speaker) ? '村民' : vn ? (line.name && line.name.replace(/^小/, '') === vn ? line.name : vn) : (line.name || '村民')) : !knows(G.s, line.speaker) ? '？？？' : line.speaker;
  R.name.textContent = narr ? '' : shown;
  if (line.know && G.s) G.s.f[line.know] = true;   // 自我介绍这一句还显示 ？？？，之后才有名字
  R.text.classList.toggle('narr', narr);
  // 写到牠的舌头（两条舌头、舔线）：牠的立绘换成舔线那张，不管 AI 选了什么表情
  const TONGUE = /舌/;
  if (line.speaker === '牠' && TONGUE.test(line.text)) line = { ...line, expr: 'lick' };
  if (!opts.keepSprite && (SPRITE_DIR[line.speaker] || NPC_SPRITES[line.speaker])) setSprite(line.speaker, line.expr);
  else if (line.speaker === 'narration' && !opts.keepSprite) {
    // AI 多半只用旁白写牠（不给牠台词）：旁白写到牠在做事，就把牠的立绘放上来，按内容选表情
    const t = line.text, onStage = G.R.chars?.other?.who === '牠';
    const acting = /(牠|白头发的人)(没|又|就|才|也|只)?(坐|站|抬|转|把|拿|捏|写|推|舔|看|低|伸|笑|停|咬|缝|吐|张|垂|递|收|拨|扯|盯|走|蹲|靠|按)/.test(t);
    if (acting || (onStage && /牠|白头发的人/.test(t))) {
      const e = /舌|舔/.test(t) ? 'lick' : /疯|撕|尖叫|抓狂/.test(t) ? 'mad' : /脸红|红了|躲开视线/.test(t) ? 'shy' : /字条|写/.test(t) ? 'note' : onStage ? G.R.chars.other.expr : 'note';
      if (!onStage || e !== G.R.chars.other.expr) setSprite('牠', e);
    }
  }
  // 牠的称呼：名字揭晓前旁白统一叫「白头发的人」，揭晓后统一叫「牠」
  if (line.speaker === 'narration' && G.s) {
    const known = knows(G.s, '牠'); let t = line.text;
    t = known ? t.replace(/白头发的人|白发(的)?(男子|男人|人)/g, '牠') : t.replace(/白发(的)?(男子|男人|人)|白头发的(男子|男人)/g, '白头发的人').replace(/牠/g, '白头发的人');
    line = { ...line, text: t };
  }
  const segs = splitGarble(line.text, opts.allowGarble);
  s.log.push({ who: narr ? '' : shown, t: segs.map(x => x.t).join('') });
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
  R.next.classList.add('hidden');
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
    G.waitClick = res;
    if (G.auto || G.forceAuto) setTimeout(() => { if (G.waitClick === res) { G.waitClick = null; res(); } }, (getSettings().autoDelay + textLen * 0.04) * 1000);
  });
}
// 播放一组固定台词，最后一句也要点一下
export async function playLines(lines, opts = {}) {
  for (const l of lines) { await showLine(l, opts); await waitAdvance(l.text.length); }
  G.R.next.classList.add('hidden');
}
// 播放队列（流式），最后一句不等点击
async function playQueue(q, opts) {
  let prev = null;
  for (;;) {
    const l = await q.next();
    if (!l) break;
    if (prev) await waitAdvance(prev.text.length);
    await showLine(l, opts); prev = l;
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
  R.free.classList.toggle('hidden', mode !== 'free');
  R.row.classList.toggle('hidden', mode !== 'free');
  if (mode === 'choice') {
    R.actHead.textContent = '选一个';
    R.actList.replaceChildren(...choices.map((c, i) => h('button', { class: 'btn', onclick: () => { const r = choiceResolver; choiceResolver = null; r && r(i); } }, c.text)));
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
  for (const el of R.actions.querySelectorAll('button,input')) el.disabled = b || el.dataset.over === '1';
  R.regenBtn.disabled = b || !G.last;
  R.regenBtn.style.opacity = b || !G.last ? .35 : 1;
}
function choose(choices) { renderActions('choice', choices); return new Promise(r => (choiceResolver = r)); }

function locationActions(s) {
  const out = [];
  const add = (text, cost, fn) => out.push({ text, cost, kind: 'local', fn });
  // 小游戏完成后消失（人肉 v3 · 10）：数花瓣没找到一天一次，找到了就拿掉；第 14 天或满在的时候，满会拉你再找一次
  if (s.loc === 'peach' && s.c.flowerDay !== s.day) {
    if (!s.f.flower_found) add('数花瓣', 1, () => miniAction('flower'));
    else if (s.day === 14 || rollPresence(s).includes('满')) add('和满一起数花瓣', 1, () => miniAction('flower'));
  }
  if (s.loc === 'ta_house') { out.push({ text: '看牠缝东西', cost: 1, kind: 'ai' }); add('看牠写字', 1, () => miniAction('note')); }
  if (s.loc === 'he_room') {
    if (!s.f.puzzle_he) { if (s.c.albumDay !== s.day) add('翻旧相册', 1, () => miniAction('puzzle_he')); }   // 没拼完：一天一次
    else add('看那张照片', 1, () => lookPhoto());   // 拼完：不再是小游戏
    if (organsOpen()) add('翻他的画本', 0, () => P.openOrganShelf());
    if (organsOpen() || s.done.includes('d12_drawings')) add('和他一起看画', 1, () => drawingPuzzle());
  }
  if (s.loc === 'tomb') add('墓碑前的旧照片', 1, () => miniAction('puzzle_ta'));
  const job = JOBS[s.f.job];
  if (job && job.loc === s.loc && job.slots.includes(s.slot) && s.c.workDay !== s.day) out.unshift({ text: '干活', cost: 2, kind: 'ai', work: true, note: job.note, first: true });
  if (s.loc === 'border' && s.day >= 30) add('往雾里走', 3, () => leaveVillage());
  if (s.loc === 'room' || s.loc === 'yard') add('换衣服', 0, () => P.openOutfit(false));
  return out;
}

// ———————————————————— AI 一轮 ————————————————————
function ctxFor(s, kind, ev, req = {}) {
  const appt = s.apptNow;
  const heAway = !ev && heLocation(s.day, s.slot) == null && appt?.who !== '河';
  let present = ev ? undefined : [...rollPresence(s)];   // 固定事件里谁在场由事件本身决定
  if (appt && !appt.flaked && appt.who !== '河' && appt.who !== '牠' && !ev && !present.includes(appt.who)) present = [...present.filter(n => n === '养母'), appt.who];   // 约好的人一定在
  const callNote = !ev && req.free && req.text ? callPresence(s, req.text, present) : null;
  const heHere = ev?.heHere ?? (heLocation(s.day, s.slot) === s.loc || !!ev || appt?.who === '河');   // 事件可以用 heHere: false 说明河不在场
  const allowMeta = ev?.forceMeta ? true : kind === 'event' || kind === 'choice' ? false : rollMeta(s);
  const allowGarble = madTier(s.madness) === 'mad' || s.meta.feignTurns > 0;
  const extra = (s.c.warmStreak || 0) >= 2 ? [WARM_STREAK.scaredNote] : [];
  if (s.f.he_first_day === s.day) extra.push(HE_FIRST_AFTER);
  if (heHere && (s.c.clingy || 0) >= 6) extra.push('「你」这一阵子一直跟着他，他走到哪你就在哪。他有点不自在：会找个理由走开一会儿，或者话更少，但不说破。'); 
  if (heHere && s.day === 32 && s.done.includes('d32_thread') && !ev) extra.push('「你」手腕内侧有一截红线头（「你」可能用袖子藏着）。河看见会愣一下，不解释，只问一句「疼吗」。');
  if (appt?.flaked && !ev) extra.push(`约好的${appt.who}没来：她被家里叫回去了。可以由旁白或路过的人交代一句。`);
  else if (appt && !ev) extra.push(`之前约好的：${appt.who}和「你」约在第 ${appt.day} 天${SLOTS[appt.slot]}的${appt.place}。${appt.who}已经在这里等你了，接着这个约定演。`);
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
  if (present?.includes('石') && !s.f.know_shi) { rules.push('这是石第一次见「你」：他开口第一句先自我介绍，原话是「石。……后坡老郭家的。」（speaker 写 "村民·男"，name 写 "石"）'); }
  if (present?.includes('芳') && !s.f.know_fang) { rules.push('这是芳第一次和「你」说话：她开口第一句先自我介绍，原话是「芳。叫我小芳也行，都这么叫。」（speaker 写 "村民·女"，name 写 "芳"）'); }
  if (kind !== 'event' && kind !== 'choice' && !organsOpen()) rules.push(DRAWINGS_HIDDEN);   // 第 12 天拼图之前
  const inject = collectInjections(s, extra);
  return { heHere, heAway, heLocName: LOCATIONS[heLocation(s.day, s.slot)]?.name, present, allowMeta, allowGarble, inject, rules, outfitName: OUTFITS[s.outfit]?.name + '（' + OUTFITS[s.outfit]?.note + '）' };
}
function userMsg(s, req) {
  const L = LOCATIONS[s.loc];
  switch (req.kind) {
    case 'arrive': {
      const from = s.prevLoc && s.prevLoc !== s.loc ? LOCATIONS[s.prevLoc]?.name : null;
      return `【场景切换】上一段已经结束，时间来到第 ${s.day} 天${SLOTS[s.slot]}。` +
        (from ? `「你」刚从${from}走到${L.name}，人现在在${L.name}，已经不在${from}了。` : `「你」现在在${L.name}。`) +
        `${L.name}：${L.desc}\n不要接着写上一段，只写「你」到达${L.name}时看到的场景（2–4 条）。挑一个这次的新细节写，不要重复之前到这里时写过的东西。旁白里的位置必须是${L.name}，不要写成别的地方。必须给出 suggestions。`;
    }
    case 'action': return `【玩家行动】${req.free ? '（玩家自己输入的）' : ''}${req.text}${req.note ? '\n（' + req.note + '）' : ''}\n写这次行动的经过和结果。` +
      (req.last ? '\n' + LAST_ACTION_NOTE : req.free ? `\n（这个时段还剩 ${req.apLeft} 点行动。small=1、medium=2、large=3；如果这次的规模会把点数用完，${LAST_ACTION_NOTE}）` : '');
    case 'wake': return `【醒来】「你」从假死中醒过来，地点：${L.name}，${SLOTS[s.slot]}。写醒来那一刻（2–5 条），给出建议行动。`;
    case 'event': {
      const ev = req.event;
      return `【主线事件】${ev.scene}\n刚才已经出现的固定台词：\n${(ev.lines || []).map(l => (l.speaker === 'narration' ? '' : l.speaker + '：') + l.text.replace('{FIRST_LINE}', FIRST_LINE)).join('\n')}\n接着往下写 3–6 条，上面这些固定台词不要再写一遍。${ev.choices ? '写到玩家需要做选择之前停住。suggestions 给空数组。' : ''}`;
    }
    case 'choice': return `【玩家选择】${req.text}\n${req.note ? '（这个选择：' + req.note + '）\n' : ''}${req.event.after || '写这个选择的结果，然后收住场景。'}\n只写玩家选的这一条的结果，别的选项没有发生。suggestions 给空数组。`;
  }
}

/** 跑一轮 AI。返回 normTurn 结果；出错时显示重试并等待 */
export async function doTurn(req) {
  const s = G.s;
  if (G.metaQueue.includes('copied')) { G.metaQueue = G.metaQueue.filter(x => x !== 'copied'); await metaLine('copied', true); }
  const snapshot = clone(s);
  if (['arrive', 'action', 'wake'].includes(req.kind)) G.last = { req, snapshot }; else G.last = null;
  const ctx = ctxFor(s, req.kind, req.event, req);
  if (req.lines) ctx.format = { ...(ctx.format || {}), lines: req.lines };
  const system = buildSystem(s, ctx);
  const um = userMsg(s, req);
  // 旧存档里的历史只有 lines：补齐字段，免得模型学着省略 tags / suggestions
  const hist = s.history.map(m => m.role !== 'assistant' || m.content.includes('"suggestions"') ? m
    : { role: 'assistant', content: m.content.replace(/\}\s*$/, ',"tags":[],"action_size":"small","suggestions":[],"he_flags":[],"cg":null}') });
  const messages = [{ role: 'system', content: system }, ...hist, { role: 'user', content: um }];
  setBusy(true); loadingText(); G.inTurn = true;
  const q = makeQueue();
  const opts = { allowGarble: ctx.allowGarble, keepSprite: req.keepSprite };
  // 输出检查：不在场的 NPC、不在的河，台词直接丢掉（人肉测试 v2 · 6.4）
  const norm = t => String(t || '').replace(/[「」『』“”"，。,.！？!?…\s]/g, '');
  const okLine = l => {
    if (l.speaker === '你') return req.kind === 'action' && !!req.free && norm(l.text) !== '' && norm(req.text).includes(norm(l.text));   // 「你」只能原样复述玩家自己写的话
    if (req.kind === 'event' || req.kind === 'choice' || ctx.present === undefined) return true;
    if (l.speaker === '河') return ctx.heHere;   // 河不在这个地方（在别处或不在村里）：AI 让他出场的台词删掉
    const npc = { 养母: '养母', '村民·男': '石', '村民·女': '芳', 满: '满', 衡: '衡' }[l.speaker];
    return !npc || ctx.present.includes(npc);
  };
  const fixExpr = l => (l.speaker === '河' && l.expr === 'cold' ? { ...l, expr: 'aloof' } : l);   // 冷视只给代码用
  // 石、芳第一次开口：AI 没让他们先自报姓名，就由代码补上那句（名牌在这句之后才变成名字）
  const INTRO = { '村民·男': ['know_shi', '石', '石。……后坡老郭家的。'], '村民·女': ['know_fang', '芳', '芳。叫我小芳也行，都这么叫。'] };
  const introduced = new Set();   // 这一轮已经补过 / 已经自我介绍过的（flag 要等那句播出来才设，名牌才会先显示「村民」）
  const UNSAID = CLICHES.find(c => c.say.startsWith('「想说什么又没说」')).re;
  const clean = l => {
    let t = String(l.text || '');
    t = t.replace(/\s*[A-Za-z]{3,}(?:\s+[A-Za-z]{2,})*\s*/g, m => /^[A-Z]/.test(m.trim()) && m.trim().length <= 4 ? m : '');   // 混进来的外语词（如 nuevos）去掉；短的大写缩写保留
    if (l.speaker !== 'narration') t = t.replace(/（[^）]{2,40}）/g, '');   // 台词里的括号舞台说明
    if (l.speaker === 'narration' && UNSAID.test(t)) { if (s.c.unsaidDay === s.day) return null; s.c.unsaidDay = s.day; }   // 「想说又没说」一天最多一次
    t = t.trim(); return t ? { ...l, text: t } : null;
  };
  const pushLine = l0 => {
    let l = clean(l0); if (!l) return;
    const it = INTRO[l.speaker];
    if (it && !s.f[it[0]] && !introduced.has(it[0]) && req.kind !== 'event' && req.kind !== 'choice') {
      introduced.add(it[0]);
      if (new RegExp(`^${it[1]}[。，……]`).test(l.text)) l = { ...l, name: it[1], know: it[0] };
      else q.push({ speaker: l.speaker, name: it[1], text: it[2], know: it[0] });
    }
    q.push(fixExpr(l));
  };
  const streamer = new LineStreamer(l => { if (okLine(l)) pushLine(l); });
  const playing = playQueue(q, opts);
  let raw;
  try {
    raw = await chat({ messages, important: req.kind === 'event' || req.kind === 'choice', onDelta: (_, full) => streamer.feed(full) });
  } catch (e) {
    q.close(); await playing; G.inTurn = false;
    restore(s, snapshot);  // 回滚
    return await showError(e, () => doTurn(req), req);
  }
  const turn = normTurn(raw);
  G.lastRaw = raw;  // 调试用
  s.meta.cliche = findCliches(turn.lines);
  // JSON 不完整时 normTurn 会退回「按换行硬切」，切法和流式不一样；流式已经播了就不再拿它补，免得台词错位、被拆开
  if (turn.ok !== false || streamer.count === 0) for (let i = streamer.count; i < turn.lines.length; i++) if (okLine(turn.lines[i])) pushLine(turn.lines[i]);
  q.close();
  await playing; G.inTurn = false;
  // 结算
  if (req.kind === 'action' || req.kind === 'wake' || req.kind === 'arrive') {
    const tags = req.kind === 'action' ? (req.work ? turn.tags.filter(t => t === '亲近') : turn.tags) : [];   // 干活不加同化，只留「亲近」
    const cost = req.cost ?? SIZE_COST[turn.action_size] ?? 1;
    const d = applyTags(s, tags, turn.he_flags, null, { scale: req.kind === 'action' && cost <= 1 && !req.multi ? 0.5 : 1 });   // 1 点小事打五折
    if (getSettings().debug) console.log('tags', tags, turn.he_flags, d, s.v);
  }
  if (turn.lines.some(l => GORE_RE.test(l.text || ''))) { s.c.goreDays ||= {}; s.c.goreDays[s.day] = (s.c.goreDays[s.day] || 0) + 1; }
  if (s.meta.feignTurns > 0) s.meta.feignTurns--;
  s.turns++;
  s.history.push({ role: 'user', content: um }, { role: 'assistant', content: JSON.stringify({ lines: turn.lines, tags: turn.tags, action_size: turn.action_size, suggestions: turn.suggestions, he_flags: turn.he_flags, cg: null }) });
  if (s.history.length > HISTORY_KEEP) compressHistory(s);
  if (turn.organ && organsOpen() && !ownedDrawings().includes(turn.organ)) await giveDrawing(turn.organ, 'he');
  if (turn.appointment && !req.propose) addAppt(s, turn.appointment);
  if (turn.suggestions.length) {
    s.lastSugg = turn.suggestions;
    // 至少一条 2 点的大事：AI 没给就按地点补一条
    const big = s.loc === 'he_room' && heLocation(s.day, s.slot) !== s.loc ? '把他的屋子收拾一遍' : BIG_ACTION[s.loc];   // 他不在：不要「陪他待过这一段」
    if (!s.lastSugg.some(x => x.cost >= 2) && big) s.lastSugg = [...s.lastSugg.slice(0, 3), { text: big, cost: 2 }];
  }
  else if (req.kind === 'action') { s.lastSugg = s.lastSugg.filter(x => x.text !== req.text); if (!s.lastSugg.length) s.lastSugg = [{ text: '四处看看', cost: 1 }, { text: '去找河', cost: 2 }]; }
  else if (req.kind !== 'event' && req.kind !== 'choice' && !s.lastSugg.length) s.lastSugg = [{ text: '四处看看', cost: 1 }, { text: '去找河', cost: 2 }];
  setBusy(false);
  saveRun(s);
  return turn;
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
    const j = looseJson(raw); if (j?.summary) s.summary = String(j.summary).slice(0, 400);
  } catch { s.summary = (s.summary + ' ' + convo.replace(/\n/g, ' ')).slice(-400); }
}

// 重新生成：回滚到这轮之前，再来一次（记录下来，meta 会用）
async function regenerate() {
  if (G.busy || !G.last) return;
  const { req, snapshot } = G.last;
  restore(G.s, snapshot);
  G.s.meta.rerolls++; G.s.meta.rerolledRecent = true;
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
  const req = { kind: 'action', text: a.text, cost: a.cost, last: G.s.ap - (a.cost || 1) <= 0, note: a.note, work: a.work };
  if (a.work) { G.s.c.workDay = G.s.day; if (G.s.f.job === 'ta') G.s.c.taLine = (G.s.c.taLine || 0) + 1; }
  await afterTurn(await doTurn(req), req);
}
// 自己写的行动里同时做了几件事（引号里说的话不算）
function multiAction(t) {
  const acts = t.replace(/[「“"『][^」”"』]*[」”"』]/g, '说话').split(/[，,。；;、！!？?]|然后|接着|并且|之后|顺便|再去|又去/).map(x => x.trim()).filter(x => x.length >= 2);
  return acts.length >= 2;
}
async function freeAct() {
  const t = G.R.input.value.trim(); if (!t || G.busy) return;
  if (G.s.ap <= 0) return endSlot();
  G.R.input.value = ''; G.R.inputMax = 0;
  const req = { kind: 'action', text: t, free: true, apLeft: G.s.ap };
  if (multiAction(t)) { req.multi = true; req.last = true; }   // 一次写了好几件事：这个时段的点数直接用完
  const prop = parseProposal(G.s, t, proposeTarget(G.s, t), G.s.loc);
  if (prop) { if (await confirmProposal(prop)) req.propose = prop; else { G.R.input.value = t; return; } }   // 「算了」：把字放回输入框
  const turn = await doTurn(req);
  if (req.propose && !turn.skipped) settleProposal(G.s, req.propose, turn.appointment);
  await afterTurn(turn, req);
}
async function afterTurn(turn, req) {
  const s = G.s;
  await flushMeta();
  const hr = new Date().getHours(); if (hr >= 1 && hr < 5) await metaLine('late');
  if (req.kind === 'action') {
    const cost = req.multi || (req.free && turn.action_size === 'large') ? s.ap : req.cost ?? SIZE_COST[turn.action_size] ?? 1;
    s.ap = Math.max(0, s.ap - cost);
  }
  saveRun(s);
  refreshHud();
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
  const { ORGANS } = await import('./config/world.js?v=1794222138');
  const o = ORGANS.find(x => x.id === id); if (!o) return;
  unlock('organs', id);
  if (how === 'he') await playLines([{ speaker: '河', expr: 'shy', text: '……这个给你。画得不好。' }]);
  await openOrgan(id, ownedDrawings());
}
async function sketchbook() {
  const { ORGANS } = await import('./config/world.js?v=1794222138');
  const left = ORGANS.filter(o => !ownedDrawings().includes(o.id));
  if (!left.length) return spendLocal(1, [{ speaker: 'narration', text: '画本你都翻过了。每一页的线条都很细，标注写得很工整。' }]);
  const o = left[Math.floor(Math.random() * left.length)];
  await playLines([{ speaker: 'narration', text: `画本里夹着一张${o.name}。线条很细，旁边用小字写着标注。` }]);
  await giveDrawing(o.id);
  await spendLocal(1, []);
}
// 器官归位：十张画全给，拼完一次就全部解锁（回想、「河的画」）
async function organsGame() {
  const { ORGANS } = await import('./config/world.js?v=1794222138');
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
  if (MID.gonegirl(s) && !MID.heStops(s)) {
    await playLines([{ speaker: 'narration', text: '你往雾里走。这一次，没有人从后面叫你。' }, { speaker: 'narration', text: '路越来越不像路。' }]);
    return triggerEnding('gonegirl');
  }
  const stopped = MID.heStops(s);
  const req = { kind: 'action', text: '往雾里走，想离开村子', cost: 3, note: stopped ? '河追上来，拦住了玩家。按越界规则写，不写占有。' : '雾把路绕了回来，玩家又走回了村界。河不在。' };
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
  for (const [k, n] of Object.entries(c.counter || {})) if ((s.c[k] || 0) < n) return false;
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
  return G.events.find(ev => ev.trigger === 'visit' && !s.done.includes(ev.id) && ev.loc === s.loc && condOk(s, ev.cond));
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
function commitAppt(s, ap, allowNow = false) {
  const { day, slot, loc } = ap;
  const at = day * 4 + slot, now = s.day * 4 + s.slot;
  if (day > 41 || at < now || (at === now && !allowNow)) return false;
  s.appts = (s.appts || []).filter(x => !(x.day === day && x.slot === slot));
  if (at === now) {   // 手机回复到的时候正好就是约的这个时段：还在选地点的话直接带过去
    if (s.phase === 'map' && !G.busy) { s.apptNow = ap; closeOv('map'); arrive(loc, false); }
    return true;
  }
  s.appts.push(ap); refreshHud(); return true;
}
function showAppts() {
  const list = (G.s?.appts || []).map(a => h('div', { class: 'ds', style: { fontSize: '20px', lineHeight: '2' } }, `${a.who} · 第 ${a.day} 天${SLOTS[a.slot]} · ${a.place}`));
  modal('appts', '约好的事', h('div', {}, ...(list.length ? list : [h('div', {}, '没有约好的事。')])), { buttons: [{ label: '知道了', value: 1 }] });
}
// 玩家主动约人：从输入里认出「什么时候、在哪」，弹框确认，再由对方决定答不答应（人肉 v3 · 2）
const DAY_WORDS = [[/后天/, 2], [/明天|明早|明晚|明儿/, 1], [/今天|今晚|待会|等会/, 0]];
const SLOT_WORDS = [[/上午|早上|一早|明早|清早/, 0], [/午后|下午|中午|晌午/, 1], [/黄昏|傍晚|太阳落山/, 2], [/晚上|夜里|今晚|明晚|半夜/, 3]];
const INTENT = /见|等你|等我|一起|来找|约|碰头|过来|陪我|带我/;
export function parseProposal(s, text, who, defaultLoc) {
  const d = DAY_WORDS.find(([re]) => re.test(text)), sl = SLOT_WORDS.find(([re]) => re.test(text));
  if (!sl || !who || !(INTENT.test(text) || placeIn(text))) return null;
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
const proposeNote = p => `「你」约${p.who}：第 ${p.day} 天${SLOTS[p.slot]}，在${p.place}。由${p.who}决定答不答应（看关系和${p.who === '河' ? '他' : '对方'}自己的安排；衡多半不答应，比如「我没空陪外人」；满几乎都答应）。台词里让${p.who}回答，不答应要给一句理由。appointment 写 {"who":"${p.who}","day":"…","slot":"${SLOTS[p.slot]}","place":"${p.place}","accept":true 或 false}。`;
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
  if (blocked) { s.apptMissed = a; toast(`和${a.who}约在${a.place}的事，被别的事耽误了。`, 3200); return null; }   // 这个时段被固定剧情占了：没去成，下次见面对方有反应
  if (a.who === '满' && !s.f.man_flaked && Math.random() < 0.35) { s.f.man_flaked = true; a.flaked = true; }   // 满可能被叫回家，爽约一次
  return a;
}
function morningHint(s) {
  const opts = [];
  const he = heLocation(s.day, 1); if (he) opts.push(`养母说：小河午后在${LOCATIONS[he].name}。`);
  else opts.push('养母说：小河今天一早就出去了，没说去哪。');
  const job = JOBS[s.f.job]; if (job && s.day < 30) opts.push({ fields: '养母说：今天晒场收豆子，人手不够。', yard: '养母说：今天要腌菜，你早点来帮手。', ta: '养母说：牠那边缺线，送饭的时候顺路带一卷。' }[s.f.job]);
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
function dailyCG(s) {
  s.c.dailyCg ||= {}; if (s.c.dailyCg.day === s.day) return null;
  const he = heLocation(s.day, s.slot) === s.loc;
  const pool = DAILY_POOLS.find(p => s.day <= p.to)?.ids || [];
  const ok = pool.filter(id => DAILY_WHERE[id.split('_')[1]]?.(s, he) && hasAsset(`cg/${id}.webp`));
  if (!ok.length) return null;
  const id = ok[s.day % ok.length];   // 同一场景有两张可选（黄昏的饭桌 / 晒辣椒）时按天数轮
  s.c.dailyCg.day = s.day; return id;
}
// 手机：他不秒回。你发的消息下一个时段才回（第 22、23 天隔两个时段），第一句先交代刚才在干什么；夜里发的第二天上午回，开头「睡着了。」
const HE_DOING = { ta_house: '刚才在牠那儿学手艺', fields: '刚才在地里干活', creek: '刚才在溪边', he_room: '刚才在自己屋里', yard: '刚才在院子里干活', peach: '刚才在桃花林', tomb: '刚才在后山' };
// 地图上的「有事」：约好的人、干活、能碰到的人（拜访事件）
export function mapMarks(s) {
  const m = {};
  for (const a of s.appts || []) if (a.day === s.day && a.slot === s.slot) m[a.loc] = `${a.who}在等你`;
  const job = JOBS[s.f.job];
  if (job && job.slots.includes(s.slot) && s.c.workDay !== s.day) m[job.loc] ||= '有活';
  for (const ev of G.events) if (ev.trigger === 'visit' && !s.done.includes(ev.id) && condOk(s, ev.cond)) m[ev.loc] ||= '好像有人';
  return m;
}
export function phoneReplyNow() { if (G.s) phoneReplies(G.s, true); }
async function phoneReplies(s, now = false) {
  // 拼了他的旧相册、他不在：过一个时段他发现了
  const pm = s.c.puzzleMsg;
  if (pm && (s.day - pm.day) * SLOTS.length + (s.slot - pm.slot) >= 1) {
    s.c.puzzleMsg = null; pushHe(s, '相册你动了。'); pushHe(s, '照片放反了一页。', 3000); pushHe(s, '……没关系。', 6000);
    saveRun(s); refreshHud(); toast('手机震了一下。');
  }
  const p = s.phonePending; if (!p) return;
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
  const note = (p.propose ? proposeNote(p.propose) + '\n' : '') + (now ? '他这次回得很快，就在这一时段里。' : p.slot === NIGHT ? '你的消息是夜里发的，他睡着了，现在才看到。回复的第一句就是「睡着了。」' : `他隔了一段时间才回。他刚才的去向是：${HE_DOING[where] || '出去了，没说去哪（不要编具体地点）'}——只能说这个，不要说别的地方。第一句先很短地交代刚才在干什么、为什么没看手机，再回你的话。`);
  try {
    const recent = s.phone.slice(-12).filter(m => m.text).map(m => ({ role: m.from === 'me' ? 'user' : 'assistant', content: m.text }));
    const j = looseJson(await chat({ messages: [{ role: 'system', content: phoneChatPrompt(s, { heHere: false, outfitName: '', allowMeta: false, note, stage }) }, ...recent], stream: false, maxTokens: 300 }));
    if (G.s !== s) return;
    let reps = (Array.isArray(j?.replies) ? j.replies : []).map(r => String(typeof r === 'object' ? (r?.text ?? '') : r).trim()).filter(Boolean).slice(0, 3);
    if (!reps.length) reps = [p.slot === NIGHT ? '睡着了。' : '嗯。'];
    const tags = (Array.isArray(j?.tags) ? j.tags : []).filter(x => AI_TAGS.includes(x));
    if (p.propose) settleProposal(s, p.propose, j?.appointment);
    else if (j?.appointment?.who) addAppt(s, j.appointment, p.day, true);   // 手机里约好的也进日程（按你发消息那天算「今天 / 明天」）
    if (tags.length) applyTags(s, tags);   // 聊天也改数值，和当面一样受每天 ±3 上限
    for (const m of s.phone) if (m.from === 'me' && m.note?.startsWith('已送达')) m.note = '已读';
    reps.map(msgOnly).filter(Boolean).forEach((r, i) => pushHe(s, r, i * 3000));
    saveRun(s); refreshHud(); toast('手机震了一下。');
  } catch { s.phonePending = p; }   // 没连上：下个时段再试
}

// 手机：夜里他主动发消息
// AI 偶尔会把旁白和消息写在一起（「手机亮了一下。屏幕上只有一句：『……』」）：只留引号里他发的那句
// 手机「他那边」CG（Cowork 方案 11/09）：每张一局只闪一次；怨恨优先于好感。
// 轮到某一张时，那一次的消息用固定句（不调用 AI），打开手机先闪这张、下方淡入一行小字
export const PHONE_CG = {
  phone_night: { cap: '他那边也是夜里。' },
  phone_cold: { ok: s => s.v.resent >= 60, cap: '屏幕亮了一下，又暗了。', msgs: [] },
  phone_sour: { ok: s => s.v.resent >= 35 && s.v.resent < 60, cap: '他看到了。', msgs: ['嗯。'] },
  phone_near: { ok: s => phoneStage(s) === 'near', cap: '屏幕一直亮着，他没睡。', msgs: [{ t: '睡了吗。', recall: true }, '没事。', '明天还去溪边吗。'] },
  phone_warm: { ok: s => phoneStage(s) === 'warm', cap: '他打了一行，删了，又打了一行。', msgs: ['刚回来。', '手上都是线头。', '你吃了没。'] },
};
function stageCgMessages(s) {
  s.c.phoneCgSeen ||= [];
  const id = ['phone_cold', 'phone_sour', 'phone_near', 'phone_warm'].find(k => !s.c.phoneCgSeen.includes(k) && PHONE_CG[k].ok(s) && hasAsset(`cg/${k}.webp`));
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
function msgOnly(t) { const m = t.match(/[「『“"]([^」』”"]{1,60})[」』”"]/); return (m && /[。：:，]/.test(t.slice(0, m.index)) ? m[1] : t).trim(); }
function pushHe(s, text, delay = 0) { s.phone.push({ from: 'he', text, ts: Date.now() + delay, day: s.day }); s.unread = (s.unread || 0) + 1; }
function heInvite(s) {
  const d = s.day + 1;
  const slot = [2, 1, 0, 3].find(sl => heLocation(d, sl) && !eventAt(s, d, sl) && !(s.appts || []).some(a => a.day === d && a.slot === sl));
  if (slot == null) return false;
  const loc = heLocation(d, slot);
  s.c.nextHeAppt = s.day + 3 + (Math.random() < 0.5 ? 1 : 0);
  if (!commitAppt(s, { who: '河', day: d, slot, loc, place: LOCATIONS[loc].name })) return false;
  pushHe(s, `明天${SLOTS[slot]}，${LOCATIONS[loc].name}。`); pushHe(s, ['来不来随你。', '我在那儿。', '……不来也行。'][s.day % 3], 3000);
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
    let text = '你那边现在几点';   // 上一条你没回：他问的是屏幕外的时间
    if (!ignoredLast) { const j = looseJson(await chat({ messages: [{ role: 'system', content: phonePingPrompt(s) }, { role: 'user', content: '（发一条）' }], stream: false, maxTokens: 120 })); text = msgOnly(String(j?.replies?.[0] || '')).slice(0, 40) || '睡了吗'; }
    if (G.s !== s) return;
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
const CALL_NAMES = [['养母', /养母|婶|小河他妈/], ['石', nameRe('石')], ['芳', /小芳|芳姐|芳婶/], ['芳', nameRe('芳')], ['满', nameRe('满')], ['衡', /衡|村长/]];
function canBeHere(s, name) { return name === '养母' ? s.loc === 'yard' && !motherAway(s.day, s.slot) : (NPC_PRESENCE[s.loc]?.[s.slot]?.[name] || 0) > 0 && (name !== '满' || !!s.f.man_met); }
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
  s.ap = AP_PER_SLOT; s.lastSugg = []; G.last = null;
  refreshHud(); setSprite(null); showCG(null);
  phoneReplies(s);                       // 上个时段你发的消息，他现在才回
  if (s.slot === NIGHT) phoneNight(s);   // 夜里：第 39 天约见，或者他隔几天主动发一条
  const ev = dueEvent(s);
  // 连着 3 天没去干活：衡来催一次（第 30 天以后不催）
  if (!ev && s.slot === 0 && s.f.job && s.day < 30 && s.day - Math.max(s.c.workDay ?? 7, s.c.nagDay ?? 0) >= 3) {
    s.c.nagDay = s.day;
    await playLines([{ speaker: 'narration', text: '衡在院门口站了一下。' }, { speaker: '衡', text: '活呢。' }]);
  }
  const appt = takeAppt(s, !!ev);
  if (ev) return runEvent(ev);
  if (appt && LOCATIONS[appt.loc]) { s.apptNow = appt; s.phase = 'map'; return arrive(appt.loc, false); }   // 约好的：直接带过去
  s.phase = 'map'; saveRun(s);
  setScene(); renderActions('none');
  G.R.name.classList.add('hidden'); G.R.text.className = 'text narr'; G.R.text.textContent = `${SLOTS[s.slot]}。要去哪里？`;
  if (s.slot === 0 && s.c.hintDay !== s.day) { s.c.hintDay = s.day; const t = morningHint(s); if (t) G.R.text.append(h('div', { class: 'morning-hint' }, t)); }   // 每天早上一句当天的小事（人肉 v3 · 12）
  P.openMap(false);
}
export async function arrive(loc, viaMap) {
  const s = G.s;
  if (s.phase === 'free' && viaMap) { s.ap = Math.max(0, s.ap - 1); if (s.ap <= 0) { s.loc = loc; return endSlot(); } }
  s.prevLoc = s.loc; s.loc = loc; s.phase = 'free'; s.lastSugg = [];
  if (loc === 'ta_house') s.c.taVisits = (s.c.taVisits || 0) + 1;
  if (heLocation(s.day, s.slot) === loc || s.apptNow?.who === '河') s.c.visitedHe = true;
  if (s.apptNow && s.apptNow.loc !== loc) s.apptNow = null;   // 约好的地方走开了，约定就算过了
  setSprite(null); setScene(); refreshHud(); saveRun(s);
  const ev = visitEvent(s);
  if (ev) return runEvent(ev);
  renderActions('free'); setBusy(true);
  const daily = dailyCG(s);
  if (daily) { await preload(A(`cg/${daily}.webp`)); showCG(daily); }
  const req = { kind: 'arrive' };
  const turn = await doTurn(req);
  if (daily) showCG(null);
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
  s.phase = 'map'; if (!D40_NAMES.includes(s.saveName)) s.saveName = null; s.f.d40_atChoice = false;
  // 黏人：连续 6 个时段都去他在的地方 → 他不自在，当天爱慕上限 −1；隔开一个时段清零
  s.c.clingy = s.c.visitedHe ? (s.c.clingy || 0) + 1 : 0; s.c.visitedHe = false;
  if (s.c.clingy >= 6) s.c.clingyDay = s.day;
  s.apptNow = null;
  if (s.outfit === 'village') applyTags(s, [], [], { assim: VILLAGE_OUTFIT_ASSIM }, { capExtra: true });   // 衣服加的同化也算进每天上限
  s.slot++;
  if (s.slot >= SLOTS.length) {
    s.slot = 0; s.day++; s.phoneToday = 0;
    applyTags(s, [], [], DAILY);
  }
  saveRun(s);
  await transition(`第 ${s.day} 天 · ${SLOTS[s.slot]}`);
  startSlot();
}
async function transition(text) {
  const ov = openOv('trans', h('div', { style: { background: '#0b0907', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d8cfc2', fontSize: '30px', letterSpacing: '10px' } }, text));
  await sleep(1300); ov.style.transition = 'opacity .5s'; ov.style.opacity = 0; await sleep(500); closeOv('trans');
}

// ———————————————————— 事件 ————————————————————
export async function runEvent(ev, opts = {}) {
  const s = G.s;
  if (ev.loc) s.loc = ev.loc;
  if (!s.done.includes(ev.id)) for (const l of [...(ev.lines || []), ...(ev.endLines || [])]) if (l.know) s.f[l.know] = false;   // 读档重放：名牌在自我介绍之后才变
  s.phase = 'event'; s.curEvent = ev.id; saveRun(s);
  setScene(); refreshHud(); setSprite(null); renderActions('none');
  if (ev.special === 'd40' && !s.f.d40_warned) await d40Warning();
  if (ev.cg) { await preload(A(`cg/${ev.cg}.webp`)); showCG(ev.cg); }
  const fixed = expandLines(ev.lines || []).map(l => l.text === '{NAME_ANSWER}'
    ? (s.name ? { speaker: '你', text: `「${s.name}。」` } : { speaker: 'narration', text: '你张了张嘴，没说出来。' })
    : { ...l, text: l.text.replace('{FIRST_LINE}', FIRST_LINE) });
  if (ev.id === 'd1_meet' && s.loop > 0) fixed.splice(1, 0, { speaker: 'narration', text: LOOP_LINE });  // 第二周目
  await playLines(fixed);
  if (ev.special === 'final') return finalJudge();
  if (ev.scene) await doTurn({ kind: 'event', event: ev, keepSprite: opts.keepSprite });
  if (ev.special?.startsWith('minigame:')) {
    const name = ev.special.split(':')[1];
    const res = name === 'organs' ? await organsGame() : await runMinigame(name, s);
    if (res.lines?.length) await playLines(res.lines);
  }
  if (ev.choices) {
    const i = ev.special === 'd40' ? await d40Choose(ev) : await choose(ev.choices);
    const c = ev.choices[i];
    renderActions('none');
    applyTags(s, c.tags || [], [], c.delta, { noCap: true });   // 固定事件的选项不受每天上限
    if (c.counter) s.c[c.counter] = (s.c[c.counter] || 0) + 1;
    Object.assign(s.f, c.set || {});
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
    if (ev.special === 'd40') {
      await playLines(D40_AFTER[c.set?.d40] || []);
      await playLines([{ speaker: 'narration', text: '天黑下来。他把鞋穿上，先走了。' }]);
      s.summary = (s.summary || '') + `第四十天黄昏，你对他说了「${c.text.replace(/[「」。]/g, '')}」。`;   // 第 41 天 AI 会知道
    } else await doTurn({ kind: 'choice', event: ev, text: c.text, note: c.note });
  }
  if (ev.endLines) await playLines(expandLines(ev.endLines));   // AI 那段、选项之后再接的固定台词（认路结尾给手机）
  Object.assign(s.f, ev.set || {});
  if (ev.set?.has_phone) refreshHud();
  if (ev.heFlags) applyTags(s, [], ev.heFlags);
  if (ev.unlockMisc) unlock('misc', ev.unlockMisc);
  markDone(s, ev);
  // 事件最后是 AI 写的段落（流式播放，最后一句不等点击）或选项结果时，才在这里等一下点击；
  // 只有固定台词的事件（比如衡的初见），最后一句在 playLines 里已经点过了，再等一次会像「点了没反应」
  if (ev.scene || ev.choices || ev.special) await waitAdvance();
  G.R.next.classList.add('hidden');
  showCG(null);
  if (ev.trigger === 'offline') return; // 离线事件不占时段
  return endSlot();
}
// 固定台词里的占位：{NAME_CUSTOM} = 名字不是单字时，河解释单字名习俗（人肉测试 v2 · C5）
function expandLines(lines) {
  const s = G.s, name = s?.name || '', short = [...name].pop() || '';
  return lines.flatMap(l => {
    if (l.if && !condOk(s, l.if)) return [];   // 按数值 / 之前的选择分支的固定台词
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
  // 亲密戏由 AI 写（作者要求可以直接写），写完再黑屏 → CG → 第二天
  if (ev.intimate && getSettings().adult) {   // 成人内容关着的时候不写这一夜，直接黑屏
    await doTurn({ kind: 'choice', event: { ...ev, after: ev.intimate }, text: c.text, lines: '8–16' });
    await waitAdvance();
  }
  setSprite(null);
  const black = openOv('black', h('div', { style: { background: '#000', opacity: 0, transition: 'opacity 1.6s' } }));
  await sleep(50); black.style.opacity = 1; await sleep(1900);
  const scr = G.R.dialog.parentElement;
  showCG(ev.firstCg); scr.classList.add('cg-only');   // CG 本身不配文字：对话框、HUD 都先收起来
  black.style.opacity = 0; await sleep(1700); closeOv('black');
  await new Promise(r => scr.addEventListener('click', r, { once: true }));   // 点一下继续
  const b2 = openOv('black', h('div', { style: { background: '#000', opacity: 0, transition: 'opacity 1.2s' } }));
  await sleep(50); b2.style.opacity = 1; await sleep(1300);
  showCG(null); scr.classList.remove('cg-only');
  Object.assign(s.f, ev.firstSet || {});
  if (ev.firstSet?.he_first_awkward) s.f.he_first_day = s.day + 1;   // 第二天他别扭
  if (!s.done.includes(ev.id)) s.done.push(ev.id);
  s.day++; s.slot = 0; s.phoneToday = 0; applyTags(s, [], [], DAILY);
  setScene(); refreshHud(); saveRun(s);
  b2.style.opacity = 0; await sleep(1300); closeOv('black');
  await playLines(ev.morning || []);
  s.curEvent = null; s.phase = 'map'; saveRun(s);
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
    meta.rewinds++; store.set('d40', meta); s.f.d40_rewinds = meta.rewinds;
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
  }
  G.feign = false; refreshPortrait();
}

// 玩家回来了（gap = 现在 − lastActive）。返回 true 表示在游戏里处理掉了
export function playerReturned(gap, e) {
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
  if (G.R.chars?.he && s.phase !== 'event') metaLine('away');   // 1–30 分钟：只是走开了一会儿（固定事件里不插，测试记录 6：会和事件等的点击抢）
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
export function startIdleWatch() {
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
  return triggerEnding(judgeFinal({ ...s, madTier: tierOf(s) }));
}
export async function triggerEnding(id) {
  const s = G.s; const e = ENDINGS[id];
  const firstTime = unlock('endings', id); if (e.cg) unlock('cgs', e.cg);
  s.ended = id; saveRun(s);
  if (AFTERMATH[id]) store.set('after', { kind: AFTERMATH[id], outfit: s.outfit, loc: s.loc }); else store.del('after');
  if (id === 'truman') store.set('lock_truman', { at: Date.now() });
  // 标题封面：只有「第一次」打出有特殊封面的结局才换；重复打、没有封面的结局（含‘土拨鼠之日’）都保持当前封面
  const COVER_OF = { lambs: 'fall_blood', pianist: 'palm', julesjim: 'backtoback', fountain: 'backtoback', button: 'ta_hand', truman: 'empty' };
  if (firstTime && COVER_OF[id]) store.set('cover', COVER_OF[id]);
  store.set('lastEnding', id);
  closeOv('map'); G.R = null;
  await showEnding(id, s);
  if (id === 'truman') return showLock();
  if (id === 'groundhog') {
    store.del('after');
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
export async function continueRun(s, offlineMs, alertLine = null) {
  G.s = s; G.last = null;
  buildMain(); setScene(); refreshHud();
  if (alertLine) {   // 当着他的面读档：第一句强制换成「警觉」
    import('./audio.js?v=1794222138').then(a => a.stutter()).catch(() => {});
    await playLines([{ speaker: '河', expr: 'alert', text: alertLine }]);
    s.meta.saidMeta = alertLine;
  }
  if (offlineMs >= 30 * 60e3) await wakeUp(offlineMs);
  await resumePhase();
}
