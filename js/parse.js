// 解析 AI 输出：严格 JSON → 宽松提取 → 纯文本兜底；以及流式中途提取完整的 line 对象
import { EXPR, CODE_ONLY_EXPR, ORGANS } from './config/world.js?v=1794653836';
const ORGAN_BY_NAME = Object.fromEntries(ORGANS.map(o => [o.name, o.id]));
import { AI_TAGS, MAX_TAGS_PER_TURN } from './config/values.js?v=1794653836';

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

// AI 偶尔在台词里写 HTML 标签（如「牠也记。</br>」，Cora 11/10）：标签一律去掉，<br> 类当成空格
export const stripTags = s => String(s ?? '').replace(/<\s*\/?\s*br\s*\/?\s*>/gi, ' ').replace(/<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?\/?>/gi, '').replace(/&nbsp;/g, ' ').replace(/[ \t]{2,}/g, ' ');
const SPEAKERS = new Set(['narration', '河', '牠', '养母', '村民', '村民·男', '村民·女', '你']);
export function normLine(l) {
  if (!l || typeof l !== 'object') return null;
  let sp = String(l.speaker || 'narration').trim();
  if (/^(旁白|narrator|系统)$/i.test(sp)) sp = 'narration';
  if (sp === '我' || sp === '玩家') sp = '你';
  sp = { tra: '牠', ta: '牠', 它: '牠', 白头发的人: '牠', mother: '养母', 妈: '养母', 母亲: '养母', heng: '衡', man: '满', he: '河' }[/^[a-z]+$/i.test(sp) ? sp.toLowerCase() : sp] || sp;   // 测试记录 34：speaker 写成别名（tra、mother……）的认回来，不然整句被删
  let text = stripTags(l.text).trim();
  // 测试记录 34：坏格式里漏出来的符号不上画面——开头的 : , } ] 去掉，去完不到 2 个字就丢
  const bare = text.replace(/^[\s:,}\]]+/, '');
  if (bare !== text) { text = bare.trim(); if ([...text].length < 2) return null; }
  if (!text) return null;
  sp = sp.replace(/^村民[·・.\-\s]?(男|女)$/, '村民·$1');
  const out = { speaker: SPEAKERS.has(sp) || sp.length <= 3 ? sp : 'narration', text };
  if (l.name && sp.startsWith('村民')) out.name = String(l.name).slice(0, 2);
  // user 绝不说屏幕外的话：这类台词直接丢掉
  if (sp === '你' && /下线|上线|等会见|存档|读档|屏幕|游戏|玩家|重新生成/.test(text)) return null;
  if (EXPR[sp]) out.expr = EXPR[sp][l.expr] && !CODE_ONLY_EXPR.includes(l.expr) ? l.expr : null;
  return out;
}

