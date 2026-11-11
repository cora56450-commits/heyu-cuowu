// 各个浮层：地图、手机、数值页、菜单、记录、存读档、设置、选装扮、图鉴
import { h, $, A, openOv, closeOv, toast, modal, confirmBox, sleep } from './dom.js?v=1794401406';
import { getSettings, saveSettings, store, getGallery, DEFAULT_SETTINGS, organsOpen, endingsOpen } from '../store.js?v=1794401406';
import { chat, testConnection, ApiError } from '../api.js?v=1794401406';
import { phoneOfflinePrompt, phoneChatPrompt } from '../prompt.js?v=1794401406';
import { looseJson, stripTags } from '../parse.js?v=1794401406';
import { SLOTS, LOCATIONS, heLocation, OUTFITS, STATS_EYE5, START_OUTFITS, ORGANS, AP_PER_SLOT, motherAway, locLocked, lockNote } from '../config/world.js?v=1794401406';
import { VALUE_KEYS, VALUE_NAMES, AI_TAGS } from '../config/values.js?v=1794401406';
import { ENDINGS, ENDING_LINES, GROUP_ORDER, COVERS, coversUnlocked } from '../config/endings.js?v=1794401406';
import { saveRun, loadRun, slotInfo, SLOT_IDS, clone, tierOf, applyTags, taText } from '../state.js?v=1794401406';
import { rollMeta } from '../meta.js?v=1794401406';
import { G, loadReaction, arrive, refreshHud, continueRun, userFigure, outfitNorm, statsNorm, mapMarks, mapRecall, mapMaybe, heHintShown, PHONE_CG, hasAsset, hasPhone as hasPhoneNow } from '../game.js?v=1794401406';
import { DEMO, DEMO_TAG } from '../config/demo.js?v=1794401406';
import { openOrgan } from './organ.js?v=1794401406';
import { WEB3FORMS_KEY, MAIL_SUBJECT } from '../config/mail.js?v=1794401406';

// 系统样式的提示框（冷冰冰的电子界面，不是河说的）
export function systemNotice(text, buttons) {
  return new Promise(res => {
    // 和游戏其他弹窗同一个风格（纸面板 + 红线针脚按钮）
    const box = h('div', { class: 'sysbox paper', role: 'alertdialog' }, h('h3', {}, '提示'), h('p', {}, text),
      h('div', { class: 'row' }, buttons.map((b, i) => h('button', { type: 'button', class: 'btn' + (i === buttons.length - 1 ? ' sel' : ''), onclick: () => { closeOv('sys'); res(b.value); } }, b.label))));
    openOv('sys', h('div', { class: 'dim' }, box));
  });
}

// ———————————————— 地图 ————————————————
export function openMap(fromButton) {
  const s = G.s; if (!s) return;
  if (G.taAfterWait) { const r = G.taAfterWait; G.taAfterWait = null; r(); return; }   // 牠先于河的第二天：没看手机就点地图，出门先碰到河
  if (fromButton && (G.busy || s.phase === 'event')) { toast('现在走不开。'); return; }
  const mustChoose = s.phase === 'map';
  const heAt = heHintShown(s) ? heLocation(s.day, s.slot) : null;   // 只有少数时段告诉玩家河在哪（15%，一天最多一次）
  let sel = mustChoose ? (heAt || (s.loc && LOCATIONS[s.loc] && !locLocked(s, s.loc) ? s.loc : 'yard')) : s.loc;   // 河不在的时段：默认选你现在待的地方
  const marks = mapMarks(s);   // 有事的地点：小红点
  const isLocked = id => locLocked(s, id);
  if (!LOCATIONS[sel] || isLocked(sel)) sel = 'yard';   // 默认不停在去不了的地方
  const pins = Object.entries(LOCATIONS).map(([id, L]) => {
    const here = id === s.loc && !mustChoose;
    const b = h('button', { type: 'button', class: 'pin ' + (here ? 'tag here' : 'btn') + (isLocked(id) ? ' locked' : ''), style: { left: L.pos[0] + 'px', top: L.pos[1] + 'px' }, onclick: () => { sel = id; draw(); } },
      here ? h('img', { src: A('ui/ap_full.webp'), alt: '' }) : null, here ? taText(s, `${L.name}（你在这里）`) : taText(s, L.name), isLocked(id) ? h('i', { class: 'lock' }, '锁') : null, id === heAt ? h('i', { class: 'he' }, '河？') : null, marks[id] && !isLocked(id) ? h('i', { class: 'dot', title: marks[id] }) : null);
    b.dataset.id = id; return b;
  });
  const info = h('div', { class: 'info pp' });
  const draw = () => {
    for (const p of pins) if (!p.classList.contains('here')) { p.classList.toggle('btnsel', p.dataset.id === sel); p.classList.toggle('btn', p.dataset.id !== sel); }
    const L = LOCATIONS[sel]; const locked = isLocked(sel);
    const same = !mustChoose && sel === s.loc;
    // 说明在上、「去这里」固定在卡片底部，不随内容上下漂（测试报告：两次点空）
    info.replaceChildren(...[
      h('div', { class: 'nm' }, taText(s, L.name + (L.sub ? ' · ' + L.sub : ''))),
      h('div', { class: 'ds' }, taText(s, L.desc)),
      !locked && mapRecall(s, sel) ? h('div', { class: 'recall' }, taText(s, mapRecall(s, sel))) : null,
      !locked && mapMaybe(s, sel) ? h('div', { class: 'recall' }, taText(s, mapMaybe(s, sel))) : null,
      !locked && sel === 'ta_house' && s.c.taVisits ? h('div', { class: 'recall', style: { opacity: 0.6 } }, `来过 ${s.c.taVisits} 次 · 帮过 ${s.c.taLine || 0} 回`) : null,   // 牠和河共享爱慕 1111：看得出和牠走得多近
      sel === heAt ? h('div', { class: 'hehint' }, '这个时段：河可能在这里') : null,
      marks[sel] && !locked ? h('div', { class: 'hehint' }, marks[sel] + '。') : null,
      sel === 'yard' && motherAway(s.day, s.slot) ? h('div', { class: 'ds' }, '养母上后坡了。') : null,
      locked ? h('div', { class: 'ds' }, lockNote(s, sel)) : null,
      h('div', { class: 'grow' }),
      h('button', { type: 'button', class: 'go', disabled: locked || same, onclick: () => { closeOv('map'); arrive(sel, !mustChoose); } },
        locked ? '还去不了' : same ? '你就在这里' : mustChoose ? '去这里' : '去这里（花 1 点）')].filter(Boolean));
  };
  const side = h('div', { class: 'side' },
    h('div', { class: 'when' }, h('b', {}, `第 ${s.day} 天`), h('span', {}, SLOTS[s.slot])),
    mustChoose && s.slot === 0 && s.c.hintText && s.c.hintDay === s.day ? h('div', { class: 'tip morning' }, s.c.hintText) : null,
    h('div', { class: 'tip' }, mustChoose ? `每个地方 ${AP_PER_SLOT} 点行动，用完进下一个时段。` : '换个地方要花 1 点行动。'),
    info,
    // 地图上也能看手机（测试报告：有未读也要先进地点才能打开）
    hasPhoneNow(s) ? h('button', { type: 'button', class: 'btn map-phone', onclick: () => openPhone() }, '手机', s.unread ? h('span', { class: 'badge' }, s.unread) : null) : null,
    mustChoose ? null : h('button', { type: 'button', class: 'btn back', onclick: () => closeOv('map') }, '返回'));
  const ov = h('div', { class: ['', '', 'dusk', 'night'][s.slot] || '' }, h('div', { class: 'mapwrap' }, h('img', { src: A('ui/map.webp'), alt: '手绘的村子地图' }), h('div', { class: 'tint' }), ...pins), side);
  if (mustChoose && G.R) G.R.name.classList.add('hidden');   // 系统句不挂上一个人的名牌（测试报告 · 6）
  openOv('map', ov); draw();
}

