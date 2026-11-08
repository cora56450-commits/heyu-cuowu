// 各个浮层：地图、手机、数值页、菜单、记录、存读档、设置、选装扮、图鉴
import { h, $, A, openOv, closeOv, toast, modal, confirmBox, sleep } from './dom.js?v=1794172711';
import { getSettings, saveSettings, store, getGallery, DEFAULT_SETTINGS, organsOpen } from '../store.js?v=1794172711';
import { chat, testConnection, ApiError } from '../api.js?v=1794172711';
import { phoneOfflinePrompt, phoneChatPrompt } from '../prompt.js?v=1794172711';
import { looseJson } from '../parse.js?v=1794172711';
import { SLOTS, LOCATIONS, heLocation, OUTFITS, START_OUTFITS, ORGANS } from '../config/world.js?v=1794172711';
import { VALUE_KEYS, VALUE_NAMES, AI_TAGS } from '../config/values.js?v=1794172711';
import { ENDINGS, GROUP_ORDER } from '../config/endings.js?v=1794172711';
import { saveRun, loadRun, slotInfo, SLOT_IDS, clone, tierOf, applyTags } from '../state.js?v=1794172711';
import { rollMeta } from '../meta.js?v=1794172711';
import { G, arrive, refreshHud, continueRun, userFigure, outfitNorm } from '../game.js?v=1794172711';
import { openOrgan } from './organ.js?v=1794172711';
import { WEB3FORMS_KEY, MAIL_SUBJECT } from '../config/mail.js?v=1794172711';

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
  if (fromButton && (G.busy || s.phase === 'event')) { toast('现在走不开。'); return; }
  const mustChoose = s.phase === 'map';
  const heAt = heLocation(s.day, s.slot);
  let sel = mustChoose ? (heAt || (s.loc && LOCATIONS[s.loc] && !(LOCATIONS[s.loc].unlockDay > s.day) ? s.loc : 'yard')) : s.loc;   // 河不在的时段：默认选你现在待的地方
  const isLocked = id => { const L = LOCATIONS[id]; return L.unlockDay && s.day < L.unlockDay && !(id === 'border' && s.f.border_found); };
  const pins = Object.entries(LOCATIONS).map(([id, L]) => {
    const here = id === s.loc && !mustChoose;
    const b = h('button', { type: 'button', class: 'pin ' + (here ? 'tag here' : 'btn') + (isLocked(id) ? ' locked' : ''), style: { left: L.pos[0] + 'px', top: L.pos[1] + 'px' }, onclick: () => { sel = id; draw(); } },
      here ? h('img', { src: A('ui/ap_full.webp'), alt: '' }) : null, here ? `${L.name}（你在这里）` : L.name, id === heAt ? h('i', { class: 'he' }, '河？') : null);
    b.dataset.id = id; return b;
  });
  const info = h('div', { class: 'info pp' });
  const draw = () => {
    for (const p of pins) if (!p.classList.contains('here')) { p.classList.toggle('btnsel', p.dataset.id === sel); p.classList.toggle('btn', p.dataset.id !== sel); }
    const L = LOCATIONS[sel]; const locked = isLocked(sel);
    const same = !mustChoose && sel === s.loc;
    info.replaceChildren(...[
      h('div', { class: 'nm' }, L.name + (L.sub ? ' · ' + L.sub : '')),
      h('div', { class: 'ds' }, L.desc),
      sel === heAt ? h('div', { class: 'hehint' }, '这个时段：河可能在这里') : null,
      locked ? h('div', { class: 'ds' }, '现在还去不了。') : null,
      h('button', { type: 'button', class: 'go', disabled: locked || same, onclick: () => { closeOv('map'); arrive(sel, !mustChoose); } },
        same ? '你就在这里' : mustChoose ? '去这里' : '去这里（花 1 点）')].filter(Boolean));
  };
  const side = h('div', { class: 'side' },
    h('div', { class: 'when' }, h('b', {}, `第 ${s.day} 天`), h('span', {}, SLOTS[s.slot])),
    h('div', { class: 'tip' }, mustChoose ? '选一个地方去。到了那里有 3 点行动，用完或者离开，就进入下一个时段。' : '换个地方要花 1 点行动。'),
    info,
    mustChoose ? null : h('button', { type: 'button', class: 'btn back', onclick: () => closeOv('map') }, '返回'));
  const ov = h('div', {}, h('div', { class: 'mapwrap' }, h('img', { src: A('ui/map.webp'), alt: '手绘的村子地图' }), ...pins), side);
  openOv('map', ov); draw();
}

