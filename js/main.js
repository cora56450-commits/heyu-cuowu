// 启动：缩放、读设置、离线判定、标题画面
import { h, A, $, showScreen, modal, confirmBox, closeOv, toast } from './ui/dom.js?v=1794587138';
import { store, getSettings, saveSettings, getGallery, endingsOpen } from './store.js?v=1794587138';
import { G, loadEvents, startRun, continueRun, triggerEnding, playerReturned, startIdleWatch, installTitleMeta, hasAsset } from './game.js?v=1794587138';
import { newRun, loadRun, hasActiveRun, saveRun, SLOT_IDS } from './state.js?v=1794587138';
import { readLastActive, touchActive, installActivity, installCopyHook } from './meta.js?v=1794587138';
import { MID } from './config/endings.js?v=1794587138';
import { madTier } from './config/values.js?v=1794587138';
import * as P from './ui/panels.js?v=1794587138';
import { DEMO, DEMO_KEY, DEMO_BASE, DEMO_LAST_DAY, DEMO_TAG, TEST_BUILD } from './config/demo.js?v=1794587138';
import { showLock, showAftermath, showButtonReturn } from './ui/ending.js?v=1794587138';

// 1280×720 等比缩放，四周黑边
function fit() {
  const s = Math.min(innerWidth / 1280, innerHeight / 720);
  document.documentElement.style.setProperty('--s', s);
  document.body.classList.toggle('compact', s < 0.75);   // 手机横屏、平板竖屏：文字和按钮放大
}
addEventListener('resize', fit); fit();

// 舞台和浮层不允许被滚动（焦点、拖拽都可能让超出边界的立绘把画面「推」歪）
document.addEventListener('scroll', e => {
  const t = e.target;
  if (t && t.nodeType === 1 && (t.id === 'stage' || t.id === 'screens' || t.id === 'overlays' || t.classList.contains('screen') || t.classList.contains('ov'))) { t.scrollTop = 0; t.scrollLeft = 0; }
}, true);

// 本机开发（localhost）以外的地方：简单防扒——屏蔽右键菜单、F12 / 查看源代码 / 开发者工具快捷键，不开调试
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|.*\.local)$/.test(location.hostname);
if (!LOCAL) {
  addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (k === 'f12' || (mod && (e.shiftKey || e.altKey) && ['i', 'j', 'c'].includes(k)) || (mod && k === 'u') || (mod && e.altKey && k === 'u') || (mod && k === 's')) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  addEventListener('dragstart', e => { if (e.target.tagName === 'IMG') e.preventDefault(); });
}

// 竖屏提示页上的按钮：全屏并锁定横屏（安卓 Chrome 支持，关了自动旋转也有效）；不支持就提示去打开自动旋转
document.getElementById('rotate-go')?.addEventListener('click', async () => {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation.lock('landscape');
  } catch { document.getElementById('rotate-tip').style.display = 'block'; }
});

// 键盘推进对话
addEventListener('keydown', e => {
  if (e.target.matches('input,textarea')) return;
  if ((e.key === ' ' || e.key === 'Enter') && G.R && !$('#overlays').children.length) { e.preventDefault(); import('./game.js?v=1794587138').then(m => m.advance()); }
});

// 打开网页时算出来的离线时长，等玩家点「继续」时用（放在 G 上：读档列表那条路也要拿得到，测试记录 17）
G.bootOffline = 0;

