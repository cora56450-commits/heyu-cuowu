// BGM：8 个播放位，场景切换时淡入淡出约 1.5 秒；文件放在 assets/bgm/<播放位>.mp3（ambiguous 是 .m4a），没有就不响
// title 标题 / daily 日常 / uneasy 不安（缝合、牠、后山）/ night 夜里和河独处 / meta meta 时刻与结局
// ambiguous 暧昧（第一次、夜里在河的房间且河在、d21/r2/r5）/ joy 高兴（第 14 天桃花节）/ d40 第四十天的问题
// sad 悲伤日常（门缝、铁皮盒、最后一夜按回答）/ sad_end 悲伤结局（6 个坏结局和它们的后效画面）
// 短曲（XFADE 里的）不用 loop，快放完时另起一份从头淡入，交叉 2 秒，听不出接口
import { getSettings } from './store.js?v=1794485976';

export const SLOTS = ['title', 'daily', 'uneasy', 'night', 'meta', 'ambiguous', 'joy', 'd40', 'sad', 'sad_end'];
const XFADE = { sad: 2000, sad_end: 2000 };
const EXT = { ambiguous: 'm4a' };   // 本机没有 mp3 编码器，暧昧转成 128k AAC
const FADE = 1500;
const tracks = {};   // slot → Audio
let current = null, wanted = null, unlocked = false, dead = false, gain = 1, wantedGain = 1;

function vol() { const s = getSettings(); return s.bgmOn === false ? 0 : (s.volume ?? 0.7) * gain; }
function track(slot) {
  if (!tracks[slot]) {
    const mk = () => {
      const a = new Audio(`assets/bgm/${slot}.${EXT[slot] || 'mp3'}`); a.loop = !XFADE[slot]; a.volume = 0; a.preload = 'auto';
      a.addEventListener('error', () => { a.dataset.missing = '1'; });
      if (XFADE[slot]) a.addEventListener('timeupdate', () => {   // 交叉循环：快到结尾，另一份从头淡入，这一份淡出
        if (tracks[slot] !== a || current !== slot || a._x || !a.duration || a.duration - a.currentTime > XFADE[slot] / 1000) return;
        a._x = true; const b = a._twin || (a._twin = mk()); b._twin = a; b._x = false;
        b.currentTime = 0; b.volume = 0; tracks[slot] = b;
        b.play().then(() => fade(b, vol(), XFADE[slot])).catch(() => {}); fade(a, 0, XFADE[slot]);
      });
      return a;
    };
    tracks[slot] = mk();
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
// g：这一首的音量倍数（结局后效画面压到一半）
export function playBgm(slot, g = 1) {
  if (dead) return;
  wanted = slot; wantedGain = g;
  if (!unlocked) return;
  if (slot === current) { if (g !== gain) { gain = g; applyVolume(); } return; }
  if (current && tracks[current]) fade(tracks[current], 0);
  current = slot; gain = g;
  if (!slot) return;
  const a = track(slot);
  if (a.dataset.missing) return;
  a._x = false; if (XFADE[slot] && a.ended) a.currentTime = 0;
  a.play().then(() => fade(a, vol())).catch(() => {});
}
export function nowPlaying() { return current ?? wanted; }
// 浏览器要求先有一次点击才能出声
addEventListener('pointerdown', () => { if (!unlocked) { unlocked = true; if (wanted) { const w = wanted; current = null; playBgm(w, wantedGain); } } }, { once: false, capture: true });

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
