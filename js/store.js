// localStorage 封装：所有键统一加 gucun_ 前缀
const P = 'gucun_';
export const store = {
  get(k, def = null) {
    try { const v = localStorage.getItem(P + k); return v == null ? def : JSON.parse(v); } catch { return def; }
  },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (e) { console.warn('存储失败', e); } },
  del(k) { try { localStorage.removeItem(P + k); } catch {} },
  keys() { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(P)) out.push(k.slice(P.length)); } } catch {} return out; },
  clearAll() { for (const k of this.keys()) this.del(k); },
};

// 设置（API、文字速度等），与存档分开
export const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-flash', thinking: 'off',   // thinking：off / events（只在固定剧情开）/ all
  stream: true, jsonMode: true, timeout: 90, mock: false,
  textSpeed: 40, autoDelay: 1.6, volume: 0.7, bgmOn: true, reduceMotion: false, adult: false,
};
export function getSettings() { return { ...DEFAULT_SETTINGS, ...store.get('settings', {}) }; }
export function saveSettings(s) { store.set('settings', s); }

// 图鉴：结局、CG、道具；开新档不清
export function getGallery() { return { endings: {}, cgs: {}, organs: {}, misc: {}, ...store.get('gallery', {}) }; }
// 器官画：第 12 天「和他一起看画」拼完之前，图鉴和「河的画」里都看不到
export const organsOpen = () => !!getGallery().misc.organ_puzzle;
export function unlock(kind, id) { const g = getGallery(); if (!g[kind][id]) { g[kind][id] = Date.now(); store.set('gallery', g); return true; } return false; }