function showTitle() {
  G.R = null; G.s = null;
  import('./audio.js?v=1794587138').then(a => a.playBgm('title'));
  for (const o of [...$('#overlays').children]) o.remove();
  const active = hasActiveRun();
  const items = [
    // 继续：只有自动存档就直接进；有手动存档就打开存档列表。结局：一个都没打出来时点不开。信箱：给作者写建议
    ['开始', start], ['继续', cont, !active && !hasManualSave()], ['结局', () => P.openGallery(), !endingsOpen()], ['回想', () => P.openMemories()], ['设置', () => P.openSettings()], ['信箱', () => P.openMailbox()],
  ];
  const st = getSettings();
  // 菜单：选中项两侧的针 + 红线从两边滑进来；点击时红线抖一下、按钮下沉，再进入下一个界面
  const orn = hasAsset('ui/menu_ornament.webp');
  const menu = h('nav', { class: 'menu' + (orn ? ' has-orn' : ''), 'aria-label': '主菜单' }, items.map(([label, f, dis], i) => h('button', {
    class: i === (active ? 1 : 0) ? 'sel' : '', disabled: dis,
    onclick: e => { import('./audio.js?v=1794587138').then(a => a.playSfx('ping')); const b = e.currentTarget; b.classList.remove('tug'); void b.offsetWidth; b.classList.add('tug'); setTimeout(() => { b.classList.remove('tug'); f(); }, 260); },
    onmouseenter: e => { if (e.currentTarget.disabled) return; for (const b of menu.children) b.classList.remove('sel'); e.currentTarget.classList.add('sel'); },
  }, h('i', { class: 'orn l' }), label, h('i', { class: 'orn r' }))));
  showScreen('title', h('div', {},
    ...titleCover(),
    h('div', { class: 'gname' + (hasAsset('ui/logo.webp') ? ' has-logo' : '') }, hasAsset('ui/logo.webp') ? h('img', { class: 'logo', src: A('ui/logo.webp'), alt: '河边的错误' }) : h('b', {}, '河边的错误'), h('small', {}, '他在等你回来')),
    menu,
    h('div', { class: 'hint' }, st.apiKey || st.mock ? null : h('div', {}, DEMO && DEMO_KEY ? '可以接受 DeepSeek：直接开始，用作者提供的 Key。不想用：先在「设置」里填你自己的。' : '首次进入请先在「设置」里填写 API Key'), DEMO ? h('div', {}, '建议分几天玩，体验更好。') : null),   // 完整版不再提示（Cora 11/12）
    h('div', { class: 'ver' }, 'v0.3'),
    h('div', { class: 'credit' }, DEMO ? `试玩版 · 前 ${DEMO_LAST_DAY} 天　·　虚拟剧情演绎　·　仅供测试，请勿外传` : '虚拟剧情演绎　·　制作不易，请勿倒卖')));
}
// 封面：跟着「最近一次」打出的结局变（store 'cover'）；素材没到之前用河「冷视」立绘
import { COVERS } from './config/endings.js?v=1794587138';
export { COVERS };
// 点封面出一句（结局文案与封面 1112）：time = 按本地时间说早上好 / 下午好 / 晚上好（楚门的空河水）
const COVER_SAY = { fall_blood: { text: '河　「……不必原谅我。」' }, palm: { text: '河　「……你的手，是热的。」' }, backtoback: { text: '「我，也，在。」', note: true },
  interlace: { text: '河　「你回来了。」' }, fountain: { text: '河　「针要直。」' }, empty: { time: true } };
function titleCover() {
  if (store.get('cover') === 'ta_hand') store.set('cover', 'interlace');   // 前目的地封面换成十指相扣（1112）：旧的「牠的手穿过玻璃」自动换
  const cover = store.get('cover', 'fall');
  const river = hasAsset('cover/river.webp');
  const out = [];
  if (river) out.push(h('img', { class: 'river' + (cover === 'fall_blood' ? ' blood' : ''), src: A('cover/river.webp'), alt: '' }));
  else if (cover === 'fall_blood') out.push(h('div', { class: 'river-fallback blood' }));
  if (cover !== 'empty') {
    if (hasAsset(`cover/${cover}.webp`)) {
      // 融图：几层只作用在人物轮廓里的效果——调色、染成河水的颜色、越深越暗、河里的光和花瓣透到人身上
      const src = A(`cover/${cover}.webp`);
      const pos = cover.startsWith('fall') ? 'from-top' : 'from-bottom';
      const masked = cls => { const d = h('div', { class: 'cover-layer ' + cls }); d.style.webkitMaskImage = d.style.maskImage = `url(${src})`; return d; };
      out.push(h('div', { class: `cover-wrap ${pos} ${cover}` + (cover === 'fall_blood' ? ' blood' : '') },
        h('img', { class: 'cover-fig', src, alt: COVERS[cover] }),
        masked('tint'), masked('depth'), masked('shade'), masked('light'), river ? masked('water') : null));
      out.push(h('div', { class: 'cover-haze' + (cover === 'fall_blood' ? ' blood' : '') }));
    }
    else out.push(h('img', { class: 'he', src: A('sprite/he/cold.webp'), alt: '河' }), h('img', { class: 'thread-deco', src: A('ui/thread.webp'), alt: '' }));
  }
  const say = COVER_SAY[cover];
  if (say) {   // 点封面出一句（1112）：淡入，3 秒后淡出；每次打开游戏最多一次；点的是封面左边的人 / 水面，不挡右边的按钮
    const text = h('div', { class: 'cover-say' + (say.note ? ' note' : '') });
    const hit = h('div', { class: 'cover-hit', onclick: e => {
      if (G.coverSaid) return; G.coverSaid = true;
      if (cover === 'empty') { const r = hit.getBoundingClientRect(), sc = r.width / hit.offsetWidth || 1; const rip = h('div', { class: 'cover-ripple', style: { left: (e.clientX - r.left) / sc + 'px', top: (e.clientY - r.top) / sc + 'px' } }); hit.append(rip); setTimeout(() => rip.remove(), 2600); }
      const hr = new Date().getHours();
      text.textContent = say.time ? (hr >= 5 && hr < 11 ? '早上好。' : hr >= 11 && hr < 18 ? '下午好。' : '晚上好。') : say.text;
      setTimeout(() => text.classList.add('on'), say.time ? 1800 : 80);
      setTimeout(() => text.classList.remove('on'), (say.time ? 1800 : 80) + 3600);
    } });
    out.push(hit, text);
  }
  return out;
}
G.backTitle = showTitle;

