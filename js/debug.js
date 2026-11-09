// 调试：全通存档（?debug=1 时设置页里有按钮）
// 1. 图鉴全解锁（结局、CG、器官）  2. 三个手动存档位放关键节点，自动存档不动
import { store, getGallery } from './store.js?v=1794246986';
import { ENDINGS } from './config/endings.js?v=1794246986';
import { ORGANS } from './config/world.js?v=1794246986';
import { newRun, saveRun } from './state.js?v=1794246986';


export async function unlockAll() {
  const { STORY_CGS } = await import('./ui/panels.js?v=1794246986');   // 和「回想」用同一张表，新加的 CG 自动跟上
  const g = getGallery(); const now = Date.now();
  for (const [id, e] of Object.entries(ENDINGS)) { g.endings[id] ||= now; if (e.cg) g.cgs[e.cg] ||= now; }
  for (const id of STORY_CGS) g.cgs[id] ||= now;
  for (const o of ORGANS) g.organs[o.id] ||= now;
  g.misc = { ...(g.misc || {}), organ_puzzle: now, door_drawing: now, five_petal: now };
  store.set('gallery', g);
}

async function eventsBefore(day, slot) {
  const { G } = await import('./game.js?v=1794246986'); const events = G.events;
  return events.filter(e => !e.trigger && (e.day < day || (e.day === day && e.slot < slot))).map(e => e.id);
}

function mk(day, slot, loc, v, extra = {}) {
  const s = newRun(extra.outfit || 'initial');
  Object.assign(s, { day, slot, loc, phase: 'map', v: { ...s.v, ...v } });
  s.madness = extra.madness ?? 0;
  s.c = { taVisits: 6, taLine: 2, leaveTries: 1, offlineCount: 2, notesSeen: [], ...(extra.c || {}) };
  s.f = { he_sutured: day > 18, border_found: day > 30, flower_found: true, puzzle_he: true, has_phone: true, first_msg: true, know_ta: true, know_shi: true, know_fang: true, know_man: true, man_met: true, ...(extra.f || {}) };
  s.summary = extra.summary || '';
  s.done = extra.done || [];
  s.done.push('offline_first');
  s.phone = [{ from: 'he', text: '你睡了。', ts: Date.now() - 30 * 3600e3, sep: '你不在的时候' }, { from: 'he', text: '水我换过了', ts: Date.now() - 9 * 3600e3 }];
  return s;
}

export async function makeTestSaves() {
  // 存档 1：第 18 天上午，受伤事件前（克制偏低，可以试‘入殓师’）
  saveRun(mk(18, 0, 'fields', { love: 58, resent: 35, hope: 40, restraint: 28, assim: 30 }, {
    done: await eventsBefore(18, 0), madness: 1.5,
    summary: '你在村里住了半个多月。看过牠缝人，看过河学缝纫，过了花开的节日。河对你越来越不设防，有几次话说到一半停住。',
  }), 'slot1');
  // 存档 2：第 40 天黄昏，「第四十天的问题」之前（往‘楚门的世界’走）
  saveRun(mk(40, 2, 'creek', { love: 76, resent: 30, hope: 68, restraint: 48, assim: 22 }, {
    outfit: 'redthread', done: await eventsBefore(40, 2),
    summary: '快四十天了。河给你缝过伤口，第一次越界之后自己躲了好几天。牠发疯那天你去找了河。你们去过村界，他说起过他记得的外面：会亮的车。',
  }), 'slot2');
  // 存档 3：第 42 天清晨，直接进结局判定（数值在中间、拼过牠年轻时的照片、触发过后山事件 → 隐藏结局）
  saveRun(mk(42, 0, 'room', { love: 60, resent: 50, hope: 50, restraint: 50, assim: 50 }, {
    outfit: 'glasses', done: [...(await eventsBefore(42, 0)), 'tomb_ta_secret'],
    c: { taVisits: 16, taLine: 8 }, f: { puzzle_ta_young: true, ta_secret: true },
    summary: '第四十二天。你常去牠那里，在后山看见过牠不弯着背的样子。',
  }), 'slot3');
}
