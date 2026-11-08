// 主循环：主界面、对话播放、行动点、时段推进、事件、结局判定
import { h, $, A, sleep, showScreen, openOv, closeOv, toast, preload } from './ui/dom.js';
import { getSettings, store, unlock, getGallery, organsOpen } from './store.js';
import { chat, ApiError } from './api.js';
import { buildSystem, summaryPrompt } from './prompt.js';
import { normTurn, LineStreamer, looseJson } from './parse.js';
import { SLOTS, LOCATIONS, TOTAL_DAYS, AP_PER_SLOT, heLocation, OUTFITS, SPRITE_DIR, DEFAULT_EXPR, FIRST_LINE, EXPR, SPRITE_FIT, spriteBox, NPC_SPRITES, NPC_FIT, DUO, EXPR_FALLBACK, FEIGN_PATCH, PINCH, PINCH_BOX } from './config/world.js';
import { DAILY, VILLAGE_OUTFIT_ASSIM, WARM_STREAK, madTier } from './config/values.js';
import { ENDINGS, judgeFinal, MID, AFTERMATH, LOOP_LINE } from './config/endings.js';
import { newRun, applyTags, saveRun, loadRun, clone, tierOf, knows } from './state.js';
import { rollMeta, collectInjections, splitGarble, EXTRA_META, canExtraMeta, markExtraMeta, idleFor } from './meta.js';
import { findCliches } from './config/style.js';
import * as P from './ui/panels.js';
import { runMinigame } from './ui/minigames.js';
import { openOrgan, organPuzzle } from './ui/organ.js';
import { showEnding, showLock } from './ui/ending.js';

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
const SLOT_CLOSE = ['日头升高了一些。', '到晌午了。', '日影斜了。', '天暗下来了。', '夜深了。'];
// 「河的第一次」之后那一天：回避型，越界之后会自省
const HE_FIRST_AFTER = '昨晚你们越过了那条线。今天河有点别扭：躲着你、话比平时更少，不提昨晚，也不说任何占有的话。他在跟自己较劲，不是在生你的气。';

export async function loadEvents() {
  // 发布版的 events.json 是编码过的（tools/build_dist.py），以 E1: 开头
  const t = await fetch('data/events.json').then(r => r.text());
  const j = JSON.parse(t.startsWith('E1:') ? (await import('./_k.js')).decode(t.slice(3)) : t);
  G.events = j.events;
  try { G.assets = new Set(Object.keys(await fetch('assets/manifest.json').then(r => r.json()))); } catch { G.assets = null; }
}
// 素材在不在（新立绘没到之前用替代的）
export const hasAsset = p => !G.assets || G.assets.has(p);