// ———————————————— 手机 ————————————————
const SCREEN = { w: 800, h: 1566, x: 55, y: 239, sw: 690, sh: 1082 };
function fmtTs(ts) {
  const d = new Date(ts); const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function openPhone() {
  const s = G.s; if (!s) return;
  s.unread = 0; refreshHud(); saveRun(s);
    const msgs = h('div', { class: 'msgs' });
  const render = () => {
    let lastTs = 0;
    msgs.replaceChildren(...s.phone.flatMap(m => {
      const out = [];
      if (m.sep) out.push(h('div', { class: 'sep' }, m.sep));
      if (m.ts - lastTs > 30 * 60e3) out.push(h('div', { class: 'ts' }, fmtTs(m.ts)));
      lastTs = m.ts;
      if (m.text) out.push(h('div', { class: 'msg ' + (m.from === 'me' ? 'me' : 'he') }, m.text));
      if (m.note) out.push(h('div', { class: 'msg-note' }, m.note));
      return out;
    }));
    msgs.scrollTop = 1e6;
  };
  // 只有不在一起的时候才能聊：他就在你身边时，手机发不出去
  const together = s.phase === 'free' && heLocation(s.day, s.slot) === s.loc;
  const input = h('input', { type: 'text', placeholder: together ? '他就在你旁边。' : '给河发消息', 'aria-label': '给河发消息', maxlength: 70, disabled: together, onkeydown: e => { if (e.key === 'Enter') send(); } });
  const sendBtn = h('button', { onclick: () => send(), disabled: together }, '发送');
  // 他不秒回：发出去显示「已送达」，下一个时段他才回（game.js 的 phoneReplies）；第 39 天约见那一句除外
  async function send() {
    const t = input.value.trim(); if (!t) return;
    input.value = '';
    const last = s.phone[s.phone.length - 1]; if (last?.from === 'me') delete last.note;
    s.phone.push({ from: 'me', text: t, ts: Date.now(), note: '已送达' }); s.f.pingAnswered = true;
    if (s.day === 39 && s.f.d39_phone && !s.f.d39_replied) { s.f.d39_replied = true; render(); saveRun(s); await sleep(1800); s.phone[s.phone.length - 1].note = '已读'; s.phone.push({ from: 'he', text: '嗯。睡吧。', ts: Date.now() }); render(); saveRun(s); return; }
    if (!s.phonePending) {
      if ((s.phoneToday || 0) >= 3) s.phone[s.phone.length - 1].note = '已送达 · 他今天不会再回了';   // 每天最多回 3 次
      else { s.phoneToday = (s.phoneToday || 0) + 1; s.phonePending = { day: s.day, slot: s.slot }; }
    }
    render(); saveRun(s);
  }
  const scr = h('div', { class: 'screen-area' },
    h('div', { class: 'bar' }, h('span', {}, '‹ 信息'), '河'), msgs, h('div', { class: 'inp' }, input, sendBtn));
  const home = h('button', { class: 'home', 'aria-label': 'Home 键，关掉手机', onclick: () => closeOv('phone') });
  const bg = $('#scr-main .bg');
  const ov = h('div', {},
    bg ? h('img', { class: 'bgdim', src: bg.src, alt: '' }) : null,
    h('div', { class: 'phone' }, scr, h('img', { class: 'body', src: A('ui/phone.webp'), alt: '' }), home),
    h('div', { class: 'cap' }, h('b', {}, '他给你的手机'), h('div', {}, '只有他一个联系人。'), h('div', {}, '按 Home 键回到村子。')));
  openOv('phone', ov); render();
}
// 离线回来：河在你不在时发来的消息
export async function fetchOfflineMessages(ms) {
  const s = G.s; const H = 3600e3;
  if (ms < 3 * H) return;
  const count = ms < 20 * H ? 1 + Math.floor(Math.random() * 2) : ms < 3 * 24 * H ? 3 + Math.floor(Math.random() * 2) : 5 + Math.floor(Math.random() * 3);
  try {
    const raw = await chat({ messages: [{ role: 'user', content: phoneOfflinePrompt(s, ms, count) }], stream: false, maxTokens: 600 });
    const j = looseJson(raw); const list = (j?.messages || []).slice(0, 8);
    if (!list.length) return;
    const now = Date.now(); const maxH = ms / H;
    let first = true;
    for (const m of list) {
      const ago = Math.min(maxH * 0.95, Math.max(0.05, +m.hours_ago || 1));
      s.phone.push({ from: 'he', text: String(m.text || '。'), ts: now - ago * H, sep: first ? '你不在的时候' : null });
      first = false;
    }
    s.unread += list.length; refreshHud(); saveRun(s);
  } catch (e) { console.warn('离线消息生成失败', e); }
}

// ———————————————— 数值页 ————————————————
const EYE_X = [150, 345, 540, 735, 930];
const STATS_HELP = `这五个数，是他看你的方式。
· 爱慕：他有多在意你。陪着他、在他靠近的时候接住他，会慢慢变高；冷淡和推开会让它降下来。
· 怨恨：他有多羡慕、多恨你能离开。冷淡、拒绝、总说要走会让它变高；温柔一点、答应他的事，还有时间，都会让它慢慢消下去。
· 希望：他有多相信你能带他走。说起外面、许下承诺会让它变高。
· 克制：他还能忍住自己多少。他冲动的时候你怎么回应，会决定它往哪边走。
· 同化：你有多像这里的人。在村里待着、做村里的事，它会自己慢慢涨。
没有哪个数是越高越好。`;
export function openStats() {
  const s = G.s; if (!s) return;
  if (!store.get('stats_help')) { store.set('stats_help', 1); setTimeout(() => modal('statshelp', '他看你的方式', h('div', { class: 'how-text' }, STATS_HELP), { buttons: [{ label: '知道了', value: 1 }] }), 400); }
  const kids = [];
  VALUE_KEYS.forEach((k, i) => {
    const v = Math.round(s.v[k]); const size = 90 + v * 0.9;   // 眼球大小跟数值走
    kids.push(h('img', { class: 'eye', src: A(v < 20 ? 'ui/eye_away.webp' : 'ui/eye_look.webp'), alt: '', style: { left: EYE_X[i] + 'px', width: size + 'px', height: size + 'px' } }));
    kids.push(h('div', { class: 'lb', style: { left: EYE_X[i] + 'px' } }, h('span', {}, VALUE_NAMES[k]), h('b', {}, v)));
  });
  const close = () => { closeOv('stats'); s.meta.sawStats = true; saveRun(s); };
  const ov = h('div', {},
    h('img', { class: 'user', src: A(`sprite/user/${s.outfit}.webp`), alt: '你的样子，灰色', style: outfitNorm(s.outfit) }),   // 按脸对齐：眼睛正好在红线上
    h('img', { class: 'thread', src: A('ui/thread.webp'), alt: '' }),
    ...kids,
    h('div', { class: 'head' }, h('b', {}, '你在他眼里'), h('span', {}, '眼球越大，数值越高；太低时会转开，不再看你')),
    h('button', { type: 'button', class: 'shut', onclick: close }, '关掉'));
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
  modal('menu', '菜单', h('div', { class: 'list' }, items.map(([t, f]) => h('button', { class: 'btn', onclick: () => { closeOv('menu'); f(); } }, t))));
}
export function openOrganShelf() {
  const g = getGallery(); const got = organsOpen() ? ORGANS.filter(o => g.organs[o.id]) : [];
  if (!got.length) { toast('还没有河的画。'); return; }
  openOrgan(got[0].id, got.map(o => o.id));
}

// ———————————————— 记录 ————————————————
export function openLog() {
  const s = G.s; if (!s) return;
  const list = h('div', { class: 'log-list' }, s.log.slice(-150).map(l => h('div', {}, l.who ? h('span', { class: 'who' }, l.who) : null, h('span', { class: l.who ? '' : 'n' }, l.t))));
  modal('log', '记录', list); setTimeout(() => (list.scrollTop = 1e6), 30);
}

// ———————————————— 存档 / 读档 ————————————————
export function openSaves(mode, wait = false) {
  const ids = mode === 'save' ? SLOT_IDS.slice(1) : SLOT_IDS;
  const name = id => id === 'auto' ? '自动' : '存档 ' + id.slice(-1);
  const list = h('div', { class: 'list' });
  const draw = () => list.replaceChildren(...ids.map(id => {
    const i = slotInfo(id);
    const desc = i?.saveName ? `${i.saveName}　${new Date(i.savedAt).toLocaleString('zh-CN', { hour12: false })}` : i ? `第 ${i.day} 天 · ${SLOTS[i.slot]} · ${LOCATIONS[i.loc]?.name || ''}${i.ended ? '（已结束）' : ''}　${new Date(i.savedAt).toLocaleString('zh-CN', { hour12: false })}` : '（空）';
    return h('button', { class: 'btn', disabled: mode === 'load' && (!i || i.ended), onclick: () => act(id, i) }, h('b', {}, name(id)), '　', desc);
  }));
  async function act(id, i) {
    if (mode === 'save') {
      if (G.busy) { toast('等这一段说完再存。'); return; }
      if (i && !(await confirmBox('覆盖存档', `要覆盖${name(id)}吗？`))) return;
      const copy = clone(G.s); copy.saveName = null; copy.heOnScreen = !!G.R?.chars?.he; saveRun(copy, id); store.set('lastSlot', id); toast('存好了。'); draw();
    } else {
      const s = loadRun(id); if (!s) return;
      if (G.s && !(await confirmBox('读档', '当前进度会被这个存档替换。'))) return;
      closeOv('saves');
      s.meta.loaded = true;   // 读过档要记下来（meta 用）
      if (id !== 'auto') store.set('lastSlot', id);
      s.c.loads = (s.c.loads || 0) + 1;
      saveRun(s, 'auto');
      // 存档时河在画面里 → 读完第一句换成「警觉」；同一个存档读到第三次，台词变短
      let alert = null;
      if (s.heOnScreen) {
        const counts = store.get('loadcount', {}); const key = id + ':' + s.savedAt; counts[key] = (counts[key] || 0) + 1; store.set('loadcount', counts);
        alert = counts[key] >= 3 ? '又来了。' : ['……刚才是不是有什么不一样了。', '你做了什么？……我好像在哪里，已经听过你这句话。', '等一下。……没事。可能是我睡迷糊了。'][Math.floor(Math.random() * 3)];
      }
      continueRun(s, 0, alert);
    }
  }
  draw();
  return modal('saves', mode === 'save' ? '存档' : '读档', list);
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
  const after = () => { import('../audio.js?v=1794172711').then(a => a.applyVolume()); document.body.classList.toggle('calm', !!st.reduceMotion); };
  const rng = (key, min, max, step) => h('input', { type: 'range', min, max, step, value: st[key], oninput: e => { st[key] = +e.target.value; saveSettings(st); after(); } });
  const chk = key => (boxes[key] = h('input', { type: 'checkbox', checked: !!st[key], onchange: e => { st[key] = e.target.checked; saveSettings(st); after(); } }));
  const status = h('span', { class: 'note' });
  const panel = h('div', { class: 'panel paper' },
    h('button', { class: 'close-x', style: { color: 'var(--ink)' }, onclick: () => { saveSettings(st); closeOv('settings'); } }, '×'),
    h('h2', {}, '设置'),
    h('h4', {}, 'AI 接入'),
    h('label', {}, h('span', {}, 'API 地址'), inp('baseUrl', 'text', 'https://api.deepseek.com')),
    h('label', {}, h('span', {}, 'API Key'), inp('apiKey', 'password', 'sk-...')),
    h('label', {}, h('span', {}, '模型名'), inp('model', 'text', 'deepseek-chat')),
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
    } })), h('span', { class: 'note' }, '默认关闭：亲密的部分只写到暗示为止')),
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
      const d = await import('../debug.js?v=1794172711'); d.unlockAll(); await d.makeTestSaves(); toast('写好了。');
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
      h('button', { class: 'btn go', onclick: () => { closeOv('outfit'); res({ outfit: sel, name: nameIn.value.trim().slice(0, 8) }); } }, '就这样')) : null;
    function pick(id) {
      closeOv('outfit');
      if (!isStart && s && id !== s.outfit) {
        s.outfit = id; s.meta.outfitChanged = true; saveRun(s); refreshHud(); toast('换好了。');
        if (G.R?.chars?.he) import('../game.js?v=1794172711').then(g => g.metaLine('outfit'));
      }
      res(id);
    }
    const ov = h('div', {}, h('div', { class: 'cap' }, isStart ? '选一张脸' : '换一张脸', h('small', {}, isStart ? '游戏里随时可以换。' : '在他眼里，你随时能换一张脸。')),
      h('div', { class: 'row' + (isStart ? ' with-name' : '') }, cards), startBar,
      h('button', { class: 'close-x', onclick: () => { closeOv('outfit'); res(null); } }, '×'));
    openOv('outfit', ov);
  });
}

