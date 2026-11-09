// 三个小游戏（纯前端，不调用 AI，支持触屏）：数花瓣、牠的字条、拼图（弹窗拼贴）
import { h, A, openOv, closeOv, sleep, toStage } from './dom.js?v=1794187505';
import { garble } from '../meta.js?v=1794187505';

// 拼图用的照片（框按照片比例自动调整）
export const PUZZLES = {
  puzzle_he: { img: 'puzzle/he_child.webp', title: 'old_photo_01.jpg', flag: 'puzzle_he',
    done: '照片拼好了。一个很小的孩子，站在一辆车前面，车灯亮着。', fail: '碎片又散回了相册里。' },
  puzzle_ta: { img: 'puzzle/ta_young.webp', title: 'IMG_0000.jpg', flag: 'puzzle_ta_young',
    done: '照片上的人很年轻，头发是黑的，束在脑后。你觉得这张脸在哪里见过。', fail: '照片太旧了，拼不起来。' },
};
// 牠的字条：句子；hidden 是拼完以后那行「看不清」的字（复制出来才是真的）
const NOTES = ['河的针脚比我的正', '线头要剪干净', '你的手腕很凉', '我不老只是慢', '别在夜里去溪边', '外面的花有五瓣', '他记得的比他说的多'];
const HIDDEN = ['他用的是我的针', '我也在溪边醒过', '二十年前我也选过脸', '他会变成我'];

export function runMinigame(name, s) {
  if (name === 'flower') return flower(s);
  if (name === 'note') return note(s);
  if (PUZZLES[name]) return puzzle(s, PUZZLES[name]);
  return Promise.resolve({ lines: [] });
}

function shell(title, sub, onGiveUp) {
  const body = h('div', {});
  const ov = h('div', {}, h('div', { class: 'cap' }, title, h('small', {}, sub)), body,
    h('button', { class: 'close-x', title: '放弃', onclick: onGiveUp }, '×'));
  openOv('mini', ov); return body;
}