// ———————————————————— 主界面 ————————————————————
function bgFor(loc, slot) {
  const L = LOCATIONS[loc] || LOCATIONS.creek;
  const night = slot === 4; const dusk = slot === 3;
  const src = night && L.bg[1] ? L.bg[1] : L.bg[0];
  const filter = night && !L.bg[1] ? 'brightness(.42) saturate(.7) hue-rotate(-10deg)' : dusk ? 'sepia(.25) brightness(.9)' : slot === 0 ? 'brightness(.95) saturate(.85)' : 'none';
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
  R.hud = h('div', { class: 'hud pp' }, R.day, R.slots, R.ap);
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

export function refreshHud() {
  const s = G.s, R = G.R; if (!R) return;
  R.day.innerHTML = `第 ${s.day} 天 <small>/ ${TOTAL_DAYS}</small>`;
  R.slots.replaceChildren(...SLOTS.map((n, i) => h('span', { class: i === s.slot ? 'on' : '' }, n)));
  R.ap.replaceChildren(h('span', { class: 'l' }, '行动'), ...Array.from({ length: AP_PER_SLOT }, (_, i) => h('img', { src: A(i < s.ap ? 'ui/ap_full.webp' : 'ui/ap_empty.webp'), alt: '' })), h('span', { class: 'r' }, `剩 ${s.ap} 点`));
  R.badge.textContent = s.unread; R.badge.classList.toggle('hidden', !s.unread);
  document.body.classList.toggle('loose', s.v.restraint < 35);
  refreshPortrait();
}
export function setScene(loc = G.s.loc) {
  const b = bgFor(loc, G.s.slot); G.R.bg.src = b.src; G.R.bg.style.filter = b.filter;
  pickBgm();
}
// BGM：缝合、牠、后山 → 不安；夜里和河独处 → 夜；其他 → 日常
const UNEASY_EVENTS = ['d5_ta_suture', 'd18_injury', 'd25_ta_mad', 'tomb_ta_secret', 'ta_first'];
export function pickBgm() {
  const s = G.s; if (!s) return;
  let slot = 'daily';
  if (['ta_house', 'tomb'].includes(s.loc) || UNEASY_EVENTS.includes(s.curEvent)) slot = 'uneasy';
  else if (s.slot === 4 && ['he_room', 'room'].includes(s.loc) && (heLocation(s.day, s.slot) === s.loc || s.curEvent)) slot = 'night';
  if (s.curEvent === 'd40_question') slot = 'meta';
  import('./audio.js').then(a => a.playBgm(slot));
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
  if (G.busy || G.inTurn || G.waitClick) { if (!G.metaQueue.includes(id)) G.metaQueue.push(id); return true; }
  markExtraMeta(s, id);
  const m = EXTRA_META[id];
  import('./audio.js').then(a => a.stutter()).catch(() => {});
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
  const narr = line.speaker === 'narration';
  R.name.classList.toggle('hidden', narr);
  const shown = line.speaker.startsWith('村民') ? (line.name || '村民') : !knows(G.s, line.speaker) ? '？？？' : line.speaker;
  R.name.textContent = narr ? '' : shown;
  if (line.know && G.s) G.s.f[line.know] = true;   // 自我介绍这一句还显示 ？？？，之后才有名字
  R.text.classList.toggle('narr', narr);
  if (!opts.keepSprite && (SPRITE_DIR[line.speaker] || NPC_SPRITES[line.speaker])) setSprite(line.speaker, line.expr);
  const segs = splitGarble(line.text, opts.allowGarble);
  s.log.push({ who: narr ? '' : shown, t: segs.map(x => x.t).join('') });
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
  R.next.classList.add('hidden');
  await typeInto(R.text, segs);
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
  const L = LOCATIONS[s.loc];
  R.actHead.textContent = `在${L.name}能做的事`;
  const list = [...(s.lastSugg || []).map(x => ({ ...x, kind: 'ai' })), ...locationActions(s)];
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
  if (s.loc === 'peach') add('数花瓣', 1, () => miniAction('flower'));
  if (s.loc === 'ta_house') { out.push({ text: '看牠缝东西', cost: 1, kind: 'ai' }); add('看牠写字', 1, () => miniAction('note')); }
  if (s.loc === 'he_room') {
    add('翻旧相册', 1, () => miniAction('puzzle_he'));
    if (organsOpen()) add('翻他的画本', 0, () => P.openOrganShelf());
    if (organsOpen() || s.done.includes('d12_drawings')) add('和他一起看画', 1, () => drawingPuzzle());
  }
  if (s.loc === 'tomb') add('墓碑前的旧照片', 1, () => miniAction('puzzle_ta'));
  if (s.loc === 'border' && s.day >= 30) add('往雾里走', 3, () => leaveVillage());
  if (s.loc === 'room' || s.loc === 'yard') add('换衣服', 0, () => P.openOutfit(false));
  return out;
}

// ———————————————————— AI 一轮 ————————————————————
function ctxFor(s, kind, ev) {
  const heHere = ev?.heHere ?? (heLocation(s.day, s.slot) === s.loc || !!ev);   // 事件可以用 heHere: false 说明河不在场
  const allowMeta = ev?.forceMeta ? true : kind === 'event' || kind === 'choice' ? false : rollMeta(s);
  const allowGarble = madTier(s.madness) === 'mad' || s.meta.feignTurns > 0;
  const extra = (s.c.warmStreak || 0) >= 2 ? [WARM_STREAK.scaredNote] : [];
  if (s.f.he_first_day === s.day) extra.push(HE_FIRST_AFTER);
  const rules = kind !== 'event' && kind !== 'choice' && !goreAllowed(s) ? [GORE_HOLD] : [];
  if (kind !== 'event' && kind !== 'choice' && !organsOpen()) rules.push(DRAWINGS_HIDDEN);   // 第 12 天拼图之前
  const inject = collectInjections(s, extra);
  return { heHere, allowMeta, allowGarble, inject, rules, outfitName: OUTFITS[s.outfit]?.name + '（' + OUTFITS[s.outfit]?.note + '）' };
}
function userMsg(s, req) {
  const L = LOCATIONS[s.loc];
  switch (req.kind) {
    case 'arrive': {
      const from = s.prevLoc && s.prevLoc !== s.loc ? LOCATIONS[s.prevLoc]?.name : null;
      return `【场景切换】上一段已经结束，时间来到第 ${s.day} 天${SLOTS[s.slot]}。` +
        (from ? `「你」刚从${from}走到${L.name}，人现在在${L.name}，已经不在${from}了。` : `「你」现在在${L.name}。`) +
        `${L.name}：${L.desc}\n不要接着写上一段，只写「你」到达${L.name}时看到的场景（2–4 条）。旁白里的位置必须是${L.name}，不要写成别的地方。必须给出 suggestions。`;
    }
    case 'action': return `【玩家行动】${req.free ? '（玩家自己输入的）' : ''}${req.text}${req.note ? '\n（' + req.note + '）' : ''}\n写这次行动的经过和结果。` +
      (req.last ? '\n' + LAST_ACTION_NOTE : req.free ? `\n（这个时段还剩 ${req.apLeft} 点行动。small=1、medium=2、large=3；如果这次的规模会把点数用完，${LAST_ACTION_NOTE}）` : '');
    case 'wake': return `【醒来】「你」从假死中醒过来，地点：${L.name}，${SLOTS[s.slot]}。写醒来那一刻（2–5 条），给出建议行动。`;
    case 'event': {
      const ev = req.event;
      return `【主线事件】${ev.scene}\n刚才已经出现的固定台词：\n${(ev.lines || []).map(l => (l.speaker === 'narration' ? '' : l.speaker + '：') + l.text.replace('{FIRST_LINE}', FIRST_LINE)).join('\n')}\n接着往下写 3–6 条，上面这些固定台词不要再写一遍。${ev.choices ? '写到玩家需要做选择之前停住。suggestions 给空数组。' : ''}`;
    }
    case 'choice': return `【玩家选择】${req.text}\n${req.event.after || '写这个选择的结果，然后收住场景。'}\nsuggestions 给空数组。`;
  }
}

/** 跑一轮 AI。返回 normTurn 结果；出错时显示重试并等待 */
export async function doTurn(req) {
  const s = G.s;
  if (G.metaQueue.includes('copied')) { G.metaQueue = G.metaQueue.filter(x => x !== 'copied'); await metaLine('copied', true); }
  const snapshot = clone(s);
  if (['arrive', 'action', 'wake'].includes(req.kind)) G.last = { req, snapshot }; else G.last = null;
  const ctx = ctxFor(s, req.kind, req.event);
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
  const streamer = new LineStreamer(l => q.push(l));
  const playing = playQueue(q, opts);
  let raw;
  try {
    raw = await chat({ messages, onDelta: (_, full) => streamer.feed(full) });
  } catch (e) {
    q.close(); await playing; G.inTurn = false;
    restore(s, snapshot);  // 回滚
    return await showError(e, () => doTurn(req), req);
  }
  const turn = normTurn(raw);
  G.lastRaw = raw;  // 调试用
  s.meta.cliche = findCliches(turn.lines);
  for (let i = streamer.count; i < turn.lines.length; i++) q.push(turn.lines[i]);
  q.close();
  await playing; G.inTurn = false;
  // 结算
  if (req.kind === 'action' || req.kind === 'wake' || req.kind === 'arrive') {
    const tags = req.kind === 'action' ? turn.tags : [];
    const d = applyTags(s, tags, turn.he_flags);
    if (getSettings().debug) console.log('tags', tags, turn.he_flags, d, s.v);
  }
  if (turn.lines.some(l => GORE_RE.test(l.text || ''))) { s.c.goreDays ||= {}; s.c.goreDays[s.day] = (s.c.goreDays[s.day] || 0) + 1; }
  if (s.meta.feignTurns > 0) s.meta.feignTurns--;
  s.turns++;
  s.history.push({ role: 'user', content: um }, { role: 'assistant', content: JSON.stringify({ lines: turn.lines, tags: turn.tags, action_size: turn.action_size, suggestions: turn.suggestions, he_flags: turn.he_flags, cg: null }) });
  if (s.history.length > HISTORY_KEEP) compressHistory(s);
  if (turn.organ && organsOpen() && !ownedDrawings().includes(turn.organ)) await giveDrawing(turn.organ, 'he');
  if (turn.suggestions.length) s.lastSugg = turn.suggestions;
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
  if (a.kind === 'local') { setBusy(true); try { await a.fn(); } finally { if (!G.inTurn) setBusy(false); } return; }
  const req = { kind: 'action', text: a.text, cost: a.cost, last: G.s.ap - (a.cost || 1) <= 0 };
  await afterTurn(await doTurn(req), req);
}
async function freeAct() {
  const t = G.R.input.value.trim(); if (!t || G.busy) return;
  G.R.input.value = ''; G.R.inputMax = 0;
  const req = { kind: 'action', text: t, free: true, apLeft: G.s.ap };
  await afterTurn(await doTurn(req), req);
}
async function afterTurn(turn, req) {
  const s = G.s;
  await flushMeta();
  const hr = new Date().getHours(); if (hr >= 1 && hr < 5) await metaLine('late');
  if (req.kind === 'action') {
    const cost = req.cost ?? SIZE_COST[turn.action_size] ?? 1;
    s.ap = Math.max(0, s.ap - cost);
  }
  saveRun(s);
  refreshHud();
  if (s.ap <= 0) { await sleep(400); await waitAdvance(); await playLines([{ speaker: 'narration', text: SLOT_CLOSE[s.slot] || '时间过去了。' }]); return endSlot(); }
  renderActions('free');
}
async function spendLocal(cost, lines) {
  const s = G.s;
  if (lines?.length) { renderActions('none'); await playLines(lines); }
  s.ap = Math.max(0, s.ap - cost); refreshHud(); saveRun(s);
  if (s.ap <= 0) return endSlot();
  renderActions('free');
}
async function miniAction(name) {
  const res = await runMinigame(name, G.s);
  await spendLocal(1, res.lines);
}
// 器官图 = 河画的解剖图
const ownedDrawings = () => { const g = getGallery(); return Object.keys(g.organs).filter(id => g.organs[id]); };
async function giveDrawing(id, how) {
  const { ORGANS } = await import('./config/world.js');
  const o = ORGANS.find(x => x.id === id); if (!o) return;
  unlock('organs', id);
  if (how === 'he') await playLines([{ speaker: '河', expr: 'shy', text: '……这个给你。画得不好。' }]);
  await openOrgan(id, ownedDrawings());
}
async function sketchbook() {
  const { ORGANS } = await import('./config/world.js');
  const left = ORGANS.filter(o => !ownedDrawings().includes(o.id));
  if (!left.length) return spendLocal(1, [{ speaker: 'narration', text: '画本你都翻过了。每一页的线条都很细，标注写得很工整。' }]);
  const o = left[Math.floor(Math.random() * left.length)];
  await playLines([{ speaker: 'narration', text: `画本里夹着一张${o.name}。线条很细，旁边用小字写着标注。` }]);
  await giveDrawing(o.id);
  await spendLocal(1, []);
}
// 器官归位：十张画全给，拼完一次就全部解锁（回想、「河的画」）
async function organsGame() {
  const { ORGANS } = await import('./config/world.js');
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
function dueEvent(s) {
  return G.events.find(ev => !ev.trigger && !s.done.includes(ev.id) && (s.day > ev.day || (s.day === ev.day && s.slot >= ev.slot)));
}
function visitEvent(s) {
  return G.events.find(ev => ev.trigger === 'visit' && !s.done.includes(ev.id) && ev.loc === s.loc && (() => {
    const c = ev.cond || {};
    if (c.minDay && s.day < c.minDay) return false;
    if (c.maxDay && s.day > c.maxDay) return false;
    for (const id of c.done || []) if (!s.done.includes(id)) return false;
    if (c.slot != null && s.slot !== c.slot) return false;
    for (const [k, n] of Object.entries(c.counter || {})) if ((s.c[k] || 0) < n) return false;
    for (const [k, [lo, hi]] of Object.entries(c.v || {})) if (s.v[k] < lo || s.v[k] > hi) return false;
    for (const [k, val] of Object.entries(c.flags || {})) if (!!s.f[k] !== val) return false;
    return true;
  })());
}
export async function startSlot() {
  const s = G.s;
  s.ap = AP_PER_SLOT; s.lastSugg = []; G.last = null;
  refreshHud(); setSprite(null); showCG(null);
  const ev = dueEvent(s);
  if (ev) return runEvent(ev);
  s.phase = 'map'; saveRun(s);
  setScene(); renderActions('none');
  G.R.name.classList.add('hidden'); G.R.text.className = 'text narr'; G.R.text.textContent = `${SLOTS[s.slot]}。要去哪里？`;
  P.openMap(false);
}
export async function arrive(loc, viaMap) {
  const s = G.s;
  if (s.phase === 'free' && viaMap) { s.ap = Math.max(0, s.ap - 1); if (s.ap <= 0) { s.loc = loc; return endSlot(); } }
  s.prevLoc = s.loc; s.loc = loc; s.phase = 'free'; s.lastSugg = [];
  if (loc === 'ta_house') s.c.taVisits = (s.c.taVisits || 0) + 1;
  setSprite(null); setScene(); refreshHud(); saveRun(s);
  const ev = visitEvent(s);
  if (ev) return runEvent(ev);
  renderActions('free'); setBusy(true);
  const req = { kind: 'arrive' };
  await afterTurn(await doTurn(req), req);
}
async function leaveSlot() { if (!G.busy) endSlot(); }
async function sleepToMorning() {
  if (G.busy) return;
  const s = G.s;
  // 直接跳到第二天清晨（今天还没发生的固定事件不会被跳过：跳到它所在的时段为止）
  const evs = G.events.filter(ev => !ev.trigger && !s.done.includes(ev.id) && (ev.day === s.day && ev.slot > s.slot));
  if (evs.length) { s.slot = Math.min(...evs.map(e => e.slot)) - 1; }
  else { s.slot = 4; }
  endSlot();
}
export async function endSlot() {
  const s = G.s;
  s.phase = 'map'; if (!D40_NAMES.includes(s.saveName)) s.saveName = null; s.f.d40_atChoice = false;
  if (s.outfit === 'village') applyTags(s, [], [], { assim: VILLAGE_OUTFIT_ASSIM });
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
  s.phase = 'event'; s.curEvent = ev.id; saveRun(s);
  setScene(); refreshHud(); setSprite(null); renderActions('none');
  if (ev.special === 'd40' && !s.f.d40_warned) await d40Warning();
  if (ev.cg) { await preload(A(`cg/${ev.cg}.webp`)); showCG(ev.cg); }
  const fixed = (ev.lines || []).map(l => l.text === '{NAME_ANSWER}'
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
    applyTags(s, c.tags || [], [], c.delta);
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
    await doTurn({ kind: 'choice', event: ev, text: c.text });
  }
  Object.assign(s.f, ev.set || {});
  if (ev.heFlags) applyTags(s, [], ev.heFlags);
  markDone(s, ev);
  await waitAdvance();
  showCG(null);
  if (ev.trigger === 'offline') return; // 离线事件不占时段
  return endSlot();
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
  if (G.R.chars?.he) metaLine('away');   // 1–30 分钟：只是走开了一会儿
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
  if (s.phase === 'free') { if (!s.lastSugg?.length) s.lastSugg = [{ text: '四处看看', cost: 1 }, { text: '去找河', cost: 2 }]; setScene(); refreshHud(); renderActions('free'); if (!G.R.text.textContent) { G.R.text.className = 'text narr'; G.R.text.textContent = `${LOCATIONS[s.loc].name}。`; } return; }
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
    import('./audio.js').then(a => a.stutter()).catch(() => {});
    await playLines([{ speaker: '河', expr: 'alert', text: alertLine }]);
    s.meta.saidMeta = alertLine;
  }
  if (offlineMs >= 30 * 60e3) await wakeUp(offlineMs);
  await resumePhase();
}
