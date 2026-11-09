// 解析 AI 输出：严格 JSON → 宽松提取 → 纯文本兜底；以及流式中途提取完整的 line 对象
import { EXPR, CODE_ONLY_EXPR, ORGANS } from './config/world.js?v=1794185992';
const ORGAN_BY_NAME = Object.fromEntries(ORGANS.map(o => [o.name, o.id]));
import { AI_TAGS, MAX_TAGS_PER_TURN } from './config/values.js?v=1794185992';

export function looseJson(raw) {
  if (!raw) return null;
  let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  // 修补：尾逗号
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1')); } catch {} }
  return null;
}

const SPEAKERS = new Set(['narration', '河', '牠', '养母', '村民', '村民·男', '村民·女', '你']);
export function normLine(l) {
  if (!l || typeof l !== 'object') return null;
  let sp = String(l.speaker || 'narration').trim();
  if (/^(旁白|narrator|系统)$/i.test(sp)) sp = 'narration';
  if (sp === '我' || sp === '玩家') sp = '你';
  const text = String(l.text ?? '').trim();
  if (!text) return null;
  sp = sp.replace(/^村民[·・.\-\s]?(男|女)$/, '村民·$1');
  const out = { speaker: SPEAKERS.has(sp) || sp.length <= 3 ? sp : 'narration', text };
  if (l.name && sp.startsWith('村民')) out.name = String(l.name).slice(0, 2);
  // user 绝不说屏幕外的话：这类台词直接丢掉
  if (sp === '你' && /下线|上线|等会见|存档|读档|屏幕|游戏|玩家|重新生成/.test(text)) return null;
  if (EXPR[sp]) out.expr = EXPR[sp][l.expr] && !CODE_ONLY_EXPR.includes(l.expr) ? l.expr : null;
  return out;
}

export function normTurn(raw) {
  const j = looseJson(raw);
  if (!j || !Array.isArray(j.lines)) {
    // 兜底：把纯文本当旁白
    const txt = (raw || '').replace(/[{}\[\]"]/g, '').split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 6);
    return { ok: false, lines: txt.length ? txt.map(t => ({ speaker: 'narration', text: t.slice(0, 120) })) : [{ speaker: 'narration', text: '……' }], tags: [], action_size: 'small', suggestions: [], he_flags: [] };
  }
  const rawTags = Array.isArray(j.tags) ? j.tags.map(String) : [];
  const tags = rawTags.filter(t => AI_TAGS.includes(t)).slice(0, MAX_TAGS_PER_TURN);
  const om = rawTags.map(t => t.match(/^organ[:：](.+)$/)).find(Boolean);
  const organ = om ? ORGAN_BY_NAME[om[1].trim()] || null : null;
  const sugg = (Array.isArray(j.suggestions) ? j.suggestions : []).map(x => typeof x === 'string' ? { text: x, cost: 1 } : x)
    .filter(x => x && x.text).map(x => ({ text: String(x.text).slice(0, 20), cost: Math.min(3, Math.max(1, parseInt(x.cost) || 1)) })).slice(0, 4);
  return {
    ok: true,
    lines: j.lines.map(normLine).filter(Boolean),
    tags, suggestions: sugg, organ,
    action_size: ['small', 'medium', 'large'].includes(j.action_size) ? j.action_size : 'small',
    he_flags: Array.isArray(j.he_flags) ? j.he_flags.filter(x => typeof x === 'string') : [],
    appointment: j.appointment && typeof j.appointment === 'object' && j.appointment.who ? j.appointment : null,
  };
}

// 流式：从不完整的 JSON 里依次取出 lines 数组中已经完整的对象
export class LineStreamer {
  constructor(onLine) { this.onLine = onLine; this.pos = -1; this.count = 0; this.closed = false; }
  feed(full) {
    if (this.closed) return;
    if (this.pos < 0) {
      const m = /"lines"\s*:\s*\[/.exec(full); if (!m) return;
      this.pos = m.index + m[0].length;
    }
    let i = this.pos, depth = 0, inStr = false, esc = false, start = -1;
    for (; i < full.length; i++) {
      const c = full[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') { if (depth === 0) start = i; depth++; }
      else if (c === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          try { const l = normLine(JSON.parse(full.slice(start, i + 1))); if (l) { this.count++; this.onLine(l); } } catch {}
          this.pos = i + 1; start = -1;
        }
      } else if (c === ']' && depth === 0) { this.closed = true; this.pos = i + 1; return; }
    }
  }
}
