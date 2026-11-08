// 小工具：建元素、浮层、提示、坐标换算
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const A = p => 'assets/' + p;

export function showScreen(id, el) {
  const box = $('#screens');
  for (const s of box.children) s.classList.remove('active');
  let scr = $('#scr-' + id);
  if (el) { if (scr) scr.remove(); el.id = 'scr-' + id; el.classList.add('screen'); box.append(el); scr = el; }
  scr.classList.add('active');
  return scr;
}
export function openOv(id, el) {
  closeOv(id); el.id = 'ov-' + id; el.classList.add('ov'); $('#overlays').append(el); return el;
}
export function closeOv(id) { const o = $('#ov-' + id); if (o) o.remove(); }
export function topOv() { const o = $('#overlays'); return o.lastElementChild; }

export function toast(msg, ms = 2400) {
  const d = h('div', {}, msg); $('#toast').append(d); setTimeout(() => d.remove(), ms);
}
export function scale() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--s')) || 1; }
// 屏幕坐标 → 舞台坐标
export function toStage(e) {
  const r = $('#stage').getBoundingClientRect(); const s = r.width / 1280;
  return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
}

// 通用面板弹窗
export function modal(id, title, body, opts = {}) {
  return new Promise(res => {
    const done = v => { closeOv(id); res(v); };
    const box = h('div', { class: 'modal paper' }, title ? h('h3', {}, title) : null, body);
    const ov = h('div', { class: 'dim', onclick: e => { if (e.target === ov && !opts.noClose) done(null); } }, box);
    if (opts.buttons) box.append(h('div', { class: 'list', style: { marginTop: '18px' } },
      opts.buttons.map(b => h('button', { class: 'btn', onclick: () => done(b.value) }, b.label))));
    openOv(id, ov);
    if (opts.bind) opts.bind(done);
  });
}
export const confirmBox = (title, text, yes = '确定', no = '算了') =>
  modal('confirm', title, h('p', {}, text), { buttons: [{ label: yes, value: true }, { label: no, value: false }] });

// 预加载图片
const cache = new Map();
export function preload(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise(r => { const i = new Image(); i.onload = i.onerror = () => r(i); i.src = src; });
  cache.set(src, p); return p;
}