async function needKey() {
  const st = getSettings();
  if (st.apiKey || st.mock) return true;
  if (DEMO && DEMO_KEY) {   // 试玩版：可以直接用作者提供的限额 Key，也可以填自己的
    const v = await modal('nokey', '用哪个 AI？', h('div', { class: 'how-text' },
      '这个游戏的剧情和台词由 AI 现场写。\n· 可以接受 DeepSeek：直接用作者提供的 Key。额度有限，大家共用，用完就没有了。\n· 不想用 DeepSeek，或者想自己掌握：在设置里填你自己的 Key（DeepSeek、或其他兼容 OpenAI 格式的服务都可以）。'),
      { buttons: [{ label: '用作者提供的', value: 'demo' }, { label: '填我自己的', value: 'set' }, { label: '算了', value: null }] });
    if (v === 'demo') { saveSettings({ ...st, baseUrl: DEMO_BASE, apiKey: DEMO_KEY, model: 'deepseek-flash', demoKey: true }); return true; }
    if (v === 'set') P.openSettings();
    return false;
  }
  const v = await modal('nokey', '还没有接上 AI', h('p', {}, '这个游戏的剧情和台词由 AI 现场写。需要先在设置里填你自己的 API（默认 DeepSeek）。也可以先用测试模式看看流程。'),
    { buttons: [{ label: '去设置', value: 'set' }, { label: '用测试模式', value: 'mock' }, { label: '算了', value: null }] });
  if (v === 'set') P.openSettings();
  if (v === 'mock') { saveSettings({ ...st, mock: true }); return true; }
  return false;
}
// 开局：序 → 选脸 → 起名 → 「进去吧」。人肉 v3 · 1.1：起完名常跳回封面。
// 防两点：连点「开始」会同时跑两条开局流程；手机上页面在选脸时被系统刷新会回到封面。
// 所以开局进行到哪一步记在 sessionStorage，刷新后从那一步接着走。
const START_KEY = 'gucun_starting';
const startStage = { get: () => { try { return JSON.parse(sessionStorage.getItem(START_KEY)); } catch { return null; } }, set: v => { try { v ? sessionStorage.setItem(START_KEY, JSON.stringify(v)) : sessionStorage.removeItem(START_KEY); } catch {} } };
let starting = false;
async function start(resume = null) {
  if (starting) return;
  starting = true;
  try {
    if (!resume) {
      if (!(await needKey())) return;
      if (hasActiveRun() && !(await confirmBox('开始', '会从第一天重新开始，当前的自动存档会被覆盖。（手动存档和图鉴保留）', '重新开始'))) return;
      if (!(await startNotice())) return;   // 内容提示 + 调 AI 合成一个弹窗（测试报告：开局连弹两个，「换 pro」说了三次）
      await P.blackLines(P.PROLOGUE);            // 序：屏幕外的你、选一张脸、四十二天
    }
    let pick = resume?.pick;
    if (!pick) {
      startStage.set({ stage: 'outfit' });
      pick = await P.openOutfit(true);
      if (!pick) { startStage.set(null); return; }
    }
    startStage.set({ stage: 'go', pick });
    await P.blackLines(['进去吧。'], { hold: true });
    const run = newRun(pick.outfit); run.name = pick.name || '';
    startStage.set(null);
    await startRun(run);
  } catch (e) {
    console.error(e); startStage.set(null);
    systemNoticeSafe('进村子的时候出了点问题。再点一次「开始」试试。');
  } finally { starting = false; }
}
// 开始之前：内容提示（每个浏览器第一次）+ 调 AI（没用推荐设置时）合成一个弹窗；都不需要就不弹
async function startNotice() {
  const st = getSettings();
  const needCw = !store.get('cw_ok');
  const isPro = /pro/i.test(st.model || ''), think = st.thinking || 'off';
  const needAi = !st.mock && !(isPro && think !== 'off');
  if (!needCw && !needAi) return true;
  const parts = [];
  if (needCw) parts.push('· 这个游戏有血腥内容：人体缝合、内脏、伤口的描写，还有压抑、让人不安的情节。\n· 剧情和台词由 AI 现场写，偶尔会前后对不上。\n· 虚拟剧情演绎，和现实中的人、地方、习俗都无关。');
  let rec = null;
  if (needAi) {
    const modelName = isPro ? 'pro' : /flash/i.test(st.model || '') ? 'flash' : (st.model || '默认');
    const thinkName = { off: '关', events: '只在固定剧情开', all: '全部开' }[think] || think;
    const want = [!isPro && /deepseek/i.test(st.baseUrl || 'deepseek') ? '换成 pro 模型（人物更像自己、前后更连贯；慢一点，费用高 4–5 倍）' : '', think === 'off' ? '打开思维链（只在固定剧情：关键剧情先想再写，少出错）' : ''].filter(Boolean);
    if (want.length) {
      parts.push(`现在的 AI：${modelName}，思维链「${thinkName}」。推荐：\n` + want.map(w => '· ' + w).join('\n') + '\n之后随时可以在「设置」里改。');
      rec = { ...st, model: !isPro && /deepseek/i.test(st.baseUrl || 'deepseek') ? 'deepseek-v4-pro' : st.model, thinking: think === 'off' ? 'events' : think };
    }
  }
  if (!parts.length) return true;
  const buttons = rec ? [{ label: '用推荐的，开始', value: 'rec' }, { label: '保持现在，开始', value: 'keep' }, { label: '返回', value: false }] : [{ label: '我知道了，开始', value: 'keep' }, { label: '返回', value: false }];
  const v = await modal('cw', '开始之前', h('div', { class: 'how-text' }, parts.join('\n\n')), { buttons, noClose: true });
  if (!v) return false;
  if (needCw) store.set('cw_ok', 1);
  if (v === 'rec' && rec) saveSettings(rec);
  return true;
}
function systemNoticeSafe(t) { try { P.systemNotice(t, [{ label: '好', value: 1 }]); } catch {} }
function hasManualSave() { return SLOT_IDS.slice(1).some(id => { const s = loadRun(id); return s && !s.ended; }); }
async function loadMenu() { if (await needKey()) P.openSaves('load'); }
async function cont() {
  if (!(await needKey())) return;
  if (hasManualSave()) return P.openSaves('load');   // 有手动存档：让玩家选（自动存档排第一个）
  const s = loadRun('auto'); if (!s || s.ended) return;
  const off = G.bootOffline; G.bootOffline = 0;
  await continueRun(s, off);
}

