// 结局画面、‘楚门的世界’锁定画面、结局后效
import { h, A, showScreen, sleep, confirmBox, preload } from './dom.js?v=1794410523';
import { store, unlock } from '../store.js?v=1794410523';
import { ENDINGS, ENDING_LINES, BUTTON_RETURNS } from '../config/endings.js?v=1794410523';
import { madTier } from '../config/values.js?v=1794410523';
import { userFigure } from '../game.js?v=1794410523';
import { FILES, afterwordText, loadAfterword } from '../config/afterword.js?v=1794410523';
import { garble } from '../meta.js?v=1794410523';

const waitClick = el => new Promise(r => el.addEventListener('click', r, { once: true }));

export async function showEnding(id, s) {
  const e = ENDINGS[id]; const L = ENDING_LINES[id] || {};
  import('../audio.js?v=1794410523').then(a => a.playBgm('meta'));
  if (FILES[id]) loadAfterword(id);   // 先读好后日谈 / 字条，最后那一下点击时直接下载（楚门、前目的地）
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
  // 0. 结局前的固定段落（‘祖与占’，测试记录 17 §8）：最后一句带 CG
  if (L.intro?.length) {
    const ic = h('img', { class: 'cg', alt: '' }); scr.insertBefore(ic, say);
    for (const [cls, text, cgId] of L.intro) {
      if (cgId) { const src = A(`cg/${cgId}.webp`); await preload(src).catch(() => {}); ic.src = src; ic.classList.add('on'); unlock('cgs', cgId); }   // 测试记录 18 §3：结局中途出的 CG 也进回想
      await line(text, cls);
    }
    ic.classList.remove('on'); await sleep(900); ic.remove();
    cg.classList.add('on');   // 测试记录 18 §7：接着「门关上了……」就出结局 CG
  }
  // 1. 黑屏旁白（[类型, 文字] 的是别的样式，比如前目的地第 6 句的字条）
  for (const p of L.pre || []) { if (Array.isArray(p) && p[2] === 'cg') { cg.classList.add('on'); await sleep(1200); } await (Array.isArray(p) ? line(p[1], p[0]) : line(p, 'narr')); }   // 前目的地：扎头发那句就出 CG（测试记录 21）
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
  // 4. 牠的字条（‘前目的地’）
  if (L.note) await line(`「${L.note}」`, 'note');
  // 5. 河的最后一句（按疯神档位）
  for (const t of L[tier] || []) await line(t, 'he');
  // 5.5 结局交代（post：河那句之后、标题之前，和 pre 一样的黑屏旁白；借鉴机制与结局 §8）
  for (const p of L.post || []) await line(p, 'narr');
  // 5.6 致敬原作的最后一句（结局致敬与改名 1110）：所有交代播完以后单独一句；楚门在锁屏前、前目的地在下载字条前、土拨鼠在回第 1 天前（都在这之后发生）
  if (L.homage) await line(L.homage, 'narr');
  // 5.7 后日谈（‘祖与占’）：标题之前
  if (s?.name != null) store.set('lastName', s.name || '');   // 图鉴里重看后日谈时用
  if (L.after?.length) { cg.classList.remove('on'); await sleep(900); await playAfter(scr, say, L.after, line, s?.name || ''); }
  // 6. 标题卡
  title.classList.add('on'); await sleep(1800);
  tap.classList.add('on');
  // ‘楚门的世界’：最后这一下点击里触发下载（用户手势里，浏览器一般不拦）
  await new Promise(r => scr.addEventListener('click', () => { if (FILES[id]) downloadAfterword(s?.name, id); r(); }, { once: true }));   // 前目的地也下载，但不锁网页
}

