// 结局画面、‘楚门的世界’锁定画面、结局后效
import { h, A, showScreen, sleep, confirmBox, preload } from './dom.js?v=1794315422';
import { store } from '../store.js?v=1794315422';
import { ENDINGS, ENDING_LINES } from '../config/endings.js?v=1794315422';
import { madTier } from '../config/values.js?v=1794315422';
import { userFigure } from '../game.js?v=1794315422';
import { FILE_NAME, afterwordText, loadAfterword } from '../config/afterword.js?v=1794315422';
import { garble } from '../meta.js?v=1794315422';

const waitClick = el => new Promise(r => el.addEventListener('click', r, { once: true }));

export async function showEnding(id, s) {
  const e = ENDINGS[id]; const L = ENDING_LINES[id] || {};
  import('../audio.js?v=1794315422').then(a => a.playBgm('meta'));
  if (id === 'truman') loadAfterword();   // 先读好后日谈，最后那一下点击时直接下载
  const tier = madTier(s?.madness || 0);
  const cg = h('img', { class: 'cg' + (e.glitch ? ' glitch' : ''), src: A(`cg/${e.cg}.webp`), alt: '' });
  const title = h('div', { class: 'card-title' }, `‘${e.title}’`);
  const say = h('div', { class: 'end-say' });
  const tap = h('div', { class: 'tap' }, '点一下');
  const scr = showScreen('ending', h('div', {}, cg, say, title, tap));
  await preload(A(`cg/${e.cg}.webp`));
  const line = async (text, cls) => {   // 一句固定文字：淡入，点一下继续
    say.className = 'end-say ' + cls; say.textContent = text; await sleep(60); say.classList.add('on');
    await sleep(700); await waitClick(scr); say.classList.remove('on'); await sleep(450);
  };
  // 1. 黑屏旁白
  for (const p of L.pre || []) await line(p, 'narr');
  // 2. user 的样子（结局差分 / 落灰）
  if (e.userSprite || id === 'godot') {
    const fig = id === 'godot' ? userFigure(s.outfit, true) : h('div', { class: 'user-fig' }, h('img', { src: A(`sprite/user/${e.userSprite}.webp`), alt: '' }));
    fig.style.opacity = 0; fig.style.transition = 'opacity 2s';
    if (id === 'godot') { fig.firstChild.classList.add('fx-dust'); fig.append(h('div', { class: 'dust-layer' })); }
    scr.append(fig); await sleep(80); fig.style.opacity = 1;
    await sleep(id === 'godot' ? 5000 : 2800);
    fig.style.opacity = 0; await sleep(1800); fig.remove();
  }
  // 3. 结局 CG
  cg.classList.add('on'); await sleep(2400);
  // 4. 牠的字条（‘本杰明·巴顿奇事’）
  if (L.note) await line(`「${L.note}」`, 'note');
  // 5. 河的最后一句（按疯神档位）
  for (const t of L[tier] || []) await line(t, 'he');
  // 5.5 结局交代（post：河那句之后、标题之前，和 pre 一样的黑屏旁白；借鉴机制与结局 §8）
  for (const p of L.post || []) await line(p, 'narr');
  // 6. 标题卡
  title.classList.add('on'); await sleep(1800);
  tap.classList.add('on');
  // ‘楚门的世界’：最后这一下点击里触发下载（用户手势里，浏览器一般不拦）
  await new Promise(r => scr.addEventListener('click', () => { if (id === 'truman') downloadAfterword(s?.name); r(); }, { once: true }));
}

// UTF-8 带 BOM，Windows 记事本打开不乱码
export function downloadAfterword(name = '') {
  try {
    const blob = new Blob(['\ufeff' + afterwordText(name).replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: FILE_NAME, style: { display: 'none' } });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { console.warn('后日谈下载失败', e); }
}

export function showLock() {
  const knot = h('img', { class: 'knot', src: A('ui/ap_empty.webp'), alt: '' });
  let timer = null;
  const start = () => { timer = setTimeout(async () => {
    if (await confirmBox('', '要把门再打开吗？', '打开', '不')) { store.del('lock_truman'); location.reload(); }
  }, 5000); };
  const stop = () => clearTimeout(timer);
  knot.addEventListener('pointerdown', start); knot.addEventListener('pointerup', stop); knot.addEventListener('pointerleave', stop);
  // 空的墨绿河水：没有菜单，只有水在慢慢动（轻微缩放 + 飘的花瓣）
  const river = h('img', { class: 'bg drift', src: A('cover/river.webp'), alt: '' });
  river.onerror = () => { river.src = A('bg/creek.webp'); river.classList.add('fallback'); };
  const petals = Array.from({ length: 14 }, (_, i) => h('i', { class: 'petal', style: { left: (Math.random() * 100) + '%', animationDelay: (-Math.random() * 16) + 's', animationDuration: (12 + Math.random() * 10) + 's', transform: `scale(${0.6 + Math.random() * 0.8})` } }));
  showScreen('lock', h('div', {}, river, ...petals,
    h('div', { class: 'line' }, '灯我关了。你那边，还亮着吧。'),
    // 牠的一句：乱码，选中复制出去才是「？呢我那」（倒着读：那我呢？）。每次打开重新生成，复制钩子在 boot() 里装好了
    h('div', { class: 'ta-garble' }, garble('？呢我那')),
    knot,
    h('div', { class: 'tiny' }, '清除这个网站的数据也能打开，但存档、Key 和图鉴会一起被清掉。')));
}

// 结局后效：之后打开游戏时
export async function showAftermath(a) {
  const bg = h('img', { class: 'bg', src: A('bg/room_night.webp'), alt: '', style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(.7)' } });
  const kids = [bg];
  let line = '';
  if (a.kind === 'fade') { const f = userFigure(a.outfit, false); f.firstChild.classList.add('fx-fade'); kids.push(f); line = '床上那具身体，已经不在了。'; }
  if (a.kind === 'dust') { const f = userFigure(a.outfit, true); f.firstChild.classList.add('fx-dust'); f.append(h('div', { class: 'dust-layer' })); kids.push(f); line = '……'; }
  if (a.kind === 'gone') line = '偏房里没有人。';
  if (a.kind === 'kept') { kids.push(userFigure(a.outfit, true)); line = '它还是你走的时候的样子。'; }   // ‘沉默的羔羊’：原样，不落灰、不变透明
  kids.push(h('div', { class: 'after-line' }, line));
  const scr = showScreen('after', h('div', { style: { background: '#000' } }, ...kids));
  await sleep(2500);
  await waitClick(scr);
}