// ———————————————— 手机 ————————————————
const SCREEN = { w: 800, h: 1566, x: 55, y: 239, sw: 690, sh: 1082 };
function fmtTs(ts) {
  const d = new Date(ts); const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function openPhone(noFlash) {
  const s = G.s; if (!s) return;
  // 轮到新的「他那边」CG：先闪 1.5 秒，下方淡入一行小字；每张一局只闪一次，没有就直接打开手机
  const cgId = s.c.phoneCgPending;
  if (noFlash !== true && cgId && !G.phoneFlashed && document.querySelector('#scr-main') && (PHONE_CG[cgId]?.slot ?? s.slot) === s.slot) {   // 时段不对先不闪，留到对应时段打开手机时
    G.phoneFlashed = true; s.c.phoneCgPending = null; saveRun(s);
    const img = h('img', { src: A(`cg/${cgId}.webp`), alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', opacity: 0, transition: 'opacity .6s' } });
    const cap = h('div', { class: 'phone-cap' }, PHONE_CG[cgId]?.cap || '');
    const f = h('div', { style: { background: '#000' } }, img, cap);
    openOv('phoneflash', f); setTimeout(() => { img.style.opacity = 1; cap.classList.add('on'); }, 30); setTimeout(() => { closeOv('phoneflash'); G.phoneFlashed = false; openPhone(true); }, 1800);
    import('../store.js?v=1794401406').then(m => m.unlock('cgs', cgId)); return;
  }
  s.unread = 0; refreshHud(); saveRun(s);
  // 「睡了吗。」→ 打开手机 3 秒后变成「对方撤回了一条消息」
  const recall = s.phone.filter(m => m.recallAt && m.recallAt < 1e9);
  for (const m of recall) m.recallAt = Date.now() + m.recallAt;
  if (recall.length) setTimeout(() => { if ($('#ov-phone')) render(); saveRun(s); }, 3100);
    const msgs = h('div', { class: 'msgs' });
  const render = () => {
    let lastTs = 0;
    msgs.replaceChildren(...s.phone.flatMap(m => {
      const out = [];
      if (m.sep) out.push(h('div', { class: 'sep' }, m.sep));
      if (m.ts - lastTs > 30 * 60e3) out.push(h('div', { class: 'ts' }, fmtTs(m.ts)));
      lastTs = m.ts;
      if (m.recallAt && m.recallAt <= Date.now()) out.push(h('div', { class: 'msg-sys' }, '对方撤回了一条消息'));
      else if (m.text && m.from === 'sys') out.push(h('div', { class: 'msg-sys' }, m.text));   // 旁白单独一行灰字
      else if (m.text) out.push(h('div', { class: 'msg ' + (m.from === 'me' ? 'me' : 'he') }, m.text));
      if (m.note) out.push(h('div', { class: 'msg-note' }, m.note));
      return out;
    }), typing ? h('div', { class: 'msg-sys typing' }, '对方正在输入…') : '');
    msgs.scrollTop = 1e6;
  };
  // 只有不在一起的时候才能聊：他就在你身边时，手机发不出去
  const evNow = s.phase === 'event' && G.events?.find(e => e.id === s.curEvent);
  const together = (s.phase === 'free' && heLocation(s.day, s.slot) === s.loc) || (evNow && evNow.heHere !== false);   // 固定事件里河在场也算
  const input = h('input', { type: 'text', placeholder: together ? '他就在你旁边。' : '给河发消息', 'aria-label': '给河发消息', maxlength: 70, disabled: together, onkeydown: e => { if (e.key === 'Enter') send(); } });
  const sendBtn = h('button', { onclick: () => send(), disabled: together }, '发送');
  // 他不秒回：发出去显示「已送达」，下一个时段他才回（game.js 的 phoneReplies）；第 39 天约见那一句除外
  async function send() {
    const typed = input.value.trim(); if (!typed) return;
    let quick = false;
    input.value = '';
    // 你打的字被改掉一次（借鉴机制与结局 §7，Emily is Away）：第 25 天以后、第 40 天以外，第一次出现「走 / 回去 / 离开」时，发出去的那条换掉第一处；不提示
    let t = typed, altered = null;
    if (s.day >= 25 && s.day !== 40 && !s.f.msg_altered) {
      const m = typed.match(/回去|离开|走/);
      if (m) { t = typed.slice(0, m.index) + (m[0] === '走' ? '留' : '留下') + typed.slice(m.index + m[0].length); altered = typed; s.f.msg_altered = true; }
    }
    const last = s.phone[s.phone.length - 1]; if (last?.from === 'me') delete last.note;
    s.phone.push({ from: 'me', text: t, ts: Date.now(), note: '已送达', day: s.day, ...(altered ? { altered } : {}) }); s.f.pingAnswered = true;
    if (s.day === 39 && s.f.d39_phone && !s.f.d39_replied) { s.f.d39_replied = true; render(); saveRun(s); await sleep(1800); s.phone[s.phone.length - 1].note = '已读'; s.phone.push({ from: 'he', text: '嗯。睡吧。', ts: Date.now() }); render(); saveRun(s); return; }
    const g = await import('../game.js?v=1794401406');
    if (!s.phonePending) {
      if ((s.phoneToday || 0) >= 3) s.phone[s.phone.length - 1].note = '已送达 · 他今天不会再回了';   // 每天最多回 3 次
      else {
        s.phoneToday = (s.phoneToday || 0) + 1; s.phonePending = { day: s.day, slot: s.slot };
        // 秒回按关系掷骰子（主线 1109 §2）：生 30%、熟 50%、近 70%、冷从不；第 22–24 天他躲着你，不掷
        const { phoneStage } = await import('../state.js?v=1794401406');
        const night = s.slot === g.NIGHT_SLOT;   // 夜里别老「睡着了」（1111）：夜里当晚就回的概率另算，他也在缝东西、没睡
        const p = (night ? { raw: 0.1, warm: 0.3, near: 0.6, cold: 0 } : { raw: 0.3, warm: 0.5, near: 0.7, cold: 0 })[phoneStage(s)] ?? (night ? 0.1 : 0.3);
        if (!(s.day >= 22 && s.day <= 24) && !s.f.first_msg_reply && Math.random() < p) quick = true;
      }
    }
    // 手机上约他：每一条都看（连发时第二条也算），弹框确认，他回的时候决定答不答应
    const prop = s.phonePending && g.parseProposal(s, t, '河', null);
    if (prop && await g.confirmProposal(prop)) s.phonePending.propose = prop;
    render(); saveRun(s);
    if (quick) {   // 秒回：「对方正在输入…」1–3 秒（AI 写得慢就一直显示到写完）
      typing = true; render();
      await Promise.all([sleep(1000 + Math.random() * 2000), g.phoneReplyNow()]);
      typing = false; if ($('#ov-phone')) { s.unread = 0; refreshHud(); render(); }
    }
  }
  let typing = false;
  // 备忘录（备忘录任务单 §1）：和聊天并列的一页，代码记的、AI 不写；按天分组，新的在上面，划掉的变灰
  const memoEl = h('div', { class: 'memo' });
  const renderMemo = () => {
    const days = [...new Set((s.memo || []).map(m => m.day))].sort((a, b) => b - a);
    memoEl.replaceChildren(...(days.length ? days.flatMap(d => [h('div', { class: 'memo-day' }, `第 ${d} 天`),
      ...(s.memo.filter(m => m.day === d).reverse().sort((a, b) => (b.ghost ? 1 : 0) - (a.ghost ? 1 : 0))   // 第 40 天回档留的那几条排在当天最上面
        .flatMap(m => [h('div', { class: 'memo-item' + (m.done ? ' done' : '') }, m.text), m.extra ? h('div', { class: 'memo-extra' }, m.extra) : null].filter(Boolean)))]) : [h('div', { class: 'memo-empty' }, '还没有记下什么。')]));
  };
  const inp = h('div', { class: 'inp' }, input, sendBtn);
  const title = h('b', {}, '河');
  const back = h('span', { class: 'hidden', onclick: () => show('chat') }, '‹ 信息');
  const memoBtn = h('span', { class: 'memo-tab', onclick: () => show('memo') }, '备忘录');
  function show(v) {
    const memo = v === 'memo';
    if (memo) { import('../game.js?v=1794401406').then(g => { g.memoSync(s); renderMemo(); }); renderMemo(); }
    title.textContent = memo ? '备忘录' : '河';
    back.classList.toggle('hidden', !memo); memoBtn.classList.toggle('hidden', memo);
    msgs.classList.toggle('hidden', memo); inp.classList.toggle('hidden', memo); memoEl.classList.toggle('hidden', !memo);
  }
  const scr = h('div', { class: 'screen-area' },
    h('div', { class: 'bar' }, back, title, memoBtn), msgs, memoEl, inp);
  show('chat');
  const home = h('button', { class: 'home', 'aria-label': 'Home 键，关掉手机', onclick: () => closeOv('phone') });
  const bg = $('#scr-main .bg');
  const ov = h('div', {},
    bg?.src && !bg.src.endsWith('/') && bg.getAttribute('src') ? h('img', { class: 'bgdim', src: bg.src, alt: '' }) : null,   // 没有背景图就不放（空地址在旧浏览器里会画成一块白）
    h('div', { class: 'phone' }, scr, h('img', { class: 'body', src: A('ui/phone.webp'), alt: '' }), home),
    h('div', { class: 'cap' }, h('b', {}, '他给你的手机'), h('div', {}, '只有他一个联系人。'), h('div', {}, '按 Home 键回到村子。')));
  openOv('phone', ov); render();
}
// 离线回来：河在你不在时发来的消息
export async function fetchOfflineMessages(ms) {
  const s = G.s; const H = 3600e3;
  if (ms < 3 * H) return;
  const count = ms < 20 * H ? 1 + Math.floor(Math.random() * 2) : ms < 3 * 24 * H ? 3 + Math.floor(Math.random() * 2) : 5 + Math.floor(Math.random() * 3);
  // 未接来电（借鉴机制与结局 §6）：只是一行系统字，放在「你不在的时候」最前面；不到 1 天不加
  const D = 24 * H, days = ms / D;
  let calls = days < 1 ? 0 : days < 3 ? 1 : days < 7 ? 3 : days < 14 ? 7 : 14;
  if (calls && (s.v?.resent ?? 0) >= 60) calls = Math.max(1, Math.floor(calls / 2));   // 怨恨高：他打得少了
  if (calls && (s.v?.love ?? 0) >= 70) calls += 2;
  let first = true;
  if (calls) { s.phone.push({ from: 'sys', text: `未接来电（${calls}）`, ts: Date.now() - ms * 0.95, sep: '你不在的时候' }); first = false; s.unread = (s.unread || 0) + 1; refreshHud(); saveRun(s); }
  try {
    const raw = await chat({ messages: [{ role: 'user', content: phoneOfflinePrompt(s, ms, count) }], stream: false, maxTokens: 600 });
    const j = looseJson(raw); const list = (j?.messages || []).slice(0, 8);
    if (!list.length) return;
    const now = Date.now(); const maxH = ms / H;
    for (const m of list) {
      const ago = Math.min(maxH * 0.95, Math.max(0.05, +m.hours_ago || 1));
      s.phone.push({ from: 'he', text: stripTags(m.text).trim() || '。', ts: now - ago * H, sep: first ? '你不在的时候' : null });
      first = false;
    }
    s.unread += list.length; refreshHud(); saveRun(s);
  } catch (e) { console.warn('离线消息生成失败', e); }
}

// ———————————————— 数值页 ————————————————
const EYE_X = [110, 300, 490, 680, STATS_EYE5.x];   // 第 5 颗（同化）压在女主右眼上
const LABEL_X = [110, 300, 490, 680, 805];   // 同化的标签放在她头发边上，不挡脸
const STATS_HELP = `· 爱慕：他有多在意你。陪着他、接住他的靠近会变高；冷淡、推开会降。
· 怨恨：他有多恨你能离开。你不在的时候、约好了没去、他的消息你没回、你总待在别人那里，它都会涨；冷淡、拒绝、总说要走涨得更快。越到后面越容易涨。温柔、守约、时间会让它慢慢消下去；那天你冷过他，它就不消。
· 希望：他有多信你能带他走。说外面的事、说要带他走会涨；说你想一个人走会掉。
· 克制：他还能忍住自己多少。他冲动时你怎么回应，决定它往哪边走。
· 同化：你有多像这里的人。待在村里、做村里的事、穿村里的衣服，它会自己涨。
· 同化往回拉的办法：跟他说起外面、说你想离开；换上「外面的衣服」；身上多出不该有的东西时，别当它本来就在那里。
没有哪个数是越高越好。`;
export function openStats() {
  const s = G.s; if (!s) return;
  const help = () => modal('statshelp', '他看你的方式', h('div', { class: 'how-text' }, STATS_HELP), { buttons: [{ label: '知道了', value: 1 }] });
  if (!store.get('stats_help')) { store.set('stats_help', 1); setTimeout(help, 400); }   // 第一次自动弹，之后点「这些数是什么」再看
  const kids = [];
  VALUE_KEYS.forEach((k, i) => {
    const v = Math.round(s.v[k]); const size = 90 + v * 0.9;   // 眼球大小跟数值走
    kids.push(h('img', { class: 'eye', src: A(v < 20 ? 'ui/eye_away.webp' : 'ui/eye_look.webp'), alt: '', style: { left: EYE_X[i] + 'px', width: size + 'px', height: size + 'px', ...(i === 4 ? { top: STATS_EYE5.y + 'px' } : {}) } }));
    kids.push(h('div', { class: 'lb', style: { left: LABEL_X[i] + 'px' } }, h('span', {}, VALUE_NAMES[k]), h('b', {}, v)));
  });
  const close = () => { closeOv('stats'); s.meta.sawStats = true; saveRun(s); };
  // d9 窗外之后第一次打开：0.8 秒后五颗眼球一起看过来（放大一点），停 1.5 秒再回去；没有字，只一次（关得早也不补）
  if (!s.c.eyesFirst || (s.f.seen_empty && !s.c.eyesLooked)) {   // 第一次打开就看过来一次；d9 窗外之后再看一次（Cora 11/10）
    if (s.c.eyesFirst) s.c.eyesLooked = true; s.c.eyesFirst = true; saveRun(s);
    setTimeout(() => {
      const eyes = [...document.querySelectorAll('#ov-stats .eye')]; if (!eyes.length) return;
      const keep = eyes.map(e => [e.src, e.style.width]);
      eyes.forEach(e => { e.src = A('ui/eye_look.webp'); e.style.width = e.style.height = parseFloat(e.style.width) * 1.12 + 'px'; });
      setTimeout(() => eyes.forEach((e, i) => { e.src = keep[i][0]; e.style.width = e.style.height = keep[i][1]; }), 1500);
    }, 800);
  }
  const ov = h('div', {},
    h('img', { class: 'user', src: A(`sprite/user/${s.outfit}.webp`), alt: '你的样子，灰色', style: statsNorm(s.outfit) }),   // 两眼正好压在红线最平的那一段上
    h('img', { class: 'thread', src: A('ui/thread.webp'), alt: '' }),
    ...kids,
    // 口袋里的五瓣花（主线 1109 §4）：0 朵不显示；第 34 天看过他的盒子以后多半句
    (s.c.flowerFound || 0) > 0 ? h('div', { class: 'pocket' }, `口袋里：错的花 ×${s.c.flowerFound}` + (s.f.he_box ? '　他的盒子：很多' : '')) : null,
    h('div', { class: 'head' }, h('b', {}, '你在他眼里'), h('span', {}, '眼球越大，数值越高；太低时会转开，不再看你')),
    h('button', { type: 'button', class: 'shut', onclick: close }, '关掉'),
    h('button', { type: 'button', class: 'stats-q', onclick: help }, '这些数是什么？'));   // 说明太密，不再铺在页面上，点了才弹
  openOv('stats', ov);
}

// ———————————————— 菜单 ————————————————
export function openMenu() {
  const items = [
    ['存档', () => openSaves('save')], ['读档', () => openSaves('load')], ['换装扮', () => openOutfit(false)],
    ['河的画', () => openOrganShelf()], ['结局', () => openGallery()], ['回想', () => openMemories()], ['设置', () => openSettings()],
    ['回到标题', async () => { if (await confirmBox('回到标题', '进度已经自动保存。（关掉页面，就等于你在河的世界里倒下了。）')) G.backTitle(); }],
  ];
  if (getSettings().debug) items.splice(items.length - 1, 0, ['调试', () => openDebug()]);
  const dis = t => t === '结局' && !endingsOpen();   // 和封面一致：还没打出结局（试玩版：还没玩完十天）时灰着
  modal('menu', '菜单', h('div', { class: 'list' }, items.map(([t, f]) => h('button', { class: 'btn', disabled: dis(t), onclick: () => { closeOv('menu'); f(); } }, t))));
}
export function openOrganShelf() {
  const g = getGallery(); const got = organsOpen() ? ORGANS.filter(o => g.organs[o.id]) : [];
  if (!got.length) { toast('还没有河的画。'); return; }
  openOrgan(got[0].id, got.map(o => o.id));
}

// ———————————————— 记录 ————————————————
export function openLog() {
  const s = G.s; if (!s) return;
  // 看记录时自动播放先停下（测试报告：开着自动打开记录，剧情继续往下走，走到地图后记录关不掉）
  if (G.auto) { G.auto = false; G.R?.autoBtn?.classList.remove('on'); }
  // 按天分段：每一天一个标题（旧记录没有天数就不分）
  let day = null; const rows = [];
  for (const l of s.log) {
    if (l.d && l.d !== day) { day = l.d; rows.push(h('div', { class: 'log-day' }, `第 ${day} 天`)); }
    rows.push(h('div', {}, l.who ? h('span', { class: 'who' }, l.who) : null, h('span', { class: l.who ? '' : 'n' }, l.t)));
  }
  const list = h('div', { class: 'log-list' }, rows);
  modal('log', '记录', list); setTimeout(() => (list.scrollTop = 1e6), 30);
}

// ———————————————— 存档 / 读档 ————————————————
export function openSaves(mode, wait = false) {
  const ids = mode === 'save' ? SLOT_IDS.slice(1) : SLOT_IDS;
  const name = id => id === 'auto' ? '自动' : '存档 ' + id.slice(-1);
  const list = h('div', { class: 'list' });
  const draw = () => list.replaceChildren(...ids.map(id => {
    const i = slotInfo(id);
    const desc = i?.saveName ? `${i.saveName}　${new Date(i.savedAt).toLocaleString('zh-CN', { hour12: false })}` : i ? `第 ${i.day} 天 · ${SLOTS[i.slot]} · ${taText(i, LOCATIONS[i.loc]?.name || '')}${i.ended ? '（已结束）' : ''}　${new Date(i.savedAt).toLocaleString('zh-CN', { hour12: false })}` : '（空）';
    return h('button', { class: 'btn', disabled: mode === 'load' && (!i || i.ended), onclick: () => act(id, i) }, h('b', {}, name(id)), '　', desc);
  }));
  async function act(id, i) {
    if (mode === 'save') {
      // 随时可存：正在说的这一段还没结束时，存的是这一段开始之前的状态（读档会重放这一段）
      if (i && !(await confirmBox('覆盖存档', `要覆盖${name(id)}吗？`))) return;
      const copy = clone(G.busy && G.last?.snapshot ? G.last.snapshot : G.s); copy.saveName = null; copy.heOnScreen = !!G.R?.chars?.he; copy.taOnScreen = G.R?.chars?.other?.who === '牠'; saveRun(copy, id); store.set('lastSlot', id); toast('存好了。'); draw();
    } else {
      const s = loadRun(id); if (!s) return;
      const fromTitle = !G.s;   // 从标题画面点「继续」进来的（有手动存档时会先弹这个列表）
      if (G.s && !(await confirmBox('读档', '当前进度会被这个存档替换。'))) return;
      closeOv('saves');
      s.meta.loaded = true;   // 读过档要记下来（meta 用）
      if (id !== 'auto') store.set('lastSlot', id);
      s.c.loads = (s.c.loads || 0) + 1;
      saveRun(s, 'auto');
      // 当面读档（当面读档的反应 1111）：河不是每次都发现，发现了按数值换说法；牠在场时偶尔笑一下 / 推一张一个字的字条
      let alert = null;
      if (s.heOnScreen || s.taOnScreen || s.loc === 'ta_house') {
        const counts = store.get('loadcount', {}); const key = id + ':' + s.savedAt; counts[key] = (counts[key] || 0) + 1; store.set('loadcount', counts);
        alert = loadReaction(s, counts[key], G.s);
      }
      // 从标题读自动存档：离开的这段时间照样算（离线假死、离线消息、怨恨）；之前固定传 0，有手动存档的玩家全都跳过了
      const off = fromTitle && id === 'auto' ? (G.bootOffline || 0) : 0;
      if (fromTitle) G.bootOffline = 0;
      continueRun(s, off, alert);
    }
  }
  draw();
  return modal('saves', mode === 'save' ? '存档' : '读档', list, { buttons: [{ label: '返回', value: null }] });
}

// ———————————————— 设置 ————————————————
export function openSettings() {
  const st = getSettings();
  // 改了就立刻保存（不依赖点 × 关闭）
  const boxes = {};
  const inp = (key, type = 'text', ph = '') => h('input', { type, value: st[key] ?? '', placeholder: ph, autocomplete: 'off', oninput: e => {
    st[key] = e.target.value.trim();
    if (key === 'apiKey' && st.apiKey && st.mock) { st.mock = false; if (boxes.mock) boxes.mock.checked = false; }
    saveSettings(st);
  } });
  const after = () => { import('../audio.js?v=1794401406').then(a => a.applyVolume()); document.body.classList.toggle('calm', !!st.reduceMotion); };
  const rng = (key, min, max, step) => h('input', { type: 'range', min, max, step, value: st[key], oninput: e => { st[key] = +e.target.value; saveSettings(st); after(); } });
  const chk = key => (boxes[key] = h('input', { type: 'checkbox', checked: !!st[key], onchange: e => { st[key] = e.target.checked; saveSettings(st); after(); } }));
  const status = h('span', { class: 'note' });
  const panel = h('div', { class: 'panel paper' },
    h('button', { class: 'close-x', style: { color: 'var(--ink)' }, onclick: () => { saveSettings(st); closeOv('settings'); if (G.coverChanged && !G.R) { G.coverChanged = false; G.backTitle?.(); } } }, '×'),
    h('h2', {}, '设置'),
    ...(() => {   // 封面自选：只列已解锁的（打出过的结局对应的 + 默认）
      const ids = coversUnlocked(getGallery().endings); if (ids.length < 2) return [];
      const cur = store.get('cover', 'fall');
      return [h('h4', {}, '封面'), h('label', {}, h('span', {}, '封面'), h('select', { class: 'sel', onchange: e => { store.set('cover', e.target.value); G.coverChanged = true; } },
        ...ids.map(id => h('option', { value: id, selected: id === cur }, (id === 'fall' ? '默认 · ' : '') + COVERS[id]))))];
    })(),
    h('h4', {}, 'AI 接入'),
    h('label', {}, h('span', {}, 'API 地址'), inp('baseUrl', 'text', 'https://api.deepseek.com')),
    h('label', {}, h('span', {}, 'API Key'), inp('apiKey', 'password', 'sk-...')),
    (() => {   // 模型：快 / 好 / 其他（自己填）
      const PRESET = [['deepseek-flash', '快：deepseek-flash（便宜）'], ['deepseek-v4-pro', '好：deepseek-v4-pro（贵 4–5 倍，前后更连贯）']];
      const custom = !PRESET.some(([v]) => v === st.model);
      const other = inp('model', 'text', '模型名'); other.style.display = custom ? '' : 'none';
      const sel = h('select', { class: 'sel', onchange: e => { if (e.target.value === '__other') { other.style.display = ''; other.focus(); } else { other.style.display = 'none'; st.model = e.target.value; saveSettings(st); } } },
        ...PRESET.map(([v, t]) => h('option', { value: v, selected: v === st.model }, t)), h('option', { value: '__other', selected: custom }, '其他（自己填模型名）'));
      return h('label', {}, h('span', {}, '模型'), sel, other);
    })(),
    h('label', {}, h('span', {}, '思维链'), h('select', { class: 'sel', onchange: e => { st.thinking = e.target.value; saveSettings(st); } },
      ...[['off', '关'], ['events', '只在固定剧情开（推荐）'], ['all', '全部开（每一轮都慢很多）']].map(([v, t]) => h('option', { value: v, selected: (st.thinking || 'off') === v }, t))),
      h('span', { class: 'note' }, '先想再写，逻辑更通顺，但出字要多等一会儿。只对 DeepSeek 生效')),
    h('label', {}, h('span', {}, '流式输出'), chk('stream'), h('span', { class: 'note' }, '打字机效果更快出现；服务商不支持时会自动整段输出')),
    h('label', {}, h('span', {}, 'JSON 模式'), chk('jsonMode'), h('span', { class: 'note' }, '要求模型严格输出 JSON；不支持时会自动关掉')),
    h('p', { class: 'note' }, '默认使用 OpenAI 兼容的 /chat/completions 格式。Key 只保存在你自己这个浏览器的 localStorage 里，不会发到除了你填的 API 地址以外的任何地方。'),
    h('p', { class: 'note' }, '如果提示「连不上」：有些服务商不允许浏览器直接调用（跨域 / CORS）。可以把 API 地址换成你自己的代理地址。'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => { saveSettings(st); status.textContent = '测试中……'; try { await testConnection(); status.textContent = '连上了。'; } catch (e) { status.textContent = e.message; } } }, '测试连接'), status),
    h('label', {}, h('span', {}, '测试模式'), chk('mock'), h('span', { class: 'note' }, '不调用 AI，用固定台词跑流程（开发调试用）')),
    h('label', {}, h('span', {}, '成人内容'), (boxes.adult = h('input', { type: 'checkbox', checked: !!st.adult, onchange: async e => {
      if (e.target.checked && !(await confirmBox('成人内容', '打开后，亲密的场景会直接写出来，不再只是暗示。只有年满 18 岁才能打开。你已满 18 岁吗？', '已满 18 岁，打开', '算了'))) { e.target.checked = false; return; }
      st.adult = e.target.checked; saveSettings(st);
    } })), h('span', { class: 'note' }, '默认关闭：亲密的部分只写到暗示为止。打开后描写尺度取决于你用的 AI 服务')),
    h('h4', {}, '阅读'),
    h('label', {}, h('span', {}, '文字速度'), rng('textSpeed', 10, 100, 5)),
    h('label', {}, h('span', {}, '自动播放间隔'), rng('autoDelay', 0.6, 4, 0.2)),
    h('label', {}, h('span', {}, '背景音乐'), chk('bgmOn')),
    h('label', {}, h('span', {}, '音量'), rng('volume', 0, 1, 0.05)),
    h('label', {}, h('span', {}, '减少画面晃动'), chk('reduceMotion'), h('span', { class: 'note' }, '关掉立绘的抽动效果')),
    h('h4', {}, '存档'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => {
        if (!(await confirmBox('清除存档', '自动存档和三个手动存档都会被删掉。图鉴、设置和 Key 会保留。', '清除'))) return;
        for (const id of SLOT_IDS) store.del('save_' + id); store.del('after'); toast('存档已清除。'); G.s = null; closeOv('settings'); G.backTitle();
      } }, '清除存档'),
      h('button', { class: 'btn', onclick: async () => {
        if (!(await confirmBox('清除全部', '所有东西都会被清掉：存档、结局图鉴、设置和 API Key。', '全部清除'))) return;
        store.clearAll(); location.reload();
      } }, '清除全部数据')),
    h('p', { class: 'note' }, '浏览器里「清除网站数据」也会把存档、Key 和图鉴一起清掉。'),
    st.debug ? h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => {
      if (!(await confirmBox('全通存档', '图鉴全部解锁，三个手动存档位会被覆盖成测试节点（自动存档不动）。', '写入'))) return;
      const d = await import('../debug.js?v=1794401406'); await d.unlockAll(); await d.makeTestSaves(); toast('写好了。');
    } }, '调试：全通存档')) : null);
  openOv('settings', h('div', {}, panel));
}

