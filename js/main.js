// 启动：缩放、读设置、离线判定、标题画面
import { h, A, $, showScreen, modal, confirmBox, closeOv, toast } from './ui/dom.js?v=1794173159';
import { store, getSettings, saveSettings, getGallery } from './store.js?v=1794173159';
import { G, loadEvents, startRun, continueRun, triggerEnding, playerReturned, startIdleWatch, hasAsset } from './game.js?v=1794173159';
import { newRun, loadRun, hasActiveRun } from './state.js?v=1794173159';
import { readLastActive, touchActive, installActivity, installCopyHook } from './meta.js?v=1794173159';
import { MID } from './config/endings.js?v=1794173159';
import { madTier } from './config/values.js?v=1794173159';
import * as P from './ui/panels.js?v=1794173159';
import { showLock, showAftermath } from './ui/ending.js?v=1794173159';

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
  if ((e.key === ' ' || e.key === 'Enter') && G.R && !$('#overlays').children.length) { e.preventDefault(); import('./game.js?v=1794173159').then(m => m.advance()); }
});

let bootOffline = 0;

function showTitle() {
  G.R = null; G.s = null;
  import('./audio.js?v=1794173159').then(a => a.playBgm('title'));
  for (const o of [...$('#overlays').children]) o.remove();
  const active = hasActiveRun();
  const items = [
    // 继续：只有自动存档就直接进；有手动存档就打开存档列表。结局：一个都没打出来时点不开。信箱：给作者写建议
    ['开始', start], ['继续', cont, !active && !hasManualSave()], ['结局', () => P.openGallery(), !Object.keys(getGallery().endings || {}).length], ['回想', () => P.openMemories()], ['设置', () => P.openSettings()], ['信箱', () => P.openMailbox()],
  ];
  const st = getSettings();
  // 菜单：选中项两侧的针 + 红线从两边滑进来；点击时红线抖一下、按钮下沉，再进入下一个界面
  const orn = hasAsset('ui/menu_ornament.webp');
  const menu = h('nav', { class: 'menu' + (orn ? ' has-orn' : ''), 'aria-label': '主菜单' }, items.map(([label, f, dis], i) => h('button', {
    class: i === (active ? 1 : 0) ? 'sel' : '', disabled: dis,
    onclick: e => { const b = e.currentTarget; b.classList.remove('tug'); void b.offsetWidth; b.classList.add('tug'); setTimeout(() => { b.classList.remove('tug'); f(); }, 260); },
    onmouseenter: e => { if (e.currentTarget.disabled) return; for (const b of menu.children) b.classList.remove('sel'); e.currentTarget.classList.add('sel'); },
  }, h('i', { class: 'orn l' }), label, h('i', { class: 'orn r' }))));
  showScreen('title', h('div', {},
    ...titleCover(),
    h('div', { class: 'gname' + (hasAsset('ui/logo.webp') ? ' has-logo' : '') }, hasAsset('ui/logo.webp') ? h('img', { class: 'logo', src: A('ui/logo.webp'), alt: '河边的错误' }) : h('b', {}, '河边的错误'), h('small', {}, '他在等你回来')),
    menu,
    h('div', { class: 'hint' }, st.apiKey || st.mock ? null : h('div', {}, '首次进入请先在「设置」里填写 API Key'), h('div', {}, '建议分几天玩，体验更好。')),
    h('div', { class: 'ver' }, 'v0.3')));
}
// 封面：跟着「最近一次」打出的结局变（store 'cover'）；素材没到之前用河「冷视」立绘
export const COVERS = { fall: '河头朝下坠进水里', fall_blood: '下坠 · 带血', palm: '手掌贴着屏幕', backtoback: '河和牠背靠背', ta_hand: '牠的手穿过玻璃', empty: '空的河水' };
function titleCover() {
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
  return out;
}
G.backTitle = showTitle;