// 同一个游戏开了两个标签页：后开的那个不能操作，避免两边存档互相覆盖
function otherTabOpen() {
  if (!('BroadcastChannel' in window)) return Promise.resolve(false);
  const bc = new BroadcastChannel(DEMO ? 'gucun_demo' : DEMO_TAG ? `gucun_${DEMO_TAG.toLowerCase()}` : 'gucun'); tabChannel = bc;   // 试玩版和完整版不互相锁
  let other = false, asking = true;
  bc.onmessage = e => {
    if (e.data === 'hello' && !G.blocked) bc.postMessage('here');
    if (e.data === 'here' && asking) other = true;
    if (e.data === 'takeover' && !G.blocked) { if (G.s) saveRun(G.s); showElsewhere(); }   // 别的页面接管了：这边停下
  };
  bc.postMessage('hello');
  return new Promise(r => setTimeout(() => { asking = false; r(other); }, 400));
}
let tabChannel = null;
function showElsewhere() {
  G.blocked = true;
  import('./audio.js?v=1794587138').then(a => a.stopAll()).catch(() => {});   // 被接管的页面不能还在放音乐，不然两边的 BGM 叠在一起
  for (const o of [...$('#overlays').children]) o.remove();
  // 测试记录 7 #A：忘了关的后台页面也会把人卡在这里，所以给一个「在这里继续」：通知另一边停下，这边重新进
  const take = () => { try { tabChannel?.postMessage('takeover'); sessionStorage.setItem('gucun_takeover', '1'); } catch {} location.reload(); };
  showScreen('elsewhere', h('div', { style: { background: '#0b0907', display: 'flex', flexDirection: 'column', gap: '36px', alignItems: 'center', justifyContent: 'center', color: '#bdb4a8', fontSize: '26px', letterSpacing: '8px' } },
    h('div', {}, '你已经在别的地方看着他了。'),
    h('button', { class: 'btn', style: { width: 'auto', padding: '10px 34px', fontSize: '18px', letterSpacing: '4px' }, onclick: take }, '在这里继续')));
}