// ———————————————— 选装扮 ————————————————
export function openOutfit(isStart) {
  return new Promise(res => {
    const s = G.s;
    const flags = s?.f || {};
    const ids = Object.keys(OUTFITS).filter(id => START_OUTFITS.includes(id) || (!isStart && OUTFITS[id].unlockFlag && flags[OUTFITS[id].unlockFlag]));
    let sel = s?.outfit || 'initial';
    const cards = ids.map(id => h('button', { class: 'o' + (id === sel ? ' sel' : ''), 'data-id': id, onclick: () => isStart ? choose(id) : pick(id) },
      h('img', { src: A(`sprite/user/${id}.webp`), alt: '', style: outfitNorm(id) }), h('div', { class: 'nm' }, OUTFITS[id].name, h('small', {}, OUTFITS[id].note))));
    // 开局：点卡片只是选中，下面填名字（可以不填），按「就这样」才开始
    function choose(id) { sel = id; for (const c of cards) c.classList.toggle('sel', c.dataset.id === id); }
    const nameIn = isStart ? h('input', { class: 'name-in', type: 'text', maxlength: 8, placeholder: '你的名字（可以不填）', autocomplete: 'off' }) : null;
    const startBar = isStart ? h('div', { class: 'namebar' }, nameIn,
      h('button', { class: 'btn go', onclick: () => { closeOv('outfit'); res({ outfit: sel, name: nameIn.value.trim().slice(0, 8) }); } }, '就这样'),
      null) : null;
    function pick(id) {
      closeOv('outfit');
      if (!isStart && s && id !== s.outfit) {
        s.outfit = id; s.meta.outfitChanged = true; saveRun(s); refreshHud(); toast('换好了。');
        if (G.R?.chars?.he) import('../game.js?v=1794401406').then(g => { g.addResent(G.s, 1, '当面换装'); g.metaLine('outfit'); });   // 数值与怨恨 §1-5
      }
      res(id);
    }
    const ov = h('div', {}, h('div', { class: 'cap' }, isStart ? '选一身打扮' : '换一身打扮', h('small', {}, isStart ? '五套的区别在衣服上。游戏里随时可以换。' : '在他眼里，你随时能换一张脸。')),
      h('div', { class: 'row' + (isStart ? ' with-name' : '') }, cards), startBar,
      h('button', { class: 'close-x', onclick: () => { closeOv('outfit'); res(null); } }, '×'));
    openOv('outfit', ov);
  });
}