// 一条 line 的 JSON 坏了（最常见：台词里有没转义的英文引号 "）：按字段名硬取，不再整条丢掉（测试报告「台词丢了」）
export function rescueLine(src) {
  try { return JSON.parse(src); } catch {}
  const sp = /"speaker"\s*:\s*"([^"]{0,12})"/.exec(src); if (!sp) return null;
  const ex = /"expr"\s*:\s*"([a-z_]{0,12})"/.exec(src);
  const tm = /"text"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"(?:expr|name|speaker)"\s*:\s*"[^"]*"\s*)*}\s*$/.exec(src); if (!tm) return null;
  const nm = /"name"\s*:\s*"([^"]{0,4})"/.exec(src); let q = 0;
  return { speaker: sp[1], expr: ex?.[1], name: nm?.[1], text: tm[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/"/g, () => (q++ % 2 ? '」' : '「')) };
}
// 整段 JSON 坏了时，从 lines 数组里一条一条取（和流式的切法一样，台词不会错位）
function scanLines(full) {
  const out = []; const s = new LineStreamer(l => out.push(l)); s.feed(full); return out;
}

export function normTurn(raw) {
  const j = looseJson(raw);
  if (!j || !Array.isArray(j.lines)) {
    const rescued = raw ? scanLines(raw) : [];
    if (rescued.length) return { ok: 'rescued', lines: rescued, tags: [], action_size: 'small', suggestions: [], he_flags: [] };
    // 测试记录 34：键名写坏了（空的、乱的）的 lines——每个对象里按「前一个字符串值是谁、后一个是台词」硬取
    const pairs = [...String(raw || '').matchAll(/\{\s*"[^"]{0,10}"\s*:\s*"([^"]{0,12})"\s*,\s*"[^"]{0,10}"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
      .map(m => normLine({ speaker: m[1].trim() || 'narration', text: m[2].replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\') })).filter(Boolean);
    if (pairs.length >= 2) return { ok: 'rescued', lines: pairs, tags: [], action_size: 'small', suggestions: [], he_flags: [] };
    // 带 JSON 符号又救不回来：不当旁白播，交给 doTurn 悄悄重试一次
    if (/[{\[]|"\s*:/.test(raw || '')) return { ok: false, retry: true, lines: [{ speaker: 'narration', text: '……' }], tags: [], action_size: 'small', suggestions: [], he_flags: [] };
    // 兜底：真的纯文本才当旁白
    const txt = stripTags(raw || '').replace(/[{}\[\]"]/g, '').split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 6);
    return { ok: false, lines: txt.length ? txt.map(t => ({ speaker: 'narration', text: t.slice(0, 120) })) : [{ speaker: 'narration', text: '……' }], tags: [], action_size: 'small', suggestions: [], he_flags: [] };
  }
  const rawTags = Array.isArray(j.tags) ? j.tags.map(String) : [];
  const tags = rawTags.filter(t => AI_TAGS.includes(t)).slice(0, MAX_TAGS_PER_TURN);
  const om = rawTags.map(t => t.match(/^organ[:：](.+)$/)).find(Boolean);
  const organ = om ? ORGAN_BY_NAME[om[1].trim()] || null : null;
  const sugg = (Array.isArray(j.suggestions) ? j.suggestions : []).map(x => typeof x === 'string' ? { text: x, cost: 1 } : x)
    .filter(x => x && x.text && !/发(条|个|一条)?(信息|消息|短信)|短信|打(个)?电话|手机/.test(String(x.text))).map(x => ({ text: stripTags(x.text).trim().slice(0, 20),   // 用手机的建议不要（Cora 11/11：选了也不会真发）
       cost: Math.min(2, Math.max(1, parseInt(x.cost) || 1)) })).slice(0, 4);
  return {
    ok: true,
    lines: j.lines.map(normLine).filter(Boolean),
    tags, suggestions: sugg, organ,
    action_size: ['small', 'medium', 'large'].includes(j.action_size) ? j.action_size : 'small',
    he_flags: Array.isArray(j.he_flags) ? j.he_flags.filter(x => typeof x === 'string') : [],
    appointment: j.appointment && typeof j.appointment === 'object' && j.appointment.who ? j.appointment : null,
    action_count: Math.min(5, Math.max(1, parseInt(j.action_count) || 1)),   // 玩家这次实际做了几件事（二测 · 1）
    player_fact: typeof j.player_fact === 'string' && j.player_fact.trim() && !/^(null|无|没有)$/i.test(j.player_fact.trim()) ? [...j.player_fact.trim()].slice(0, 20).join('') : null,   // 「你」亲口说的关于自己的事（借鉴机制与结局 §2）
    persuaded: j.persuaded === true,   // 说服养母（§4）
    he_owes: typeof j.he_owes === 'string' && j.he_owes.trim() && !/^(null|无|没有)$/i.test(j.he_owes.trim()) ? [...j.he_owes.trim()].slice(0, 20).join('') : null,   // 他躲开的那句（主线 1109 §1.4）
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
          const l = normLine(rescueLine(full.slice(start, i + 1))); if (l) { this.count++; this.onLine(l); }
          this.pos = i + 1; start = -1;
        }
      } else if (c === ']' && depth === 0) { this.closed = true; this.pos = i + 1; return; }
    }
  }
}