// ———————————————— 图鉴 ————————————————
// 回想里的剧情 / 日常 CG（结局 CG 不放这里）
export const STORY_CGS = ['first_meet', 'daily_table', 'ta_suture', 'user_offline', 'master', 'festival', 'he_suture', 'first_cross', 'ta_mad', 'border', 'outside', 'he_first', 'ta_first', 'day40'];
function viewCG(id, title) {
  const v = h('div', { style: { background: '#000' }, onclick: () => closeOv('cgview') },
    h('img', { src: A(`cg/${id}.webp`), style: { width: '100%', height: '100%', objectFit: 'contain' }, alt: '' }),
    title ? h('div', { style: { position: 'absolute', bottom: '60px', width: '100%', textAlign: 'center', color: '#f3ece2', fontSize: '44px', letterSpacing: '14px', textShadow: '0 2px 16px #000' } }, title) : null);
  openOv('cgview', v);
}
function galleryShell(title, sub, body) {
  const top = h('div', { class: 'top' },
    h('div', { class: 't' }, h('b', {}, title), h('span', {}, sub)),
    h('div', { class: 'r' }, h('button', { type: 'button', class: 'btn', onclick: () => closeOv('gallery') }, '返回')));
  openOv('gallery', h('div', {}, top, body));
}
// 结局：12 个结局，未达成只写条件，达成后点开看 CG 和标题卡
export function openGallery() {
  const g = getGallery();
  const E = Object.entries(ENDINGS);
  const seen = E.filter(([id]) => g.endings[id]).length;
  const card = (id, e, extra = '') => {
    if (g.endings[id]) return h('div', { class: 'gcard card on ' + extra, onclick: () => viewCG(e.cg, `‘${e.title}’`) },
      h('img', { class: 'thumb', src: A(`cg/${e.cg}.webp`), alt: '' }), h('b', {}, `‘${e.title}’`), h('small', {}, '已达成 · 点开看'));
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
  galleryShell('结局', `已见 ${seen} / ${E.length}`, body);
}
// 回想：剧情 / 日常 CG；没解锁的是纸卡，写 ???
export function openMemories() {
  const g = getGallery();
  const seen = STORY_CGS.filter(id => g.cgs[id]).length;
  const body = h('div', { class: 'body' }, h('div', { class: 'grid' }, STORY_CGS.map(id => g.cgs[id]
    ? h('div', { class: 'gcard card on img', onclick: () => viewCG(id) }, h('img', { src: A(`cg/${id}.webp`), alt: '' }))
    : h('div', { class: 'gcard card' }, h('span', { class: 'q' }, '???')))));
  // 道具：河的画（器官归位拼完之前全是 ???）
  const open = organsOpen();
  body.append(h('div', { class: 'gsec' }, '河的画'), h('div', { class: 'grid organs' }, ORGANS.map(o => open && g.organs[o.id]
    ? h('div', { class: 'gcard card on img organ', onclick: () => openOrgan(o.id, ORGANS.filter(x => g.organs[x.id]).map(x => x.id)) }, h('img', { src: A(`organ/${o.id}.webp`), alt: o.name }))
    : h('div', { class: 'gcard card' }, h('span', { class: 'q' }, '???')))));
  galleryShell('回想', `${seen} / ${STORY_CGS.length}`, body);
}

// ———————————————— 调试（?debug=1）————————————————
function openDebug() {
  const s = G.s;
  const box = h('div', { class: 'list' },
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
          进度: s ? `第 ${s.day} 天` : '还没开始', 设备: navigator.userAgent }) }).then(x => x.json());
      if (!r.success) throw new Error(r.message || '寄不出去');
      store.set('mail_last', Date.now()); msg.value = ''; status.textContent = '寄出去了。谢谢你。';
    } catch (e) { status.textContent = '没寄出去，过一会儿再试试。'; }
    finally { send.disabled = false; }
  } }, '寄出');
  modal('mail', '信箱', h('div', { class: 'mail-box' }, h('p', { class: 'note' }, '写给作者的信。会连同你现在的进度（第几天）一起寄出，不会带上你的 Key 和存档内容。'), msg, who, h('div', { class: 'row' }, send, status)));
}