// ———————————————— 图鉴 ————————————————
// 回想里的剧情 / 日常 CG（结局 CG 不放这里）
export const STORY_CGS = ['first_meet', 'd1_night', 'd2_walk', 'd2_phone', 'daily_breakfast', 'daily_table', 'daily_lamp', 'daily_chili', 'd4_heng', 'ta_suture', 'd6_creek', 'd8_man', 'puzzle_photo', 'phone_night', 'phone_warm', 'phone_near', 'phone_sour', 'phone_cold', 'user_offline', 'master', 'd12_drawings', 'festival', 'd16_teach', 'he_suture', 'd20_rain', 'first_cross', 'd24_door', 'daily_table_mid', 'daily_lamp_mid', 'daily_laundry', 'ta_mad', 'ta_lick', 'd26_guo', 'd28_tomb', 'border', 'd32_thread', 'd34_flowers', 'outside', 'd36_roof', 'd38_unbind', 'daily_table_late', 'daily_lamp_late', 'daily_wait_late', 'he_first', 'ta_first', 'julesjim_hands', 'day40', 'd41_night', 'epi_button', 'epi_julesjim', 'epi_truman'];
function viewCG(id, title, endId) {
  const after = endId && ENDING_LINES[endId]?.after;   // ‘祖与占’：最下面一行小字「后日谈 ›」，点了重看
  const v = h('div', { style: { background: '#000' }, onclick: () => closeOv('cgview') },
    after ? h('button', { type: 'button', class: 'btn', style: { position: 'absolute', bottom: '18px', left: '50%', transform: 'translateX(-50%)', zIndex: 2, textAlign: 'center', fontSize: '18px', letterSpacing: '4px' }, onclick: e => { e.stopPropagation(); import('./ending.js?v=1794401406').then(m => m.replayAfter(endId)); } }, '后日谈') : null,
    h('img', { src: A(`cg/${id}.webp`), style: { width: '100%', height: '100%', objectFit: 'contain' }, alt: '' }),
    title ? h('div', { style: { position: 'absolute', bottom: '60px', width: '100%', textAlign: 'center', color: '#f3ece2', fontSize: '44px', letterSpacing: '14px', textShadow: '0 2px 16px #000' } }, title) : null);
  openOv('cgview', v);
}
function openCoverPicker() {
  const ids = coversUnlocked(getGallery().endings), cur = store.get('cover', 'fall');
  const grid = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '14px', justifyContent: 'center' } }, ...ids.map(id => h('div', {
    style: { width: '150px', cursor: 'pointer', textAlign: 'center', fontSize: '14px', color: 'var(--ink)', outline: id === cur ? '2px dashed #b0453a' : 'none', outlineOffset: '4px' },
    onclick: () => { store.set('cover', id); closeOv('cover'); toast('封面换好了。'); if (!G.R) { closeOv('gallery'); G.backTitle?.(); } } },
    h('img', { src: A(`cover/${id === 'empty' ? 'river' : id}.webp`), alt: COVERS[id], style: { width: '150px', height: '110px', objectFit: 'cover', display: 'block', background: '#111' } }),
    h('div', { style: { marginTop: '4px' } }, (id === 'fall' ? '默认 · ' : '') + COVERS[id]))));
  modal('cover', '换封面', grid, { buttons: [{ label: '返回', value: null }] });
}
function galleryShell(title, sub, body, extra = null) {
  const top = h('div', { class: 'top' },
    h('div', { class: 't' }, h('b', {}, title), h('span', {}, sub)),
    h('div', { class: 'r' }, extra, h('button', { type: 'button', class: 'btn', onclick: () => closeOv('gallery') }, '返回')));
  openOv('gallery', h('div', {}, top, body));
}
// 结局：12 个结局，未达成只写条件，达成后点开看 CG 和标题卡
export function openGallery() {
  const g = getGallery();
  const E = Object.entries(ENDINGS);
  const seen = E.filter(([id]) => g.endings[id]).length;
  const card = (id, e, extra = '') => {
    if (g.endings[id]) return h('div', { class: 'gcard card on ' + extra, onclick: () => viewCG(e.cg, `‘${e.title}’`, id) },
      h('img', { class: 'thumb', src: A(`cg/${e.cg}.webp`), alt: '' }), h('b', {}, `‘${e.title}’`), h('small', {}, e.tag || '已达成'));   // 结局图鉴小字（结局致敬与改名 1110 A）
    if (e.hidden) return h('div', { class: 'gcard card hidden-end' }, '？？？');
    return h('div', { class: 'gcard card ' + extra + (e.how ? ' has-how' : ''), onclick: e.how ? () => modal('how', '怎么达成', h('div', { class: 'how-text' }, e.how)) : null },
      h('span', { class: 'q' }, '？？？'), h('span', { class: 'cond' }, e.cond), e.how ? h('small', { class: 'how-hint' }, '点开看怎么达成') : null);
  };
  const grp = name => E.filter(([, e]) => e.group === name);
  const body = h('div', { class: 'body' },
    h('div', { class: 'grp' }, '第 42 天'), h('div', { class: 'grid' }, grp('第 42 天').map(([id, e]) => card(id, e))),
    h('div', { class: 'grp' }, '中途'), h('div', { class: 'grid' }, grp('中途').map(([id, e]) => card(id, e))),
    h('div', { class: 'grp' }, '兜底　·　隐藏'),
    h('div', { class: 'grid' }, ...grp('兜底').map(([id, e]) => card(id, e)), ...grp('隐藏').map(([id, e]) => card(id, e))));   // 和上面同样大小的卡片
  const covers = coversUnlocked(g.endings);   // 换封面（后日谈按钮与封面 1111 §2）：结局页右上角，点缩略图换
  galleryShell('结局', `已见 ${seen} / ${E.length}`, body, covers.length > 1 ? h('button', { type: 'button', class: 'btn', style: { marginRight: '10px' }, onclick: openCoverPicker }, '换封面') : null);
}
// 回想：剧情 / 日常 CG；没解锁的是纸卡，写 ???
export function openMemories() {
  const g = getGallery();
  const CGS = STORY_CGS.filter(id => hasAsset(`cg/${id}.webp`));   // 试玩版只列包里有的
  const seen = CGS.filter(id => g.cgs[id]).length;
  const body = h('div', { class: 'body' }, h('div', { class: 'grid' }, CGS.map(id => g.cgs[id]
    ? h('div', { class: 'gcard card on img', onclick: () => viewCG(id) }, h('img', { src: A(`cg/${id}.webp`), alt: '' }))
    : h('div', { class: 'gcard card' }, h('span', { class: 'q' }, '???')))));
  // 道具：河的画（器官归位拼完之前全是 ???）
  const open = organsOpen();
  body.append(h('div', { class: 'gsec' }, '河的画'), h('div', { class: 'grid organs' }, ORGANS.map(o => open && g.organs[o.id]
    ? h('div', { class: 'gcard card on img organ', onclick: () => openOrgan(o.id, ORGANS.filter(x => g.organs[x.id]).map(x => x.id)) }, h('img', { src: A(`organ/${o.id}.webp`), alt: o.name }))
    : h('div', { class: 'gcard card' }, h('span', { class: 'q' }, '???')))));
  // 第 24 天门缝底下推出来的那张画（没有图，只有字）
  const textCard = (title, lines) => h('div', { class: 'gcard card on door-drawing', onclick: () => openOv('cgview', h('div', { style: { background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onclick: () => closeOv('cgview') }, h('div', { class: 'paper', style: { width: '560px', padding: '48px 56px', fontSize: '22px', lineHeight: '2.1', color: '#3b342c' } }, ...lines.flatMap((l, k) => k ? [h('br'), l] : [l])))) }, h('span', {}, title));
  // 门缝下的画：用第 24 天的 CG（主线 1109 §5.2：原来误用了小时候的河）；图没到就不显示这张卡
  if (g.misc.door_drawing && hasAsset('cg/d24_door.webp')) body.lastChild.append(h('div', { class: 'gcard card on img organ', onclick: () => viewCG('d24_door') }, h('img', { src: A('cg/d24_door.webp'), alt: '门缝下的画', style: { objectFit: 'cover' } })));
  if (g.misc.five_petal) body.lastChild.append(hasAsset('cg/five_petal.webp') ? h('div', { class: 'gcard card on img organ', onclick: () => viewCG('five_petal') }, h('img', { src: A('cg/five_petal.webp'), alt: '五瓣的花', style: { objectFit: 'cover' } })) : textCard('五瓣的花', ['桃花林里那朵五瓣的。', '在这里，它看起来反而像一个错误。']));
  galleryShell('回想', `${seen} / ${CGS.length}`, body);
}

// ———————————————— 调试（?debug=1）————————————————
function openDebug() {
  const s = G.s;
  const box = h('div', { class: 'list' },
    h('button', { class: 'btn', onclick: () => import('../game.js?v=1794401406').then(g => g.glitchOnce(undefined, { force: true })) }, '立绘花屏一次（看效果）'),
    ...VALUE_KEYS.map(k => h('label', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, h('span', { style: { width: '60px' } }, VALUE_NAMES[k]),
      h('input', { type: 'range', min: 0, max: 100, value: s.v[k], oninput: e => { s.v[k] = +e.target.value; e.target.nextSibling.textContent = e.target.value; } }), h('span', {}, s.v[k]))),
    h('label', {}, '疯神 ', h('input', { type: 'range', min: -5, max: 5, step: 0.5, value: s.madness, oninput: e => { s.madness = +e.target.value; } })),
    h('label', {}, '跳到第几天 ', h('input', { type: 'number', min: 1, max: 42, value: s.day, onchange: e => {
      s.day = +e.target.value; s.slot = 0;
      for (const ev of G.events) if (!ev.trigger && ev.day < s.day && !s.done.includes(ev.id)) s.done.push(ev.id);   // 跳过去的天数里的固定事件算已经发生
    } })),
    h('label', {}, '牠屋子次数 ', h('input', { type: 'number', min: 0, value: s.c.taVisits || 0, onchange: e => { s.c.taVisits = +e.target.value; } })),
    h('pre', { style: { fontSize: '13px', whiteSpace: 'pre-wrap' } }, JSON.stringify({ c: s.c, f: s.f, done: s.done, madTier: tierOf(s), meta: s.meta }, null, 1)));
  modal('debug', '调试', box, { buttons: [{ label: '关闭', value: null }] }).then(() => { saveRun(s); refreshHud(); });
}

// ———————————————— 信箱：给作者写建议（Web3Forms） ————————————————
export function openMailbox() {
  const ready = !!WEB3FORMS_KEY;
  const msg = h('textarea', { class: 'mail-text', maxlength: 1500, placeholder: ready ? '想对作者说的话：建议、bug、哪里玩不下去……' : '', disabled: !ready });
  const who = h('input', { class: 'mail-who', type: 'text', maxlength: 60, placeholder: '怎么称呼你 / 联系方式（可以不填）', disabled: !ready });
  const status = h('span', { class: 'note' }, ready ? '' : '信箱还没开通。');
  const send = h('button', { class: 'btn', disabled: !ready, onclick: async () => {
    const text = msg.value.trim(); if (!text) { status.textContent = '还没写内容。'; return; }
    const last = store.get('mail_last', 0); if (Date.now() - last < 60e3) { status.textContent = '寄得太快了，过一分钟再寄。'; return; }
    send.disabled = true; status.textContent = '寄出中……';
    try {
      const s = loadRun('auto');
      const r = await fetch('https://api.web3forms.com/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ access_key: WEB3FORMS_KEY, subject: MAIL_SUBJECT, from_name: who.value.trim() || '匿名玩家', message: text,
          进度: s ? `第 ${s.day} 天` : '还没开始', 版本: DEMO ? '试玩版' : DEMO_TAG ? `测试版 ${DEMO_TAG}` : '完整版', 设备: navigator.userAgent }) }).then(x => x.json());
      if (!r.success) throw new Error(r.message || '寄不出去');
      store.set('mail_last', Date.now()); msg.value = ''; status.textContent = '寄出去了。谢谢你。';
    } catch (e) { status.textContent = '没寄出去，过一会儿再试试。'; }
    finally { send.disabled = false; }
  } }, '寄出');
  modal('mail', '信箱', h('div', { class: 'mail-box' }, h('p', { class: 'note' }, '写给作者的信。会连同你现在的进度（第几天）一起寄出，不会带上你的 Key 和存档内容。'), msg, who, h('div', { class: 'row' }, send, status)));
}