async function needKey() {
  const st = getSettings();
  if (st.apiKey || st.mock) return true;
  const v = await modal('nokey', '还没有接上 AI', h('p', {}, '这个游戏的剧情和台词由 AI 现场写。需要先在设置里填你自己的 API（默认 DeepSeek）。也可以先用测试模式看看流程。'),
    { buttons: [{ label: '去设置', value: 'set' }, { label: '用测试模式', value: 'mock' }, { label: '算了', value: null }] });
  if (v === 'set') P.openSettings();
  if (v === 'mock') { saveSettings({ ...st, mock: true }); return true; }
  return false;
}
async function start() {
  if (!(await needKey())) return;
  if (hasActiveRun() && !(await confirmBox('开始', '会从第一天重新开始，当前的自动存档会被覆盖。（手动存档和图鉴保留）', '重新开始'))) return;
  const pick = await P.openOutfit(true);
  if (!pick) return;
  const run = newRun(pick.outfit); run.name = pick.name || '';
  await startRun(run);
}
function hasManualSave() { return ['slot1', 'slot2', 'slot3'].some(id => { const s = loadRun(id); return s && !s.ended; }); }
async function loadMenu() { if (await needKey()) P.openSaves('load'); }
async function cont() {
  if (!(await needKey())) return;
  if (hasManualSave()) return P.openSaves('load');   // 有手动存档：让玩家选（自动存档排第一个）
  const s = loadRun('auto'); if (!s || s.ended) return;
  const off = bootOffline; bootOffline = 0;
  await continueRun(s, off);
}

// 同一个游戏开了两个标签页：后开的那个不能操作，避免两边存档互相覆盖
function otherTabOpen() {
  if (!('BroadcastChannel' in window)) return Promise.resolve(false);
  const bc = new BroadcastChannel('gucun');
  let other = false, asking = true;
  bc.onmessage = e => {
    if (e.data === 'hello' && !G.blocked) bc.postMessage('here');
    if (e.data === 'here' && asking) other = true;
  };
  bc.postMessage('hello');
  return new Promise(r => setTimeout(() => { asking = false; r(other); }, 400));
}
function showElsewhere() {
  G.blocked = true;
  showScreen('elsewhere', h('div', { style: { background: '#0b0907', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bdb4a8', fontSize: '26px', letterSpacing: '8px' } }, '你已经在别的地方看着他了。'));
}

async function boot() {
  installCopyHook();
  document.body.classList.toggle('calm', !!getSettings().reduceMotion);
  const qs = new URLSearchParams(location.search);
  if (qs.has('debug') && LOCAL) saveSettings({ ...getSettings(), debug: true });
  if (!LOCAL && getSettings().debug) saveSettings({ ...getSettings(), debug: false });   // 线上版不开调试
  if (await otherTabOpen()) return showElsewhere();
  let lastActive = readLastActive();
  // 调试：?debug=1&offline=小时数，模拟离开了这么久
  if (qs.has('debug') && qs.has('offline')) lastActive = Date.now() - parseFloat(qs.get('offline')) * 3600e3;
  touchActive();
  // 回来了（切回前台 / 久没操作后又点了一下）：游戏里走离线流程；在标题画面就记下来，点「继续」时用
  installActivity((gap, e) => { if (G.blocked) return; if (!playerReturned(gap, e)) bootOffline = Math.max(bootOffline, gap); });
  startIdleWatch();
  try { await loadEvents(); } catch (e) { document.body.append(h('div', { style: { color: '#fff', padding: '20px' } }, '事件表加载失败。请用本地服务器或 GitHub Pages 打开（不能直接双击 index.html）。')); throw e; }
  if (store.get('lock_truman')) return showLock();
  const s = loadRun('auto');
  if (s && !s.ended && lastActive) {
    const off = Date.now() - lastActive;
    G.s = s;
    // 等待戈多：最先判定
    if (off >= MID.godotDays * 24 * 3600e3) return triggerEnding('godot');
    if (off >= MID.lambsMinOfflineH * 3600e3 && MID.lambs({ ...s, madTier: madTier(s.madness) })) return triggerEnding('lambs');
    G.s = null;
    bootOffline = off;
  }
  const after = store.get('after');
  if (after) await showAftermath(after);
  showTitle();
}
boot();
