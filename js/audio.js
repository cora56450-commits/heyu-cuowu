// BGM：5 个播放位，场景切换时淡入淡出约 1.5 秒；文件放在 assets/bgm/<播放位>.mp3，没有就不响
// title 标题 / daily 日常 / uneasy 不安（缝合、牠、后山）/ night 夜里和河独处 / meta meta 时刻与结局
import { getSettings } from './store.js?v=1794249273';

export const SLOTS = ['title', 'daily', 'uneasy', 'night', 'meta'];
const FADE = 1500;
const tracks = {};   // slot → Audio
let current = null, wanted = null, unlocked = false, dead = false;

function vol() { const s = getSettings(); return s.bgmOn === false ? 0 : (s.volume ?? 0.7); }
function track(slot) {
  if (!tracks[slot]) {
    const a = new Audio(`assets/bgm/${slot}.mp3`); a.loop = true; a.volume = 0; a.preload = 'auto';
    a.addEventListener('error', () => { a.dataset.missing = '1'; });
    tracks[slot] = a;
  }
  return tracks[slot];
}
function fade(a, to, ms = FADE) {
  clearInterval(a._fade);
  const from = a.volume, t0 = performance.now();
  a._fade = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k >= 1) { clearInterval(a._fade); if (to === 0) a.pause(); }
  }, 50);
}
export function playBgm(slot) {
  if (dead) return;
  wanted = slot;
  if (!unlocked || slot === current) return;
  if (current && tracks[current]) fade(tracks[current], 0);
  current = slot;
  if (!slot) return;
  const a = track(slot);
  if (a.dataset.missing) return;
  a.play().then(() => fade(a, vol())).catch(() => {});
}
// 浏览器要求先有一次点击才能出声
addEventListener('pointerdown', () => { if (!unlocked) { unlocked = true; if (wanted) { const w = wanted; current = null; playBgm(w); } } }, { once: false, capture: true });

export function stopAll() {
  dead = true; wanted = null; current = null;   // 这个页面之后都不再出声
  for (const a of Object.values(tracks)) { clearInterval(a._fade); a.volume = 0; a.pause(); }
}
export function applyVolume() { if (current && tracks[current]) fade(tracks[current], vol(), 300); }
// meta 时刻：当前曲子突然停 1–2 秒再继续
export function stutter(ms = 1200 + Math.random() * 800) {
  const a = current && tracks[current]; if (!a || a.paused) return;
  const v = a.volume; a.volume = 0;
  setTimeout(() => { a.volume = v; }, ms);
}
