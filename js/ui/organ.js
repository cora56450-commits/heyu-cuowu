// 器官道具查看：CSS 3D 摇摆 + 拖动旋转 + 随角度移动的高光
import { h, A, openOv, closeOv, toStage, sleep } from './dom.js?v=1794349186';
import { ORGANS } from '../config/world.js?v=1794349186';

export function openOrgan(id, list) {
  list = list && list.length ? list : [id];
  let idx = Math.max(0, list.indexOf(id));
  return new Promise(res => {
    const img = h('img', { alt: '', draggable: 'false' });
    const gloss = h('div', { class: 'gloss' });
    const rot = h('div', { class: 'organ-rot' }, img, gloss);
    const stage = h('div', { class: 'organ-stage' }, rot);
    const nm = h('div', { class: 'nm' }); const say = h('div', { class: 'say' });
    const set = () => {
      const o = ORGANS.find(x => x.id === list[idx]);
      const src = A(`organ/${o.id}.webp`);
      img.src = src;
      gloss.style.webkitMaskImage = gloss.style.maskImage = `url(${src})`;
      nm.replaceChildren(h('small', { class: 'over' }, '河的画'), o.name, h('small', {}, `${o.rank}　·　${idx + 1} / ${list.length}`));
      say.replaceChildren(h('b', {}, '河'), '「' + o.line + '」');
    };
    let angle = 0, drag = null, release = 0, raf;
    const t0 = performance.now();
    const loop = now => {
      const t = (now - t0) / 1000;
      const idle = 6 * Math.sin(t * 2 * Math.PI / 4.6);
      if (drag) angle = drag.cur;
      else if (release) { // 松手后弹回待机摆动
        const k = Math.min(1, (now - release) / 900); const e = 1 - Math.pow(1 - k, 3);
        angle = drag0 + (idle - drag0) * e + Math.sin(k * Math.PI * 2) * (1 - k) * 4;
        if (k >= 1) release = 0;
      } else angle = idle;
      const tilt = 2.5 * Math.sin(t * 2 * Math.PI / 6.3);
      rot.style.transform = `rotateY(${angle}deg) rotateX(${tilt}deg)`;
      const p = 50 + angle * 1.6;
      gloss.style.background = `linear-gradient(${100 + angle}deg, rgba(0,0,0,.42) ${p - 45}%, rgba(255,255,255,0) ${p - 15}%, rgba(255,245,235,.6) ${p}%, rgba(255,255,255,0) ${p + 14}%, rgba(0,0,0,.35) ${p + 50}%)`;
      img.style.filter = `drop-shadow(${-angle * 0.8}px 18px 22px rgba(0,0,0,.55))`;
      raf = requestAnimationFrame(loop);
    };
    let drag0 = 0;
    stage.addEventListener('pointerdown', e => { stage.setPointerCapture(e.pointerId); drag = { x: toStage(e).x, start: angle, cur: angle }; stage.style.cursor = 'grabbing'; });
    stage.addEventListener('pointermove', e => { if (!drag) return; const dx = toStage(e).x - drag.x; drag.cur = Math.max(-25, Math.min(25, drag.start + dx * 0.18)); });
    const up = () => { if (!drag) return; drag0 = drag.cur; drag = null; release = performance.now(); stage.style.cursor = ''; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    const close = () => { cancelAnimationFrame(raf); closeOv('organ'); res(); };
    const nav = d => { idx = (idx + d + list.length) % list.length; set(); };
    const ov = h('div', {}, nm, stage, say,
      list.length > 1 ? h('button', { class: 'nav', style: { left: '120px' }, onclick: () => nav(-1) }, '‹') : null,
      list.length > 1 ? h('button', { class: 'nav', style: { right: '120px' }, onclick: () => nav(1) }, '›') : null,
      h('button', { class: 'close-x', onclick: close }, '×'));
    openOv('organ', ov); set(); raf = requestAnimationFrame(loop);
  });
}

// —— 器官归位：把拿到的画拖到躯干里对应的虚线位置 ——
// 位置是躯干框里的百分比 [x, y, 宽]；躯干轮廓图（ui/torso.webp）没到之前用代码画的轮廓
export const ORGAN_SLOTS = {
  lungs: [50, 27, 52], heart: [57, 33, 17], stomach: [61, 47, 22], spleen: [73, 45, 12], pancreas: [52, 52, 20],
  gallbladder: [37, 49, 9], kidney: [36, 58, 13], large_intestine: [50, 67, 44], small_intestine: [50, 69, 28], bladder: [50, 84, 13],
};
// 有躯干素材（ui/torso，1086×1433）时，位置对准素材上画好的虚线
export const TORSO_SLOTS = {
  lungs: [49.5, 22.5, 57], heart: [52, 25, 16], stomach: [61, 41, 15], spleen: [74, 43, 7], pancreas: [54.5, 51, 28],
  gallbladder: [30.5, 47, 8], kidney: [33, 58, 9], large_intestine: [48.5, 74.5, 50], small_intestine: [49, 75, 37], bladder: [47.5, 93, 14],
};
export function organPuzzle(owned, hasTorso) {
  return new Promise(res => {
    const SLOTS = hasTorso ? TORSO_SLOTS : ORGAN_SLOTS;
    const W = hasTorso ? 430 : 380, H = hasTorso ? 567 : 600, X = 560, Y = 80;
    const body = h('div', { class: 'torso' + (hasTorso ? ' has-img' : ''), style: { left: X + 'px', top: Y + 'px', width: W + 'px', height: H + 'px' } });
    if (hasTorso) body.append(h('img', { src: A('ui/torso.webp'), alt: '', class: 'torso-img' }));
    else body.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 100 158" class="torso-img" preserveAspectRatio="none"><path d="M30 2 Q50 -2 70 2 L74 14 Q92 18 96 30 L92 100 Q88 128 80 150 L20 150 Q12 128 8 100 L4 30 Q8 18 26 14 Z" fill="rgba(239,230,216,.08)" stroke="rgba(239,230,216,.55)" stroke-width=".6"/></svg>`);
    const placed = new Set();
    for (const [id, [px, py, pw]] of Object.entries(SLOTS)) {
      const has = owned.includes(id);
      body.append(h('div', { class: 'slot' + (has ? '' : ' empty'), 'data-id': id, style: { left: px + '%', top: py + '%', width: pw + '%', height: (pw * W / H) + '%' } }));
    }
    const tray = h('div', { class: 'tray' });
    const ov = h('div', { class: 'solid' }, h('div', { class: 'cap' }, '和他一起看画', h('small', {}, '把每一张放回它该在的地方。')), body, tray,
      h('button', { class: 'close-x', onclick: () => { closeOv('mini'); res({ success: false, lines: [] }); } }, '×'));
    openOv('mini', ov);
    for (const id of owned) {
      const img = h('img', { class: 'piece', src: A(`organ/${id}.webp`), alt: '', draggable: 'false' });
      tray.append(img);
      let d = null;
      // 原地用位移拖动（不换父元素，否则指针捕获会丢）
      img.addEventListener('pointerdown', e => {
        if (placed.has(id)) return;
        img.setPointerCapture(e.pointerId); const p = toStage(e);
        d = { sx: p.x, sy: p.y }; img.classList.add('dragging'); img.style.transition = 'none';
      });
      img.addEventListener('pointermove', e => { if (!d) return; const p = toStage(e); img.style.transform = `translate(${p.x - d.sx}px, ${p.y - d.sy}px)`; });
      const up = async e => {
        if (!d) return; d = null; img.classList.remove('dragging');
        const sr = img.closest('#stage').getBoundingClientRect(); const k = sr.width / 1280; const r = img.getBoundingClientRect();
        const cx = (r.left + r.width / 2 - sr.left) / k, cy = (r.top + r.height / 2 - sr.top) / k;
        const [px, py, pw] = SLOTS[id];
        const tx = X + px / 100 * W, ty = Y + py / 100 * H;
        if (Math.hypot(cx - tx, cy - ty) < 60) {
          // 放对了：吸附，带一点「贴合」的动效
          const sw = pw / 100 * W, ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
          img.replaceWith(h('div', { class: 'piece-gap' }));   // 托盘里留个空位，剩下的不重新排位（测试报告：连续拖时抓错器官）
          ov.append(img);
          Object.assign(img.style, { position: 'absolute', transform: '', width: sw + 'px', height: sw * ratio + 'px', left: (tx - sw / 2) + 'px', top: (ty - sw * ratio / 2) + 'px' });
          img.classList.add('fit'); placed.add(id);
          body.querySelector(`.slot[data-id="${id}"]`)?.classList.add('filled');
          if (placed.size === owned.length) {
            await sleep(900); closeOv('mini');
            res({ success: true, lines: [{ speaker: '河', expr: 'smile', text: '……都在该在的地方。' }] });
          }
        } else { img.style.transition = 'transform .35s cubic-bezier(.3,1.4,.5,1)'; img.style.transform = ''; }   // 放错了：弹回原位
      };
      img.addEventListener('pointerup', up); img.addEventListener('pointercancel', up);
    }
  });
}