// 试玩版水印：整屏斜着铺一层很淡的编号，角落再放一个小编号；截图、录屏里都带着，流出去能看出是谁的那份
function watermark() {
  if (!DEMO_TAG) return;
  const t = `${DEMO ? '试玩' : '测试'} · ${DEMO_TAG}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220"><text x="20" y="130" transform="rotate(-24 180 110)" font-size="22" font-family="serif" fill="#888" fill-opacity="0.09" letter-spacing="6">${t}</text></svg>`;
  const wm = h('div', { id: 'wm', style: { backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")` } }, h('span', {}, t));
  $('#stage').append(wm);
}
async function boot() {
  watermark();
  installCopyHook();
  document.body.classList.toggle('calm', !!getSettings().reduceMotion);
  const qs = new URLSearchParams(location.search);
  if (qs.has('debug') && (LOCAL || TEST_BUILD)) saveSettings({ ...getSettings(), debug: true });
  if (!LOCAL && !TEST_BUILD && getSettings().debug) saveSettings({ ...getSettings(), debug: false });   // 线上版不开调试（Cowork 测试版 CW 除外）
  // 同一个浏览器里还有别的页面开着（常是忘了关的旧标签页、微信里没关的旧窗口）：新打开的这个直接接管，旧的那边停下、静音
  try { sessionStorage.removeItem('gucun_takeover'); } catch {}
  if (await otherTabOpen()) tabChannel?.postMessage('takeover');
  let lastActive = readLastActive();
  // 调试：?debug=1&offline=小时数，模拟离开了这么久
  if (qs.has('debug') && qs.has('offline')) lastActive = Date.now() - parseFloat(qs.get('offline')) * 3600e3;
  touchActive();
  // 回来了（切回前台 / 久没操作后又点了一下）：游戏里走离线流程；在标题画面就记下来，点「继续」时用
  installActivity((gap, e, info) => { if (G.blocked) return; if (!playerReturned(gap, e, info)) G.bootOffline = Math.max(G.bootOffline, gap); });
  startIdleWatch();
  installTitleMeta();
  try { await loadEvents(); } catch (e) { document.body.append(h('div', { style: { color: '#fff', padding: '20px' } }, '事件表加载失败。请用本地服务器或 GitHub Pages 打开（不能直接双击 index.html）。')); throw e; }
  if (store.get('lock_truman')) return showLock();
  // 前目的地后日谈 B：打出过‘前目的地’，离开 6 小时以上回来 → 封面之前播一段；另一局的离线流程照常在后面走
  if (lastActive && Date.now() - lastActive >= 6 * 3600e3 && getGallery().endings?.button) await showButtonReturn(Date.now() - lastActive);
  const s = loadRun('auto');
  if (s && !s.ended && lastActive) {
    const off = Date.now() - lastActive;
    G.s = s;
    // 等待戈多：最先判定
    if (off >= MID.godotDays * 24 * 3600e3) return triggerEnding('godot');
    if (off >= MID.lambsMinOfflineH * 3600e3 && MID.lambs({ ...s, madTier: madTier(s.madness) })) return triggerEnding('lambs');
    G.s = null;
    G.bootOffline = off;
  }
  const after = store.get('after');
  if (after) await showAftermath(after);
  showTitle();
  const st = startStage.get();   // 开局走到一半页面被刷新了：接着走，不回封面
  if (st?.stage === 'outfit') start({});
  else if (st?.stage === 'go' && st.pick) start({ pick: st.pick });
}
boot();