// ———————————————— 序：点「开始」之后、选脸之前（人肉测试 v2 · C1） ————————————————
export const PROLOGUE = ['你过不去。', '她可以。', '给她挑一张脸。', '她在溪边醒来，住四十二天。', '这些天，你看着她。', '村里也有人，在看着你。'];   // 11/09 Cora 定稿 C 版
// 黑底白字，一行一行淡入，点一下下一行；lines 放完以后淡出
export function blackLines(lines, { hold = false, faint = false } = {}) {
  return new Promise(res => {
    const box = h('div', { class: 'prologue-lines' }); const ov = h('div', { class: 'prologue' }, box, h('div', { class: 'tap' }, '点一下'));
    openOv('prologue', ov); let i = 0;
    const next = () => {
      if (i >= lines.length) { ov.removeEventListener('click', next); ov.style.transition = 'opacity .8s'; ov.style.opacity = 0; setTimeout(() => { closeOv('prologue'); res(); }, hold ? 1600 : 800); return; }
      const p = h('p', faint ? { style: { fontSize: '15px', letterSpacing: '4px', color: 'rgba(220,210,195,.45)' } } : {}, lines[i++]); box.append(p); setTimeout(() => p.classList.add('on'), 30);   // faint：很淡的小字（11/10 修：之前这条注释把 setTimeout 注释掉了，黑屏上的字都不显示）
    };
    ov.addEventListener('click', next); next();
  });
}