// 后日谈：每句带背景（黑底 / 院子），图鉴里也能单独重看
async function playAfter(host, say, items, line, name = store.get('lastName', '')) {
  const bg = h('img', { class: 'cg', alt: '' }); host.insertBefore(bg, say);
  for (const [cls, text0, b] of items) {
    const text = text0 === '{NAME_SENT}' ? (name ? `屏幕上是你的名字。一个字都没打错。` : '屏幕上是一个「你」字。') : text0;
    if (b && b !== 'black') {   // 'cg:xxx' 用 CG（进回想），别的是背景图
      const isCg = b.startsWith('cg:'), src = isCg ? A(`cg/${b.slice(3)}.webp`) : A(`bg/${b}.webp`);
      if (!bg.src.endsWith(src)) { await preload(src).catch(() => {}); bg.src = src; } bg.classList.add('on');
      if (isCg) unlock('cgs', b.slice(3));
    }
    else bg.classList.remove('on');
    await line(text, cls);
  }
  bg.classList.remove('on'); await sleep(600); bg.remove();
}
export async function replayAfter(id) {
  const L = ENDING_LINES[id]; if (!L?.after) return;
  const say = h('div', { class: 'end-say' });
  const scr = h('div', { id: 'ov-after', class: 'ov after-play', style: { background: '#000' } }, say);
  document.querySelector('#overlays').append(scr);
  const line = async (text, cls) => { say.className = 'end-say ' + cls; say.textContent = text; await sleep(60); say.classList.add('on'); await sleep(700); await waitClick(scr); say.classList.remove('on'); await sleep(450); };
  await playAfter(scr, say, L.after, line);
  scr.remove();
}
// 前目的地后日谈 B：之后每次回来（只是过场：不读存档、不改存档，播完回封面）
export async function showButtonReturn(offMs) {
  const n = (store.get('button_returns', 0) || 0) + 1; store.set('button_returns', n);
  const sc = BUTTON_RETURNS[n === 10 ? 5 : (n - 1) % (n > 10 ? 6 : 5)];
  const days = Math.floor(offMs / 86400e3);
  const gone = days < 1 ? '一会儿' : days < 7 ? `${'一两三四五六'[days - 1]}天` : '很久';
  const say = h('div', { class: 'end-say' });
  const bg = h('img', { class: 'cg', src: A(`bg/${sc.bg}.webp`), alt: '' });
  const scr = showScreen('ending', h('div', {}, bg, say));
  await preload(A(`bg/${sc.bg}.webp`)).catch(() => {});
  const line = async (text, cls) => { say.className = 'end-say ' + cls; say.textContent = text; await sleep(60); say.classList.add('on'); await sleep(700); await waitClick(scr); say.classList.remove('on'); await sleep(450); };
  if (sc !== BUTTON_RETURNS[0]) await line(`你走了${gone}。`, 'narr');   // 第一句按离开时长；他不冷、不怨。① 自己开头就是「你回来了。」、后面说天数，不重复（测试记录 21）
  bg.classList.add('on'); await sleep(900);
  for (const [cls, text] of sc.lines) await line(text.replace('{N}', gone), cls);
  bg.classList.remove('on'); await sleep(700);
}
// UTF-8 带 BOM，Windows 记事本打开不乱码
export function downloadAfterword(name = '', kind = 'truman') {
  try {
    const blob = new Blob(['\ufeff' + afterwordText(name, kind).replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: FILES[kind].name, style: { display: 'none' } });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { console.warn('后日谈下载失败', e); }
}

export function showLock() {
  // 楚门锁屏 1111：同心结挪到正中、64px；新图 ui/knot_tongxin.webp 没到之前用原来的结
  const knot = h('img', { class: 'knot', src: A('ui/knot_tongxin.webp'), alt: '' });
  knot.onerror = () => { knot.onerror = null; knot.src = A('ui/ap_empty.webp'); };
  const hint = h('div', { class: 'knot-hint' }, '攥紧了，就解得开。');
  setTimeout(() => hint.classList.add('on'), 20000);   // 进锁屏 20 秒后浮出
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
    knot, hint,
    h('div', { class: 'tiny' }, '清除这个网站的数据也能打开，但存档、Key 和图鉴会一起被清掉。')));
}

// 结局后效：之后打开游戏时
export async function showAftermath(a) {
  const bgId = a.kind === 'dust' ? ({ god: 'creek', mad: 'he_room' }[a.tier] || 'room_night') : 'room_night';   // 等待戈多：神档放回溪边、疯档搬到他屋里、中间留在偏房（测试记录 17 §10）
  const bg = h('img', { class: 'bg', src: A(`bg/${bgId}.webp`), alt: '', style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(.7)' } });
  const kids = [bg];
  let line = '';
  if (a.kind === 'fade') { const f = userFigure(a.outfit, false); f.firstChild.classList.add('fx-fade'); kids.push(f); line = '床上那具身体，已经不在了。'; }
  if (a.kind === 'dust') { const f = h('div', { class: 'user-fig' }, h('img', { class: 'fx-dust', src: A('sprite/user/feign.webp'), alt: '' }), h('div', { class: 'dust-layer' })); kids.push(f); line = '……'; }   // 假死立绘 + 落灰（测试记录 17 §7）
  if (a.kind === 'gone') line = '偏房里没有人。';
  if (a.kind === 'kept') { kids.push(userFigure(a.outfit, true)); line = '它还是你走的时候的样子。'; }   // ‘沉默的羔羊’：原样，不落灰、不变透明
  kids.push(h('div', { class: 'after-line' }, line));
  const scr = showScreen('after', h('div', { style: { background: '#000' } }, ...kids));
  await sleep(2500);
  await waitClick(scr);
}