// —— 数花瓣 ——
function flowerSvg(n, size, rot, hue) {
  const petals = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (360 / n) * i;
    petals.push(`<ellipse cx="50" cy="27" rx="${n === 4 ? 15 : n === 5 ? 13 : 11}" ry="22" transform="rotate(${a} 50 50)" fill="hsl(${hue},60%,90%)" stroke="hsl(${hue},35%,62%)" stroke-width="1.6"/>`);
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${petals.join('')}<circle cx="50" cy="50" r="9" fill="hsl(${hue - 10},45%,55%)"/><circle cx="50" cy="50" r="4" fill="#7a2a2a"/></svg>`;
}
function flower(s) {
  return new Promise(res => {
    let miss = 0;
    const finish = ok => {
      closeOv('mini');
      if (ok) { s.c.flowerFound = (s.c.flowerFound || 0) + 1; s.f.flower_found = true; }
      res({ success: ok, lines: ok
        ? [{ speaker: 'narration', text: '你找到了那朵五瓣的。' }, { speaker: 'narration', text: '在这里，它看起来反而像一个错误。' }]
        : [{ speaker: 'narration', text: '花太多了。你数到一半就忘了数到哪。' }] });
    };
    const body = shell('数花瓣', '这里的花是四瓣或六瓣的。找出那朵不一样的。', () => finish(false));
    const area = h('div', { class: 'flowers' }); body.append(area);
    const W = 1100, H = 590, N = 30, placed = [];
    const odd = Math.floor(Math.random() * N);
    for (let i = 0; i < N; i++) {
      const size = 62 + Math.random() * 36;
      let x, y, tries = 0;
      do { x = Math.random() * (W - size); y = Math.random() * (H - size); tries++; }
      while (tries < 200 && placed.some(p => Math.hypot(p.x - x, p.y - y) < (p.size + size) / 2 * 0.95));
      placed.push({ x, y, size });
      const n = i === odd ? 5 : Math.random() < 0.5 ? 4 : 6;
      const wrap = h('div', { html: flowerSvg(n, size, Math.random() * 90, 340 + Math.random() * 25) });
      const svg = wrap.firstChild;
      svg.style.left = x + 'px'; svg.style.top = y + 'px';
      svg.addEventListener('click', async () => {
        if (n === 5) { svg.style.transform = 'scale(1.4)'; svg.style.transition = 'transform .4s'; await sleep(700); finish(true); }
        else { miss++; svg.classList.remove('wrong'); void svg.getBoundingClientRect(); svg.classList.add('wrong'); if (miss >= 8) finish(false); }
      });
      area.append(svg);
    }
  });
}

// —— 牠的字条 ——
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function note(s) {
  return new Promise(res => {
    s.c.notesSeen = s.c.notesSeen || [];
    const pool = NOTES.filter(n => !s.c.notesSeen.includes(n));
    const sentence = (pool.length ? pool : NOTES)[Math.floor(Math.random() * (pool.length || NOTES.length))];
    const chars = [...sentence];
    let tiles = shuffle(chars.map((c, i) => ({ c, i, mir: Math.random() < 0.35 ? (Math.random() < 0.7 ? 'mir' : 'flip') : '' })));
    if (tiles.every((t, k) => t.i === k)) tiles = tiles.reverse();
    const answer = [];
    const finish = ok => {
      closeOv('mini');
      if (ok) { if (!s.c.notesSeen.includes(sentence)) { s.c.notesSeen.push(sentence); s.c.taLine = (s.c.taLine || 0) + 1; } }
      res({ success: ok, lines: ok
        ? [{ speaker: '牠', expr: 'note', text: `（字条）「${sentence}」` }]
        : [{ speaker: 'narration', text: '你看不懂牠写的字。牠把字条收回去，折成很小的一块。' }] });
    };
    const body = shell('牠的字条', '字被打乱了，有的是反着写的。按顺序点，把句子拼回来。', () => finish(false));
    const paper = h('div', { class: 'note-paper paper' }); const poolEl = h('div', { class: 'note-pool' });
    const ctl = h('div', { class: 'note-ctl' }, h('button', { class: 'btn', onclick: () => { answer.pop(); draw(); } }, '退一个'), h('button', { class: 'btn', onclick: () => { answer.length = 0; draw(); } }, '重来'));
    body.append(paper, poolEl, ctl);
    const draw = () => {
      paper.replaceChildren(...answer.map((t, k) => h('button', { onclick: () => { answer.splice(k, 1); draw(); } }, t.c)), answer.length ? '' : h('span', { style: { opacity: .4, fontSize: '22px' } }, '（点下面的字）'));
      poolEl.replaceChildren(...tiles.map(t => h('button', { class: (t.mir || '') + (answer.includes(t) ? ' used' : ''), onclick: () => { answer.push(t); draw(); check(); } }, t.c)));
    };
    const check = async () => {
      if (answer.length < chars.length) return;
      if (answer.map(t => t.c).join('') === sentence) {
        poolEl.replaceChildren(); ctl.replaceChildren();
        const hidden = HIDDEN[Math.floor(Math.random() * HIDDEN.length)];
        paper.append(h('div', { style: { fontSize: '20px', marginTop: '16px', opacity: .55, userSelect: 'text', webkitUserSelect: 'text', letterSpacing: '2px' } }, garble(hidden)));
        paper.append(h('div', { style: { marginTop: '24px' } }, h('button', { class: 'btn', style: { width: 'auto', height: 'auto', fontSize: '20px', boxShadow: 'none', padding: '8px 26px' }, onclick: () => finish(true) }, '收起字条')));
      } else { paper.classList.remove('wrong'); void paper.offsetWidth; paper.style.animation = 'shake .3s'; await sleep(350); paper.style.animation = ''; answer.length = 0; draw(); }
    };
    draw();
  });
}

// —— 拼图：照片被拆进几个老式电脑窗口 ——
async function puzzle(s, cfg) {
  // 框按照片实际比例来（竖版 / 横版都行）
  const pic = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = A(cfg.img); });
  const ratio = pic ? pic.naturalHeight / pic.naturalWidth : 1.6;
  return new Promise(res => {
    const finish = ok => {
      closeOv('mini');
      if (ok) s.f[cfg.flag] = true;
      res({ success: ok, lines: [{ speaker: 'narration', text: ok ? cfg.done : cfg.fail }] });
    };
    const body = shell('拼图', '拖动窗口，把照片拼回去。', () => finish(false));
    const FH = Math.min(550, 600 * ratio), FW = FH / ratio, FX = (1280 - FW) / 2, FY = 100 + (550 - FH) / 2, COLS = 3, ROWS = 3;
    const cw = FW / COLS, ch = FH / ROWS;
    const frame = h('div', { class: 'puzzle-frame', style: { left: FX + 'px', top: FY + 'px', width: FW + 'px', height: FH + 'px' } });
    body.append(frame);
    const PAD = 5, TB = 22;
    let z = 10, left = COLS * ROWS;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const pic = h('div', { class: 'pic', style: { width: cw + 'px', height: ch + 'px', backgroundImage: `url(${A(cfg.img)})`, backgroundSize: `${FW}px ${FH}px`, backgroundPosition: `${-c * cw}px ${-r * ch}px` } });
      const win = h('div', { class: 'win98' }, h('div', { class: 'tb' }, h('span', {}, `${cfg.title} (${r * COLS + c + 1}/${COLS * ROWS})`), h('b', {}, '×')), pic);
      // 随机散开（避开中间的框）
      let x, y;
      do { x = 20 + Math.random() * (1280 - cw - 60); y = 90 + Math.random() * (720 - ch - 140); }
      while (x > FX - cw * 0.6 && x < FX + FW - cw * 0.4 && y > FY - ch * 0.6 && y < FY + FH - ch * 0.3);
      win.style.left = x + 'px'; win.style.top = y + 'px'; win.style.zIndex = z++;
      const target = { x: FX + c * cw - PAD, y: FY + r * ch - TB - PAD };
      let d = null;
      win.addEventListener('pointerdown', e => {
        if (win.classList.contains('snap')) return;
        win.setPointerCapture(e.pointerId); const p = toStage(e);
        d = { dx: p.x - parseFloat(win.style.left), dy: p.y - parseFloat(win.style.top) }; win.style.zIndex = z++;
      });
      win.addEventListener('pointermove', e => { if (!d) return; const p = toStage(e); win.style.left = (p.x - d.dx) + 'px'; win.style.top = (p.y - d.dy) + 'px'; });
      const up = async () => {
        if (!d) return; d = null;
        if (Math.hypot(parseFloat(win.style.left) - target.x, parseFloat(win.style.top) - target.y) < 32) {
          win.style.left = target.x + 'px'; win.style.top = target.y + 'px'; win.classList.add('snap'); win.style.zIndex = 1;
          if (--left === 0) {
            const full = h('img', { src: A(cfg.img), style: { position: 'absolute', left: FX + 'px', top: FY + 'px', width: FW + 'px', height: FH + 'px', opacity: 0, transition: 'opacity 1.2s', zIndex: 500, objectFit: 'cover' } });
            body.append(full); await sleep(50); full.style.opacity = 1; await sleep(2200); finish(true);
          }
        }
      };
      win.addEventListener('pointerup', up); win.addEventListener('pointercancel', up);
      body.append(win);
    }
  });
}
